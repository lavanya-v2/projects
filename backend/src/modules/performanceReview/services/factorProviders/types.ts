import { Project } from '../../../../models/Project';
import type { MemberCategory } from '../../../../models/ReviewCycleParticipant';

/**
 * The seam that makes this module source-agnostic.
 *
 * Everything above it works in terms of `teamMemberId` and never sees a Jira
 * accountId or an Excel display name. Onboarding a non-Jira project means writing
 * one provider and confirming identity links — no schema change, and no change to
 * cycles, scoring, coverage, reviews or any UI.
 */

/**
 * Raw delivery metrics for one member from one source.
 *
 * `null` means "this source cannot supply this metric" and is NOT the same as 0.
 * A null sub-metric is dropped from the system factor and the remaining
 * components are re-weighted, scaling coverage down — so an Excel project with
 * only delivery data yields a real score at reduced coverage rather than a
 * fake 100 or a spurious 0.
 */
export interface RawMemberMetrics {
    teamMemberId: number;
    category: MemberCategory;

    // Developer signals
    spPlanned: number | null;
    spDone: number | null;
    spRework: number | null;
    deliveredCount: number | null;
    reopenedCount: number | null;

    // QA signals. clearedSp/uatFailedSp and inSprintBugCount/inSprintEligibleCount
    // are numerator/denominator pairs so a cycle can re-derive the rate from summed
    // counters rather than averaging per-sprint percentages.
    ticketsTested: number | null;
    clearedSp: number | null;
    uatFailedSp: number | null;
    inSprintBugCount: number | null;
    inSprintEligibleCount: number | null;
    prodBugsEscaped: number | null;
    /** Pre-computed per-sync QA risk rate; -1 is the insufficient-data sentinel. */
    qualityRate: number | null;
    bugEscapeRatePct: number | null;

    /** Lead override keys that passed validation and were applied to this row. */
    overridesApplied: string[];

    /**
     * Override keys that were REJECTED — not an overridable metric, or outside its
     * plausible range. Surfaced rather than dropped so a bad override shows up
     * instead of appearing to have been honoured.
     */
    overridesRejected: string[];
}

/** One member's metrics from one specific attached source. */
export interface SourceMemberMetrics extends RawMemberMetrics {
    /** review_cycle_sources.id — the attachment, not the sync. */
    sourceId: number;
    projectId: number;
    /**
     * Human identity of the source (sprint name or date-window label, plus its
     * dates). Without this, two sprints from the same project are indistinguishable
     * in any downstream breakdown — same projectId, no way to tell rows apart.
     * Optional because a future non-Jira provider may have nothing better than a
     * date range, or nothing at all (e.g. a single-snapshot Excel import).
     */
    periodLabel?: string | null;
    startDate?: string | null;
    endDate?: string | null;
}

/** A delivery period that could be attached to a cycle. */
export interface CycleSourceCandidate {
    projectId: number;
    sourceType: 'sprint' | 'kanban' | 'excel_import';
    perfSprintSyncId: number | null;
    externalSourceId: string | null;
    periodLabel: string;
    startDate: string;
    /** Attachment is decided solely by which cycle window contains this date. */
    endDate: string;
}

export interface SystemFactorProvider {
    readonly id: string;
    /** Whether this provider handles the given project. */
    supports(project: Project): boolean;
    /** Completed delivery periods whose end date falls inside the window. */
    listSources(projectId: number, window: { start: string; end: string }): Promise<CycleSourceCandidate[]>;
    /**
     * Metrics per (source, member). Returns one row per member per source so the
     * scorer can compute coverage — "had data in 3 of 4 attached sprints" — rather
     * than only a total.
     */
    getMemberMetrics(
        sources: Array<{ sourceId: number; projectId: number; perfSprintSyncId: number | null; externalSourceId: string | null }>,
    ): Promise<SourceMemberMetrics[]>;
}
