import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import sequelize from '../../../../config/connection';
import { createApp } from '../../../../app';
import { seedFixture, passIdentityGate, seedTemplate, templateItemIds, addExtraSprint, Fixture } from './helpers/seed';
import { ReviewCycleConfig } from '../../../../models/ReviewCycleConfig';
import { ReviewCycle } from '../../../../models/ReviewCycle';
import { ReviewCycleParticipant } from '../../../../models/ReviewCycleParticipant';
import { UserPermission } from '../../../../models/UserPermission';
import { CompetencyTemplate } from '../../../../models/CompetencyTemplate';
import { User } from '../../../../models/User';
import { generateCycles } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';
import * as leadReviewService from '../../services/leadReviewService';

/**
 * A lead's view of a team member's history across team changes — the
 * confidentiality boundary is the point of these tests.
 *
 * Every "redacted" assertion below checks the actual JSON payload, not a UI
 * concept: a redacted field must be ABSENT from what the server sends, not merely
 * unrendered by a client that could be swapped out.
 */

const BASE = '/api/performance-review';
const GOOD = 'Consistently reviewed others PRs and caught two production issues pre-release.';

let app: Express;
let fx: Fixture;
let template: CompetencyTemplate;
let items: Record<string, number>;
let cycleId: number;

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
 * Being the assigned reviewer is the authorization signal this feature is built
 * on, but it is layered on top of the module's existing project-access gate
 * (`resolveReviewPermissions`'s `hasOverlap` check applies here too) — reflecting
 * real deployments, where a reassignment is only meaningful for someone who
 * already has standing on the relevant projects. A raw reviewer-slot edit with no
 * matching UserPermission row (as this fixture's `leadOutside` starts with,
 * scoped only to project C) needs this grant to become realistic.
 */
async function grantAccess(userId: number, projectIds: number[]): Promise<void> {
    await UserPermission.create({ userId, accountId: fx.account.id, projectIds } as any);
}

async function submitAndPublish(teamMemberId: number, reviewerUserId: number) {
    const draft = await leadReviewService.getOrCreateDraft(cycleId, teamMemberId, reviewerUserId);
    await leadReviewService.saveDraft(draft.id, {
        strengths: 'Strong ownership of the payments migration.',
        improvements: 'Could bring design decisions to the team earlier.',
        ratings: [
            { templateItemId: items.quality, rating: 4, comment: GOOD },
            { templateItemId: items.ownership, rating: 3, comment: GOOD },
        ],
    });
    const submitted = await leadReviewService.submitReview(draft.id, reviewerUserId);
    await cycleService.recomputeCycle(cycleId, 'manual');
    return leadReviewService.publishReview(submitted.id, fx.users.superuser.id);
}

describe('own-authored history is unredacted', () => {
    it('returns full narrative and ratings for a cycle the lead reviewed themself', async () => {
        await submitAndPublish(fx.members.solo.id, fx.users.leadA.id);

        const res = await request(app)
            .get(`${BASE}/team-members/${fx.members.solo.id}/history`)
            .set(auth(fx.users.leadA));

        expect(res.status).toBe(200);
        expect(res.body.teamMember.id).toBe(fx.members.solo.id);
        const cycle = res.body.cycles.find((c: any) => c.cycleId === cycleId);
        expect(cycle.review.redacted).toBe(false);
        expect(cycle.review.strengths).toBeTruthy();
        expect(cycle.review.ratings.length).toBeGreaterThan(0);
        expect(cycle.score.compositeScore).not.toBeNull();
    });
});

describe('a different lead\'s authored review is redacted', () => {
    it('strips narrative and ratings entirely from the payload, keeps the score', async () => {
        // leadA authors and publishes. manager is granted the reviewer slot for the
        // NEXT cycle, simulating a team change — but for THIS cycle they were not
        // the author, so it must be redacted for them specifically.
        await submitAndPublish(fx.members.solo.id, fx.users.leadA.id);

        // Give leadOutside "current reviewer" standing for solo via a manual
        // reassignment on this same cycle's participant row, so the AUTHORIZATION
        // check (are they currently assigned to this person) passes, while the
        // REVIEW itself remains authored by leadA — the exact case the redaction
        // rule exists for.
        await grantAccess(fx.users.leadOutside.id, [fx.projectA.id, fx.projectB.id]);
        const participant = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });
        await participant!.update({ reviewerUserId: fx.users.leadOutside.id });

        const res = await request(app)
            .get(`${BASE}/team-members/${fx.members.solo.id}/history`)
            .set(auth(fx.users.leadOutside));

        expect(res.status).toBe(200);
        const cycle = res.body.cycles.find((c: any) => c.cycleId === cycleId);

        expect(cycle.review.redacted).toBe(true);
        expect(cycle.review.reviewerName).toBeTruthy();
        // The actual server payload must not carry these keys at all.
        expect(cycle.review.strengths).toBeUndefined();
        expect(cycle.review.improvements).toBeUndefined();
        expect(cycle.review.overallComment).toBeUndefined();
        expect(cycle.review.ratings).toBeUndefined();
        expect(cycle.review.normalizedScore).toBeUndefined();

        // The numbers are NOT redacted — only the narrative is.
        expect(cycle.score.compositeScore).not.toBeNull();
        expect(cycle.score.leadScore).not.toBeNull();
    });
});

