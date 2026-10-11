import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import sequelize from '../../../../config/connection';
import { seedFixture, Fixture } from './helpers/seed';
import { PerfSprintSync } from '../../../../models/PerfSprintSync';
import { getProjectDataHealth, getProjectDataHealthBatch } from '../../services/dataHealthService';

/**
 * Phase 12b: flags a project worth a second look before adding it to review
 * scope — never a block, consistent with every other gate in this module.
 */

let fx: Fixture;

beforeAll(async () => {
    await sequelize.authenticate();
});

beforeEach(async () => {
    fx = await seedFixture();
});

const isoDaysAgo = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
};

// The fixture seeds its own syncs (dated within SPRINT_WINDOW) for every
// project it creates — cleared first so each test's own sync data is the
// only thing `getProjectDataHealth` sees, since "most recent sync" would
// otherwise always resolve to the fixture's own row.
const clearSyncs = (projectId: number) => PerfSprintSync.destroy({ where: { projectId } });

describe('getProjectDataHealth', () => {
    it('flags a shared-team project even with a recent sync', async () => {
        await clearSyncs(fx.projectA.id);
        await fx.projectA.update({ isSharedTeam: true } as any);
        await PerfSprintSync.create({
            projectId: fx.projectA.id, sprintName: 'recent', periodLabel: 'recent',
            startDate: isoDaysAgo(10), endDate: isoDaysAgo(1), syncType: 'sprint', syncStatus: 'done',
        } as any);

        const health = await getProjectDataHealth(fx.projectA.id, 'monthly');
        expect(health.healthy).toBe(false);
        expect(health.isSharedTeam).toBe(true);
        expect(health.hasRecentSync).toBe(true);
        expect(health.reasons.some(r => r.includes('shared-team'))).toBe(true);
    });

    it('flags a project with no successful sync in the last 2 monthly periods', async () => {
        await clearSyncs(fx.projectB.id);
        await PerfSprintSync.create({
            projectId: fx.projectB.id, sprintName: 'stale', periodLabel: 'stale',
            startDate: isoDaysAgo(200), endDate: isoDaysAgo(190), syncType: 'sprint', syncStatus: 'done',
        } as any);

        const health = await getProjectDataHealth(fx.projectB.id, 'monthly');
        expect(health.healthy).toBe(false);
        expect(health.hasRecentSync).toBe(false);
        expect(health.reasons.some(r => r.includes('No successful sync'))).toBe(true);
    });

    it('flags a project with no sync at all, ever', async () => {
        await clearSyncs(fx.projectC.id);
        const health = await getProjectDataHealth(fx.projectC.id, 'monthly');
        expect(health.healthy).toBe(false);
        expect(health.lastSyncEndDate).toBeNull();
        expect(health.reasons.some(r => r.includes('has ever completed'))).toBe(true);
    });

    it('clears a healthy project — not shared, synced recently', async () => {
        await clearSyncs(fx.projectA.id);
        await PerfSprintSync.create({
            projectId: fx.projectA.id, sprintName: 'recent', periodLabel: 'recent',
            startDate: isoDaysAgo(10), endDate: isoDaysAgo(1), syncType: 'sprint', syncStatus: 'done',
        } as any);

        const health = await getProjectDataHealth(fx.projectA.id, 'monthly');
        expect(health.healthy).toBe(true);
        expect(health.reasons).toEqual([]);
    });

    it('a stale failed sync does not count as recent — only syncStatus=done does', async () => {
        await clearSyncs(fx.projectA.id);
        await PerfSprintSync.create({
            projectId: fx.projectA.id, sprintName: 'failed-recent', periodLabel: 'failed-recent',
            startDate: isoDaysAgo(10), endDate: isoDaysAgo(1), syncType: 'sprint', syncStatus: 'failed',
        } as any);

        const health = await getProjectDataHealth(fx.projectA.id, 'monthly');
        expect(health.hasRecentSync).toBe(false);
    });

    it('batch matches the single-project result for the same projects', async () => {
        await clearSyncs(fx.projectA.id);
        await fx.projectA.update({ isSharedTeam: true } as any);
        const batch = await getProjectDataHealthBatch([fx.projectA.id, fx.projectB.id, fx.projectC.id], 'monthly');
        const single = await getProjectDataHealth(fx.projectA.id, 'monthly');
        expect(batch.get(fx.projectA.id)).toEqual(single);
        expect(batch.size).toBe(3);
    });
});
