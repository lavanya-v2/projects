import { JiraService } from '../../jira/services/jiraService';
import { generateCycles } from './kanbanCycleService';

/**
 * A delivery period, normalized across every way a project's team can work.
 * This is the single seam every call site that currently branches on
 * `isKanbanProject` (daily reports, perf sync, the presentation, Team
 * Performance, reconciliation jobs, the frontend) is meant to converge on --
 * see the Kanban delivery-models design doc. Call sites migrate to it one at
 * a time across several stages; today only the 'sprint' and 'cadence'
 * providers exist. 'continuous' (a project with no sprint and no configured
 * cycle -- pure backlog pull) resolves to synthetic reporting-week windows in
 * a later stage and is an empty list until then.
 *
 * Dates are passed through in whatever format their source uses rather than
 * normalized: 'cadence' and 'continuous' periods are YYYY-MM-DD (DATEONLY),
 * 'sprint' periods are full ISO timestamps (as Jira returns them). A caller
 * that needs one consistent format must convert -- reformatting here would
 * risk a silent behaviour change in whichever provider gets touched.
 */
export interface DeliveryPeriod {
    kind: 'sprint' | 'cadence' | 'continuous';
    startDate: string;
    endDate: string;
    label: string;
    isComplete: boolean;
    /** Jira sprint id for 'sprint', the deterministic cycle index for 'cadence', null otherwise. */
    sourceId: number | string | null;
}

/**
 * The minimal shape resolveDeliveryPeriods needs from a project row. A plain
 * object satisfies this just as well as a full Sequelize Project instance --
 * deliberate, so tests and fixtures don't need a DB-backed model.
 */
export interface DeliveryPeriodProject {
    deliveryModel: 'sprint' | 'cadence' | 'continuous';
    jiraBoardId?: number | string | null;
    kanbanCycleAnchorDate?: string | null;
    kanbanCycleDays?: number | null;
    kanbanCycleStrideDays?: number | null;
}

/**
 * Resolve a project's delivery periods (its "sprints", however it actually
 * works), newest first, capped at `limit`.
 *
 * `jira` is only used by the 'sprint' provider -- pass null for a 'cadence'
 * or 'continuous' project to skip constructing a client that will never be
 * called. `asOf` only matters for 'cadence' (cycles are generated up to and
 * including whichever one contains it); the 'sprint' provider asks Jira for
 * whatever is currently active/closed on the board.
 */
export async function resolveDeliveryPeriods(
    project: DeliveryPeriodProject,
    jira: Pick<JiraService, 'listBoardSprints'> | null,
    asOf: string,
    limit = 24,
): Promise<DeliveryPeriod[]> {
    if (project.deliveryModel === 'cadence') {
        return resolveCadencePeriods(project, asOf, limit);
    }
    if (project.deliveryModel === 'sprint') {
        return resolveSprintPeriods(project, jira, limit);
    }
    return resolveContinuousPeriods(asOf, limit);
}

function resolveCadencePeriods(project: DeliveryPeriodProject, asOf: string, limit: number): DeliveryPeriod[] {
    if (!project.kanbanCycleAnchorDate || !project.kanbanCycleDays) return [];
    const cycles = generateCycles(
        project.kanbanCycleAnchorDate,
        project.kanbanCycleDays,
        asOf,
        project.kanbanCycleStrideDays,
    );
    // Same "most recent `limit`, newest first" selection as every existing
    // cadence call site (e.g. performanceSyncService.getKanbanCyclesForProject).
    const recent = cycles.slice(Math.max(0, cycles.length - limit)).reverse();
    return recent.map(c => ({
        kind: 'cadence' as const,
        startDate: c.startDate,
        endDate: c.endDate,
        label: c.label,
        isComplete: c.isComplete,
        sourceId: c.index,
    }));
}

