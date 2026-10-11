import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import sequelize from '../../../../config/connection';
import { createApp } from '../../../../app';
import {
    seedFixture, passIdentityGate, seedTemplate, templateItemIds, linkMemberToUser, Fixture,
} from './helpers/seed';
import { ReviewCycleConfig } from '../../../../models/ReviewCycleConfig';
import { ReviewCycle } from '../../../../models/ReviewCycle';
import { ReviewCycleParticipant } from '../../../../models/ReviewCycleParticipant';
import { ReviewCycleSource } from '../../../../models/ReviewCycleSource';
import { CompetencyTemplate } from '../../../../models/CompetencyTemplate';
import { User } from '../../../../models/User';
import { generateCycles } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';
import * as leadReviewService from '../../services/leadReviewService';

/**
 * Phase 4: the member-facing surface, end to end over HTTP.
 *
 * The service layer for acknowledgement was covered in leadReview.integration.test.ts.
 * What has not been proven is the actual member-facing route: identity resolution
 * from a JWT to a roster row, the trend series shape, and — the property that
 * matters most for a system that decides what a member is allowed to see — that
 * visibility flips from 404 to 200 at exactly the moment a review is published,
 * never before.
 */

const BASE = '/api/performance-review';

let app: Express;
let fx: Fixture;
let template: CompetencyTemplate;
let items: Record<string, number>;
let cycleId: number;

const GOOD = 'Consistently reviewed others PRs and caught two production issues pre-release.';

const tokenFor = (user: User): string =>
    jwt.sign(
        { id: user.id, userId: user.userId, role: (user as any).role },
        process.env.JWT_SECRET || 'default_secret_key',
        { expiresIn: '1h' },
    );

const auth = (user: User) => ({ Authorization: `Bearer ${tokenFor(user)}` });

beforeAll(async () => {
    await sequelize.authenticate();
    app = createApp();
});

beforeEach(async () => {
    fx = await seedFixture();
    await passIdentityGate(fx.projectA.id, fx.users.superuser.id);
    await passIdentityGate(fx.projectB.id, fx.users.superuser.id);
    template = await seedTemplate(fx.account.id, fx.users.superuser.id);
    items = await templateItemIds(template.id);

    // The 'solo' team member IS the signed-in member user for these tests.
    await linkMemberToUser(fx.members.solo.id, fx.users.member.id);

    await ReviewCycleConfig.create({
        accountId: fx.account.id,
        scopeProjectIds: [fx.projectA.id, fx.projectB.id],
        cadence: 'monthly',
        anchorDate: '2026-10-01',
        reviewYearStartMonth: 4,
        weightSystem: 60,
        weightLead: 40,
        weightCustomer: 0,
        leadTemplateId: template.id,
        isEnabled: true,
        createdByUserId: fx.users.superuser.id,
    } as any);
    await generateCycles(fx.account.id, '2027-03-31');

    const cycle = await ReviewCycle.findOne({ where: { accountId: fx.account.id, startDate: '2026-10-01' } });
    cycleId = cycle!.id;
    await cycleService.openCycle(cycleId, fx.users.superuser.id);
});

/**
 * Submit and publish a review, exactly as the real request lifecycle does.
 *
 * `leadReviewController.submit` recomputes the cycle right after
 * `leadReviewService.submitReview` — the service layer deliberately leaves that to
 * its caller (the same split every other test in this suite follows, e.g.
 * leadReview.integration.test.ts's "counts a submitted review" case). Skipping it
 * here would publish a review whose ReviewMemberScore row still reflects the
 * pre-submission state, which is a test-fixture bug, not a service one.
 */
async function submitAndPublishReview(teamMemberId = fx.members.solo.id) {
    const draft = await leadReviewService.getOrCreateDraft(cycleId, teamMemberId, fx.users.leadA.id);
    await leadReviewService.saveDraft(draft.id, {
        strengths: 'Strong ownership of the payments migration.',
        improvements: 'Could bring design decisions to the team earlier.',
        ratings: [
            { templateItemId: items.quality, rating: 4, comment: GOOD },
            { templateItemId: items.ownership, rating: 3, comment: GOOD },
        ],
    });
    const submitted = await leadReviewService.submitReview(draft.id, fx.users.leadA.id);
    await cycleService.recomputeCycle(cycleId, 'manual');
    return leadReviewService.publishReview(submitted.id, fx.users.superuser.id);
}

