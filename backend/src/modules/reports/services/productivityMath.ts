export interface SprintFact {
    storyPoints: number | null;
    wasCompleted: boolean;
}

export interface SprintProductivity {
    spDone: number;
    spPlanned: number;
    productivity: number;
}

export interface ProductivityTrend {
    currentProductivity: number | null;
    avgProductivity: number | null;
    trend: 'up' | 'down' | 'neutral';
    trendPct: number;
    health: 'green' | 'amber' | 'red';
}

export function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

export interface CommitmentAware {
    isKanbanProject?: boolean | null;
    tracksCommitment?: boolean | null;
}

/**
 * True when a project has a real committed target to measure against — every
 * sprint project (always), or a Kanban project that explicitly opted into
 * commitment tracking. False only for Kanban projects with no tracked
 * commitment (e.g. LS): for those, "delivery %" has no real baseline to be
 * good or bad against, so callers should show raw SP-delivered instead of a
 * ratio (see metricKind: 'percent' | 'throughput' throughout this codebase).
 */
export function hasCommitment(project: CommitmentAware): boolean {
    return !project.isKanbanProject || !!project.tracksCommitment;
}

export interface DateGatedKanban {
    isKanbanProject?: boolean | null;
    kanbanCycleAnchorDate?: string | null;
}

/**
 * Whether Kanban rules apply to a SPECIFIC date, not just "is this project
 * Kanban right now". A project's `isKanbanProject` flag has no history -- it's
 * a single current-value column -- so report/presentation generation for an
 * OLD date (backfill, force-regen, a presentation's own date range) must not
 * blindly read the live flag, or a project that switched mid-history (e.g.
 * Scrum -> Kanban) would have its pre-cutover dates silently reinterpreted
 * under the new rules. `kanbanCycleAnchorDate` (already required for cadence
 * sync) doubles as the cutover marker: dates before it stay on Scrum rules
 * even after the project flips. Continuous-mode projects (no anchor date)
 * have no prior history to protect, so the live flag applies unconditionally.
 */
export function isKanbanForDate(project: DateGatedKanban, date: string): boolean {
    if (!project.isKanbanProject) return false;
    if (!project.kanbanCycleAnchorDate) return true;
    return date >= project.kanbanCycleAnchorDate;
}

export function computeSprintProductivity(facts: SprintFact[]): SprintProductivity {
    const spDone = facts
        .filter(f => f.wasCompleted)
        .reduce((sum, f) => sum + (f.storyPoints ?? 0), 0);
    const spPlanned = facts.reduce((sum, f) => sum + (f.storyPoints ?? 0), 0);
    const productivity = spPlanned > 0 ? round1((spDone / spPlanned) * 100) : 0;
    return {
        spDone: round1(spDone),
        spPlanned: round1(spPlanned),
        productivity,
    };
}

export function computeProductivityTrend(
    sprintRowsNewestFirst: { productivity: number }[],
): ProductivityTrend {
    const currentProductivity = sprintRowsNewestFirst.length > 0
        ? sprintRowsNewestFirst[0].productivity
        : null;
    const historicalSprints = sprintRowsNewestFirst.slice(1);
    const avgProductivity = historicalSprints.length > 0
        ? round1(historicalSprints.reduce((sum, s) => sum + s.productivity, 0) / historicalSprints.length)
        : null;

    let trend: 'up' | 'down' | 'neutral' = 'neutral';
    let trendPct = 0;
    if (currentProductivity != null && avgProductivity != null && avgProductivity > 0) {
        trendPct = Math.round(((currentProductivity - avgProductivity) / avgProductivity) * 100);
        trend = trendPct > 5 ? 'up' : trendPct < -5 ? 'down' : 'neutral';
    }

    const health: 'green' | 'amber' | 'red' =
        currentProductivity == null ? 'red'
        : currentProductivity >= 80 ? 'green'
        : currentProductivity >= 60 ? 'amber'
        : 'red';

    return { currentProductivity, avgProductivity, trend, trendPct, health };
}
