import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — factories must NOT reference outer variables (hoisting limitation)
// ---------------------------------------------------------------------------

vi.mock('../../../models/ProgramMonthlyReport', () => ({
    ProgramMonthlyReport: {
        findOne: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
    }
}));

vi.mock('../../../models/MonthlyProjectReport', () => ({
    MonthlyProjectReport: {
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

vi.mock('../../../models/AccountTeamMember', () => ({
    AccountTeamMember: { findAll: vi.fn().mockResolvedValue([]) }
}));

vi.mock('../../../models/TeamMember', () => ({
    TeamMember: {}
}));

vi.mock('./monthlyReportService', () => ({
    monthlyReportService: { generateProjectMonthlyReport: vi.fn() }
}));

vi.mock('../../ai/services/aiService', () => ({
    aiService: { generateMonthlyAccountSummary: vi.fn() }
}));

vi.mock('../../../common/utils/pptGenerator', () => ({
    pptGenerator: { generateProgramMonthlyReport: vi.fn() }
}));

vi.mock('../../../common/utils', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks so vi.mocked() wrappers resolve correctly
// ---------------------------------------------------------------------------
import { MonthlyProgramReportService } from './monthlyProgramReportService';
import { ProgramMonthlyReport } from '../../../models/ProgramMonthlyReport';
import { MonthlyProjectReport } from '../../../models/MonthlyProjectReport';
import { Program } from '../../../models/Program';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { monthlyReportService } from './monthlyReportService';
import { aiService } from '../../ai/services/aiService';
import { pptGenerator } from '../../../common/utils/pptGenerator';

// Typed mock handles
const mockProgramMonthlyFindOne = vi.mocked(ProgramMonthlyReport.findOne);
const mockProgramMonthlyUpsert = vi.mocked(ProgramMonthlyReport.upsert);
const mockProgramFindByPk = vi.mocked(Program.findByPk);
const mockAccountFindByPk = vi.mocked(Account.findByPk);
const mockProjectFindAll = vi.mocked(Project.findAll);
const mockMonthlyProjectFindOne = vi.mocked(MonthlyProjectReport.findOne);
const mockGenerateProjectMonthlyReport = vi.mocked(monthlyReportService.generateProjectMonthlyReport);
const mockGenerateMonthlyAccountSummary = vi.mocked(aiService.generateMonthlyAccountSummary);
const mockGeneratePpt = vi.mocked(pptGenerator.generateProgramMonthlyReport);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeProject = (id: number, name: string, code: string) =>
    ({ id, name, code, accountId: 1, programId: 1 } as any);

const makeMonthlyReport = (status: string) =>
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
    month: 9,
    year: 2026,
    summary: 'All good',
    risks: {},
    health: 'Green',
    projectsMissing: [] as string[],
    filePath: null as string | null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MonthlyProgramReportService — no-regression coverage', () => {
    let service: MonthlyProgramReportService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new MonthlyProgramReportService();

        mockProgramMonthlyFindOne.mockResolvedValue(null); // no cache -> generate fresh
        mockProgramFindByPk.mockResolvedValue(PROGRAM);
        mockAccountFindByPk.mockResolvedValue(ACCOUNT);
        mockGenerateMonthlyAccountSummary.mockResolvedValue(DEFAULT_AI_RESULT);
        mockGeneratePpt.mockResolvedValue('/tmp/program-monthly.pptx');
        mockProgramMonthlyUpsert.mockResolvedValue([{ ...SAVED_REPORT }] as any);
    });

    it('a normal Green/Amber project flows through unchanged', async () => {
        mockProjectFindAll.mockResolvedValue([makeProject(1, 'Steady Project', 'SP')]);
        // Keyed by projectId rather than call order: the per-project loop and the later
        // "preserve existing manager insights" lookup both go through ProgramMonthlyReport,
        // not this model, but keying defensively here avoids relying on exact call ordering.
        mockMonthlyProjectFindOne.mockImplementation(({ where }: any) =>
            Promise.resolve(where.projectId === 1 ? makeMonthlyReport('Amber') : null)
        );

        await service.generateMonthlyProgramReport(1, 9, 2026, true);

        expect(mockGenerateMonthlyAccountSummary).toHaveBeenCalledOnce();
        const [projectSummaries] = mockGenerateMonthlyAccountSummary.mock.calls[0];
        expect(projectSummaries).toHaveLength(1);
        expect(projectSummaries[0].projectName).toBe('Steady Project');
        expect(projectSummaries[0].status).toBe('Amber');
    });

    it('falls back to generateProjectMonthlyReport for a project with no cached monthly report', async () => {
        mockProjectFindAll.mockResolvedValue([makeProject(1, 'Missing Cache Project', 'MCP')]);
        mockMonthlyProjectFindOne.mockResolvedValue(null); // never cached for any project
        mockGenerateProjectMonthlyReport.mockResolvedValueOnce(makeMonthlyReport('Green'));

        await service.generateMonthlyProgramReport(1, 9, 2026, true);

        const [projectSummaries] = mockGenerateMonthlyAccountSummary.mock.calls[0];
        expect(projectSummaries).toHaveLength(1);
        expect(projectSummaries[0].projectName).toBe('Missing Cache Project');
    });

    it('excludes a project whose fallback generation throws', async () => {
        mockProjectFindAll.mockResolvedValue([
            makeProject(1, 'Real Project', 'RP'),
            makeProject(2, 'Broken Project', 'BP'),
        ]);
        mockMonthlyProjectFindOne.mockImplementation(({ where }: any) =>
            Promise.resolve(where.projectId === 1 ? makeMonthlyReport('Green') : null)
        );
        mockGenerateProjectMonthlyReport.mockImplementation((projectId: number) =>
            projectId === 2 ? Promise.reject(new Error('no weekly data')) : Promise.resolve(makeMonthlyReport('Green'))
        );

        await service.generateMonthlyProgramReport(1, 9, 2026, true);

        const [projectSummaries] = mockGenerateMonthlyAccountSummary.mock.calls[0];
        expect(projectSummaries).toHaveLength(1);
        expect(projectSummaries[0].projectName).toBe('Real Project');

        const pptArg = mockGeneratePpt.mock.calls[0][0];
        expect(pptArg.projectsMissing).toContain('Broken Project');
    });
});

describe('MonthlyProgramReportService — PPT refresh on cache-hit (Gap 2, parity with MonthlyAccountReportService)', () => {
    let service: MonthlyProgramReportService;
    let renderDeckSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new MonthlyProgramReportService();
        renderDeckSpy = vi.spyOn(service, 'renderDeckFromStored').mockResolvedValue('/tmp/refreshed.pptx');
        mockProgramFindByPk.mockResolvedValue(PROGRAM);
        mockAccountFindByPk.mockResolvedValue(ACCOUNT);
    });

    it('calls renderDeckFromStored and still returns the cached row on a cache-hit read', async () => {
        const cached = { ...SAVED_REPORT };
        mockProgramMonthlyFindOne.mockResolvedValue(cached as any);

        const result = await service.generateMonthlyProgramReport(1, 9, 2026, false);

        expect(renderDeckSpy).toHaveBeenCalledWith(cached);
        expect(result).toBe(cached);
    });

    it('still returns the cached row even if renderDeckFromStored throws (non-fatal PPT refresh)', async () => {
        const cached = { ...SAVED_REPORT };
        mockProgramMonthlyFindOne.mockResolvedValue(cached as any);
        renderDeckSpy.mockRejectedValueOnce(new Error('PPT engine down'));

        const result = await service.generateMonthlyProgramReport(1, 9, 2026, false);

        expect(result).toBe(cached);
    });
});
