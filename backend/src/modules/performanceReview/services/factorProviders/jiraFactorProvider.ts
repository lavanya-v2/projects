import { Op } from 'sequelize';
import { Project } from '../../../../models/Project';
import { PerfSprintSync } from '../../../../models/PerfSprintSync';
import { PerfMemberScore } from '../../../../models/PerfMemberScore';
import type {
    SystemFactorProvider,
    CycleSourceCandidate,
    SourceMemberMetrics,
} from './types';
import type { MemberCategory } from '../../../../models/ReviewCycleParticipant';

/** Only completed syncs may feed a review score. */
const DONE = 'done';

/**
 * Metric keys a lead override may legitimately change, with their plausible range.
 *
 * `perf_member_scores.overridden_metrics` is free-form JSONB writable from the
 * Team Performance override UI, and those values flow straight into a published
 * review score. Without this allowlist a typo or a bad actor could put a negative
 * or absurd number into an HR record. Anything unlisted or out of range is ignored
 * and recorded, never silently applied.
 *
 * Upper bounds are deliberately generous — this rejects nonsense, not unusual
 * sprints.
 */
const OVERRIDE_BOUNDS: Record<string, { min: number; max: number }> = {
    spPlanned: { min: 0, max: 10_000 },
    spDone: { min: 0, max: 10_000 },
    spRework: { min: 0, max: 10_000 },
    spCarriedOver: { min: 0, max: 10_000 },
    deliveredCount: { min: 0, max: 10_000 },
    reopenedCount: { min: 0, max: 10_000 },
    ticketsTestedCount: { min: 0, max: 10_000 },
    prodBugsEscaped: { min: 0, max: 10_000 },
    clearedSp: { min: 0, max: 10_000 },
    uatFailedSp: { min: 0, max: 10_000 },
    inSprintBugCount: { min: 0, max: 10_000 },
    inSprintEligibleCount: { min: 0, max: 10_000 },
    // Rates are percentages. qualityRate carries -1 as its insufficient-data
    // sentinel, so its floor admits that one negative value and nothing below it.
    qualityRate: { min: -1, max: 100 },
    bugEscapeRatePct: { min: 0, max: 100 },
};

/** A finite number inside the metric's declared range, or null. */
function validOverride(key: string, raw: unknown): number | null {
    const bounds = OVERRIDE_BOUNDS[key];
    if (!bounds) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (value < bounds.min || value > bounds.max) return null;
    return value;
}

/**
 * Provider for Jira-backed projects, covering both sprint and Kanban.
 *
 * They are one provider rather than two because they are one table: Kanban syncs
 * are rows in `perf_sprint_syncs` with `sync_type = 'kanban'`, produced on fixed
 * date strides instead of Jira sprint boundaries. Every metric and formula is
 * identical; only the label differs. Splitting them would duplicate the entire
 * body to change one string.
 */
class JiraFactorProvider implements SystemFactorProvider {
    readonly id = 'jira';

    supports(project: Project): boolean {
        return ((project as any).dataSourceType ?? 'jira') !== 'excel';
    }

    /**
     * Candidate sources for a window.
     *
     * Selected by `end_date` falling inside the window — the same rule the cycle
     * uses to claim a source. A sprint that straddles two cycles belongs to the one
     * where it finished: deterministic, never double-counted, and explainable to
     * the person being reviewed ("work counts when it lands").
     */
    async listSources(
        projectId: number,
        window: { start: string; end: string },
    ): Promise<CycleSourceCandidate[]> {
        const syncs = await PerfSprintSync.findAll({
            where: {
                projectId,
                syncStatus: DONE,
                endDate: { [Op.between]: [window.start, window.end] },
            },
            attributes: ['id', 'syncType', 'periodLabel', 'sprintName', 'startDate', 'endDate'],
            order: [['endDate', 'ASC']],
        });

        return syncs.map(s => ({
            projectId,
            sourceType: (s.syncType === 'kanban' ? 'kanban' : 'sprint') as 'sprint' | 'kanban',
            perfSprintSyncId: s.id,
            externalSourceId: null,
            periodLabel: s.periodLabel ?? (s as any).sprintName ?? String(s.startDate).slice(0, 10),
            startDate: String(s.startDate).slice(0, 10),
            endDate: String(s.endDate).slice(0, 10),
        }));
    }

