import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../models/DailyBoardSnapshot', () => ({
    DailyBoardSnapshot: { findAll: vi.fn() },
}));
vi.mock('../../../models/ProjectWeeklyReport', () => ({
    ProjectWeeklyReport: { findOne: vi.fn() },
}));
vi.mock('../../../models/Risk', () => ({
    Risk: { findAll: vi.fn() },
}));
vi.mock('../../../models/Account', () => ({
    Account: { findByPk: vi.fn() },
}));
vi.mock('../../../models/Project', () => ({
    Project: { findAll: vi.fn() },
}));
vi.mock('../../ai/services/aiService', () => ({
    aiService: { scrubText: vi.fn((text: string) => text) },
}));

import { rollupProjectRange, rollupAccountRange } from './rangeRollupService';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { ProjectWeeklyReport } from '../../../models/ProjectWeeklyReport';
import { Risk } from '../../../models/Risk';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';

const mockFindAllSnapshots = vi.mocked(DailyBoardSnapshot.findAll);
const mockFindOneWeekly = vi.mocked(ProjectWeeklyReport.findOne);
const mockFindAllRisks = vi.mocked(Risk.findAll);
const mockFindByPkAccount = vi.mocked(Account.findByPk);
const mockFindAllProjects = vi.mocked(Project.findAll);

const window = { startDate: '2026-08-14', endDate: '2026-08-20' };

const snapshot = (date: string, health: string, overrides: any = {}) => ({
    date,
    overallHealth: health,
    executiveSummary: `Summary for ${date}`,
    executiveRisks: '',
    executivePlan: '',
    healthRationale: `rationale ${health}`,
    blockedTickets: [],
    confirmedProdBugKeys: [],
    ...overrides,
});

describe('rollupProjectRange', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns null when there are no snapshots in the window', async () => {
        mockFindAllSnapshots.mockResolvedValue([]);
        const project = { id: 1, code: 'AB', name: 'Alpha Beta' } as any;
        const result = await rollupProjectRange(project, window);
        expect(result).toBeNull();
    });

    it('computes latest/worst/deterministic health from the daily timeline', async () => {
        mockFindAllSnapshots.mockResolvedValue([
            snapshot('2026-08-14', 'Green'),
            snapshot('2026-08-15', 'Green'),
            snapshot('2026-08-16', 'Green'),
            snapshot('2026-08-17', 'Green'),
            snapshot('2026-08-18', 'Amber'),
        ] as any);
        const project = { id: 1, code: 'AB', name: 'Alpha Beta' } as any;
        const result = await rollupProjectRange(project, window);
        expect(result).not.toBeNull();
        expect(result!.latestHealth).toBe('Amber');
        expect(result!.worstHealth).toBe('Amber');
        // 4 Green + 1 Amber -> Green under rollupHealth (Phase 2's proportional rule)
        expect(result!.deterministicHealth).toBe('Green');
        expect(result!.snapshotCount).toBe(5);
    });

    it('dedupes confirmedProdBugKeys across snapshots', async () => {
        mockFindAllSnapshots.mockResolvedValue([
            snapshot('2026-08-14', 'Amber', { confirmedProdBugKeys: ['ABC-1', 'ABC-2'] }),
            snapshot('2026-08-15', 'Amber', { confirmedProdBugKeys: ['ABC-2', 'ABC-3'] }),
        ] as any);
        const project = { id: 1, code: 'AB', name: 'Alpha Beta' } as any;
        const result = await rollupProjectRange(project, window);
        expect(result!.confirmedProdBugKeys.sort()).toEqual(['ABC-1', 'ABC-2', 'ABC-3']);
    });

    it('extracts blocked ticket summaries (falling back to key) from blockedTickets', async () => {
        mockFindAllSnapshots.mockResolvedValue([
            snapshot('2026-08-14', 'Amber', {
                blockedTickets: [{ key: 'X-1', summary: 'Blocked thing' }, { key: 'X-2' }],
            }),
        ] as any);
        const project = { id: 1, code: 'AB', name: 'Alpha Beta' } as any;
        const result = await rollupProjectRange(project, window);
        expect(result!.dailySummaries[0].blocked).toEqual(['Blocked thing', 'X-2']);
    });
});

