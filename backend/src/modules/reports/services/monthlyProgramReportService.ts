import { Account } from '../../../models/Account';
import { Program } from '../../../models/Program';
import { Project } from '../../../models/Project';
import { MonthlyProjectReport } from '../../../models/MonthlyProjectReport';
import { ProgramMonthlyReport } from '../../../models/ProgramMonthlyReport';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { TeamMember } from '../../../models/TeamMember';
import { monthlyReportService } from './monthlyReportService';
import { aiService } from '../../ai/services/aiService';
import { pptGenerator } from '../../../common/utils/pptGenerator';
import { logger } from '../../../common/utils';
import { computeThresholdRollup } from './healthMath';

function throwErr(message: string, statusCode: number): never {
    throw Object.assign(new Error(message), { statusCode });
}

export class MonthlyProgramReportService {

    /**
     * Re-renders the PPT for an already-generated report using only stored data.
     * No AI call, no report regeneration — see accountReportService.renderDeckFromStored.
     */
    async renderDeckFromStored(report: ProgramMonthlyReport): Promise<string | undefined> {
        const program = await Program.findByPk(report.programId);
        if (!program) return undefined;
        const account = await Account.findByPk(program.accountId);

        // Phase C3: re-rendering an already-generated report must show what was true when it
        // was generated, not today's live project roster — see the identical fix and rationale
        // in monthlyAccountReportService.renderDeckFromStored.
        const allProjects = await Project.findAll({
            where: { accountId: program.accountId, programId: report.programId, isSharedTeam: false }
        });
        const includedNames = new Set(report.projectsIncluded as string[] | null ?? []);
        const projects = allProjects.filter(p => includedNames.has(p.name));

        const pptProjectSummaries: any[] = [];
        const projectsMissing: string[] = [];

        for (const project of projects) {
            const monthlyReport = await MonthlyProjectReport.findOne({
                where: { projectId: project.id, month: report.month, year: report.year }
            });

            if (!monthlyReport) {
                projectsMissing.push(project.name);
                continue;
            }

            const memberRecords = await AccountTeamMember.findAll({
                where: { projectId: project.id },
                include: [{ model: TeamMember }]
            });
            const teamMembers = memberRecords
                .filter((m: any) => m.teamMember)
                .map((m: any) => ({
                    name: `${m.teamMember.firstName} ${m.teamMember.lastName}`,
                    role: m.role || 'Team Member'
                }));

            pptProjectSummaries.push({
                name: project.name,
                summary: monthlyReport.workSummary,
                risks: monthlyReport.risks,
                status: monthlyReport.status,
                achievements: monthlyReport.achievements,
                teamMembers
            });
        }

        const generatedFilePath = await pptGenerator.generateProgramMonthlyReport({
            programName: program.name,
            accountName: account?.name || 'Unknown',
            month: report.month,
            year: report.year,
            summary: report.summary || 'No data available.',
            keyAccomplishments: report.keyAccomplishments as string[],
            risks: report.risks as any,
            actionItems: report.actionItems as string[],
            annexure: report.annexure as { title: string; points: string[] }[],
            health: report.health || 'Unknown',
            projects: pptProjectSummaries,
            // Freshly computed from the current active, non-shared set — see
            // accountReportService.renderDeckFromStored.
            projectsMissing
        });

        await ProgramMonthlyReport.update(
            { filePath: generatedFilePath },
            { where: { id: report.id } }
        );

        return generatedFilePath;
    }

