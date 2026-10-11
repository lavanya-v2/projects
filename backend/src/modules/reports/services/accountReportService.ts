import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { ProjectWeeklyReport } from '../../../models/ProjectWeeklyReport';
import { AccountWeeklyReport } from '../../../models/AccountWeeklyReport';
import { reportService } from './reportService';
import { aiService } from '../../ai/services/aiService';
import { pptGenerator } from '../../../common/utils/pptGenerator';
import { logger } from '../../../common/utils';
import { Op } from 'sequelize';
import { computeThresholdRollup } from './healthMath';
import { normalizeWindow } from './reportWindow';

export class AccountReportService {
  /**
   * Re-renders the PPT for an already-generated report using only stored data.
   *
   * Deliberately does NOT call the AI or regenerate any project report — the deck
   * is a pure render of what is already in the DB, so a download can refresh a
   * stale layout without altering a single word of the report's content.
   * Only filePath is written back.
   */
  async renderDeckFromStored(report: AccountWeeklyReport): Promise<string | undefined> {
    const account = await Account.findByPk(report.accountId);
    if (!account) return undefined;

    // Phase C3 (found while fixing the identical bug at the monthly level): re-rendering an
    // already-generated report must show what was true when it was generated, not today's
    // live project roster — otherwise deactivating a project later silently rewrites history
    // for every old report that included it. Use the saved `projectsIncluded` list from
    // generation time instead of a live isActive query.
    const allProjects = await Project.findAll({
      where: { accountId: report.accountId, isSharedTeam: false },
    });
    const includedNames = new Set((report.projectsIncluded as string[] | null) ?? []);
    const projects = allProjects.filter(p => includedNames.has(p.name));

    const pptProjectSummaries: any[] = [];
    const projectsMissing: string[] = [];

    for (const project of projects) {
      // Looked up by the real (start_date, end_date) the account report covers, not
      // weekNumber/year -- ISO week numbers are no longer the uniqueness key (see the
      // configurable Account.weekStartDay work), so they're not guaranteed to still
      // uniquely identify this project's matching week under a non-default cycle.
      const weeklyReport = await ProjectWeeklyReport.findOne({
        where: { projectId: project.id, startDate: report.startDate, endDate: report.endDate },
      });

      if (weeklyReport) {
        pptProjectSummaries.push({
          name: project.name,
          summary: weeklyReport.workSummary,
          risks: weeklyReport.risks,
          status: weeklyReport.status,
          achievements: weeklyReport.achievements,
        });
      } else {
        projectsMissing.push(project.name);
      }
    }

    const generatedFilePath = await pptGenerator.generateAccountWeeklyReport({
      accountName: account.name,
      weekNumber: report.weekNumber,
      year: report.year,
      startDate: report.startDate,
      endDate: report.endDate,
      summary: report.summary,
      keyAccomplishments: report.keyAccomplishments as string[],
      risks: report.risks as any,
      actionItems: report.actionItems as string[],
      health: report.health,
      projects: pptProjectSummaries,
      // Computed from the same point-in-time `projectsIncluded` list above, not a live
      // query — a project missing its own weekly report at generation time stays missing
      // on re-render, consistent with the rest of this point-in-time reconstruction.
      projectsMissing,
    });

    await AccountWeeklyReport.update({ filePath: generatedFilePath }, { where: { id: report.id } });

    return generatedFilePath;
  }

