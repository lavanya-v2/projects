import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { Express } from 'express';
import sequelize from '../../../../config/connection';
import { createApp } from '../../../../app';
import {
    seedFixture, passIdentityGate, linkMemberToUser, ReviewCycleConfig, ReviewCycle,
    ReviewCycleParticipant, ReviewProjectSettings, Fixture,
} from './helpers/seed';
import { generateCycles } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';
import { User } from '../../../../models/User';
import { UserPermission } from '../../../../models/UserPermission';

/**
 * Phase 10: a per-project default reviewer, set once during Setup, applied to
 * every new participant whose dominant project is that one — ahead of the
 * existing single-unambiguous-lead auto-pick, not a replacement for it.
 */

const BASE = '/api/performance-review';

let app: Express;
let fx: Fixture;
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

    await ReviewCycleConfig.create({
        accountId: fx.account.id,
        scopeProjectIds: [fx.projectA.id],
        cadence: 'monthly',
        anchorDate: '2026-10-01',
        reviewYearStartMonth: 4,
        weightSystem: 60,
        weightLead: 40,
        weightCustomer: 0,
        isEnabled: true,
        createdByUserId: fx.users.superuser.id,
    } as any);
    await generateCycles(fx.account.id, '2027-03-31');
    const cycle = await ReviewCycle.findOne({ where: { accountId: fx.account.id, startDate: '2026-10-01' } });
    cycleId = cycle!.id;
});

describe('a project-level default reviewer wins over the single-unambiguous-lead auto-pick', () => {
    it('assigns the explicit default, not the auto-picked lead, to a new participant', async () => {
        // fx.users.leadA and fx.users.manager both have permission on projectA,
        // but resolveDefaultReviewer only ever auto-picks a 'lead' role — with
        // exactly one lead (leadA) it would otherwise be unambiguous and
        // auto-assigned. An explicit default reviewer should win regardless.
        await ReviewProjectSettings.create({
            projectId: fx.projectA.id,
            defaultReviewerUserId: fx.users.manager.id,
        } as any);

        await cycleService.openCycle(cycleId, fx.users.superuser.id);

        const participant = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });
        expect(participant).not.toBeNull();
        expect(participant!.reviewerUserId).toBe(fx.users.manager.id);
        expect(participant!.reviewerUserId).not.toBe(fx.users.leadA.id);
    });

    it('falls back to the single-unambiguous-lead auto-pick when no default is set', async () => {
        // No ReviewProjectSettings row at all for projectA.
        await cycleService.openCycle(cycleId, fx.users.superuser.id);

        const participant = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });
        expect(participant!.reviewerUserId).toBe(fx.users.leadA.id);
    });

    it('a late-set default is picked up by Recompute on an already-open cycle, without disturbing an existing assignment', async () => {
        await cycleService.openCycle(cycleId, fx.users.superuser.id);
        const before = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });
        expect(before!.reviewerUserId).toBe(fx.users.leadA.id);

        await ReviewProjectSettings.create({
            projectId: fx.projectA.id,
            defaultReviewerUserId: fx.users.manager.id,
        } as any);
        await cycleService.recomputeCycle(cycleId);

        const after = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });
        // freezeParticipants never overwrites a reviewer already assigned —
        // the default reviewer only applies to participants frozen after it
        // was set, exactly like any other setting change.
        expect(after!.reviewerUserId).toBe(fx.users.leadA.id);
    });
});

describe('a reviewer is never auto-assigned to review their own record', () => {
    it('leaves the reviewer null for a participant who is also the project default reviewer', async () => {
        // solo is a participant on projectA. Link them to leadA's login, then make
        // leadA the project's default reviewer — leadA would otherwise review
        // their own record via the default-reviewer path.
        await linkMemberToUser(fx.members.solo.id, fx.users.leadA.id);
        await ReviewProjectSettings.create({
            projectId: fx.projectA.id,
            defaultReviewerUserId: fx.users.leadA.id,
        } as any);

        await cycleService.openCycle(cycleId, fx.users.superuser.id);

        const self = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });
        expect(self!.reviewerUserId).toBeNull();

        // Someone else on the same project still gets the default normally —
        // the guard is per-participant, not a project-wide disable.
        const other = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.across.id },
        });
        expect(other!.reviewerUserId).toBe(fx.users.leadA.id);
    });

    it('does not retroactively clear a reviewer a superuser manually assigned to themselves', async () => {
        await linkMemberToUser(fx.members.solo.id, fx.users.leadA.id);
        await cycleService.openCycle(cycleId, fx.users.superuser.id);

        const participant = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });
        // Manual override: a human deliberately assigning leadA to their own
        // record — not the auto-pick path this guard exists to stop.
        await participant!.update({ reviewerUserId: fx.users.leadA.id });

        await ReviewProjectSettings.create({
            projectId: fx.projectA.id,
            defaultReviewerUserId: fx.users.manager.id,
        } as any);
        await cycleService.recomputeCycle(cycleId);

        const after = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });
        expect(after!.reviewerUserId).toBe(fx.users.leadA.id);
    });
});

