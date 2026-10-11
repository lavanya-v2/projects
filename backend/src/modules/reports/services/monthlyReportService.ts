import { Project } from '../../../models/Project';
import { ProjectWeeklyReport } from '../../../models/ProjectWeeklyReport';
import { MonthlyProjectReport } from '../../../models/MonthlyProjectReport';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { aiService } from '../../ai/services/aiService';
import { logger } from '../../../common/utils';
import { Op } from 'sequelize';
import { rollupHealth, rollupHealthWeighted } from './healthMath';

// Pure helpers, extracted and directly unit-testable (no DB/AI/require() involved) — see
// monthlyReportService.test.ts. Kept in this file since they're small and used nowhere else.

/**
 * Y-M-D date strings for a calendar month, built directly (not via a local-midnight
 * `Date`→`toISOString()` round trip, which shifts a day backward on any positive-UTC-offset
 * timezone — this server runs IST, and the old computation silently produced Aug 31 - Sep 29
 * for "September" every month, pre-existing and unrelated to the trailing-days fix below, but
 * caught while testing it).
 */
export function monthDateRange(year: number, month: number): { startDateStr: string; endDateStr: string } {
    const lastDayOfMonth = new Date(year, month, 0).getDate();
    return {
        startDateStr: `${year}-${String(month).padStart(2, '0')}-01`,
        endDateStr: `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`,
    };
}

/**
 * The date range not yet covered by a weekly report, from the day after the last known week's
 * end through month-end. Returns null when there's no gap (the last weekly report already
 * reaches month-end, or overshoots it).
 */
