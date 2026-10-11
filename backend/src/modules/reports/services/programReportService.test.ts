import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — factories must NOT reference outer variables (hoisting limitation)
// ---------------------------------------------------------------------------

vi.mock('../../../models/ProgramWeeklyReport', () => ({
    ProgramWeeklyReport: {
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

vi.mock('../../../models/Program', () => ({
    Program: { findByPk: vi.fn() }
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
    aiService: {
        generateAccountSummary: vi.fn(),
        collateAccountInsights: vi.fn(),
        scrubText: vi.fn((text: string) => text),
    }
}));

vi.mock('../../../common/utils/pptGenerator', () => ({
    pptGenerator: { generateProgramWeeklyReport: vi.fn() }
}));

vi.mock('../../../common/utils', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks so vi.mocked() wrappers resolve correctly
// ---------------------------------------------------------------------------
import { ProgramReportService } from './programReportService';
import { ProgramWeeklyReport } from '../../../models/ProgramWeeklyReport';
import { ProjectWeeklyReport } from '../../../models/ProjectWeeklyReport';
import { Program } from '../../../models/Program';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { reportService } from './reportService';
import { aiService } from '../../ai/services/aiService';
import { pptGenerator } from '../../../common/utils/pptGenerator';

// Typed mock handles
const mockProgramWeeklyFindOne = vi.mocked(ProgramWeeklyReport.findOne);
const mockProgramWeeklyUpsert = vi.mocked(ProgramWeeklyReport.upsert);
const mockProgramFindByPk = vi.mocked(Program.findByPk);
const mockAccountFindByPk = vi.mocked(Account.findByPk);
const mockProjectFindAll = vi.mocked(Project.findAll);
const mockProjectWeeklyFindOne = vi.mocked(ProjectWeeklyReport.findOne);
const mockGenerateWeeklyReport = vi.mocked(reportService.generateWeeklyReport);
const mockGenerateAccountSummary = vi.mocked(aiService.generateAccountSummary);
const mockGeneratePpt = vi.mocked(pptGenerator.generateProgramWeeklyReport);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeProject = (id: number, name: string, code: string) =>
    ({ id, name, code, accountId: 1, programId: 1 } as any);

const makeWeeklyReport = (status: string) =>
    ({
        workSummary: 'Summary',
        risks: 'Some risks',
        status,
        achievements: 'Achievements',
        toJSON: () => ({ status }),
    } as any);

const PROGRAM = { id: 1, name: 'Sales', accountId: 1, redThresholdPercentage: null } as any;
const ACCOUNT = { id: 1, name: 'Test Account', redThresholdPercentage: 30, amberThresholdPercentage: 20, redProjectCountFloor: 2, redCeilingBadPercentage: null } as any;

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
    programId: 1,
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
describe('ProgramReportService — Unknown-status exclusion (Gap 1, parity with AccountReportService)', () => {
    let service: ProgramReportService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new ProgramReportService();

        mockProgramWeeklyFindOne.mockResolvedValue(null); // no cache -> always generate fresh
        mockProgramFindByPk.mockResolvedValue(PROGRAM);
        mockAccountFindByPk.mockResolvedValue(ACCOUNT);
        mockGenerateAccountSummary.mockResolvedValue(DEFAULT_AI_RESULT);
        mockGeneratePpt.mockResolvedValue('/tmp/program-report.pptx');
        mockProgramWeeklyUpsert.mockResolvedValue([{ ...SAVED_REPORT }] as any);
    });

    it('excludes a cached weekly report with status=Unknown from the AI summary and PPT, adds it to projectsMissing', async () => {
        mockProjectFindAll.mockResolvedValue([
            makeProject(1, 'Healthy Project', 'HP'),
            makeProject(2, 'No-Data Project', 'NDP'),
        ]);

        mockProjectWeeklyFindOne
            .mockResolvedValueOnce(makeWeeklyReport('Green'))
            .mockResolvedValueOnce(makeWeeklyReport('Unknown'));

        await service.generateProgramWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        expect(mockGenerateAccountSummary).toHaveBeenCalledOnce();
        const [projectSummaries] = mockGenerateAccountSummary.mock.calls[0];
        expect(projectSummaries).toHaveLength(1);
        expect(projectSummaries[0].projectName).toBe('Healthy Project');

        const pptArg = mockGeneratePpt.mock.calls[0][0];
        expect(pptArg.projectsMissing).toContain('No-Data Project');
    });

    it('excludes a freshly-generated report with status=Unknown (fallback branch)', async () => {
        mockProjectFindAll.mockResolvedValue([
            makeProject(1, 'Real Project', 'RP'),
            makeProject(2, 'Ghost Project', 'GP'),
        ]);

        mockProjectWeeklyFindOne
            .mockResolvedValueOnce(makeWeeklyReport('Green'))
            .mockResolvedValueOnce(null); // Ghost Project not cached -> fallback generation

        mockGenerateWeeklyReport.mockResolvedValueOnce(makeWeeklyReport('Unknown'));

        await service.generateProgramWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        const [projectSummaries] = mockGenerateAccountSummary.mock.calls[0];
        expect(projectSummaries).toHaveLength(1);
        expect(projectSummaries[0].projectName).toBe('Real Project');

        const pptArg = mockGeneratePpt.mock.calls[0][0];
        expect(pptArg.projectsMissing).toContain('Ghost Project');
    });

    it('excludes a project when the fallback generateWeeklyReport call returns null', async () => {
        mockProjectFindAll.mockResolvedValue([
            makeProject(1, 'Active Project', 'AP'),
            makeProject(2, 'Empty Project', 'EP'),
        ]);

        mockProjectWeeklyFindOne
            .mockResolvedValueOnce(makeWeeklyReport('Amber'))
            .mockResolvedValueOnce(null);

        mockGenerateWeeklyReport.mockResolvedValueOnce(null as any);

        await service.generateProgramWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        const [projectSummaries] = mockGenerateAccountSummary.mock.calls[0];
        expect(projectSummaries).toHaveLength(1);
        expect(projectSummaries[0].projectName).toBe('Active Project');

        const pptArg = mockGeneratePpt.mock.calls[0][0];
        expect(pptArg.projectsMissing).toContain('Empty Project');
    });

    it('a normal Green/Amber project flows through unchanged (no-regression case)', async () => {
        mockProjectFindAll.mockResolvedValue([makeProject(1, 'Steady Project', 'SP')]);
        mockProjectWeeklyFindOne.mockResolvedValueOnce(makeWeeklyReport('Amber'));

        await service.generateProgramWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        const [projectSummaries] = mockGenerateAccountSummary.mock.calls[0];
        expect(projectSummaries).toHaveLength(1);
        expect(projectSummaries[0].projectName).toBe('Steady Project');
        expect(projectSummaries[0].status).toBe('Amber');
    });
});

describe('ProgramReportService — PPT refresh on cache-hit (Gap 2, parity with AccountReportService)', () => {
    let service: ProgramReportService;
    let renderDeckSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new ProgramReportService();
        renderDeckSpy = vi.spyOn(service, 'renderDeckFromStored').mockResolvedValue('/tmp/refreshed.pptx');
        mockProgramFindByPk.mockResolvedValue(PROGRAM);
        mockAccountFindByPk.mockResolvedValue(ACCOUNT);
    });

    it('calls renderDeckFromStored and still returns the cached row on a cache-hit read', async () => {
        const cached = { ...SAVED_REPORT };
        mockProgramWeeklyFindOne.mockResolvedValue(cached as any);

        const result = await service.generateProgramWeeklyReport(1, '2026-02-06', '2026-02-12', false);

        expect(renderDeckSpy).toHaveBeenCalledWith(cached);
        expect(result).toBe(cached);
    });

    it('still returns the cached row even if renderDeckFromStored throws (non-fatal PPT refresh)', async () => {
        const cached = { ...SAVED_REPORT };
        mockProgramWeeklyFindOne.mockResolvedValue(cached as any);
        renderDeckSpy.mockRejectedValueOnce(new Error('PPT engine down'));

        const result = await service.generateProgramWeeklyReport(1, '2026-02-06', '2026-02-12', false);

        expect(result).toBe(cached);
    });
});

// ---------------------------------------------------------------------------
// Configurable weekly report cycle (Account.weekStartDay) — proves the service fetches the
// program's parent account and threads its real weekStartDay into normalizeWindow, rather than
// the old hardcoded inline Friday-Thursday validation this replaced.
// ---------------------------------------------------------------------------
describe('ProgramReportService — configurable weekStartDay (Account.weekStartDay)', () => {
    let service: ProgramReportService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new ProgramReportService();
        mockProgramWeeklyFindOne.mockResolvedValue(null); // no cache -> always generate fresh
        mockProgramFindByPk.mockResolvedValue(PROGRAM);
        mockProjectFindAll.mockResolvedValue([makeProject(1, 'Steady Project', 'SP')]);
        mockProjectWeeklyFindOne.mockResolvedValue(makeWeeklyReport('Green'));
        mockGenerateAccountSummary.mockResolvedValue(DEFAULT_AI_RESULT);
        mockGeneratePpt.mockResolvedValue('/tmp/program-report.pptx');
        mockProgramWeeklyUpsert.mockResolvedValue([{ ...SAVED_REPORT }] as any);
    });

    it('accepts and stores a Monday-Sunday range for a program whose account is configured with weekStartDay=1', async () => {
        mockAccountFindByPk.mockResolvedValue({ ...ACCOUNT, weekStartDay: 1 });

        // 2026-02-09 is a confirmed Monday; 2026-02-15 the following Sunday.
        await service.generateProgramWeeklyReport(1, '2026-02-09', '2026-02-15', true);

        const upsertArg = mockProgramWeeklyUpsert.mock.calls[0][0];
        expect(upsertArg.startDate).toBe('2026-02-09');
        expect(upsertArg.endDate).toBe('2026-02-15');
    });

    it('rejects a Friday-start date range for a program whose account is configured with weekStartDay=1 (Monday) -- proves the cycle is actually read from the account, not hardcoded', async () => {
        mockAccountFindByPk.mockResolvedValue({ ...ACCOUNT, weekStartDay: 1 });

        await expect(service.generateProgramWeeklyReport(1, '2026-02-06', '2026-02-12', true))
            .rejects.toThrow('Start date must be a Monday.');
    });

    it('falls back to Friday-Thursday when the account has no weekStartDay set (defensive default, matches every account before this feature)', async () => {
        mockAccountFindByPk.mockResolvedValue({ id: 1, name: 'Legacy Account' });

        await service.generateProgramWeeklyReport(1, '2026-02-06', '2026-02-12', true);

        const upsertArg = mockProgramWeeklyUpsert.mock.calls[0][0];
        expect(upsertArg.startDate).toBe('2026-02-06');
        expect(upsertArg.endDate).toBe('2026-02-12');
    });
});
