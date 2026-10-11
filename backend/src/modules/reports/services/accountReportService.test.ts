import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — factories must NOT reference outer variables (hoisting limitation)
// ---------------------------------------------------------------------------

vi.mock('../../../models/AccountWeeklyReport', () => ({
    AccountWeeklyReport: {
        findOne: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
    }
}));

vi.mock('../../../models/ProjectWeeklyReport', () => ({
    ProjectWeeklyReport: {
        findOne: vi.fn(),
    }
}));

vi.mock('../../../models/Account', () => ({
    Account: { findByPk: vi.fn() }
}));

vi.mock('../../../models/Project', () => ({
    Project: { findAll: vi.fn() }
}));

vi.mock('./reportService', () => ({
    reportService: { generateWeeklyReport: vi.fn() }
}));

vi.mock('../../ai/services/aiService', () => ({
    aiService: { generateAccountSummary: vi.fn(), scrubText: vi.fn((text: string) => text) }
}));

vi.mock('../../../common/utils/pptGenerator', () => ({
    pptGenerator: { generateAccountWeeklyReport: vi.fn() }
}));

vi.mock('../../../common/utils', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../common/utils/excelGenerator', () => ({
    excelGenerator: { generateAccountWeeklyReport: vi.fn() }
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks so vi.mocked() wrappers resolve correctly
// ---------------------------------------------------------------------------
import { AccountReportService } from './accountReportService';
import { AccountWeeklyReport } from '../../../models/AccountWeeklyReport';
import { ProjectWeeklyReport } from '../../../models/ProjectWeeklyReport';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { reportService } from './reportService';
import { aiService } from '../../ai/services/aiService';
import { pptGenerator } from '../../../common/utils/pptGenerator';

// Typed mock handles
const mockAccountFindOne = vi.mocked(AccountWeeklyReport.findOne);
const mockAccountUpsert  = vi.mocked(AccountWeeklyReport.upsert);
const mockAccountUpdate  = vi.mocked(AccountWeeklyReport.update);
const mockAccountFindByPk = vi.mocked(Account.findByPk);
const mockProjectFindAll  = vi.mocked(Project.findAll);
const mockProjectWeeklyFindOne = vi.mocked(ProjectWeeklyReport.findOne);
const mockGenerateWeeklyReport = vi.mocked(reportService.generateWeeklyReport);
const mockGenerateAccountSummary = vi.mocked(aiService.generateAccountSummary);
const mockGeneratePpt = vi.mocked(pptGenerator.generateAccountWeeklyReport);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeProject = (id: number, name: string, code: string) =>
    ({ id, name, code, accountId: 1 } as any);

const makeWeeklyReport = (status: string) =>
    ({
        workSummary: `Summary`,
        risks: 'Some risks',
        status,
        achievements: 'Achievements',
        toJSON: () => ({ status }),
    } as any);

const DEFAULT_AI_RESULT = {
    summary: 'All good',
    key_accomplishments: [],
    red_projects: [],
    risks: { summary: '', items: [] },
    action_items: [],
    health: 'Green',
};

const SAVED_REPORT = {
    id: 99,
    weekNumber: 7,
    year: 2026,
    startDate: '2026-02-06',
    endDate: '2026-02-12',
    summary: 'All good',
    risks: {},
    health: 'Green',
    projectsMissing: [] as string[],
    filePath: null as string | null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('AccountReportService — no-data project exclusion', () => {
    let service: AccountReportService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AccountReportService();

        // No cached account report → always generate fresh
        mockAccountFindOne.mockResolvedValue(null);

        // Account lookup
        mockAccountFindByPk.mockResolvedValue({ id: 1, name: 'Test Account' } as any);

        // Default AI result
        mockGenerateAccountSummary.mockResolvedValue(DEFAULT_AI_RESULT);

        // PPT + DB
        mockGeneratePpt.mockResolvedValue('/tmp/report.pptx');
        mockAccountUpsert.mockResolvedValue([{ ...SAVED_REPORT }] as any);
        mockAccountUpdate.mockResolvedValue([1] as any);
    });

    // -----------------------------------------------------------------------
    it('excludes a project with status=Unknown from health and PPT, adds it to projectsMissing', async () => {
        mockProjectFindAll.mockResolvedValue([
            makeProject(1, 'Healthy Project', 'HP'),
            makeProject(2, 'No-Data Project', 'NDP'),
        ]);

        mockProjectWeeklyFindOne
            .mockResolvedValueOnce(makeWeeklyReport('Green'))   // Healthy Project
            .mockResolvedValueOnce(makeWeeklyReport('Unknown')); // No-Data Project

        await service.generateAccountWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        // AI should only receive the healthy project
        expect(mockGenerateAccountSummary).toHaveBeenCalledOnce();
        const [projectSummaries] = mockGenerateAccountSummary.mock.calls[0];
        expect(projectSummaries).toHaveLength(1);
        expect(projectSummaries[0].projectName).toBe('Healthy Project');

        // PPT: only healthy project in projects array, no-data project in missing
        expect(mockGeneratePpt).toHaveBeenCalledOnce();
        const pptArg = mockGeneratePpt.mock.calls[0][0];
        expect(pptArg.projects).toHaveLength(1);
        expect(pptArg.projects[0].name).toBe('Healthy Project');
        expect(pptArg.projectsMissing).toContain('No-Data Project');
    });

    // -----------------------------------------------------------------------
    it('excludes a project when generateWeeklyReport returns null (no daily data)', async () => {
        mockProjectFindAll.mockResolvedValue([
            makeProject(1, 'Active Project', 'AP'),
            makeProject(2, 'Empty Project', 'EP'),
        ]);

        mockProjectWeeklyFindOne
            .mockResolvedValueOnce(makeWeeklyReport('Amber'))  // Active Project — in DB
            .mockResolvedValueOnce(null);                      // Empty Project — not in DB

        // generateWeeklyReport returns null for the empty project
        mockGenerateWeeklyReport.mockResolvedValueOnce(null);

        await service.generateAccountWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        const [projectSummaries] = mockGenerateAccountSummary.mock.calls[0];
        expect(projectSummaries).toHaveLength(1);
        expect(projectSummaries[0].projectName).toBe('Active Project');

        const pptArg = mockGeneratePpt.mock.calls[0][0];
        expect(pptArg.projects).toHaveLength(1);
        expect(pptArg.projectsMissing).toContain('Empty Project');
    });

    // -----------------------------------------------------------------------
    it('excludes a project whose freshly-generated report has status=Unknown', async () => {
        mockProjectFindAll.mockResolvedValue([
            makeProject(1, 'Real Project', 'RP'),
            makeProject(2, 'Ghost Project', 'GP'),
        ]);

        mockProjectWeeklyFindOne
            .mockResolvedValueOnce(makeWeeklyReport('Green'))  // Real Project
            .mockResolvedValueOnce(null);                      // Ghost Project — not in DB

        // generateWeeklyReport returns a report with Unknown status
        mockGenerateWeeklyReport.mockResolvedValueOnce(makeWeeklyReport('Unknown'));

        await service.generateAccountWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        const [projectSummaries] = mockGenerateAccountSummary.mock.calls[0];
        expect(projectSummaries).toHaveLength(1);
        expect(projectSummaries[0].projectName).toBe('Real Project');

        const pptArg = mockGeneratePpt.mock.calls[0][0];
        expect(pptArg.projectsMissing).toContain('Ghost Project');
    });

    // -----------------------------------------------------------------------
    it('does NOT make account RED when only some projects have no data', async () => {
        // Reproduces the exact scenario: WordPress + Prospecting have no data,
        // Good Project is Green — account should remain Green.
        mockProjectFindAll.mockResolvedValue([
            makeProject(1, 'WordPress', 'WP'),
            makeProject(2, 'Prospecting', 'PROS'),
            makeProject(3, 'Good Project', 'GOOD'),
        ]);

        mockProjectWeeklyFindOne
            .mockResolvedValueOnce(makeWeeklyReport('Unknown'))  // WordPress
            .mockResolvedValueOnce(makeWeeklyReport('Unknown'))  // Prospecting
            .mockResolvedValueOnce(makeWeeklyReport('Green'));   // Good Project

        mockGenerateAccountSummary.mockResolvedValueOnce({
            ...DEFAULT_AI_RESULT,
            health: 'Green',
        });

        await service.generateAccountWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        // AI must NOT have received WordPress or Prospecting
        const [projectSummaries] = mockGenerateAccountSummary.mock.calls[0];
        const names = projectSummaries.map((p: any) => p.projectName);
        expect(names).not.toContain('WordPress');
        expect(names).not.toContain('Prospecting');
        expect(names).toContain('Good Project');

        // Saved report must have health=Green, not Red
        const upsertArg = mockAccountUpsert.mock.calls[0][0];
        expect(upsertArg.health).toBe('Green');
        expect(upsertArg.projectsMissing).toContain('WordPress');
        expect(upsertArg.projectsMissing).toContain('Prospecting');
    });

    // -----------------------------------------------------------------------
    it('skips AI call entirely when all projects have no data, saves health=Unknown', async () => {
        mockProjectFindAll.mockResolvedValue([
            makeProject(1, 'WordPress', 'WP'),
            makeProject(2, 'Prospecting', 'PROS'),
        ]);

        mockProjectWeeklyFindOne
            .mockResolvedValueOnce(makeWeeklyReport('Unknown'))
            .mockResolvedValueOnce(makeWeeklyReport('Unknown'));

        await service.generateAccountWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        // No projects → AI should NOT be called
        expect(mockGenerateAccountSummary).not.toHaveBeenCalled();

        const upsertArg = mockAccountUpsert.mock.calls[0][0];
        expect(upsertArg.health).toBe('Unknown');
        expect(upsertArg.projectsMissing).toContain('WordPress');
        expect(upsertArg.projectsMissing).toContain('Prospecting');
    });
});

