import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import sequelize from '../../../../config/connection';
import {
    seedFixture, PerfIdentityLink, ReviewCycleConfig, ReviewCycle, ReviewCycleParticipant,
    ReviewMemberScore, Fixture,
} from './helpers/seed';
import { seedSuggestions, bulkConfirm, decideLink } from '../../services/identityResolutionService';
import { generateCycles } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';

/**
 * Phase 8: a project should never wait on its last unresolved person, and a
 * person confirmed after a cycle opens must be able to join it without
 * redoing anything else.
 */

let fx: Fixture;

beforeAll(async () => {
    await sequelize.authenticate();
});

beforeEach(async () => {
    fx = await seedFixture();
});

describe('a person confirmed after cycle open joins it on the next recompute', () => {
    it('freezes only the resolved people at open, then adds a late confirmation without disturbing the rest', async () => {
        // Seed suggestions for project A (solo, across, tiny all match by exact
        // name), but only confirm solo and across — tiny stays undecided,
        // standing in for Megha.
        await seedSuggestions(fx.projectA.id);

        const tinyLink = await PerfIdentityLink.findOne({
            where: { projectId: fx.projectA.id, teamMemberId: fx.members.tiny.id, status: 'suggested' },
        });
        expect(tinyLink).not.toBeNull();
        // Dismiss it for now — she is deliberately left for later, not blocking anyone.
        await decideLink(tinyLink!.id, 'reject', fx.users.superuser.id);

        const { confirmed } = await bulkConfirm(fx.projectA.id, fx.users.superuser.id);
        expect(confirmed).toBeGreaterThanOrEqual(2); // solo + across at minimum

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

        const cycle = await ReviewCycle.findOne({
            where: { accountId: fx.account.id, startDate: '2026-10-01' },
        });
        await cycleService.openCycle(cycle!.id, fx.users.superuser.id);

        const afterOpen = await ReviewCycleParticipant.findAll({ where: { reviewCycleId: cycle!.id } });
        expect(afterOpen.map(p => p.teamMemberId).sort()).toEqual(
            [fx.members.solo.id, fx.members.across.id].sort(),
        );

        const soloScoreBefore = await ReviewMemberScore.findOne({
            where: { reviewCycleId: cycle!.id, teamMemberId: fx.members.solo.id },
        });
        expect(soloScoreBefore).not.toBeNull();

        // Confirm tiny now — the "add Megha back" moment.
        await decideLink(tinyLink!.id, 'confirm', fx.users.superuser.id);

        const { scored } = await cycleService.recomputeCycle(cycle!.id, 'manual');
        expect(scored).toBeGreaterThan(0);

        const afterRecompute = await ReviewCycleParticipant.findAll({ where: { reviewCycleId: cycle!.id } });
        expect(afterRecompute.map(p => p.teamMemberId).sort()).toEqual(
            [fx.members.solo.id, fx.members.across.id, fx.members.tiny.id].sort(),
        );

        const tinyScore = await ReviewMemberScore.findOne({
            where: { reviewCycleId: cycle!.id, teamMemberId: fx.members.tiny.id },
        });
        expect(tinyScore).not.toBeNull();
        // Tiny is below the volume floor — present as a participant, but her
        // system factor is missing, never scored 0.
        expect(tinyScore!.systemPresent).toBe(false);

        const soloScoreAfter = await ReviewMemberScore.findOne({
            where: { reviewCycleId: cycle!.id, teamMemberId: fx.members.solo.id },
        });
        expect(Number(soloScoreAfter!.compositeScore)).toBe(Number(soloScoreBefore!.compositeScore));
    });

    it('refuses to add a late confirmation to a locked cycle — she starts next cycle instead', async () => {
        await seedSuggestions(fx.projectA.id);
        const tinyLink = await PerfIdentityLink.findOne({
            where: { projectId: fx.projectA.id, teamMemberId: fx.members.tiny.id, status: 'suggested' },
        });
        await decideLink(tinyLink!.id, 'reject', fx.users.superuser.id);
        await bulkConfirm(fx.projectA.id, fx.users.superuser.id);

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
        await cycleService.openCycle(cycle!.id, fx.users.superuser.id);
        await cycleService.transitionCycle(cycle!.id, 'locked', null, fx.users.superuser.id);

        await decideLink(tinyLink!.id, 'confirm', fx.users.superuser.id);

        await expect(cycleService.recomputeCycle(cycle!.id, 'manual')).rejects.toThrow(
            cycleService.FrozenCycleError,
        );

        const participants = await ReviewCycleParticipant.findAll({ where: { reviewCycleId: cycle!.id } });
        expect(participants.some(p => p.teamMemberId === fx.members.tiny.id)).toBe(false);
    });
});
