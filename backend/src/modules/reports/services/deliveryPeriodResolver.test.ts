import { describe, it, expect, vi } from 'vitest';
import { resolveDeliveryPeriods, fridayOnOrBefore, isoWeekOfThursday } from './deliveryPeriodResolver';
import { generateCycles } from './kanbanCycleService';

const MON = '2026-06-01'; // confirmed Monday in kanbanCycleService.test.ts

describe('resolveDeliveryPeriods — cadence provider', () => {
    // Characterisation: this is the exact call performanceSyncService
    // .getKanbanCyclesForProject made directly before its refactor to this
    // seam (kanbanCycleAnchorDate, kanbanCycleDays, asOf, kanbanCycleStrideDays
    // -> generateCycles, sliced to `limit`, reversed to newest-first). The
    // seam must reproduce it exactly -- same dates, same order, same count --
    // or the refactor changes behaviour for every existing Kanban project.
    it('reproduces generateCycles exactly for a back-to-back (no-stride) project', async () => {
        const project = { deliveryModel: 'cadence' as const, kanbanCycleAnchorDate: MON, kanbanCycleDays: 7 };
        const asOf = '2026-06-22';
        const limit = 24;

        const direct = generateCycles(MON, 7, asOf).slice(-limit).reverse();
        const viaSeam = await resolveDeliveryPeriods(project, null, asOf, limit);

        expect(viaSeam.map(p => [p.startDate, p.endDate])).toEqual(direct.map(c => [c.startDate, c.endDate]));
        expect(viaSeam.map(p => p.label)).toEqual(direct.map(c => c.label));
        expect(viaSeam.map(p => p.isComplete)).toEqual(direct.map(c => c.isComplete));
        expect(viaSeam.map(p => p.sourceId)).toEqual(direct.map(c => c.index));
    });

    it('reproduces generateCycles exactly for a Mon-Fri (window 5 / stride 7) project', async () => {
        const project = {
            deliveryModel: 'cadence' as const,
            kanbanCycleAnchorDate: MON,
            kanbanCycleDays: 5,
            kanbanCycleStrideDays: 7,
        };
        const asOf = '2026-08-14';

        const direct = generateCycles(MON, 5, asOf, 7).slice(-24).reverse();
        const viaSeam = await resolveDeliveryPeriods(project, null, asOf);

        expect(viaSeam.map(p => [p.startDate, p.endDate])).toEqual(direct.map(c => [c.startDate, c.endDate]));
        expect(viaSeam.length).toBeGreaterThan(0);
    });

    it('caps at limit and stays newest-first', async () => {
        const project = { deliveryModel: 'cadence' as const, kanbanCycleAnchorDate: MON, kanbanCycleDays: 7 };
        const periods = await resolveDeliveryPeriods(project, null, '2026-09-01', 3);
        expect(periods).toHaveLength(3);
        const starts = periods.map(p => p.startDate);
        expect(starts).toEqual([...starts].sort().reverse());
    });

    it('tags every period kind="cadence" with a numeric sourceId (the cycle index)', async () => {
        const project = { deliveryModel: 'cadence' as const, kanbanCycleAnchorDate: MON, kanbanCycleDays: 7 };
        const periods = await resolveDeliveryPeriods(project, null, '2026-06-10');
        expect(periods.every(p => p.kind === 'cadence')).toBe(true);
        expect(periods.every(p => typeof p.sourceId === 'number')).toBe(true);
    });

    it('returns empty when the cadence is not configured', async () => {
        expect(await resolveDeliveryPeriods({ deliveryModel: 'cadence', kanbanCycleAnchorDate: null, kanbanCycleDays: null }, null, '2026-06-10')).toEqual([]);
        expect(await resolveDeliveryPeriods({ deliveryModel: 'cadence', kanbanCycleAnchorDate: MON, kanbanCycleDays: null }, null, '2026-06-10')).toEqual([]);
    });
});