// ---------------------------------------------------------------------------
// Deterministic health calculation logic — imports and exercises the REAL
// computeThresholdRollup from healthMath.ts (Phase 0 of the RAG-reliability plan).
//
// This used to be a locally-redefined `calcHealth` mirror that had drifted from
// the shipped code: it asserted zero-active-projects -> 'Green', while the real
// accountReportService.ts (and the integration test above, "skips AI call
// entirely...") has returned 'Unknown' for that case since the comment there was
// added ("that's 'we don't know', not 'everything is fine'"). The mirror was
// passing only because it tested itself, not production behavior. Importing the
// real function here closes that gap.
// ---------------------------------------------------------------------------
import { computeThresholdRollup } from './healthMath';

describe('Deterministic health calculation — Unknown status excluded', () => {
    it('Unknown-only statuses yield Unknown health (zero active projects — "we don\'t know", not Green)', () => {
        const { health, activeCount } = computeThresholdRollup(['Unknown', 'Unknown'], 30, 20);
        expect(activeCount).toBe(0);
        expect(health).toBe('Unknown');
    });

    it('Unknown projects are not counted toward RED or Amber thresholds', () => {
        const { health, activeCount, redPct, badPct } = computeThresholdRollup(['Green', 'Unknown', 'Unknown'], 30, 20);
        expect(activeCount).toBe(1); // Only Green counts
        expect(redPct).toBe(0);
        expect(badPct).toBe(0);
        expect(health).toBe('Green');
    });

    it('genuine RED projects still trigger RED when above threshold', () => {
        const { health, activeCount } = computeThresholdRollup(['Red', 'Red', 'Green', 'Unknown'], 30, 20);
        expect(activeCount).toBe(3);
        expect(health).toBe('Red');
    });

    it('a single Amber project among two active yields Amber health (50% bad, above the 20% amber threshold)', () => {
        const { health } = computeThresholdRollup(['Amber', 'Green', 'Unknown'], 30, 20);
        expect(health).toBe('Amber');
    });

    it('respects a non-default redThresholdPercentage (previously untested — only the default 30 was exercised)', () => {
        // 1 of 4 active = 25% red.
        const atDefaultThreshold = computeThresholdRollup(['Red', 'Green', 'Green', 'Green'], 30, 20);
        expect(atDefaultThreshold.health).toBe('Amber'); // 25% red < 30% red threshold, but 25% bad >= 20% amber threshold

        const atStricterThreshold = computeThresholdRollup(['Red', 'Green', 'Green', 'Green'], 20, 20);
        expect(atStricterThreshold.health).toBe('Red'); // same data, 25% red >= 20% red threshold
    });

    // -----------------------------------------------------------------------
    // Phase 3 of the RAG-reliability plan: the Amber trigger now uses
    // Account.amberThresholdPercentage (a real, admin-configurable field that was never
    // actually read anywhere before this phase) instead of "any Amber or Red child -> Amber".
    // Decision confirmed with the user: Red trigger keeps its exact current meaning (pure
    // %Red vs redThreshold); Amber trigger becomes %(Red+Amber) vs amberThreshold — the
    // closest generalization of the old floor into a graduated rule.
    // -----------------------------------------------------------------------
    it('CCM-shaped example: 8 Amber + 7 Green (0 Red) of 15 -> still Amber at a 30% amber threshold (53% bad)', () => {
        const statuses = [...Array(8).fill('Amber'), ...Array(7).fill('Green')];
        const { health, badPct } = computeThresholdRollup(statuses, 40, 30); // CCM's real configured thresholds
        expect(badPct).toBeCloseTo(53.33, 1);
        expect(health).toBe('Amber');
    });

    it('a single Amber project out of 15 no longer taints the account (6.7% bad, below a 30% amber threshold) — the core Phase 3 fix', () => {
        const statuses = [...Array(1).fill('Amber'), ...Array(14).fill('Green')];
        const { health, badPct } = computeThresholdRollup(statuses, 40, 30);
        expect(badPct).toBeCloseTo(6.67, 1);
        expect(health).toBe('Green'); // the old "(redCount>0||amberCount>0)->Amber" floor would have said Amber here
    });

    it('the Red trigger is unaffected by the Amber-trigger change — pure %Red, same as before Phase 3', () => {
        // 6 of 15 Red = 40%, at the CCM/Thrive-configured 40% red threshold.
        const statuses = [...Array(6).fill('Red'), ...Array(9).fill('Green')];
        const { health, redPct } = computeThresholdRollup(statuses, 40, 30);
        expect(redPct).toBeCloseTo(40, 1);
        expect(health).toBe('Red');
    });

    // -----------------------------------------------------------------------
    // Build #14: Red-count floor + any-Red-forces-Amber + optional bad-percentage ceiling.
    // Fixes the dilution bug where a large enough account can hide real Red projects behind a
    // percentage threshold (e.g. 2 Red + 13 Green never crosses CCM's real 40% red threshold).
    // -----------------------------------------------------------------------
    it('2 Red + 13 Green at CCM real thresholds (40/30): percentage alone would say Green; the fixed any-Red-present rule forces at least Amber even with the count floor disabled; the count floor then escalates it the rest of the way to Red', () => {
        const statuses = [...Array(2).fill('Red'), ...Array(13).fill('Green')];
        const withFloorDisabled = computeThresholdRollup(statuses, 40, 30); // no floor/ceiling passed
        expect(withFloorDisabled.health).toBe('Amber'); // redCount>=1 is a fixed, unconditional rule — not gated by the floor

        const withFloor = computeThresholdRollup(statuses, 40, 30, 2, null);
        expect(withFloor.redPct).toBeCloseTo(13.33, 1);
        expect(withFloor.health).toBe('Red'); // redCount (2) >= redCountFloor (2) — this is the actual dilution-bug fix
    });

    it('1 Red + 2 Amber + 13 Green: any-Red-present floor forces at least Amber, regardless of percentage', () => {
        const statuses = ['Red', ...Array(2).fill('Amber'), ...Array(13).fill('Green')];
        const { health, redCount } = computeThresholdRollup(statuses, 40, 30, 2, null);
        expect(redCount).toBe(1);
        expect(health).toBe('Amber'); // redCount >= 1, but below the floor of 2 — Amber, not Red
    });

    it('3 Amber + 12 Green (0 Red): unaffected by the new floor — stays Green, same as before Build #14', () => {
        const statuses = [...Array(3).fill('Amber'), ...Array(12).fill('Green')];
        const { health, redCount } = computeThresholdRollup(statuses, 40, 30, 2, null);
        expect(redCount).toBe(0);
        expect(health).toBe('Green'); // 20% bad < 30% amber threshold, no Red present
    });

    it('13 Amber + 2 Green (0 Red), ceiling unset: stays Amber, not escalated to Red', () => {
        const statuses = [...Array(13).fill('Amber'), ...Array(2).fill('Green')];
        const { health, redCount, badPct } = computeThresholdRollup(statuses, 40, 30, 2, null);
        expect(redCount).toBe(0);
        expect(badPct).toBeCloseTo(86.67, 1);
        expect(health).toBe('Amber'); // ceiling disabled by default — pure-Amber saturation caps at Amber
    });

    it('13 Amber + 2 Green (0 Red), ceiling set to 80: escalates to Red via the ceiling despite zero Red projects', () => {
        const statuses = [...Array(13).fill('Amber'), ...Array(2).fill('Green')];
        const { health, redCount, badPct } = computeThresholdRollup(statuses, 40, 30, 2, 80);
        expect(redCount).toBe(0);
        expect(badPct).toBeCloseTo(86.67, 1);
        expect(health).toBe('Red'); // badPct (86.67) >= ceiling (80)
    });

    it('CCM real examples from today (8 Amber + 7 Green, 0 Red) are unaffected by Build #14 defaults — no regression', () => {
        const statuses = [...Array(8).fill('Amber'), ...Array(7).fill('Green')];
        const { health } = computeThresholdRollup(statuses, 40, 30, 2, null);
        expect(health).toBe('Amber'); // same result as the pre-Build-#14 test above
    });

    it('omitting redCountFloor/ceilingBadPct entirely (as rangeRollupService/programDailyReportService still do) disables just those two escalations, not the whole function', () => {
        // 6 Red is nowhere near the count floor and there's no ceiling to trip -- with the
        // params omitted, the only thing that can still turn this Red is the pre-existing
        // percentage rule, exactly as it worked before Build #14 for these two callers.
        const statuses = [...Array(6).fill('Red'), ...Array(9).fill('Green')];
        const { health, redPct } = computeThresholdRollup(statuses, 40, 30); // no 4th/5th args
        expect(redPct).toBeCloseTo(40, 1);
        expect(health).toBe('Red'); // via the unchanged percentage rule alone, not the new floor/ceiling
    });
});