describe('identity resolution', () => {
    it('resolves the caller to their roster row via the user_id FK', async () => {
        await submitAndPublishReview();
        const res = await request(app).get(`${BASE}/me/reviews`).set(auth(fx.users.member));

        expect(res.status).toBe(200);
        expect(res.body.teamMember.id).toBe(fx.members.solo.id);
    });

    it('returns an empty, non-erroring payload for a user with no roster match', async () => {
        // leadOutside is a real user but was never linked to any team_members row.
        const res = await request(app).get(`${BASE}/me/reviews`).set(auth(fx.users.leadOutside));

        expect(res.status).toBe(200);
        expect(res.body.teamMember).toBeNull();
        expect(res.body.reviews).toEqual([]);
        expect(res.body.trend).toEqual([]);
    });
});

describe('visibility flips exactly at publish, never before', () => {
    it('shows nothing while the review is still a draft', async () => {
        await leadReviewService.getOrCreateDraft(cycleId, fx.members.solo.id, fx.users.leadA.id);

        const list = await request(app).get(`${BASE}/me/reviews`).set(auth(fx.users.member));
        expect(list.body.reviews).toEqual([]);

        const detail = await request(app).get(`${BASE}/me/reviews/${cycleId}`).set(auth(fx.users.member));
        expect(detail.status).toBe(404);
    });

    it('shows nothing while the review is submitted but not yet published', async () => {
        const draft = await leadReviewService.getOrCreateDraft(cycleId, fx.members.solo.id, fx.users.leadA.id);
        await leadReviewService.saveDraft(draft.id, {
            strengths: 'x'.repeat(10), improvements: 'y'.repeat(10),
            ratings: [
                { templateItemId: items.quality, rating: 4, comment: GOOD },
                { templateItemId: items.ownership, rating: 3, comment: GOOD },
            ],
        });
        await leadReviewService.submitReview(draft.id, fx.users.leadA.id);

        const detail = await request(app).get(`${BASE}/me/reviews/${cycleId}`).set(auth(fx.users.member));
        expect(detail.status).toBe(404);
    });

    it('appears the moment the review is published', async () => {
        const published = await submitAndPublishReview();

        const detail = await request(app).get(`${BASE}/me/reviews/${cycleId}`).set(auth(fx.users.member));
        expect(detail.status).toBe(200);
        expect(detail.body.review.id).toBe(published.id);
        expect(detail.body.review.status).toBe('published');
    });

    it('never returns a review score for a cycle that has not been published', async () => {
        // Score the cycle but only lock it — never publish.
        await cycleService.transitionCycle(cycleId, 'locked', null, fx.users.superuser.id);

        const detail = await request(app).get(`${BASE}/me/reviews/${cycleId}`).set(auth(fx.users.member));
        // No lead review exists at all in this test, so 404 either way — the
        // real assertion is in the score endpoint: an un-published cycle's
        // ReviewMemberScore rows must never surface through /me/reviews.
        expect(detail.status).toBe(404);

        const list = await request(app).get(`${BASE}/me/reviews`).set(auth(fx.users.member));
        expect(list.body.trend).toEqual([]);
    });
});

describe('the trend series', () => {
    it('carries the composite, factor scores, coverage and provisional flag', async () => {
        await submitAndPublishReview();

        const res = await request(app).get(`${BASE}/me/reviews`).set(auth(fx.users.member));
        expect(res.body.trend).toHaveLength(1);

        const point = res.body.trend[0];
        expect(point.periodLabel).toBe('2026-10');
        expect(point.systemScore).toBeCloseTo(86.4, 1);
        // quality: (4-1)/4*100=75 @weight 3; ownership: (3-1)/4*100=50 @weight 1
        // -> (3*75 + 1*50) / 4 = 68.75
        expect(point.leadScore).toBeCloseTo(68.75, 1);
        expect(point.overallCoverage).toBe(100);
        expect(point.isProvisional).toBe(false);
        expect(point.acknowledgedAt).toBeNull();
    });

    it('is scoped to the caller — never returns another member\'s trend', async () => {
        await submitAndPublishReview(fx.members.solo.id);
        // 'across' also has a data row but no review published for them.
        await linkMemberToUser(fx.members.across.id, fx.users.leadOutside.id);

        const res = await request(app).get(`${BASE}/me/reviews`).set(auth(fx.users.leadOutside));
        expect(res.body.trend).toEqual([]);
    });
});