export function computeTrailingWindow(
    lastWeeklyEndDate: string | null,
    monthStartDate: string,
    monthEndDate: string
): { start: string; end: string } | null {
    const start = lastWeeklyEndDate
        ? new Date(new Date(lastWeeklyEndDate + 'T00:00:00Z').getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : monthStartDate;
    return start <= monthEndDate ? { start, end: monthEndDate } : null;
}

export interface TrailingSummary {
    week: number; // synthetic — not a real ISO week number
    summary: string;
    achievements: string;
    risks: string;
    status: string;
    dayCount: number; // real day count this stub covers -- its weight in the outer monthly rollup
}

/** Rolls up trailing daily snapshots into one synthetic weekly-shaped entry. Null if none. */
export function buildTrailingSummary(
    snapshots: Array<{ overallHealth?: string | null; workSummary?: string | null; executiveRisks?: string | null }>
): TrailingSummary | null {
    if (snapshots.length === 0) return null;
    const trailingRollup = rollupHealth(snapshots.map(s => s.overallHealth || 'Unknown'));
    return {
        week: 0,
        summary: snapshots.map(s => s.workSummary).filter(Boolean).join(' '),
        achievements: '',
        risks: snapshots.map(s => s.executiveRisks).filter(Boolean).join(' '),
        status: trailingRollup.health,
        dayCount: snapshots.length,
    };
}

export class MonthlyReportService {

    async generateProjectMonthlyReport(projectId: number, month?: number, year?: number, forceRefresh: boolean = false): Promise<any> {

        // 1. Determine Month/Year (Default to current IST month)
        // Note: JS Month is 0-indexed (0=Jan, 11=Dec). Our DB stores 1-12.
        if (!month || !year) {
            const now = new Date();
            // Simple default to current month
            month = now.getMonth() + 1;
            year = now.getFullYear();
            logger.debug(`Month/Year not provided. Defaulting to ${month}/${year}`, 'MonthlyReportService');
        }

        logger.info(`Generating Monthly Report for Project ${projectId}, ${month}/${year}`, 'MonthlyReportService');

        // 2. Check Cache
        if (!forceRefresh) {
            const existing = await MonthlyProjectReport.findOne({
                where: { projectId, month, year }
            });
            if (existing) {
                logger.info('Returning cached monthly report.', 'MonthlyReportService');
                return existing;
            } else {
                logger.warn(`No cached monthly report found for Project ${projectId} in ${month}/${year}. forceRefresh is false. rejecting.`, 'MonthlyReportService');
                throw new Error('No report data found. Please try "Queue your request" option to generate it, and check back after a minute.');
            }
        }

        // 3. Fetch Weekly Reports for this month
        // Logic: Fetch weekly reports where the report's iso year matches AND the week falls primarily in this month?
        // OR: Simpler: Fetch where `start_date`'s month match the filtered month.
        // Let's use `start_date` filter.

        const { startDateStr, endDateStr } = monthDateRange(year, month);

        const weeklyReports = await ProjectWeeklyReport.findAll({
            where: {
                projectId,
                startDate: {
                    [Op.between]: [startDateStr, endDateStr]
                }
            },
            order: [['startDate', 'ASC']]
        });

        // Trailing-days gap fix: the month's final Friday-Thursday week may not have closed
        // yet when this report is generated (e.g. the month ends mid-week) — its
        // ProjectWeeklyReport doesn't exist yet, so those days would otherwise be silently
        // excluded from the month permanently (nothing re-adds them later). Fill the gap
        // directly from DailyBoardSnapshot for whatever days after the last known week aren't
        // covered by a weekly report yet, so every day through month-end is represented.
        //
        // `lastWeeklyEnd` is looked up project-wide (not scoped to this month's own
        // `weeklyReports`), and deliberately NOT reused from that array: a week can straddle two
        // calendar months (e.g. a Fri-Thu week starting in August, ending in September) and gets
        // attributed wholly to August via the `startDate` filter above -- correct on its own, but
        // if September's report is generated before September's own first week closes,
        // `weeklyReports` here is empty and a month-scoped lookup would wrongly start the
        // trailing window at September 1st, re-pulling days already fully counted in August's
        // rollup. Filtering candidates by `startDate <= monthEnd` (not `endDate <= monthEnd`)
        // is essential here: August's own straddling week (startDate Aug28, endDate Sep3)
        // must still be found when generating AUGUST's report too, so its already-covered
        // Aug28-31 days aren't re-pulled into a spurious August trailing stub -- an
        // `endDate <= monthEnd` filter would skip that week (its endDate overshoots August) and
        // wrongly fall back to an earlier week, double-counting Aug28-31. `startDate <= monthEnd`
        // correctly finds the latest-ending week that has *started* by month-end, whichever month
        // it's filed under, in every case: this month's own last week (whether or not it
        // overshoots into next month), or the previous month's straddling tail when this month's
        // own weeks haven't started yet.
        const lastCoveredWeek = await ProjectWeeklyReport.findOne({
            where: { projectId, startDate: { [Op.lte]: endDateStr } },
            order: [['endDate', 'DESC']]
        });
        const lastWeeklyEnd = lastCoveredWeek ? lastCoveredWeek.endDate : null;
        const trailingWindow = computeTrailingWindow(lastWeeklyEnd, startDateStr, endDateStr);

        let trailingSummary: TrailingSummary | null = null;
        if (trailingWindow) {
            const trailingSnapshots = await DailyBoardSnapshot.findAll({
                where: { projectId, date: { [Op.between]: [trailingWindow.start, trailingWindow.end] } },
                order: [['date', 'ASC']],
            });
            trailingSummary = buildTrailingSummary(trailingSnapshots);
            if (trailingSummary) {
                logger.info(
                    `[MonthlyTrailingDays] Project ${projectId} ${month}/${year}: ${trailingSnapshots.length} trailing day(s) ` +
                    `(${trailingWindow.start} to ${trailingWindow.end}) not yet covered by a weekly report, rolled up to ${trailingSummary.status}.`,
                    'MonthlyReportService'
                );
            }
        }

        if (weeklyReports.length === 0 && !trailingSummary) {
            throw new Error(`No weekly data found for Project ID ${projectId} in ${month}/${year}`);
        }

        logger.debug(`Found ${weeklyReports.length} weekly reports${trailingSummary ? ' + trailing days' : ''}. Aggregating...`, 'MonthlyReportService');

        // 4. Fetch existing manager insights (if any) to preserve context during regeneration
        const existingReport = await MonthlyProjectReport.findOne({ where: { projectId, month, year } });
        const managerInsights = existingReport?.managerInsights || undefined;

        // 5. Aggregate via AI
        const weeklySummaries = weeklyReports.map(w => ({
            week: w.weekNumber,
            summary: w.workSummary,
            achievements: w.achievements,
            risks: w.risks,
            status: w.status
        }));
        if (trailingSummary) weeklySummaries.push(trailingSummary);

        const aiResult = await aiService.generateMonthlySummary(weeklySummaries, { managerInsights });

        // 4.5 Validate AI output for temporal accuracy
        const { temporalValidator } = require('../../../common/utils');
        const validation = temporalValidator.validateTemporalClaims(
            JSON.stringify(aiResult),
            `Monthly-ProjectID${projectId}`
        );

        if (!validation.isValid || validation.suspiciousClaims.length > 0) {
            logger.warn(
                `Temporal validation warnings for ProjectID${projectId} monthly report: ${temporalValidator.generateValidationReport(validation)}`,
                'MonthlyReportService'
            );
        }

        // 5.5 Deterministic monthly status (Phase 3 of the RAG-reliability plan; reweighted per
        // the monthly-rollup-gaps plan) — rolled up from this month's weekly statuses (plus any
        // trailing days not yet covered by a weekly report, so the month's last partial week
        // isn't silently dropped). AI status is advisory only, exactly like the weekly/daily
        // levels, and is never used to determine the saved status.
        //
        // Each entry is weighted by how many real days it represents, not counted as one flat
        // item: a full closed week (a fixed 7-day Fri-Thu window) gets weight 7, while the
        // trailing stub gets weight equal to however many real days it actually covers. Without
        // this, a 1-day trailing stub carried the same vote as an entire closed week, letting a
        // single bad day at month-end swing an otherwise-good month. When every entry is a full
        // closed week (i.e. no trailing stub -- any already-fully-closed historical month), every
        // weight is equal and this is arithmetically identical to the old flat average.
        const WEEK_SPAN_DAYS = 7;
        const weightedEntries = [
            ...weeklyReports.map(w => ({ health: w.status, weight: WEEK_SPAN_DAYS })),
            ...(trailingSummary ? [{ health: trailingSummary.status, weight: trailingSummary.dayCount }] : [])
        ];
        const monthlyRollup = rollupHealthWeighted(weightedEntries);
        const monthlyStatus = monthlyRollup.health;
        const weeklyLabelParts = weeklyReports.map(w => `W${w.weekNumber}=${w.status || 'Unknown'} (${WEEK_SPAN_DAYS}d)`);
        if (trailingSummary) weeklyLabelParts.push(`trailing=${trailingSummary.status} (${trailingSummary.dayCount}d)`);
        const monthlyHealthRationale =
            `Month status: ${monthlyStatus} (weighted avg ${monthlyRollup.avg.toFixed(2)} across ${monthlyRollup.scorableCount} scored period${monthlyRollup.scorableCount !== 1 ? 's' : ''}, ${monthlyRollup.totalWeight} total day${monthlyRollup.totalWeight !== 1 ? 's' : ''}). ` +
            `Weekly: ${weeklyLabelParts.join(', ')}. ` +
            `Rule: avg < 0.35 → Green; avg < 1.2 → Amber; else Red (each period weighted by real day count); a weighted majority of Red days forces Red regardless of average.`;

        if (aiResult.status && aiResult.status !== monthlyStatus) {
            logger.warn(
                `[MonthlyHealthGuard] AI suggested status=${aiResult.status}, deterministic status=${monthlyStatus}. Using deterministic.`,
                'MonthlyReportService'
            );
        }

        // 6. Save/Upsert — preserve manager-entered fields
        const upsertData: any = {
            projectId,
            month,
            year,
            workSummary: aiResult.work_summary,
            achievements: aiResult.achievements,
            risks: aiResult.risks,
            status: monthlyStatus, // Deterministic — computed from weekly status distribution
            monthlyHealthRationale
        };
        if (managerInsights) upsertData.managerInsights = managerInsights;
        if (existingReport?.originalExecutiveSummary) upsertData.originalExecutiveSummary = existingReport.originalExecutiveSummary;

        const [savedReport] = await MonthlyProjectReport.upsert(upsertData, {
            conflictFields: ['project_id', 'month', 'year']
        });

        return savedReport;
    }
}

export const monthlyReportService = new MonthlyReportService();