  private getWeekNumber(d: Date): [number, number] {
    // Copy date so don't modify original
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    // Set to nearest Thursday: current date + 4 - current day number
    // Make Sunday's day number 7
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    // Get first day of year
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    // Calculate full weeks to nearest Thursday
    const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return [d.getUTCFullYear(), weekNo];
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  async generateAccountWeeklyReport(
    accountId: number,
    startDate?: string,
    endDate?: string,
    forceRefresh: boolean = false
  ): Promise<any> {
    const cycleAccount = await Account.findByPk(accountId);
    const weekStartDay = cycleAccount?.weekStartDay ?? 5;

    const window = normalizeWindow(startDate, endDate, 'fri-thu-week', weekStartDay);
    startDate = window.startDate;
    endDate = window.endDate;

    // Kept as a human-readable label for UI/PPT titles -- no longer the DB uniqueness key,
    // which is now the real (account_id, start_date, end_date), correct for any configured
    // week-start day.
    const [isoYear, weekNumber] = this.getWeekNumber(new Date(endDate));
    logger.info(
      `Generating Account Weekly Report for Account ${accountId}, Week ${weekNumber}-${isoYear}`,
      'AccountReportService'
    );

    // 1. Check Cache
    if (!forceRefresh) {
      const existing = await AccountWeeklyReport.findOne({
        where: { accountId, startDate, endDate },
      });
      if (existing) {
        logger.info('Returning cached account report.', 'AccountReportService');

        // Regenerate PPT if requested (or to ensure latest template)
        try {
          const projectSummariesForPpt = [];
          const projects = await Project.findAll({ where: { accountId, isActive: true, isSharedTeam: false } });

          for (const project of projects) {
            try {
              const wr = await reportService.generateWeeklyReport(project.code, startDate, endDate, false);
              if (wr) {
                projectSummariesForPpt.push({
                  name: project.name,
                  summary: wr.workSummary,
                  risks: wr.risks,
                  status: wr.status,
                  achievements: wr.achievements,
                });
              }
            } catch (e) {
              // ignore missing in this pass
            }
          }

          const pptData = {
            accountName: (await Account.findByPk(accountId))?.name || 'Unknown',
            weekNumber: existing.weekNumber,
            year: existing.year,
            startDate: existing.startDate,
            endDate: existing.endDate,
            summary: existing.summary,
            keyAccomplishments: existing.keyAccomplishments,
            risks: existing.risks,
            actionItems: existing.actionItems,
            health: existing.health,
            projects: projectSummariesForPpt,
            projectsMissing: existing.projectsMissing as string[],
          };
          await pptGenerator.generateAccountWeeklyReport(pptData);
        } catch (e) {
          logger.error(
            'Error generating PPT from cached report',
            e instanceof Error ? e : String(e),
            'AccountReportService'
          );
        }

        return existing;
      } else {
        logger.warn(
          `No cached account report found for Account ${accountId} and week ${weekNumber}. forceRefresh is false. rejecting.`,
          'AccountReportService'
        );
        throw new Error(
          'No report data found. Please try "Queue your request" option to generate it, and check back after a minute.'
        );
      }
    }

    // 2 Fetch Account
    const account = await Account.findByPk(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    // 3. Fetch Projects & Reports
    const projects = await Project.findAll({ where: { accountId, isActive: true, isSharedTeam: false } });
    // const weeklyReports: ProjectWeeklyReport[] = []; // Unused
    const projectsIncluded: string[] = [];
    const projectsMissing: string[] = [];

    // Define this strictly to match AI service expectation if possible, but any[] is accepted there
    const projectSummaries: any[] = [];
    const pptProjectSummaries: any[] = [];

    for (const project of projects) {
      const weeklyReport = await ProjectWeeklyReport.findOne({
        where: {
          projectId: project.id,
          startDate,
          endDate,
        },
      });

      if (weeklyReport) {
        // A cached WSR with status=Unknown means no real daily data ever
        // rolled up for this project this week — treat it the same as a
        // missing report rather than feeding "Unknown" noise to the AI
        // summary, the deterministic health calc, or the PPT.
        if (weeklyReport.status === 'Unknown') {
          projectsMissing.push(project.name);
        } else {
          // weeklyReports.push(weeklyReport);
          // Scrub WSR text with empty confirmed keys at account level — any prod-bug language
          // that wasn't validated in a DSR confirmed list should not propagate upward.
          projectSummaries.push({
            projectName: project.name,
            summary: aiService.scrubText(weeklyReport.workSummary || '', []),
            risks: aiService.scrubText(weeklyReport.risks || '', []),
            status: weeklyReport.status,
            achievements: weeklyReport.achievements,
            managerInsights: weeklyReport.managerInsights,
          });

          pptProjectSummaries.push({
            name: project.name,
            summary: weeklyReport.workSummary,
            risks: weeklyReport.risks,
            status: weeklyReport.status,
            achievements: weeklyReport.achievements,
          });

          projectsIncluded.push(project.name);
        }
      } else {
        try {
          logger.debug(`Attempting to generate missing report for ${project.name}...`, 'AccountReportService');
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
              achievements: newReport.achievements,
            });

            pptProjectSummaries.push({
              name: project.name,
              summary: newReport.workSummary,
              risks: newReport.risks,
              status: newReport.status,
              achievements: newReport.achievements,
            });

            projectsIncluded.push(project.name);
          }
        } catch (e) {
          logger.warn(
            `Could not generate report for ${project.name}: ${e instanceof Error ? e.message : 'Unknown error'}`,
            'AccountReportService'
          );
          projectsMissing.push(project.name);
        }
      }
    }

    // 4. Generate AI Summary
    interface AiResult {
      summary: string;
      key_accomplishments: string[];
      red_projects: string[];
      risks: { summary: string; items: string[] } | string[] | string;
      recommendations?: string;
      health: string;
      notes?: string;
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

    // Collate project-level manager insights into account-level narrative
    const projectInsightsList = projectSummaries
      .filter(p => p.managerInsights && p.managerInsights.trim().length > 0)
      .map(p => ({ projectName: p.projectName, insights: p.managerInsights as string }));