async function resolveSprintPeriods(
    project: DeliveryPeriodProject,
    jira: Pick<JiraService, 'listBoardSprints'> | null,
    limit: number,
): Promise<DeliveryPeriod[]> {
    if (!jira || !project.jiraBoardId) return [];
    // listBoardSprints already returns newest-first, capped at maxResults --
    // nothing left to do but normalize the shape.
    const sprints = await jira.listBoardSprints(Number(project.jiraBoardId), limit);
    return sprints.map(s => ({
        kind: 'sprint' as const,
        startDate: s.startDate,
        endDate: s.endDate,
        label: s.name,
        isComplete: s.state !== 'active',
        sourceId: s.id,
    }));
}

// ─── continuous provider ──────────────────────────────────────────────────
//
// A 'continuous' project has no sprint and no configured cycle -- pure
// backlog pull, no natural period boundary at all. Rather than "no period,
// no metrics", its period IS the org's reporting week (Friday through
// Thursday, decided and kept org-wide rather than per-project -- see the
// Kanban delivery-models design doc's "reporting week ownership" decision).
// That gives every metric a denominator and, via the weekly-close sync
// trigger, a first sync span it has never had before.
//
// Deliberately its own UTC DATEONLY date math (not reportService's
// generateWeeklyReport, which is server-local-time `Date` arithmetic aimed at
// validating a human-supplied range) -- this needs a *generator*, not a
// validator, and must be as DST/timezone-safe as kanbanCycleService's cycle
// math for the same reason.

const MS_PER_DAY = 86_400_000;

function toUtcMs(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

function toDateStr(ms: number): string {
    const dt = new Date(ms);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** The Friday on or before `dateStr` -- the start of that date's reporting week. */
export function fridayOnOrBefore(dateStr: string): string {
    const day = new Date(toUtcMs(dateStr)).getUTCDay(); // Sun=0 .. Sat=6, Fri=5
    const diffToFriday = (day + 2) % 7; // days since the most recent Friday
    return toDateStr(toUtcMs(dateStr) - diffToFriday * MS_PER_DAY);
}

/**
 * ISO week number of the Thursday ending a Fri-Thu reporting week, matching
 * reportService.getWeekNumber's convention of keying off the end date. Pure
 * UTC reimplementation (that one is private and server-local-time) so this
 * provider stays independently testable and DST-safe.
 */
export function isoWeekOfThursday(thursdayDateStr: string): { week: number; isoYear: number } {
    const ms = toUtcMs(thursdayDateStr);
    // ISO week year is defined by its Thursday, which this date already is.
    const isoYear = new Date(ms).getUTCFullYear();
    const jan4Ms = Date.UTC(isoYear, 0, 4);
    const jan4Day = (new Date(jan4Ms).getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const week1MondayMs = jan4Ms - jan4Day * MS_PER_DAY;
    const week = Math.round((ms - week1MondayMs) / (7 * MS_PER_DAY)) + 1;
    return { week, isoYear };
}

function continuousWeekLabel(startDate: string, endDate: string): string {
    const { week, isoYear } = isoWeekOfThursday(endDate);
    return `Wk ${week}, ${isoYear}`;
}

/**
 * Generate the `limit` most recent Fri-Thu reporting weeks up to and
 * including the one containing `asOf`, newest first -- the same shape as
 * cadence's "recent cycles, newest first, current one included" list.
 */
function resolveContinuousPeriods(asOf: string, limit: number): DeliveryPeriod[] {
    const currentWeekStart = fridayOnOrBefore(asOf);
    const asOfMs = toUtcMs(asOf);
    const periods: DeliveryPeriod[] = [];
    for (let i = 0; i < limit; i++) {
        const startMs = toUtcMs(currentWeekStart) - i * 7 * MS_PER_DAY;
        const endMs = startMs + 6 * MS_PER_DAY;
        const startDate = toDateStr(startMs);
        const endDate = toDateStr(endMs);
        periods.push({
            kind: 'continuous',
            startDate,
            endDate,
            label: continuousWeekLabel(startDate, endDate),
            isComplete: endMs < asOfMs,
            sourceId: startDate,
        });
    }
    return periods;
}