    /**
     * Per-member metrics for the attached sources.
     *
     * Rows with no resolved `teamMemberId` are dropped: an unconfirmed identity
     * must not silently attribute someone's delivery data. That absence is what
     * drives the visible zero-coverage warning rather than a quiet omission.
     *
     * Lead overrides are applied HERE, before any aggregation, so an override of
     * a per-sprint metric flows correctly into a cycle-level sum.
     */
    async getMemberMetrics(
        sources: Array<{ sourceId: number; projectId: number; perfSprintSyncId: number | null }>,
    ): Promise<SourceMemberMetrics[]> {
        const withSync = sources.filter(s => s.perfSprintSyncId !== null);
        if (withSync.length === 0) return [];

        const bySyncId = new Map(withSync.map(s => [s.perfSprintSyncId as number, s]));

        const [scores, syncs] = await Promise.all([
            PerfMemberScore.findAll({
                where: {
                    syncId: { [Op.in]: [...bySyncId.keys()] },
                    teamMemberId: { [Op.ne]: null },
                },
            }),
            // Sprint identity for the breakdown — the same fields listSources()
            // already resolves, fetched here too because getMemberMetrics only
            // receives sourceId/projectId/perfSprintSyncId from the caller, not the
            // richer CycleSourceCandidate shape.
            PerfSprintSync.findAll({
                where: { id: { [Op.in]: [...bySyncId.keys()] } },
                attributes: ['id', 'periodLabel', 'sprintName', 'startDate', 'endDate'],
            }),
        ]);
        const syncById = new Map(syncs.map(s => [s.id, s]));

        return scores.map(row => {
            const source = bySyncId.get(row.syncId)!;
            const sync = syncById.get(row.syncId);
            const o = (row.overriddenMetrics ?? {}) as Record<string, unknown>;
            const applied: string[] = [];
            const rejected: string[] = [];

            const pick = <K extends keyof PerfMemberScore>(key: K, overrideKey: string): number | null => {
                if (row.isOverridden && Object.prototype.hasOwnProperty.call(o, overrideKey)) {
                    const override = validOverride(overrideKey, o[overrideKey]);
                    if (override !== null) {
                        applied.push(overrideKey);
                        return override;
                    }
                    // Out of range or not an overridable metric: fall through to the
                    // computed value rather than poison the score, and record it.
                    rejected.push(overrideKey);
                }
                const v = row[key] as unknown;
                return v === null || v === undefined ? null : Number(v);
            };

            return {
                sourceId: source.sourceId,
                projectId: source.projectId,
                periodLabel: sync?.periodLabel ?? (sync as any)?.sprintName ?? null,
                startDate: sync ? String(sync.startDate).slice(0, 10) : null,
                endDate: sync ? String(sync.endDate).slice(0, 10) : null,
                teamMemberId: row.teamMemberId as number,
                category: (row.memberCategory ?? 'developer') as MemberCategory,

                spPlanned: pick('spPlanned', 'spPlanned'),
                spDone: pick('spDone', 'spDone'),
                spRework: pick('spRework', 'spRework'),
                deliveredCount: pick('deliveredCount', 'deliveredCount'),
                reopenedCount: pick('reopenedCount', 'reopenedCount'),

                ticketsTested: pick('ticketsTestedCount', 'ticketsTestedCount'),
                // Populated from the 20260908110007 migration onward. Rows synced
                // before it are null, and the normalizer falls back to the
                // documented tickets-weighted proxy for those — recorded in
                // breakdown.approximations so an approximated score says so.
                clearedSp: pick('clearedSp', 'clearedSp'),
                uatFailedSp: pick('uatFailedSp', 'uatFailedSp'),
                inSprintBugCount: pick('inSprintBugCount', 'inSprintBugCount'),
                inSprintEligibleCount: pick('inSprintEligibleCount', 'inSprintEligibleCount'),
                prodBugsEscaped: pick('prodBugsEscaped', 'prodBugsEscaped'),
                qualityRate: pick('qualityRate', 'qualityRate'),
                bugEscapeRatePct: pick('bugEscapeRatePct', 'bugEscapeRatePct'),

                // Only overrides that actually took effect. A rejected key is
                // reported separately so a bad override is visible rather than
                // looking like it was honoured.
                overridesApplied: applied,
                overridesRejected: rejected,
            };
        });
    }
}

export const jiraFactorProvider = new JiraFactorProvider();