    let collatedAccountInsights: string | undefined;
    if (projectInsightsList.length > 0) {
      logger.debug(
        `Collating ${projectInsightsList.length} project insights for account ${account.name}...`,
        'AccountReportService'
      );
      try {
        collatedAccountInsights = await aiService.collateAccountInsights(projectInsightsList);
      } catch (e) {
        logger.warn(
          `Failed to collate account insights: ${e instanceof Error ? e.message : 'Unknown'}`,
          'AccountReportService'
        );
        collatedAccountInsights = projectInsightsList.map(p => `[${p.projectName}]: ${p.insights}`).join(' | ');
      }
    }

    if (projectSummaries.length > 0) {
      // Use existing AI Service method
      try {
        aiResult = await aiService.generateAccountSummary(projectSummaries, { accountId }, collatedAccountInsights);

        // Validate AI output for temporal accuracy
        const { temporalValidator } = require('../../../common/utils');
        const validation = temporalValidator.validateTemporalClaims(
          JSON.stringify(aiResult),
          `Account-${account.name}-Weekly`
        );

        if (!validation.isValid || validation.suspiciousClaims.length > 0) {
          logger.warn(
            `Temporal validation warnings for ${account.name} account weekly report: ${temporalValidator.generateValidationReport(validation)}`,
            'AccountReportService'
          );

          // Log the original AI result for debugging
          logger.debug(`AI Result before validation: ${JSON.stringify(aiResult.risks)}`, 'AccountReportService');
        }
      } catch (error) {
        logger.error('AI Generation failed', error instanceof Error ? error : String(error), 'AccountReportService');
      }
    }

    // 5. Deterministic account health (Phase 3 of the RAG-reliability plan) — computed
    // from project status distribution, fully deterministic: AI disagreement is logged
    // only, never applied, matching daily/weekly. Previously this guard only blocked AI
    // from reporting a HEALTHIER state than the data showed, but still let AI report a
    // WORSE one, which made account health non-deterministic run to run.
    const redThreshold = account.redThresholdPercentage ?? 30;
    const amberThreshold = account.amberThresholdPercentage ?? 20;
    const redCountFloor = account.redProjectCountFloor ?? 2;
    const ceilingBadPct = account.redCeilingBadPercentage ?? null;
    const { health: finalAccountHealth } = computeThresholdRollup(
      projectSummaries.map(p => p.status),
      redThreshold,
      amberThreshold,
      redCountFloor,
      ceilingBadPct
    );

    if (finalAccountHealth !== aiResult.health) {
      logger.warn(
        `[AccountHealthGuard] AI suggested health=${aiResult.health}, deterministic=${finalAccountHealth}. Using deterministic.`,
        'AccountReportService'
      );
    }

    // red_projects is now computed, not AI-authored — it's a factual list derivable from
    // the same project statuses the health rollup above already used.
    const redProjects = projectSummaries.filter(p => p.status === 'Red').map(p => p.projectName);

    // 5. Save/Upsert Account Report
    const reportDataToSave = {
      accountId,
      weekNumber,
      year: isoYear,
      startDate,
      endDate,
      summary: aiResult.summary,
      keyAccomplishments: aiResult.key_accomplishments,
      redProjects,
      risks: aiResult.risks,
      actionItems: aiResult.action_items,
      health: finalAccountHealth, // Deterministic — AI is never used to determine this
      projectsIncluded,
      projectsMissing,
      managerInsights: collatedAccountInsights || null,
    };

    const [finalReport] = await AccountWeeklyReport.upsert(reportDataToSave, {
      conflictFields: ['account_id', 'start_date', 'end_date'],
    });

    // 6. Generate PPT Report
    try {
      const pptData = {
        accountName: account.name,
        weekNumber: finalReport.weekNumber,
        year: finalReport.year,
        startDate: finalReport.startDate,
        endDate: finalReport.endDate,
        summary: finalReport.summary,
        keyAccomplishments: finalReport.keyAccomplishments,
        risks: finalReport.risks,
        actionItems: finalReport.actionItems,
        health: finalReport.health,
        projects: pptProjectSummaries,
        projectsMissing: reportDataToSave.projectsMissing,
      };

      // Capture filepath here
      const generatedFilePath = await pptGenerator.generateAccountWeeklyReport(pptData);

      // Also generate Excel for backward compatibility / data view
      const excelGenerator = require('../../../common/utils/excelGenerator').excelGenerator;
      await excelGenerator.generateAccountWeeklyReport({
        ...pptData,
      });

      // Update DB with filepath (Prioritize PPT)
      await AccountWeeklyReport.update({ filePath: generatedFilePath }, { where: { id: finalReport.id } });

      // Return the report with the file path included
      finalReport.filePath = generatedFilePath;
    } catch (pptError) {
      logger.error(
        'Failed to generate reports',
        pptError instanceof Error ? pptError : String(pptError),
        'AccountReportService'
      );
    }

    return finalReport;
  }
}

export const accountReportService = new AccountReportService();