describe('eligible reviewers include full-account and program-scoped access, not just explicit project ids', () => {
    it('a manager with full-account access (empty projectIds) is eligible for a project not in any explicit grant', async () => {
        // Real bug: a Thrive manager had project_ids=[] (full account access, the
        // normal shape for an account-wide grant) and never showed up as an
        // eligible reviewer for any of the account's projects — the old check
        // only matched an EXPLICIT project id in the array.
        await UserPermission.create({
            userId: fx.users.manager.id,
            accountId: fx.account.id,
            projectIds: [],
        } as any);

        const eligible = await cycleService.getEligibleReviewersForProject(fx.projectC.id);
        expect(eligible.some(r => r.id === fx.users.manager.id)).toBe(true);
    });

    it('resolveDefaultReviewer (via freezeParticipants) still only auto-picks an unambiguous LEAD, not a full-account manager', async () => {
        // Confirms the fix doesn't loosen resolveDefaultReviewer's stricter
        // "exactly one lead" auto-pick criterion — a manager with full-account
        // access must now be selectable by hand, but never auto-assigned.
        await UserPermission.create({
            userId: fx.users.manager.id,
            accountId: fx.account.id,
            projectIds: [],
        } as any);

        await cycleService.openCycle(cycleId, fx.users.superuser.id);
        const participant = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });
        expect(participant!.reviewerUserId).toBe(fx.users.leadA.id);
        expect(participant!.reviewerUserId).not.toBe(fx.users.manager.id);
    });
});

describe('GET /project-settings/:projectId returns eligibleReviewers', () => {
    it('matches the real, project-scoped eligible set — lead and manager, not the outside lead', async () => {
        const res = await request(app)
            .get(`${BASE}/project-settings/${fx.projectA.id}`)
            .set(auth(fx.users.superuser));

        expect(res.status).toBe(200);
        const ids = res.body.eligibleReviewers.map((r: any) => r.id);
        expect(ids).toContain(fx.users.leadA.id);
        expect(ids).toContain(fx.users.manager.id);
        expect(ids).not.toContain(fx.users.leadOutside.id);
    });

    it('scopes to project C\'s own outside lead, excluding A/B\'s lead and manager', async () => {
        const res = await request(app)
            .get(`${BASE}/project-settings/${fx.projectC.id}`)
            .set(auth(fx.users.superuser));

        expect(res.status).toBe(200);
        const ids = res.body.eligibleReviewers.map((r: any) => r.id);
        // The fixture's superuser has full-account access (projectIds: []) and
        // so is legitimately eligible everywhere, including project C — this is
        // correct now that full-account grants are honored, not a leak. The
        // real assertion is that A/B's project-scoped lead and manager are
        // correctly EXCLUDED from project C.
        expect(ids).toContain(fx.users.leadOutside.id);
        expect(ids).toContain(fx.users.superuser.id);
        expect(ids).not.toContain(fx.users.leadA.id);
        expect(ids).not.toContain(fx.users.manager.id);
    });
});

describe('PUT /project-settings/:projectId validates defaultReviewerUserId', () => {
    it('rejects a reviewer with no access to the project', async () => {
        const res = await request(app)
            .put(`${BASE}/project-settings/${fx.projectA.id}`)
            .set(auth(fx.users.superuser))
            .send({ templateId: null, defaultReviewerUserId: fx.users.leadOutside.id });

        expect(res.status).toBe(400);
    });

    it('accepts and persists an eligible reviewer', async () => {
        const res = await request(app)
            .put(`${BASE}/project-settings/${fx.projectA.id}`)
            .set(auth(fx.users.superuser))
            .send({ templateId: null, defaultReviewerUserId: fx.users.manager.id });

        expect(res.status).toBe(200);
        expect(res.body.defaultReviewerUserId).toBe(fx.users.manager.id);
    });
});
