import { Account } from '../../../models/Account';
import { Program } from '../../../models/Program';
import { Project } from '../../../models/Project';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { ProgramDailyReport } from '../../../models/ProgramDailyReport';
import { aiService } from '../../ai/services/aiService';
import { logger } from '../../../common/utils';
import { computeThresholdRollup } from './healthMath';

function throwErr(message: string, statusCode: number): never {
    throw Object.assign(new Error(message), { statusCode });
}

function toDateOnly(input?: string): string {
    if (!input) {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        throwErr('Invalid date format. Use YYYY-MM-DD.', 400);
    }
    return input;
}

export class ProgramDailyReportService {

    async generateDailyProgramReport(
        programId: number,
        date?: string,
        forceRefresh: boolean = false
    ): Promise<any> {
        const reportDate = toDateOnly(date);

        const program = await Program.findByPk(programId);
        if (!program) throwErr('Program not found', 404);

        const account = await Account.findByPk(program!.accountId);
        if (!account) throwErr('Account not found', 404);

        logger.info(`Generating Daily Program Report for Program ${programId}, date ${reportDate}`, 'ProgramDailyReportService');

        if (!forceRefresh) {
            const existing = await ProgramDailyReport.findOne({
                where: { programId, reportDate }
            });
            if (existing) {
                logger.info('Returning cached daily program report.', 'ProgramDailyReportService');
                return existing;
            }
            throwErr(
                'No report found for that date. Use force=true or queue generation.',
                404
            );
        }

        // isActive/isSharedTeam filter matches every sibling rollup (programReportService,
        // monthlyProgramReportService, accountReportService, monthlyAccountReportService) —
        // this was the one report that never got it, so a deactivated project kept
        // showing up in its program's nightly daily rollup.
        const projects = await Project.findAll({
            where: { accountId: program!.accountId, programId, isActive: true, isSharedTeam: false }
        });

        if (projects.length === 0) {
            throwErr('Program has no assigned projects. Add projects before generating reports.', 422);
        }

        const projectsIncluded: Array<{ projectName: string; health?: string; sprintBurndown?: any }> = [];
        const projectsMissing: string[] = [];
        const projectDailyInputs: any[] = [];

        for (const project of projects) {
            const snap = await DailyBoardSnapshot.findOne({
                where: { projectId: project.id, date: reportDate }
            });

            if (!snap) {
                projectsMissing.push(project.name);
                continue;
            }

            projectDailyInputs.push({
                projectName: project.name,
                summary: aiService.scrubText(snap.workSummary || '', snap.confirmedProdBugKeys || []),
                executiveSummary: snap.executiveSummary,
                status: snap.overallHealth,
                risks: snap.executiveRisks,
                plan: snap.executivePlan,
                sprintBurndown: snap.sprintBurndown,
                blockedTickets: snap.blockedTickets,
                managerInsights: snap.managerInsights,
            });

            projectsIncluded.push({
                projectName: project.name,
                health: snap.overallHealth || undefined,
                sprintBurndown: snap.sprintBurndown ?? undefined,
            });
        }

        // Collate manager insights — reuse account-level method
        const projectInsightsList = projectDailyInputs
            .filter(p => p.managerInsights && (p.managerInsights as string).trim().length > 0)
            .map(p => ({ projectName: p.projectName, insights: p.managerInsights as string }));

        let collatedInsights: string | undefined;
        if (projectInsightsList.length > 0) {
            try {
                collatedInsights = await aiService.collateAccountInsights(projectInsightsList);
            } catch (e) {
                logger.warn(`Failed to collate program daily insights: ${e instanceof Error ? e.message : 'Unknown'}`, 'ProgramDailyReportService');
                collatedInsights = projectInsightsList.map(p => `[${p.projectName}]: ${p.insights}`).join(' | ');
            }
        }

        const redThreshold = program!.redThresholdPercentage ?? account!.redThresholdPercentage ?? 30;
        const amberThreshold = account!.amberThresholdPercentage ?? 20;

        interface AiResult {
            summary: string;
            key_accomplishments: string[];
            red_projects: string[];
            risks: { summary: string; items: string[] } | string[] | string;
            health: string;
            action_items?: string[];
        }

        let aiResult: AiResult = {
            summary: 'No data available.',
            key_accomplishments: [],
            red_projects: [],
            risks: { summary: '', items: [] },
            action_items: [],
            health: 'Unknown',
        };

        if (projectDailyInputs.length > 0) {
            try {
                aiResult = await aiService.generateDailyProgramSummary(
                    projectDailyInputs,
                    {
                        programId,
                        programName: program!.name,
                        redThresholdPercentage: redThreshold,
                        date: reportDate,
                    },
                    collatedInsights
                );
            } catch (error) {
                logger.error(
                    'AI Generation failed (program daily)',
                    error instanceof Error ? error : String(error),
                    'ProgramDailyReportService'
                );
            }
        }

        // Deterministic program-daily health (Phase 3 of the RAG-reliability plan) — AI
        // disagreement logged only, never applied.
        const { health: finalHealth } =
            computeThresholdRollup(projectDailyInputs.map(p => p.status), redThreshold, amberThreshold);

        if (finalHealth !== aiResult.health) {
            logger.warn(
                `[ProgramDailyHealthGuard] AI suggested health=${aiResult.health}, deterministic=${finalHealth}. Using deterministic.`,
                'ProgramDailyReportService'
            );
        }

        const redProjects = projectDailyInputs.filter(p => p.status === 'Red').map(p => p.projectName);

        const reportDataToSave = {
            programId,
            accountId: program!.accountId,
            reportDate,
            summary: aiResult.summary,
            keyAccomplishments: aiResult.key_accomplishments,
            redProjects,
            risks: aiResult.risks,
            actionItems: aiResult.action_items,
            health: finalHealth,
            projectsIncluded, // rich objects with sprintBurndown
            projectsMissing,
            managerInsights: collatedInsights || null,
        };

        const [finalReport] = await ProgramDailyReport.upsert(reportDataToSave as any, {
            conflictFields: ['program_id', 'report_date']
        });

        return finalReport;
    }

    async listByProgram(programId: number, opts: { page?: number; limit?: number } = {}) {
        const limit = Math.min(opts.limit ?? 20, 100);
        const offset = ((opts.page ?? 1) - 1) * limit;
        const { rows, count } = await ProgramDailyReport.findAndCountAll({
            where: { programId },
            order: [['reportDate', 'DESC']],
            limit,
            offset,
        });
        return { reports: rows, total: count, page: opts.page ?? 1, limit };
    }
}

export const programDailyReportService = new ProgramDailyReportService();
