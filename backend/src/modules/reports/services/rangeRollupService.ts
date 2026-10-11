/**
 * Shared range rollup (Phase 4 of the RAG-reliability plan).
 *
 * The single source of "what does project/account X look like over this date range" —
 * intended to replace the ad hoc, duplicated logic in the standalone scripts
 * (generateTwiceWeeklyEmail.ts, generateAccountReport.ts, and their near-clones), so the
 * scripts and the app compute health, project population, and Unknown-handling identically.
 *
 * This module takes an already-validated `RangeWindow` — it does NOT call `normalizeWindow`
 * itself. Window *validation* (what dates are allowed for a given caller) is a policy
 * decision that belongs to the caller (see reportWindow.ts); this module only does
 * *computation* over a window it's handed, which is what lets one implementation serve both
 * the app's strict Friday-Thursday cadence and the scripts' arbitrary date ranges.
 */
import { Op } from 'sequelize';
import { Project } from '../../../models/Project';
import { Account } from '../../../models/Account';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { ProjectWeeklyReport } from '../../../models/ProjectWeeklyReport';
import { Risk } from '../../../models/Risk';
import { aiService } from '../../ai/services/aiService';
import { rollupHealth, computeThresholdRollup } from './healthMath';
import { isoWeekOfThursday } from './deliveryPeriodResolver';

export interface RangeWindow {
    startDate: string;
    endDate: string;
}

export interface DailySummary {
    date: string;
    summary: string;
    risks: string;
    plan: string;
    health: string;
    healthRationale: string;
    blocked: string[];
}

export interface ProjectRangeRollup {
    projectId: number;
    code: string;
    name: string;
    window: RangeWindow;
    snapshotCount: number;
    dailySummaries: DailySummary[];
    confirmedProdBugKeys: string[];
    healthTimeline: Array<{ date: string; health: string }>;
    latestHealth: string;
    worstHealth: string;
    /** Deterministic multi-day rollup via the same `rollupHealth` weekly reports use (Phase 2). */
    deterministicHealth: string;
    healthRollupAvg: number;
}

const HEALTH_RANK: Record<string, number> = { Green: 0, Amber: 1, Red: 2 };

/**
 * Rolls up a single project's daily snapshots over `window`. Returns null when there are no
 * snapshots at all in the window — the caller (rollupAccountRange) is responsible for
 * bucketing that as "missing" rather than silently dropping or silently counting it, per the
 * Unknown-handling fix this phase makes.
 */
export async function rollupProjectRange(project: Project, window: RangeWindow): Promise<ProjectRangeRollup | null> {
    const snapshots = await DailyBoardSnapshot.findAll({
        where: {
            projectId: project.id,
            date: { [Op.between]: [window.startDate, window.endDate] },
        },
        order: [['date', 'ASC']],
    });

    if (snapshots.length === 0) return null;

    // Scrub at construction so no downstream caller (script or app) can forget to whitelist
    // confirmed production bug keys before this text reaches an AI prompt or a customer email.
    const confirmedProdBugKeys = [
        ...new Set(snapshots.flatMap(s => (s.confirmedProdBugKeys as string[] | null) ?? [])),
    ];

    const dailySummaries: DailySummary[] = snapshots.map(s => ({
        date: String(s.date),
        summary: aiService.scrubText(s.executiveSummary || '', confirmedProdBugKeys),
        risks: aiService.scrubText(s.executiveRisks || '', confirmedProdBugKeys),
        plan: aiService.scrubText(s.executivePlan || '', confirmedProdBugKeys),
        health: s.overallHealth || 'Unknown',
        healthRationale: s.healthRationale || '',
        blocked: Array.isArray(s.blockedTickets)
            ? (s.blockedTickets as any[]).map(b => b?.summary || b?.key).filter(Boolean)
            : [],
    }));

    const healthTimeline = dailySummaries.map(d => ({ date: d.date, health: d.health }));
    const latestHealth = healthTimeline[healthTimeline.length - 1].health;
    const worstHealth = healthTimeline.reduce(
        (worst, t) => ((HEALTH_RANK[t.health] ?? -1) > (HEALTH_RANK[worst] ?? -1) ? t.health : worst),
        healthTimeline[0].health
    );

    const rollup = rollupHealth(healthTimeline.map(h => h.health));

    return {
        projectId: project.id,
        code: project.code,
        name: project.name,
        window,
        snapshotCount: snapshots.length,
        dailySummaries,
        confirmedProdBugKeys,
        healthTimeline,
        latestHealth,
        worstHealth,
        deterministicHealth: rollup.health,
        healthRollupAvg: rollup.avg,
    };
}