    async generateMonthlyProgramReport(
        programId: number,
        month?: number,
        year?: number,
        forceRefresh: boolean = false
    ): Promise<any> {
        if (!month || !year) {
            const now = new Date();
            month = now.getMonth() + 1;
            year = now.getFullYear();
            logger.debug(`Month/Year not provided. Defaulting to ${month}/${year}`, 'MonthlyProgramReportService');
        }

        const program = await Program.findByPk(programId);
        if (!program) throwErr('Program not found', 404);

        const account = await Account.findByPk(program!.accountId);
        if (!account) throwErr('Account not found', 404);

        logger.info(`Generating Monthly Program Report for Program ${programId}, ${month}/${year}`, 'MonthlyProgramReportService');

        if (!forceRefresh) {
            const existing = await ProgramMonthlyReport.findOne({
                where: { programId, month, year }
            });
            if (existing) {
                logger.info('Returning cached monthly program report.', 'MonthlyProgramReportService');

                // Regenerate the PPT from stored data on every cache-hit read, matching
                // monthlyAccountReportService.ts's cache-hit behavior — reuses the existing
                // renderDeckFromStored method instead of duplicating its project-loop logic.
                try {
                    await this.renderDeckFromStored(existing);
                } catch (e) {
                    logger.error('Error regenerating PPT from cached monthly program report', e instanceof Error ? e : String(e), 'MonthlyProgramReportService');
                }

                return existing;
            }
            throwErr(
                'No report data found. Please try "Queue your request" option to generate it, and check back after a minute.',
                404
            );
        }

        // Fetch projects in this program (active projects feed new reports)
        const projects = await Project.findAll({
            where: { accountId: program!.accountId, programId, isActive: true, isSharedTeam: false }
        });

        if (projects.length === 0) {
            throwErr('Program has no assigned projects. Add projects before generating reports.', 422);
        }

        const projectsIncluded: string[] = [];
        const projectsMissing: string[] = [];
        const projectSummaries: any[] = [];
        const pptProjectSummaries: any[] = [];

        for (const project of projects) {
            let monthlyReport = await MonthlyProjectReport.findOne({
                where: { projectId: project.id, month, year }
            });

            if (!monthlyReport) {
                try {
                    logger.debug(`Attempting to generate missing monthly report for ${project.name}...`, 'MonthlyProgramReportService');
                    monthlyReport = await monthlyReportService.generateProjectMonthlyReport(project.id, month, year, true);
                } catch (e) {
                    logger.warn(
                        `Could not generate monthly report for ${project.name}: ${e instanceof Error ? e.message : 'Unknown error'}`,
                        'MonthlyProgramReportService'
                    );
                    projectsMissing.push(project.name);
                    continue;
                }
            }

            if (monthlyReport) {
                projectSummaries.push({
                    projectName: project.name,
                    summary: monthlyReport.workSummary,
                    risks: monthlyReport.risks,
                    status: monthlyReport.status,
                    achievements: monthlyReport.achievements,
                });

                // Team members feed the monthly deck's Team Details annexure
                const memberRecords = await AccountTeamMember.findAll({
                    where: { projectId: project.id },
                    include: [{ model: TeamMember }]
                });
                const teamMembers = memberRecords
                    .filter((m: any) => m.teamMember)
                    .map((m: any) => ({
                        name: `${m.teamMember.firstName} ${m.teamMember.lastName}`,
                        role: m.role || 'Team Member'
                    }));

                pptProjectSummaries.push({
                    name: project.name,
                    summary: monthlyReport.workSummary,
                    risks: monthlyReport.risks,
                    status: monthlyReport.status,
                    achievements: monthlyReport.achievements,
                    teamMembers
                });

                projectsIncluded.push(project.name);
            } else {
                projectsMissing.push(project.name);
            }
        }

        // Preserve existing manager insights during regeneration
        const existingProgramReport = await ProgramMonthlyReport.findOne({
            where: { programId, month, year }
        });
        const existingManagerInsights = existingProgramReport?.managerInsights || undefined;

        interface AiResult {
            summary: string;
            key_accomplishments: string[];
            red_projects: string[];
            risks: { summary: string; items: string[] } | string[] | string;
            action_items?: string[];
            annexure?: { title: string; points: string[] }[];
            health: string;
        }

        let aiResult: AiResult = {
            summary: 'No data available.',
            key_accomplishments: [],
            red_projects: [],
            risks: { summary: '', items: [] },
            action_items: [],
            annexure: [],
            health: 'Unknown',
        };

        const redThreshold = program!.redThresholdPercentage ?? account!.redThresholdPercentage ?? 30;
        const amberThreshold = account!.amberThresholdPercentage ?? 20;
        const redCountFloor = account!.redProjectCountFloor ?? 2;
        const ceilingBadPct = account!.redCeilingBadPercentage ?? null;

        if (projectSummaries.length > 0) {
            try {
                aiResult = await aiService.generateMonthlyAccountSummary(projectSummaries, {
                    accountId: program!.accountId,
                    redThresholdPercentage: redThreshold,
                    managerInsights: existingManagerInsights,
                });
            } catch (error) {
                logger.error(
                    'AI Generation failed',
                    error instanceof Error ? error : String(error),
                    'MonthlyProgramReportService'
                );
            }
        }

        // Deterministic program-monthly health (Phase 3 of the RAG-reliability plan) — AI
        // disagreement logged only, never applied. (Previously this file had no such log line
        // at all, unlike its sibling files — added here for consistency.)
        const { health: finalHealth } =
            computeThresholdRollup(projectSummaries.map(p => p.status), redThreshold, amberThreshold, redCountFloor, ceilingBadPct);

        if (finalHealth !== aiResult.health) {
            logger.warn(
                `[MonthlyProgramHealthGuard] AI suggested health=${aiResult.health}, deterministic=${finalHealth}. Using deterministic.`,
                'MonthlyProgramReportService'
            );
        }

        const redProjects = projectSummaries.filter(p => p.status === 'Red').map(p => p.projectName);

        const upsertData: any = {
            programId,
            accountId: program!.accountId,
            month,
            year,
            summary: aiResult.summary,
            keyAccomplishments: aiResult.key_accomplishments,
            redProjects,
            risks: aiResult.risks,
            actionItems: aiResult.action_items,
            annexure: aiResult.annexure || [],
            health: finalHealth,
            projectsIncluded,
            projectsMissing,
        };
        if (existingManagerInsights) upsertData.managerInsights = existingManagerInsights;
        if (existingProgramReport?.originalExecutiveSummary) {
            upsertData.originalExecutiveSummary = existingProgramReport.originalExecutiveSummary;
        }

        const [finalReport] = await ProgramMonthlyReport.upsert(upsertData, {
            conflictFields: ['program_id', 'month', 'year']
        });

        // Generate PPT — non-fatal: a deck failure must not lose the saved report.
        try {
            const generatedFilePath = await pptGenerator.generateProgramMonthlyReport({
                programName: program!.name,
                accountName: account?.name || 'Unknown',
                month: finalReport.month,
                year: finalReport.year,
                summary: finalReport.summary || 'No data available.',
                keyAccomplishments: finalReport.keyAccomplishments as string[],
                risks: finalReport.risks as any,
                actionItems: finalReport.actionItems as string[],
                annexure: finalReport.annexure as { title: string; points: string[] }[],
                health: finalReport.health || 'Unknown',
                projects: pptProjectSummaries,
                projectsMissing
            });

            await ProgramMonthlyReport.update(
                { filePath: generatedFilePath },
                { where: { id: finalReport.id } }
            );
            finalReport.filePath = generatedFilePath;
        } catch (e) {
            logger.error(
                'Error generating program monthly PPT',
                e instanceof Error ? e : String(e),
                'MonthlyProgramReportService'
            );
        }

        return finalReport;
    }

    async listByProgram(programId: number, opts: { page?: number; limit?: number } = {}) {
        const limit = Math.min(opts.limit ?? 20, 100);
        const offset = ((opts.page ?? 1) - 1) * limit;
        const { rows, count } = await ProgramMonthlyReport.findAndCountAll({
            where: { programId },
            order: [['year', 'DESC'], ['month', 'DESC']],
            limit,
            offset,
        });
        return { reports: rows, total: count, page: opts.page ?? 1, limit };
    }
}

export const monthlyProgramReportService = new MonthlyProgramReportService();