describe('authorization: only the current reviewer (or above) may open a profile', () => {
    it('forbids a lead who is not currently assigned to this person', async () => {
        // leadOutside was never made this person's reviewer in this fixture.
        const res = await request(app)
            .get(`${BASE}/team-members/${fx.members.solo.id}/history`)
            .set(auth(fx.users.leadOutside));

        expect(res.status).toBe(403);
    });

    it('forbids a member entirely', async () => {
        const res = await request(app)
            .get(`${BASE}/team-members/${fx.members.solo.id}/history`)
            .set(auth(fx.users.member));
        expect(res.status).toBe(403);
    });

    it('lets a manager see everyone, unredacted', async () => {
        await submitAndPublish(fx.members.solo.id, fx.users.leadA.id);

        const res = await request(app)
            .get(`${BASE}/team-members/${fx.members.solo.id}/history`)
            .set(auth(fx.users.manager));

        expect(res.status).toBe(200);
        const cycle = res.body.cycles.find((c: any) => c.cycleId === cycleId);
        expect(cycle.review.redacted).toBe(false);
        expect(cycle.review.strengths).toBeTruthy();
    });

    it('requires authentication', async () => {
        const res = await request(app).get(`${BASE}/team-members/${fx.members.solo.id}/history`);
        expect(res.status).toBe(401);
    });
});

describe('reassignment moves visibility with it', () => {
    it('shows an earlier cycle redacted and a later one full, for a newly assigned lead', async () => {
        // Cycle N: leadA reviews solo.
        await submitAndPublish(fx.members.solo.id, fx.users.leadA.id);

        // Reassign solo to leadOutside for a SECOND cycle. They need delivery data
        // IN that window to become a participant at all — the fixture's sprints
        // are all dated in October, so a November sprint has to be added first.
        await addExtraSprint(fx.projectA.id, fx.members.solo.id, 'A-Sprint-Nov', '2026-11-01', '2026-11-15', {
            spPlanned: 10, spDone: 8, deliveredCount: 4,
        });
        await cycleService.transitionCycle(cycleId, 'locked', null, fx.users.superuser.id);
        await generateCycles(fx.account.id, '2027-03-31');
        const nextCycle = await ReviewCycle.findOne({
            where: { accountId: fx.account.id, startDate: '2026-11-01' },
        });
        await cycleService.openCycle(nextCycle!.id, fx.users.superuser.id);

        const nextParticipant = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: nextCycle!.id, teamMemberId: fx.members.solo.id },
        });
        expect(nextParticipant).toBeTruthy();
        await grantAccess(fx.users.leadOutside.id, [fx.projectA.id, fx.projectB.id]);
        await nextParticipant!.update({ reviewerUserId: fx.users.leadOutside.id });

        const draft = await leadReviewService.getOrCreateDraft(
            nextCycle!.id, fx.members.solo.id, fx.users.leadOutside.id,
        );
        await leadReviewService.saveDraft(draft.id, {
            strengths: 'New team, ramped up fast.',
            improvements: 'Still learning the codebase.',
            ratings: [
                { templateItemId: items.quality, rating: 3, comment: GOOD },
                { templateItemId: items.ownership, rating: 3, comment: GOOD },
            ],
        });
        const submitted = await leadReviewService.submitReview(draft.id, fx.users.leadOutside.id);
        await cycleService.recomputeCycle(nextCycle!.id, 'manual');
        await leadReviewService.publishReview(submitted.id, fx.users.superuser.id);

        const res = await request(app)
            .get(`${BASE}/team-members/${fx.members.solo.id}/history`)
            .set(auth(fx.users.leadOutside));

        expect(res.status).toBe(200);
        const first = res.body.cycles.find((c: any) => c.cycleId === cycleId);
        const second = res.body.cycles.find((c: any) => c.cycleId === nextCycle!.id);

        expect(first.review.redacted).toBe(true);
        expect(first.review.strengths).toBeUndefined();
        expect(second.review.redacted).toBe(false);
        expect(second.review.strengths).toBe('New team, ramped up fast.');
    });
});

describe('a person never part of any review cycle', () => {
    it('forbids a lead from learning even that the person has no history', async () => {
        // Ghost Contractor was rejected at the identity gate and is not linked to
        // any TeamMember row, so this addresses a genuine roster member instead:
        // create one with no participation anywhere and confirm a lead gets 403,
        // not a 200-with-nothing that would leak "this id exists, unreviewed".
        const { TeamMember } = await import('../../../../models/TeamMember');
        const neverReviewed = await TeamMember.create({
            firstName: 'Never', lastName: 'Reviewed',
            email: `never-reviewed-${Date.now()}@v2solutions.com`,
        } as any);

        const asLead = await request(app)
            .get(`${BASE}/team-members/${neverReviewed.id}/history`)
            .set(auth(fx.users.leadOutside));
        expect(asLead.status).toBe(403);

        const asSuperuser = await request(app)
            .get(`${BASE}/team-members/${neverReviewed.id}/history`)
            .set(auth(fx.users.superuser));
        expect(asSuperuser.status).toBe(200);
        expect(asSuperuser.body.cycles).toEqual([]);
    });

    it('404s for a team member id that does not exist at all', async () => {
        const res = await request(app)
            .get(`${BASE}/team-members/9999999/history`)
            .set(auth(fx.users.superuser));
        expect(res.status).toBe(404);
    });
});
