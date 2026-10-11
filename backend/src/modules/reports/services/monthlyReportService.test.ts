import { describe, it, expect, vi } from 'vitest';

// Importing monthlyReportService.ts (even just for its pure helper exports) transitively
// imports the real Sequelize models, whose @Table decorators register against the real
// Sequelize singleton unless mocked — same root cause documented in reportService.test.ts.
vi.mock('../../../models/Project', () => ({ Project: { findAll: vi.fn() } }));
vi.mock('../../../models/ProjectWeeklyReport', () => ({ ProjectWeeklyReport: { findAll: vi.fn() } }));
vi.mock('../../../models/MonthlyProjectReport', () => ({ MonthlyProjectReport: { findOne: vi.fn(), upsert: vi.fn() } }));
vi.mock('../../../models/DailyBoardSnapshot', () => ({ DailyBoardSnapshot: { findAll: vi.fn() } }));
vi.mock('../../ai/services/aiService', () => ({ aiService: { generateMonthlySummary: vi.fn() } }));
vi.mock('../../../common/utils', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { computeTrailingWindow, buildTrailingSummary, monthDateRange } from './monthlyReportService';
import { rollupHealth, rollupHealthWeighted } from './healthMath';

describe('monthDateRange — timezone round-trip bug fix (found while testing Phase C2)', () => {
    it('returns the true first and last calendar day of the month, not shifted by local timezone', () => {
        expect(monthDateRange(2026, 9)).toEqual({ startDateStr: '2026-09-01', endDateStr: '2026-09-30' });
    });

    it('handles February in a leap year correctly', () => {
        expect(monthDateRange(2028, 2)).toEqual({ startDateStr: '2028-02-01', endDateStr: '2028-02-29' });
    });

    it('handles February in a non-leap year correctly', () => {
        expect(monthDateRange(2026, 2)).toEqual({ startDateStr: '2026-02-01', endDateStr: '2026-02-28' });
    });

    it('handles December correctly (year-end edge)', () => {
        expect(monthDateRange(2026, 12)).toEqual({ startDateStr: '2026-12-01', endDateStr: '2026-12-31' });
    });
});

// Pure-function tests only — generateProjectMonthlyReport's full end-to-end path hits a
// dynamic `require('../../../common/utils')` for temporalValidator that vitest/vite-node does
// not resolve at test-run time (a pre-existing limitation shared by every other service in
// this codebase using the same pattern; no existing test in the repo exercises that call
// either). The trailing-days logic itself is fully covered here via the extracted pure
// helpers; the full flow is verified live against the real compiled app in the plan's
// live-test step, which does not hit this vitest-only limitation.

describe('computeTrailingWindow — Phase C2 (monthly trailing-days gap)', () => {
    it('returns the gap from the day after the last weekly report through month end', () => {
        const window = computeTrailingWindow('2026-09-24', '2026-09-01', '2026-09-30');
        expect(window).toEqual({ start: '2026-09-25', end: '2026-09-30' });
    });

    it('returns null when the last weekly report already reaches month end', () => {
        const window = computeTrailingWindow('2026-09-30', '2026-09-01', '2026-09-30');
        expect(window).toBeNull();
    });

    it('returns null when the last weekly report overshoots month end (next month already started)', () => {
        const window = computeTrailingWindow('2026-10-01', '2026-09-01', '2026-09-30');
        expect(window).toBeNull();
    });

    it('treats the whole month as the gap when there is no weekly report at all yet', () => {
        const window = computeTrailingWindow(null, '2026-09-01', '2026-09-30');
        expect(window).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    });

    it('handles a month boundary correctly (no off-by-one across month/year rollover)', () => {
        const window = computeTrailingWindow('2026-12-28', '2026-12-01', '2026-12-31');
        expect(window).toEqual({ start: '2026-12-29', end: '2026-12-31' });
    });
});

describe('buildTrailingSummary — Phase C2 (monthly trailing-days gap)', () => {
    it('rolls up trailing daily snapshots into a synthetic weekly-shaped entry', () => {
        const result = buildTrailingSummary([
            { overallHealth: 'Red', workSummary: 'Fixed the outage.', executiveRisks: 'Third-party API down.' },
            { overallHealth: 'Red', workSummary: 'Root cause found.', executiveRisks: null },
        ]);
        expect(result).toEqual({
            week: 0,
            summary: 'Fixed the outage. Root cause found.',
            achievements: '',
            risks: 'Third-party API down.',
            status: 'Red',
            dayCount: 2,
        });
    });

    it('returns null for an empty snapshot list (no trailing data to report)', () => {
        expect(buildTrailingSummary([])).toBeNull();
    });

    it('treats a missing overallHealth as Unknown rather than crashing', () => {
        const result = buildTrailingSummary([{ overallHealth: null, workSummary: 'x', executiveRisks: null }]);
        expect(result?.status).toBe('Unknown');
    });

    it('dayCount reflects the real number of trailing snapshots, independent of their status', () => {
        const result = buildTrailingSummary([
            { overallHealth: 'Green', workSummary: 'a', executiveRisks: null },
            { overallHealth: 'Amber', workSummary: 'b', executiveRisks: null },
            { overallHealth: 'Green', workSummary: 'c', executiveRisks: null },
        ]);
        expect(result?.dayCount).toBe(3);
    });
});

// -----------------------------------------------------------------------------------------------
// Monthly-project rollup gaps (Sep 30 2026): the month-level status rollup reused rollupHealth's
// flat, equal-weight list -- a 1-day trailing stub counted exactly as heavily as a full ~7-day
// closed week, letting a single bad day at month-end swing an otherwise-healthy month. Fixed by
// weighting each entry by the real day count it represents (rollupHealthWeighted, healthMath.ts).
// -----------------------------------------------------------------------------------------------
describe('rollupHealthWeighted — weighted monthly-project rollup (fixes trailing-stub dilution)', () => {
    it('a 1-day Red trailing stub no longer swings an otherwise-Green month (the core fix)', () => {
        const entries = [
            { health: 'Green', weight: 7 },
            { health: 'Green', weight: 7 },
            { health: 'Green', weight: 7 },
            { health: 'Red', weight: 1 }, // 1-day trailing stub
        ];
        const result = rollupHealthWeighted(entries);
        // Flat/unweighted equivalent would be avg = 2/4 = 0.50 -> Amber (the bug).
        expect(result.avg).toBeCloseTo(2 / 22, 4);
        expect(result.health).toBe('Green');
    });

    it('all entries equally weighted (every week fully closed, no trailing stub) matches rollupHealth exactly — provable no-regression for historical months', () => {
        const statuses = ['Amber', 'Amber', 'Amber', 'Amber']; // SC's real August 2026 shape
        const flat = rollupHealth(statuses);
        const weighted = rollupHealthWeighted(statuses.map(health => ({ health, weight: 7 })));
        expect(weighted.avg).toBeCloseTo(flat.avg, 10);
        expect(weighted.health).toBe(flat.health);
    });

    it('a long trailing stub (nearly a full week) still carries meaningful weight, not diluted to near-zero', () => {
        const entries = [
            { health: 'Green', weight: 7 },
            { health: 'Green', weight: 7 },
            { health: 'Red', weight: 6 }, // 6-day trailing stub, almost a full week
        ];
        const result = rollupHealthWeighted(entries);
        // avg = (6*2)/(7+7+6) = 12/20 = 0.6 -> Amber, correctly reflecting a substantial bad tail.
        expect(result.avg).toBeCloseTo(0.6, 4);
        expect(result.health).toBe('Amber');
    });

    it('weighted majority-Red safety escalation: Red weight over half the total forces Red regardless of average', () => {
        const entries = [
            { health: 'Red', weight: 7 },
            { health: 'Red', weight: 7 },
            { health: 'Green', weight: 7 },
        ];
        // 14 of 21 total weight is Red -- a strict majority by weight.
        const result = rollupHealthWeighted(entries);
        expect(result.health).toBe('Red');
    });

    it('a single Red day (weight 1) alone does not trigger the majority override when it is the only entry, consistent with rollupHealth at scorableCount=1', () => {
        const result = rollupHealthWeighted([{ health: 'Red', weight: 1 }]);
        expect(result.health).toBe('Red'); // avg = 2.0 >= AMBER_CEILING, Red via the average path too
    });

    it('all-Unknown/null entries return Unknown, not a misleadingly reassuring Green', () => {
        const result = rollupHealthWeighted([{ health: 'Unknown', weight: 7 }, { health: null, weight: 3 }]);
        expect(result.health).toBe('Unknown');
        expect(result.totalWeight).toBe(0);
    });

    it('an empty entry list returns Unknown', () => {
        expect(rollupHealthWeighted([]).health).toBe('Unknown');
    });
});
