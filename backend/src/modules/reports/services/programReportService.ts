import { Account } from '../../../models/Account';
import { Program } from '../../../models/Program';
import { Project } from '../../../models/Project';
import { ProjectWeeklyReport } from '../../../models/ProjectWeeklyReport';
import { ProgramWeeklyReport } from '../../../models/ProgramWeeklyReport';
import { reportService } from './reportService';
import { aiService } from '../../ai/services/aiService';
import { logger } from '../../../common/utils';
import { pptGenerator } from '../../../common/utils/pptGenerator';
import { computeThresholdRollup } from './healthMath';
import { normalizeWindow } from './reportWindow';

function throwErr(message: string, statusCode: number): never {
    throw Object.assign(new Error(message), { statusCode });
}

export class ProgramReportService {

    /**
     * Re-renders the PPT for an already-generated report using only stored data.
     * No AI call, no report regeneration — see accountReportService.renderDeckFromStored.
     */
    async renderDeckFromStored(report: ProgramWeeklyReport): Promise<string | undefined> {
        const program = await Program.findByPk(report.programId);
        if (!program) return undefined;
        const account = await Account.findByPk(program.accountId);

        // Phase C3 (found while fixing the identical bug at account/monthly levels): use the
        // saved `projectsIncluded` list from generation time, not a live isActive query — see
        // the identical fix and rationale in accountReportService.renderDeckFromStored.
        const allProjects = await Project.findAll({
            where: { accountId: program.accountId, programId: report.programId, isSharedTeam: false }
        });
        const includedNames = new Set(report.projectsIncluded as string[] | null ?? []);
        const projects = allProjects.filter(p => includedNames.has(p.name));

        const pptProjectSummaries: any[] = [];
        const projectsMissing: string[] = [];

        for (const project of projects) {
            // Looked up by the real (start_date, end_date) the program report covers, not
            // weekNumber/year -- see the identical fix and rationale in
            // accountReportService.renderDeckFromStored.
            const weeklyReport = await ProjectWeeklyReport.findOne({
                where: { projectId: project.id, startDate: report.startDate, endDate: report.endDate }
            });

            if (weeklyReport) {
                pptProjectSummaries.push({
                    name: project.name,
                    summary: weeklyReport.workSummary || '',
                    risks: weeklyReport.risks || '',
                    status: weeklyReport.status || 'Unknown',
                    achievements: weeklyReport.achievements || ''
                });
            } else {
                projectsMissing.push(project.name);
            }
        }

        const generatedFilePath = await pptGenerator.generateProgramWeeklyReport({
            programName: program.name,
            accountName: account?.name || 'Unknown',
            weekNumber: report.weekNumber,
            year: report.year,
            startDate: report.startDate,
            endDate: report.endDate,
            summary: report.summary || 'No data available.',
            keyAccomplishments: report.keyAccomplishments as string[],
            risks: report.risks as any,
            actionItems: report.actionItems as string[],
            health: report.health || 'Unknown',
            projects: pptProjectSummaries,
            // Freshly computed from the current active, non-shared set — see
            // accountReportService.renderDeckFromStored.
            projectsMissing
        });

        await ProgramWeeklyReport.update(
            { filePath: generatedFilePath },
            { where: { id: report.id } }
        );

        return generatedFilePath;
    }

    private getWeekNumber(d: Date): [number, number] {
        d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
        return [d.getUTCFullYear(), weekNo];
    }