// ---------------------------------------------------------------------------
// Configurable weekly report cycle (Account.weekStartDay) — proves the service actually
// fetches the account and threads its real weekStartDay into normalizeWindow, rather than
// silently keeping the old hardcoded Friday-Thursday validation.
// ---------------------------------------------------------------------------
describe('AccountReportService — configurable weekStartDay (Account.weekStartDay)', () => {
    let service: AccountReportService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AccountReportService();
        mockAccountFindOne.mockResolvedValue(null); // no cache -> always generate fresh
        mockProjectFindAll.mockResolvedValue([]);
        mockGenerateAccountSummary.mockResolvedValue(DEFAULT_AI_RESULT);
        mockGeneratePpt.mockResolvedValue('/tmp/report.pptx');
        mockAccountUpsert.mockResolvedValue([{ ...SAVED_REPORT }] as any);
        mockAccountUpdate.mockResolvedValue([1] as any);
    });

    it('accepts and stores a Monday-Sunday range for an account configured with weekStartDay=1', async () => {
        mockAccountFindByPk.mockResolvedValue({ id: 1, name: 'Monday Account', weekStartDay: 1 } as any);

        // 2026-02-09 is a confirmed Monday; 2026-02-15 the following Sunday.
        await service.generateAccountWeeklyReport(1, '2026-02-09', '2026-02-15', true);

        const upsertArg = mockAccountUpsert.mock.calls[0][0];
        expect(upsertArg.startDate).toBe('2026-02-09');
        expect(upsertArg.endDate).toBe('2026-02-15');
    });

    it('rejects a Friday-start date range for an account configured with weekStartDay=1 (Monday) -- proves the cycle is actually read from the account, not hardcoded', async () => {
        mockAccountFindByPk.mockResolvedValue({ id: 1, name: 'Monday Account', weekStartDay: 1 } as any);

        await expect(service.generateAccountWeeklyReport(1, '2026-02-06', '2026-02-12', true))
            .rejects.toThrow('Start date must be a Monday.');
    });

    it('falls back to Friday-Thursday when Account.findByPk resolves an account with no weekStartDay set (defensive default, matches every account before this feature)', async () => {
        mockAccountFindByPk.mockResolvedValue({ id: 1, name: 'Legacy Account' } as any);

        await service.generateAccountWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        const upsertArg = mockAccountUpsert.mock.calls[0][0];
        expect(upsertArg.startDate).toBe('2026-02-06');
        expect(upsertArg.endDate).toBe('2026-02-12');
    });
});
