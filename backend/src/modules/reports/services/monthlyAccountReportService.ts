import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { MonthlyProjectReport } from '../../../models/MonthlyProjectReport';
import { MonthlyAccountReport } from '../../../models/MonthlyAccountReport';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { TeamMember } from '../../../models/TeamMember';
import { monthlyReportService } from './monthlyReportService';
import { aiService } from '../../ai/services/aiService';
import { pptGenerator } from '../../../common/utils/pptGenerator';
import { logger } from '../../../common/utils';
import { computeThresholdRollup } from './healthMath';

export class MonthlyAccountReportService {

    /**
     * Re-renders the PPT for an already-generated report using only stored data.
     * No AI call, no report regeneration — see accountReportService.renderDeckFromStored.
     */
    async renderDeckFromStored(report: MonthlyAccountReport): Promise<string | undefined> {
        const account = await Account.findByPk(report.accountId);
        if (!account) return undefined;

        // Phase C3: re-rendering an already-generated report must show what was true when it
        // was generated, not today's live project roster — otherwise deactivating a project
        // later silently rewrites history for every old report that included it. Use the
        // saved `projectsIncluded` list from generation time (all projects for the account,
        // active or not, filtered to that saved list) instead of a live isActive query.
        const allProjects = await Project.findAll({
            where: { accountId: report.accountId, isSharedTeam: false }
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

        const generatedFilePath = await pptGenerator.generateAccountMonthlyReport({
            accountName: account.name,
            month: report.month,
            year: report.year,
            summary: report.summary,
            keyAccomplishments: report.keyAccomplishments as string[],
            risks: report.risks as any,
            actionItems: report.actionItems as string[],
            annexure: report.annexure as { title: string; points: string[] }[],
            health: report.health,
            projects: pptProjectSummaries,
            // Freshly computed from the current active, non-shared set — see
            // accountReportService.renderDeckFromStored.
            projectsMissing
        });

        await MonthlyAccountReport.update(
            { filePath: generatedFilePath },
            { where: { id: report.id } }
        );

        return generatedFilePath;
    }

    async generateMonthlyAccountReport(
        accountId: number,
        month?: number,
        year?: number,
        forceRefresh: boolean = false
    ): Promise<any> {
        // 1. Default month/year to current if not provided
        if (!month || !year) {
            const now = new Date();
            month = now.getMonth() + 1; // JS is 0-indexed
            year = now.getFullYear();
            logger.debug(`Month/Year not provided. Defaulting to ${month}/${year}`, 'MonthlyAccountReportService');
        }

        logger.info(`Generating Monthly Account Report for Account ${accountId}, ${month}/${year}`, 'MonthlyAccountReportService');

        // 2. Cache check
        if (!forceRefresh) {
            const existing = await MonthlyAccountReport.findOne({
                where: { accountId, month, year }
            });
            if (existing) {
                logger.info('Returning cached monthly account report.', 'MonthlyAccountReportService');

                // Regenerate PPT from cached data so the file is always fresh
                try {
                    const account = await Account.findByPk(accountId);
                    const projects = await Project.findAll({ where: { accountId, isActive: true, isSharedTeam: false } });
                    const pptProjectSummaries: any[] = [];

                    for (const project of projects) {
                        const mr = await MonthlyProjectReport.findOne({
                            where: { projectId: project.id, month, year }
                        });
                        if (mr) {
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
                                summary: mr.workSummary,
                                risks: mr.risks,
                                status: mr.status,
                                achievements: mr.achievements,
                                teamMembers
                            });
                        }
                    }

                    const pptData = {
                        accountName: account?.name || 'Unknown',
                        month: existing.month,
                        year: existing.year,
                        summary: existing.summary,
                        risks: existing.risks,
                        health: existing.health,
                        keyAccomplishments: existing.keyAccomplishments as string[],
                        actionItems: existing.actionItems as string[],
                        annexure: existing.annexure as { title: string; points: string[] }[],
                        projects: pptProjectSummaries,
                        projectsMissing: existing.projectsMissing as string[]
                    };
                    await pptGenerator.generateAccountMonthlyReport(pptData);
                } catch (e) {
                    logger.error('Error regenerating PPT from cached monthly account report', e instanceof Error ? e : String(e), 'MonthlyAccountReportService');
                }

                return existing;
            } else {
                logger.warn(`No cached monthly account report found for Account ${accountId} in ${month}/${year}. forceRefresh is false. rejecting.`, 'MonthlyAccountReportService');
                throw new Error('No report data found. Please try "Queue your request" option to generate it, and check back after a minute.');
            }
        }

        // 3. Fetch Account
        const account = await Account.findByPk(accountId);
        if (!account) {
            throw new Error('Account not found');
        }

        // 4. Fetch all projects under account
        const projects = await Project.findAll({ where: { accountId, isActive: true, isSharedTeam: false } });

        const projectsIncluded: string[] = [];
        const projectsMissing: string[] = [];
        const projectSummaries: any[] = [];
        const pptProjectSummaries: any[] = [];

        for (const project of projects) {
            let monthlyReport = await MonthlyProjectReport.findOne({
                where: { projectId: project.id, month, year }
            });

            if (!monthlyReport) {
                // Try to generate the missing monthly project report
                try {
                    logger.debug(`Attempting to generate missing monthly report for ${project.name}...`, 'MonthlyAccountReportService');
                    monthlyReport = await monthlyReportService.generateProjectMonthlyReport(project.id, month, year, true);
                } catch (e) {
                    logger.warn(`Could not generate monthly report for ${project.name}: ${e instanceof Error ? e.message : 'Unknown error'}`, 'MonthlyAccountReportService');
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
                    achievements: monthlyReport.achievements
                });

                // Fetch team members for this project
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

        // 5. Generate AI Summary
        interface AiResult {
            summary: string;
            key_accomplishments: string[];
            red_projects: string[];
            risks: { summary: string; items: string[] } | string[] | string;
            action_items?: string[];
            annexure?: { title: string; points: string[] }[];
            health: string;
        }

        // Fetch existing report to preserve manager insights during regeneration
        const existingAccountReport = await MonthlyAccountReport.findOne({ where: { accountId, month, year } });
        const existingManagerInsights = existingAccountReport?.managerInsights || undefined;

        let aiResult: AiResult = {
            summary: 'No data available.',
            key_accomplishments: [],
            red_projects: [],
            risks: { summary: '', items: [] },
            action_items: [],
            annexure: [],
            health: 'Unknown'
        };

        if (projectSummaries.length > 0) {
            try {
                aiResult = await aiService.generateMonthlyAccountSummary(projectSummaries, { accountId, managerInsights: existingManagerInsights });

                const { temporalValidator } = require('../../../common/utils');
                const validation = temporalValidator.validateTemporalClaims(
                    JSON.stringify(aiResult),
                    `Account-${account.name}-Monthly`
                );

                if (!validation.isValid || validation.suspiciousClaims.length > 0) {
                    logger.warn(
                        `Temporal validation warnings for ${account.name} monthly account report: ${temporalValidator.generateValidationReport(validation)}`,
                        'MonthlyAccountReportService'
                    );
                }
            } catch (error) {
                logger.error('AI Generation failed', error instanceof Error ? error : String(error), 'MonthlyAccountReportService');
            }
        }

        // 5.5 Deterministic monthly account health (Phase 3 of the RAG-reliability plan) —
        // previously `health: aiResult.health` was written straight from the AI with no guard
        // at all, unlike every other level. Rolled up from this month's MonthlyProjectReport
        // statuses; AI disagreement logged only, never applied.
        const redThreshold = account.redThresholdPercentage ?? 30;
        const amberThreshold = account.amberThresholdPercentage ?? 20;
        const redCountFloor = account.redProjectCountFloor ?? 2;
        const ceilingBadPct = account.redCeilingBadPercentage ?? null;
        const { health: finalAccountHealth } =
            computeThresholdRollup(projectSummaries.map(p => p.status), redThreshold, amberThreshold, redCountFloor, ceilingBadPct);

        if (finalAccountHealth !== aiResult.health) {
            logger.warn(
                `[MonthlyAccountHealthGuard] AI suggested health=${aiResult.health}, deterministic=${finalAccountHealth}. Using deterministic.`,
                'MonthlyAccountReportService'
            );
        }

        const redProjects = projectSummaries.filter(p => p.status === 'Red').map(p => p.projectName);

        // 6. Save/Upsert
        const upsertAccountData: any = {
            accountId,
            month,
            year,
            summary: aiResult.summary,
            keyAccomplishments: aiResult.key_accomplishments,
            redProjects,
            risks: aiResult.risks,
            actionItems: aiResult.action_items,
            annexure: aiResult.annexure || [],
            health: finalAccountHealth,
            projectsIncluded,
            projectsMissing
        };
        // Preserve manager-entered fields so regeneration does not wipe them
        if (existingManagerInsights) upsertAccountData.managerInsights = existingManagerInsights;
        if (existingAccountReport?.originalExecutiveSummary) upsertAccountData.originalExecutiveSummary = existingAccountReport.originalExecutiveSummary;

        const [finalReport] = await MonthlyAccountReport.upsert(upsertAccountData, {
            conflictFields: ['account_id', 'month', 'year']
        });

        // 7. Generate PPT
        try {
            const pptData = {
                accountName: account.name,
                month: finalReport.month,
                year: finalReport.year,
                summary: finalReport.summary,
                risks: finalReport.risks,
                health: finalReport.health,
                keyAccomplishments: finalReport.keyAccomplishments as string[],
                actionItems: finalReport.actionItems as string[],
                annexure: finalReport.annexure as { title: string; points: string[] }[],
                projects: pptProjectSummaries,
                projectsMissing
            };

            const generatedFilePath = await pptGenerator.generateAccountMonthlyReport(pptData);

            await MonthlyAccountReport.update(
                { filePath: generatedFilePath },
                { where: { id: finalReport.id } }
            );

            finalReport.filePath = generatedFilePath;
        } catch (pptError) {
            logger.error('Failed to generate monthly account PPT', pptError instanceof Error ? pptError : String(pptError), 'MonthlyAccountReportService');
        }

        return finalReport;
    }
}

export const monthlyAccountReportService = new MonthlyAccountReportService();
