import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import sequelize from '../../../../config/connection';
import {
    seedFixture, passIdentityGate, seedTemplate, ReviewCycleConfig, ReviewCycle,
    ReviewProjectSettings, CompetencyTemplate, Fixture,
} from './helpers/seed';
import { generateCycles } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';
import { getOrCreateDraft } from '../../services/leadReviewService';

/**
 * Phase 9: a project can point at a specific competency template instead of
 * the account default — a plain pointer at an existing template, not a new
 * one authored per project.
 */

let fx: Fixture;
let cycleId: number;

beforeAll(async () => {
    await sequelize.authenticate();
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
    await cycleService.openCycle(cycleId, fx.users.superuser.id);
});

describe('a project-level template override wins over the account default', () => {
    it('opens a review against the overridden template, not the account default', async () => {
        const accountDefault = await seedTemplate(fx.account.id, fx.users.superuser.id);

        const projectTemplate = await CompetencyTemplate.create({
            name: 'Project-specific template',
            scope: 'project',
            projectId: fx.projectA.id,
            version: 1,
            status: 'active',
            ratingScaleMin: 1,
            ratingScaleMax: 5,
            createdByUserId: fx.users.superuser.id,
        } as any);

        await ReviewProjectSettings.create({ projectId: fx.projectA.id, templateId: projectTemplate.id } as any);

        const review = await getOrCreateDraft(cycleId, fx.members.solo.id, fx.users.leadA.id);
        expect(review.templateId).toBe(projectTemplate.id);
        expect(review.templateId).not.toBe(accountDefault.id);
    });

    it('falls back to the account default once the override is removed', async () => {
        const accountDefault = await seedTemplate(fx.account.id, fx.users.superuser.id);

        const projectTemplate = await CompetencyTemplate.create({
            name: 'Project-specific template',
            scope: 'project',
            projectId: fx.projectA.id,
            version: 1,
            status: 'active',
            ratingScaleMin: 1,
            ratingScaleMax: 5,
            createdByUserId: fx.users.superuser.id,
        } as any);

        const settings = await ReviewProjectSettings.create({
            projectId: fx.projectA.id, templateId: projectTemplate.id,
        } as any);
        await settings.update({ templateId: null });

        const review = await getOrCreateDraft(cycleId, fx.members.solo.id, fx.users.leadA.id);
        expect(review.templateId).toBe(accountDefault.id);
    });

    it('an account with no override scores identically to before this feature existed', async () => {
        const accountDefault = await seedTemplate(fx.account.id, fx.users.superuser.id);

        // No ReviewProjectSettings row at all for projectA.
        const review = await getOrCreateDraft(cycleId, fx.members.solo.id, fx.users.leadA.id);
        expect(review.templateId).toBe(accountDefault.id);
    });
});
