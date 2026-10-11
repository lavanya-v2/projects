/**
 * Production-bug axis of the daily health score.
 *
 * Phase 0 of the RAG-reliability plan extracted the then-current count/priority-branch
 * formula verbatim out of reportService.ts's inline `getBugScore()` closure, unchanged,
 * purely so it could be unit tested. Phase 1 replaces that formula with the
 * severity-weighted score below. Defects the old formula had:
 *  - A bug's contribution could only ever go DOWN once it reached a remediation lane
 *    (QA/review/UAT/in-progress) — capped at Amber regardless of count or severity, so a
 *    Critical bug moved to "In Progress" (before any fix exists) dropped from Red to Amber,
 *    and four Blocker bugs in QA scored identically to one Medium bug in QA.
 *  - Priority was read via an exact-string allowlist (`['High','Critical','Blocker']`) that
 *    misses Jira's own default `Highest`, or any P1/Sev1-style scheme.
 *
 * New formula: each fresh, non-reopened bug contributes a weight by severity tier; bugs
 * already in a remediation lane are discounted (not capped to a flat value), so severity
 * still shows through instead of disappearing. Weights are summed and thresholded.
 */

export type PriorityTier = 'critical' | 'high' | 'medium' | 'low';

/** Default Jira-priority-label -> severity-tier mapping. Covers this app's two live accounts
 *  (CCM: Normal/High/Critical/Low; Thrive: Medium-only) plus Jira's own default scheme
 *  (Highest/High/Medium/Low/Lowest) and a Blocker/Critical/Major/Minor/Trivial scheme. */
const DEFAULT_PRIORITY_TIER_MAP: Record<string, PriorityTier> = {
    blocker: 'critical',
    critical: 'critical',
    highest: 'critical',
    high: 'high',
    major: 'high',
    medium: 'medium',
    normal: 'medium',
    low: 'low',
    lowest: 'low',
    minor: 'low',
    trivial: 'low',
};

const TIER_WEIGHTS: Record<PriorityTier, number> = {
    critical: 2.0,
    high: 1.5,
    medium: 0.75,
    low: 0.35,
};

/** A bug whose priority label isn't recognized (blank, or a scheme this map doesn't cover)
 *  is treated as 'medium' — deliberately not the most lenient option, so an unrecognized
 *  label can't silently make a real bug invisible to RAG the way an unmatched 'Highest' did
 *  under the old exact-string allowlist. */
const UNRECOGNIZED_PRIORITY_TIER: PriorityTier = 'medium';

/**
 * Maps a raw Jira priority label to a severity tier. `priorityMap`, when supplied, is a
 * project-specific override (nullable JSONB `bug_priority_map` on `projects`) that REPLACES
 * the default map entirely for that project, rather than merging with it — the project owner
 * is expected to name every priority label their Jira instance actually uses. Lookups are
 * case-insensitive on both the raw label and the map's keys.
 */
export function normalizePriority(
    raw: string | null | undefined,
    priorityMap?: Record<string, PriorityTier> | null
): PriorityTier {
    const key = (raw || '').trim().toLowerCase();
    if (!key) return UNRECOGNIZED_PRIORITY_TIER;

    const map = priorityMap ?? DEFAULT_PRIORITY_TIER_MAP;
    const matchedKey = Object.keys(map).find(k => k.toLowerCase() === key);
    return matchedKey ? map[matchedKey] : UNRECOGNIZED_PRIORITY_TIER;
}

/** A bug already in a remediation lane (in-progress/in-review/QA/UAT) keeps this fraction of
 *  its severity weight — engagement lowers urgency, but does not erase it. This is what lets
 *  a Critical bug in QA still outrank (and, at volume, still drive Red on) a Medium bug in
 *  QA, instead of both being flattened to the same fixed Amber contribution. */
const REMEDIATION_DISCOUNT = 0.5;

/** Sum thresholds, calibrated so today's headline cases hold: one Critical unaddressed
 *  (weight 2.0) is Red; one Low unaddressed (0.35) stays Green; three Mediums (2.25) is Red. */
const RED_THRESHOLD = 2.0;
const AMBER_THRESHOLD = 0.5;

export interface ScoredBug {
    isOld: boolean;
    isReopenedSubBug: boolean;
    isInRemediation: boolean;
    priorityName: string | null | undefined;
}

/**
 * `tierBreakdown` counts every fresh, non-reopened bug by severity tier regardless of
 * remediation state — this is what lets a caller explain a low/zero score as "1 low-priority
 * bug open" instead of just "no production bugs", closing the old "single Low bug is
 * completely invisible" gap even in cases where the SCORE correctly stays Green.
 */
export interface BugAxisScoreDetail {
    score: number; // 0 (Green), 1 (Amber), 2 (Red)
    totalWeight: number;
    freshCount: number;
    unaddressedCount: number;
    inRemediationCount: number;
    tierBreakdown: Record<PriorityTier, number>;
}

const EMPTY_DETAIL: BugAxisScoreDetail = {
    score: 0,
    totalWeight: 0,
    freshCount: 0,
    unaddressedCount: 0,
    inRemediationCount: 0,
    tierBreakdown: { critical: 0, high: 0, medium: 0, low: 0 },
};

export function computeBugAxisScore(
    bugs: ScoredBug[],
    priorityMap?: Record<string, PriorityTier> | null
): BugAxisScoreDetail {
    if (bugs.length === 0) return EMPTY_DETAIL;

    // Fresh = within the 15-day window AND not a re-opened sub-bug
    const freshActiveBugs = bugs.filter(b => !b.isOld && !b.isReopenedSubBug);
    if (freshActiveBugs.length === 0) return EMPTY_DETAIL;

    const tierBreakdown: Record<PriorityTier, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    let totalWeight = 0;
    let inRemediationCount = 0;

    for (const b of freshActiveBugs) {
        const tier = normalizePriority(b.priorityName, priorityMap);
        tierBreakdown[tier]++;
        const base = TIER_WEIGHTS[tier];
        totalWeight += b.isInRemediation ? base * REMEDIATION_DISCOUNT : base;
        if (b.isInRemediation) inRemediationCount++;
    }

    const score = totalWeight >= RED_THRESHOLD ? 2 : totalWeight >= AMBER_THRESHOLD ? 1 : 0;

    return {
        score,
        totalWeight,
        freshCount: freshActiveBugs.length,
        unaddressedCount: freshActiveBugs.length - inRemediationCount,
        inRemediationCount,
        tierBreakdown,
    };
}