    async generateProgramWeeklyReport(
        programId: number,
        startDate?: string,
        endDate?: string,
        forceRefresh: boolean = false
    ): Promise<any> {
        // Program/account resolved before window computation (previously this file computed the
        // window with its own independent, hardcoded-Friday copy of the same logic that lives in
        // reportWindow.ts -- now routed through the shared function so a configurable
        // Account.weekStartDay only needs to be implemented once).
        const program = await Program.findByPk(programId);
        if (!program) throwErr('Program not found', 404);

        const account = await Account.findByPk(program!.accountId);
        if (!account) throwErr('Account not found', 404);

        const weekStartDay = account!.weekStartDay ?? 5;

        let window;
        try {
            window = normalizeWindow(startDate, endDate, 'fri-thu-week', weekStartDay);
        } catch (e) {
            throwErr(e instanceof Error ? e.message : 'Invalid date range', 400);
        }
        startDate = window!.startDate;
        endDate = window!.endDate;
        const end = window!.end;

        // Kept as a human-readable label for UI/PPT titles -- no longer the DB uniqueness key,
        // which is now the real (program_id, start_date, end_date), correct for any configured
        // week-start day.
        const [isoYear, weekNumber] = this.getWeekNumber(end);
        logger.info(`Generating Program Weekly Report for Program ${programId}, Week ${weekNumber}-${isoYear}`, 'ProgramReportService');

        // Cache check
        if (!forceRefresh) {
            const existing = await ProgramWeeklyReport.findOne({
                where: { programId, startDate, endDate }
            });
            if (existing) {
                logger.info('Returning cached program report.', 'ProgramReportService');

                // Regenerate the PPT from stored data on every cache-hit read, matching
                // accountReportService.ts's cache-hit behavior — reuses the existing
                // renderDeckFromStored method instead of duplicating its project-loop logic.
                try {
                    await this.renderDeckFromStored(existing);
                } catch (e) {
                    logger.error('Error regenerating PPT from cached program report', e instanceof Error ? e : String(e), 'ProgramReportService');
                }

                return existing;
            }
            throwErr(
                'No report data found. Please try "Queue your request" option to generate it, and check back after a minute.',
                404
            );
        }

        // Fetch projects in this program only (active projects feed new reports)
        const projects = await Project.findAll({
            where: { accountId: program!.accountId, programId, isActive: true, isSharedTeam: false }
        });

        if (projects.length === 0) {
            throwErr('Program has no assigned projects. Add projects before generating reports.', 422);
        }

        const projectsIncluded: string[] = [];
        const projectsMissing: string[] = [];
        const projectSummaries: any[] = [];

        for (const project of projects) {
            const weeklyReport = await ProjectWeeklyReport.findOne({
                where: { projectId: project.id, startDate, endDate }
            });

            if (weeklyReport) {
                // A cached WSR with status=Unknown means no real daily data ever rolled up for
                // this project this week — treat it the same as a missing report rather than
                // feeding "Unknown" noise to the AI summary, the deterministic health calc, or
                // the PPT. Matches accountReportService.ts's identical exclusion.
                if (weeklyReport.status === 'Unknown') {
                    projectsMissing.push(project.name);
                } else {
                    projectSummaries.push({
                        projectName: project.name,
                        summary: aiService.scrubText(weeklyReport.workSummary || '', []),
                        risks: aiService.scrubText(weeklyReport.risks || '', []),
                        status: weeklyReport.status,
                        achievements: weeklyReport.achievements,
                        managerInsights: weeklyReport.managerInsights
                    });
                    projectsIncluded.push(project.name);
                }
            } else {
                try {
                    logger.debug(`Attempting to generate missing project weekly report for ${project.name}...`, 'ProgramReportService');
                    const newReport = await reportService.generateWeeklyReport(project.code, startDate, endDate, true);
                    // Same "no real data" exclusion as the cached-report branch above.
                    if (!newReport || newReport.status === 'Unknown') {
                        projectsMissing.push(project.name);
                    } else {
                        projectSummaries.push({
                            projectName: project.name,
                            summary: newReport.workSummary,
                            risks: newReport.risks,
                            status: newReport.status,
                            achievements: newReport.achievements
                        });
                        projectsIncluded.push(project.name);
                    }
                } catch (e) {
                    logger.warn(
                        `Could not generate report for ${project.name}: ${e instanceof Error ? e.message : 'Unknown error'}`,
                        'ProgramReportService'
                    );
                    projectsMissing.push(project.name);
                }
            }
        }

        // AI summary — reuse existing methods
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

        // Collate manager insights across projects in program
        const projectInsightsList = projectSummaries
            .filter(p => p.managerInsights && p.managerInsights.trim().length > 0)
            .map(p => ({ projectName: p.projectName, insights: p.managerInsights as string }));

        let collatedInsights: string | undefined;
        if (projectInsightsList.length > 0) {
            try {
                collatedInsights = await aiService.collateAccountInsights(projectInsightsList);
            } catch (e) {
                logger.warn(`Failed to collate program insights: ${e instanceof Error ? e.message : 'Unknown'}`, 'ProgramReportService');
                collatedInsights = projectInsightsList.map(p => `[${p.projectName}]: ${p.insights}`).join(' | ');
            }
        }

        const redThreshold = program!.redThresholdPercentage ?? account!.redThresholdPercentage ?? 30;
        // Program has no amber threshold of its own -- fall back to the parent account's,
        // same as the red threshold does above. Red-count floor and bad-percentage ceiling are
        // account-only config (no Program override) -- always inherited from the parent account.
        const amberThreshold = account!.amberThresholdPercentage ?? 20;
        const redCountFloor = account!.redProjectCountFloor ?? 2;
        const ceilingBadPct = account!.redCeilingBadPercentage ?? null;

        if (projectSummaries.length > 0) {
            try {
                aiResult = await aiService.generateAccountSummary(
                    projectSummaries,
                    { accountId: program!.accountId, redThresholdPercentage: redThreshold },
                    collatedInsights
                );
            } catch (error) {
                logger.error(
                    'AI Generation failed',
                    error instanceof Error ? error : String(error),
                    'ProgramReportService'
                );
            }
        }

        // Deterministic program health (Phase 3 of the RAG-reliability plan) — AI disagreement
        // logged only, never applied.
        const { health: finalHealth } =
            computeThresholdRollup(projectSummaries.map(p => p.status), redThreshold, amberThreshold, redCountFloor, ceilingBadPct);

        if (finalHealth !== aiResult.health) {
            logger.warn(
                `[ProgramHealthGuard] AI suggested health=${aiResult.health}, deterministic=${finalHealth}. Using deterministic.`,
                'ProgramReportService'
            );
        }

        const redProjects = projectSummaries.filter(p => p.status === 'Red').map(p => p.projectName);

        const reportDataToSave = {
            programId,
            accountId: program!.accountId,
            weekNumber,
            year: isoYear,
            startDate,
            endDate,
            summary: aiResult.summary,
            keyAccomplishments: aiResult.key_accomplishments,
            redProjects,
            risks: aiResult.risks,
            actionItems: aiResult.action_items,
            health: finalHealth,
            projectsIncluded,
            projectsMissing,
            managerInsights: collatedInsights || null,
        };

        const [finalReport] = await ProgramWeeklyReport.upsert(reportDataToSave as any, {
            conflictFields: ['program_id', 'start_date', 'end_date']
        });

        // Generate PPT — non-fatal: a deck failure must not lose the saved report.
        try {
            const generatedFilePath = await pptGenerator.generateProgramWeeklyReport({
                programName: program!.name,
                accountName: account?.name || 'Unknown',
                weekNumber: finalReport.weekNumber,
                year: finalReport.year,
                startDate: finalReport.startDate,
                endDate: finalReport.endDate,
                summary: finalReport.summary || 'No data available.',
                keyAccomplishments: finalReport.keyAccomplishments as string[],
                risks: finalReport.risks as any,
                actionItems: finalReport.actionItems as string[],
                health: finalReport.health || 'Unknown',
                projects: projectSummaries.map(p => ({
                    name: p.projectName,
                    summary: p.summary || '',
                    risks: p.risks || '',
                    status: p.status || 'Unknown',
                    achievements: p.achievements || ''
                })),
                projectsMissing
            });

            await ProgramWeeklyReport.update(
                { filePath: generatedFilePath },
                { where: { id: finalReport.id } }
            );
            finalReport.filePath = generatedFilePath;
        } catch (e) {
            logger.error(
                'Error generating program weekly PPT',
                e instanceof Error ? e : String(e),
                'ProgramReportService'
            );
        }

        return finalReport;
    }

    async listByProgram(programId: number, opts: { page?: number; limit?: number } = {}) {
        const limit = Math.min(opts.limit ?? 20, 100);
        const offset = ((opts.page ?? 1) - 1) * limit;
        const { rows, count } = await ProgramWeeklyReport.findAndCountAll({
            where: { programId },
            order: [['year', 'DESC'], ['weekNumber', 'DESC']],
            limit,
            offset,
        });
        return { reports: rows, total: count, page: opts.page ?? 1, limit };
    }
}

export const programReportService = new ProgramReportService();