describe('rollupAccountRange', () => {
    beforeEach(() => vi.clearAllMocks());

    it('buckets a project with zero snapshots as missing, not silently dropped or counted', async () => {
        mockFindByPkAccount.mockResolvedValue({ id: 1, name: 'Test Account', redThresholdPercentage: 30, amberThresholdPercentage: 20 } as any);
        mockFindAllProjects.mockResolvedValue([
            { id: 1, code: 'AA', name: 'Has Data' },
            { id: 2, code: 'BB', name: 'No Data' },
        ] as any);
        mockFindAllSnapshots.mockImplementation(async ({ where }: any) => {
            if (where.projectId === 1) return [snapshot('2026-08-14', 'Green')] as any;
            return [];
        });
        mockFindAllRisks.mockResolvedValue([]);

        const result = await rollupAccountRange(1, window);
        expect(result.projects).toHaveLength(1);
        expect(result.projects[0].code).toBe('AA');
        expect(result.projectsMissing).toEqual(['No Data']);
    });

    it('defaults to isActive:true, isSharedTeam:false — matching accountReportService.ts', async () => {
        mockFindByPkAccount.mockResolvedValue({ id: 1, name: 'Test Account' } as any);
        mockFindAllProjects.mockResolvedValue([]);
        mockFindAllRisks.mockResolvedValue([]);

        await rollupAccountRange(1, window);
        const call = mockFindAllProjects.mock.calls[0][0] as any;
        expect(call.where).toMatchObject({ accountId: 1, isActive: true, isSharedTeam: false });
    });

    it('includeInactive:true drops the isActive filter', async () => {
        mockFindByPkAccount.mockResolvedValue({ id: 1, name: 'Test Account' } as any);
        mockFindAllProjects.mockResolvedValue([]);
        mockFindAllRisks.mockResolvedValue([]);

        await rollupAccountRange(1, window, { includeInactive: true });
        const call = mockFindAllProjects.mock.calls[0][0] as any;
        expect(call.where.isActive).toBeUndefined();
        expect(call.where).toMatchObject({ accountId: 1, isSharedTeam: false });
    });

    it('rolls up account-level deterministic health from project-level deterministic healths', async () => {
        mockFindByPkAccount.mockResolvedValue({ id: 1, name: 'Test Account', redThresholdPercentage: 40, amberThresholdPercentage: 30 } as any);
        mockFindAllProjects.mockResolvedValue([
            { id: 1, code: 'AA', name: 'A' },
            { id: 2, code: 'BB', name: 'B' },
        ] as any);
        // Project A: all Green -> deterministic Green. Project B: all Amber -> deterministic Amber.
        mockFindAllSnapshots.mockImplementation(async ({ where }: any) => {
            if (where.projectId === 1) return [snapshot('2026-08-14', 'Green')] as any;
            return [snapshot('2026-08-14', 'Amber')] as any;
        });
        mockFindAllRisks.mockResolvedValue([]);

        const result = await rollupAccountRange(1, window);
        // 1 of 2 active = 50% bad, >= 30% amber threshold -> Amber
        expect(result.deterministicHealth).toBe('Amber');
    });

    it('source: "weekly-reports" looks up ProjectWeeklyReport by the window end date\'s ISO week', async () => {
        mockFindByPkAccount.mockResolvedValue({ id: 1, name: 'Test Account' } as any);
        mockFindAllProjects.mockResolvedValue([{ id: 1, code: 'AA', name: 'A' }] as any);
        mockFindOneWeekly.mockResolvedValue({ status: 'Amber' } as any);
        mockFindAllRisks.mockResolvedValue([]);

        const result = await rollupAccountRange(1, window, { source: 'weekly-reports' });
        expect(mockFindAllSnapshots).not.toHaveBeenCalled();
        expect(result.projects[0].deterministicHealth).toBe('Amber');
    });

    it('source: "weekly-reports" carries the WSR\'s own narrative fields through as a synthetic daily summary (Phase B: scripts must see the same content the app does, not empty fields)', async () => {
        mockFindByPkAccount.mockResolvedValue({ id: 1, name: 'Test Account' } as any);
        mockFindAllProjects.mockResolvedValue([{ id: 1, code: 'AA', name: 'A' }] as any);
        mockFindOneWeekly.mockResolvedValue({
            status: 'Amber',
            endDate: '2026-08-20',
            workSummary: 'Shipped the login flow.',
            risks: 'Third-party API rate limits.',
            additionalNotes: 'Plan to finish QA next week.',
            weeklyHealthRationale: 'amber|1 unaddressed bug',
        } as any);
        mockFindAllRisks.mockResolvedValue([]);

        const result = await rollupAccountRange(1, window, { source: 'weekly-reports' });
        expect(result.projects[0].dailySummaries).toEqual([{
            date: '2026-08-20',
            summary: 'Shipped the login flow.',
            risks: 'Third-party API rate limits.',
            plan: 'Plan to finish QA next week.',
            health: 'Amber',
            healthRationale: 'amber|1 unaddressed bug',
            blocked: [],
        }]);
        expect(result.projects[0].healthTimeline).toEqual([{ date: '2026-08-20', health: 'Amber' }]);
    });

    it('source: "weekly-reports" buckets a project with status=Unknown as missing', async () => {
        mockFindByPkAccount.mockResolvedValue({ id: 1, name: 'Test Account' } as any);
        mockFindAllProjects.mockResolvedValue([{ id: 1, code: 'AA', name: 'A' }] as any);
        mockFindOneWeekly.mockResolvedValue({ status: 'Unknown' } as any);
        mockFindAllRisks.mockResolvedValue([]);

        const result = await rollupAccountRange(1, window, { source: 'weekly-reports' });
        expect(result.projectsMissing).toEqual(['A']);
        expect(result.projects).toHaveLength(0);
    });

    it('throws for an unknown account rather than silently returning an empty rollup', async () => {
        mockFindByPkAccount.mockResolvedValue(null);
        await expect(rollupAccountRange(999, window)).rejects.toThrow('Account 999 not found');
    });
});
