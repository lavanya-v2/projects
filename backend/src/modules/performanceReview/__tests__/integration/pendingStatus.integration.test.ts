import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import sequelize from '../../../../config/connection';
import { createApp } from '../../../../app';
import {
    seedFixture, passIdentityGate, seedTemplate, templateItemIds, linkMemberToUser,
    ReviewCycleConfig, ReviewCycle, Fixture,
} from './helpers/seed';
import { CompetencyTemplate } from '../../../../models/CompetencyTemplate';
import { User } from '../../../../models/User';
import { generateCycles } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';
import * as leadReviewService from '../../services/leadReviewService';

/**
 * Phase 12f: a dashboard-sized summary reusing the exact participant+LeadReview
 * join listForCycle already does — the caller's own pending-review status, and,
 * when they're also a reviewer, how many of their assignments are unstarted.
 */

const BASE = '/api/performance-review';
const GOOD = 'Solid delivery this period.';

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
        weightSystem: 60, weightLead: 40, weightCustomer: 0,
        leadTemplateId: template.id,
        isEnabled: true,
        createdByUserId: fx.users.superuser.id,
    } as any);
    await generateCycles(fx.account.id, '2027-03-31');

    const cycle = await ReviewCycle.findOne({ where: { accountId: fx.account.id, startDate: '2026-10-01' } });
    cycleId = cycle!.id;
    await cycleService.openCycle(cycleId, fx.users.superuser.id);
});

async function submitAndPublish(teamMemberId: number, reviewerUserId: number) {
    const draft = await leadReviewService.getOrCreateDraft(cycleId, teamMemberId, reviewerUserId);
    await leadReviewService.saveDraft(draft.id, {
        strengths: GOOD,
        improvements: GOOD,
        ratings: [
            { templateItemId: items.quality, rating: 4, comment: GOOD },
            { templateItemId: items.ownership, rating: 3, comment: GOOD },
        ],
    });
    const submitted = await leadReviewService.submitReview(draft.id, reviewerUserId);
    await cycleService.recomputeCycle(cycleId, 'manual');
    return leadReviewService.publishReview(submitted.id, fx.users.superuser.id);
}

describe('GET /me/pending-status — member side', () => {
    it('flags a pending review when the open cycle has none published yet', async () => {
        await linkMemberToUser(fx.members.solo.id, fx.users.member.id);

        const res = await request(app).get(`${BASE}/me/pending-status`).set(auth(fx.users.member));
        expect(res.status).toBe(200);
        expect(res.body.member.hasPendingReview).toBe(true);
        expect(res.body.member.pendingCycle.id).toBe(cycleId);
    });

    it('clears the flag and reports the latest published rating once published', async () => {
        await linkMemberToUser(fx.members.solo.id, fx.users.member.id);
        await submitAndPublish(fx.members.solo.id, fx.users.leadA.id);

        const res = await request(app).get(`${BASE}/me/pending-status`).set(auth(fx.users.member));
        expect(res.status).toBe(200);
        expect(res.body.member.hasPendingReview).toBe(false);
        expect(res.body.member.latestPublished).not.toBeNull();
        expect(res.body.member.latestPublished.periodLabel).toBe('2026-10');
        expect(typeof res.body.member.latestPublished.compositeScore).toBe('number');
    });

    it('reports null for member status when the caller has no team member record', async () => {
        const res = await request(app).get(`${BASE}/me/pending-status`).set(auth(fx.users.executive));
        expect(res.status).toBe(200);
        expect(res.body.member).toBeNull();
    });
});

describe('GET /me/pending-status — lead side', () => {
    it('counts unstarted assigned reviews in the open cycle', async () => {
        const res = await request(app).get(`${BASE}/me/pending-status`).set(auth(fx.users.leadA));
        expect(res.status).toBe(200);
        expect(res.body.lead).not.toBeNull();
        expect(res.body.lead.pendingCount).toBeGreaterThan(0);
        expect(res.body.lead.cycle.id).toBe(cycleId);
    });

    it('drops to zero once every assigned review is submitted or published', async () => {
        // Every participant whose dominant project is A/B was auto-assigned to
        // leadA (the fixture's single unambiguous lead) — submit for all of them.
        for (const member of [fx.members.solo, fx.members.across, fx.members.split, fx.members.qa, fx.members.tiny]) {
            await submitAndPublish(member.id, fx.users.leadA.id);
        }

        const res = await request(app).get(`${BASE}/me/pending-status`).set(auth(fx.users.leadA));
        expect(res.status).toBe(200);
        expect(res.body.lead.pendingCount).toBe(0);
    });

    it('is null for someone not a reviewer on any open cycle', async () => {
        const res = await request(app).get(`${BASE}/me/pending-status`).set(auth(fx.users.executive));
        expect(res.status).toBe(200);
        expect(res.body.lead).toBeNull();
    });
});