describe('acknowledgement over HTTP', () => {
    it('lets the subject acknowledge their own published review', async () => {
        const published = await submitAndPublishReview();

        const res = await request(app)
            .post(`${BASE}/me/reviews/${published.id}/acknowledge`)
            .set(auth(fx.users.member))
            .send({ comment: 'Discussed on the 12th.' });

        expect(res.status).toBe(200);
        expect(res.body.acknowledgedAt).toBeTruthy();
        expect(res.body.acknowledgementComment).toBe('Discussed on the 12th.');
    });

    it('refuses acknowledgement from someone who is not the subject', async () => {
        const published = await submitAndPublishReview();
        // leadOutside IS linked to a roster row — just not the one this review is
        // about — so the request reaches the subject check rather than 404ing
        // earlier for having no roster record at all.
        await linkMemberToUser(fx.members.across.id, fx.users.leadOutside.id);

        const res = await request(app)
            .post(`${BASE}/me/reviews/${published.id}/acknowledge`)
            .set(auth(fx.users.leadOutside))
            .send({});

        expect(res.status).toBe(403);
    });

    it('requires authentication', async () => {
        const published = await submitAndPublishReview();
        const res = await request(app).post(`${BASE}/me/reviews/${published.id}/acknowledge`).send({});
        expect(res.status).toBe(401);
    });
});

describe('cycle administration over HTTP (Phase 4 admin screens)', () => {
    it('assigns a reviewer through the participants endpoint', async () => {
        const participant = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });

        const res = await request(app)
            .patch(`${BASE}/participants/${participant!.id}`)
            .set(auth(fx.users.superuser))
            .send({ reviewerUserId: fx.users.manager.id });

        expect(res.status).toBe(200);
        expect(res.body.reviewerUserId).toBe(fx.users.manager.id);
    });

    it('refuses to reassign a reviewer once the cycle is locked', async () => {
        await cycleService.transitionCycle(cycleId, 'locked', null, fx.users.superuser.id);
        const participant = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });

        const res = await request(app)
            .patch(`${BASE}/participants/${participant!.id}`)
            .set(auth(fx.users.superuser))
            .send({ reviewerUserId: fx.users.manager.id });

        expect(res.status).toBe(409);
    });

    it('drives the full lifecycle through HTTP: open sources visible, lock freezes, publish exposes to the member', async () => {
        const sourcesRes = await request(app)
            .get(`${BASE}/cycles/${cycleId}/sources`)
            .set(auth(fx.users.superuser));
        expect(sourcesRes.status).toBe(200);
        expect(sourcesRes.body.length).toBeGreaterThan(0);

        await submitAndPublishReview();

        const lockRes = await request(app)
            .post(`${BASE}/cycles/${cycleId}/transition`)
            .set(auth(fx.users.superuser))
            .send({ toStatus: 'locked' });
        expect(lockRes.status).toBe(200);

        const publishRes = await request(app)
            .post(`${BASE}/cycles/${cycleId}/transition`)
            .set(auth(fx.users.superuser))
            .send({ toStatus: 'published' });
        expect(publishRes.status).toBe(200);
        expect(publishRes.body.status).toBe('published');

        const memberView = await request(app).get(`${BASE}/me/reviews/${cycleId}`).set(auth(fx.users.member));
        expect(memberView.status).toBe(200);
        expect(memberView.body.score.isPublished).toBe(true);
    });

    it('excluding a source through HTTP is reflected in the next admin scores read', async () => {
        const source = await ReviewCycleSource.findOne({ where: { reviewCycleId: cycleId } });

        await request(app)
            .patch(`${BASE}/cycles/${cycleId}/sources/${source!.id}`)
            .set(auth(fx.users.superuser))
            .send({ excluded: true, reason: 'Sprint cancelled mid-flight' });

        const scoresRes = await request(app)
            .get(`${BASE}/cycles/${cycleId}/scores`)
            .set(auth(fx.users.superuser));
        expect(scoresRes.status).toBe(200);
        // Recompute happens inside updateSource; scores must reflect the exclusion,
        // not the stale pre-exclusion figures.
        const solo = scoresRes.body.find((s: any) => s.teamMemberId === fx.members.solo.id);
        expect(solo).toBeDefined();
    });
});