export interface AccountRangeRollup {
    accountId: number;
    accountName: string;
    window: RangeWindow;
    projects: ProjectRangeRollup[];
    projectsMissing: string[];
    risks: Risk[];
    deterministicHealth: string;
}

export interface RollupAccountRangeOptions {
    /** Default false, matching accountReportService.ts's project filter. */
    includeInactive?: boolean;
    /**
     * 'snapshots' (default): roll up from DailyBoardSnapshot directly, for an arbitrary
     * window (what the standalone scripts need).
     * 'weekly-reports': look up each project's already-computed ProjectWeeklyReport instead
     * of re-deriving from snapshots. ONLY valid when `window` is exactly one complete
     * Friday-Thursday week -- a ProjectWeeklyReport is keyed by ISO week number, which has no
     * meaning for an arbitrary multi-day range.
     */
    source?: 'snapshots' | 'weekly-reports';
}

export async function rollupAccountRange(
    accountId: number,
    window: RangeWindow,
    opts: RollupAccountRangeOptions = {}
): Promise<AccountRangeRollup> {
    const { includeInactive = false, source = 'snapshots' } = opts;

    const account = await Account.findByPk(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);

    const projectWhere: Record<string, unknown> = { accountId, isSharedTeam: false };
    if (!includeInactive) projectWhere.isActive = true;
    const projects = await Project.findAll({ where: projectWhere, order: [['name', 'ASC']] });

    const rollups: ProjectRangeRollup[] = [];
    const projectsMissing: string[] = [];

    if (source === 'snapshots') {
        for (const project of projects) {
            const r = await rollupProjectRange(project, window);
            if (r) rollups.push(r);
            else projectsMissing.push(project.name);
        }
    } else {
        const { week, isoYear } = isoWeekOfThursday(window.endDate);
        for (const project of projects) {
            const wr = await ProjectWeeklyReport.findOne({
                where: { projectId: project.id, weekNumber: week, year: isoYear },
            });
            if (!wr || wr.status === 'Unknown') {
                projectsMissing.push(project.name);
                continue;
            }
            // Carry the weekly report's own narrative fields through as a single synthetic
            // "daily" entry — dailySummaries is the shape generateRangeAccountBriefing's prompt
            // already reads (via its `latest`/`risksMentioned`/`blocked` derivations), so this
            // lets the script show the SAME work summary/risks the app's own account report
            // already pulls from this exact row, instead of leaving them as empty/"N/A".
            rollups.push({
                projectId: project.id,
                code: project.code,
                name: project.name,
                window,
                snapshotCount: 0,
                dailySummaries: [{
                    date: wr.endDate,
                    summary: wr.workSummary || '',
                    risks: wr.risks || '',
                    plan: wr.additionalNotes || '',
                    health: wr.status,
                    healthRationale: wr.weeklyHealthRationale || '',
                    blocked: [],
                }],
                confirmedProdBugKeys: [],
                healthTimeline: [{ date: wr.endDate, health: wr.status }],
                latestHealth: wr.status,
                worstHealth: wr.status,
                deterministicHealth: wr.status,
                healthRollupAvg: HEALTH_RANK[wr.status] ?? 0,
            });
        }
    }

    const projectIds = projects.map(p => p.id);
    const risks = projectIds.length === 0 ? [] : await Risk.findAll({
        where: {
            projectId: { [Op.in]: projectIds },
            [Op.or]: [
                { status: { [Op.ne]: 'DONE' } },
                { updatedAt: { [Op.between]: [`${window.startDate} 00:00:00`, `${window.endDate} 23:59:59`] } },
            ],
        },
        order: [['priority', 'ASC'], ['updatedAt', 'DESC']],
    });

    const redThreshold = account.redThresholdPercentage ?? 30;
    const amberThreshold = account.amberThresholdPercentage ?? 20;
    const { health: deterministicHealth } = computeThresholdRollup(
        rollups.map(r => r.deterministicHealth),
        redThreshold,
        amberThreshold
    );

    return {
        accountId,
        accountName: account.name,
        window,
        projects: rollups,
        projectsMissing,
        risks,
        deterministicHealth,
    };
}