describe('resolveDeliveryPeriods — sprint provider', () => {
    const sampleSprints = [
        { id: 42, name: 'Sprint 42', state: 'active', startDate: '2026-06-08T09:00:00.000Z', endDate: '2026-06-22T09:00:00.000Z' },
        { id: 41, name: 'Sprint 41', state: 'closed', startDate: '2026-05-25T09:00:00.000Z', endDate: '2026-06-08T09:00:00.000Z' },
    ];

    it('normalizes Jira sprints into the common period shape', async () => {
        const jira = { listBoardSprints: vi.fn().mockResolvedValue(sampleSprints) };
        const project = { deliveryModel: 'sprint' as const, jiraBoardId: 188 };

        const periods = await resolveDeliveryPeriods(project, jira as any, '2026-06-10');

        expect(periods).toEqual([
            { kind: 'sprint', startDate: sampleSprints[0].startDate, endDate: sampleSprints[0].endDate, label: 'Sprint 42', isComplete: false, sourceId: 42 },
            { kind: 'sprint', startDate: sampleSprints[1].startDate, endDate: sampleSprints[1].endDate, label: 'Sprint 41', isComplete: true, sourceId: 41 },
        ]);
    });

    it('calls listBoardSprints with the board id and limit, and does not touch kanban cycle logic', async () => {
        const jira = { listBoardSprints: vi.fn().mockResolvedValue([]) };
        await resolveDeliveryPeriods({ deliveryModel: 'sprint', jiraBoardId: 188 }, jira as any, '2026-06-10', 10);
        expect(jira.listBoardSprints).toHaveBeenCalledWith(188, 10);
    });

    it('returns empty without a jira client', async () => {
        expect(await resolveDeliveryPeriods({ deliveryModel: 'sprint', jiraBoardId: 188 }, null, '2026-06-10')).toEqual([]);
    });

    it('returns empty without a board id, and never calls Jira', async () => {
        const jira = { listBoardSprints: vi.fn() };
        const periods = await resolveDeliveryPeriods({ deliveryModel: 'sprint', jiraBoardId: null }, jira as any, '2026-06-10');
        expect(periods).toEqual([]);
        expect(jira.listBoardSprints).not.toHaveBeenCalled();
    });
});

describe('fridayOnOrBefore', () => {
    it('a Friday maps to itself', () => {
        expect(fridayOnOrBefore('2026-08-14')).toBe('2026-08-14'); // confirmed Friday
    });

    it('a Thursday maps to the Friday six days earlier', () => {
        expect(fridayOnOrBefore('2026-08-13')).toBe('2026-08-07');
    });

    it('a Monday maps to the previous Friday', () => {
        expect(fridayOnOrBefore('2026-08-10')).toBe('2026-08-07');
    });

    it('a Saturday maps to the day before', () => {
        expect(fridayOnOrBefore('2026-08-08')).toBe('2026-08-07');
    });
});

describe('isoWeekOfThursday', () => {
    // Ground truth cross-checked independently against the standard ISO-8601
    // week algorithm (Mon=start, week 1 = the week containing the year's
    // first Thursday), not derived from this file's own implementation.
    it('2026-01-01 (a Thursday) is ISO week 1 of 2026', () => {
        expect(isoWeekOfThursday('2026-01-01')).toEqual({ week: 1, isoYear: 2026 });
    });

    it('2026-08-13 (a Thursday) is ISO week 33 of 2026', () => {
        expect(isoWeekOfThursday('2026-08-13')).toEqual({ week: 33, isoYear: 2026 });
    });

    it('2026-12-31 (a Thursday) is ISO week 53 of 2026 (a 53-week year)', () => {
        expect(isoWeekOfThursday('2026-12-31')).toEqual({ week: 53, isoYear: 2026 });
    });
});

describe('resolveDeliveryPeriods — continuous provider', () => {
    it('generates Fri-Thu weeks, newest first, ending at the week containing asOf', async () => {
        const periods = await resolveDeliveryPeriods({ deliveryModel: 'continuous' }, null, '2026-08-14', 5);
        expect(periods.map(p => [p.startDate, p.endDate])).toEqual([
            ['2026-08-14', '2026-08-20'], // current week: Fri asOf .. next Thu
            ['2026-08-07', '2026-08-13'],
            ['2026-07-31', '2026-08-06'],
            ['2026-07-24', '2026-07-30'],
            ['2026-07-17', '2026-07-23'],
        ]);
    });

    it('marks only weeks strictly before asOf as complete', async () => {
        const periods = await resolveDeliveryPeriods({ deliveryModel: 'continuous' }, null, '2026-08-14', 3);
        expect(periods[0].isComplete).toBe(false); // contains asOf itself
        expect(periods[1].isComplete).toBe(true);
        expect(periods[2].isComplete).toBe(true);
    });

    it('tags every period kind="continuous" with the ISO week label', async () => {
        const periods = await resolveDeliveryPeriods({ deliveryModel: 'continuous' }, null, '2026-08-14', 2);
        expect(periods.every(p => p.kind === 'continuous')).toBe(true);
        expect(periods[0].label).toBe('Wk 34, 2026'); // Thu 2026-08-20
        expect(periods[1].label).toBe('Wk 33, 2026'); // Thu 2026-08-13
    });

    it('every week is exactly 7 days, Friday through Thursday', async () => {
        const periods = await resolveDeliveryPeriods({ deliveryModel: 'continuous' }, null, '2026-09-01', 10);
        for (const p of periods) {
            const spanDays = (new Date(p.endDate + 'T00:00:00Z').getTime() - new Date(p.startDate + 'T00:00:00Z').getTime()) / 86_400_000;
            expect(spanDays).toBe(6);
        }
    });

    it('ignores jira/limit-irrelevant inputs and never calls Jira', async () => {
        const jira = { listBoardSprints: vi.fn() };
        await resolveDeliveryPeriods({ deliveryModel: 'continuous' }, jira as any, '2026-08-14');
        expect(jira.listBoardSprints).not.toHaveBeenCalled();
    });
});
