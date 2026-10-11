/**
 * Pure formulae for the three quality trend metrics. Mirrors what
 * `getQualityTrendsOverview` in performanceSyncService.ts computes per sprint
 * (extracted so the reconciliation job can apply the same math to both the
 * stored facts and a freshly-rebuilt facts set from live Jira).
 */

export interface QualityFact {
    storyPoints: number | null;
    issueType: string | null;
    isProductionBug: boolean;
    wasReopened: boolean;
    wasPunted: boolean;
    /** True when the bug was ruled invalid (Root Cause fuzzy-matching 'Invalid Bug',
     *  'Bad Data' or 'Incomplete Requirement', or an invalid-bug label). Excluded from the leakage rate — see
     *  computeLeakageFromFacts. */
    invalidBug?: boolean;
    /** Jira's `created` timestamp. Used to count a bug only in the sprint it
     *  was actually created — see computeDefectDensity. */
    jiraCreatedAt?: Date | string | null;
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

function isBug(f: { issueType: string | null }): boolean {
    return (f.issueType ?? '').toLowerCase().includes('bug');
}

// A sub-bug is a QA-found defect filed against a parent story — it is the
// evidence of that story's reopen, not a separate reopened work item. The reopen
// ratio excludes sub-bugs (but counts standalone Bugs).
function isSubBug(f: { issueType: string | null }): boolean {
    const s = (f.issueType ?? '').toLowerCase();
    return s === 'sub-bug' || (s.includes('sub') && s.includes('bug'));
}

/**
 * Bug count = facts whose issueType contains 'bug', are NOT ruled invalid
 * (see QualityFact.invalidBug — Root Cause fuzzy-matching 'Invalid Bug'/'Bad
 * Data'/'Incomplete Requirement', or an invalid-bug label), AND whose Jira
 * `created` date falls in [sprintStart, sprintEnd]. The window is required to
 * match the production metric in performanceSyncService.getQualityTrendsOverview,
 * which was tightened in 2026-05 to exclude carryover bugs. The invalidBug
 * exclusion was added so a ticket the team already ruled not-a-real-defect
 * (same flag computeLeakageFromFacts already excludes) doesn't inflate density.
 * If `sprintWindow` is omitted, falls back to the un-windowed count (kept for
 * backwards-compat with any future callers that don't have sprint dates).
 */
export function computeDefectDensity(
    facts: QualityFact[],
    sprintWindow?: { startDate: string; endDate: string },
): { bugCount: number; totalSp: number; density: number } {
    const nonPunted = facts.filter(f => !f.wasPunted);
    const bugCount = nonPunted.filter(f => {
        if (!isBug(f)) return false;
        if (f.invalidBug) return false;
        if (!sprintWindow) return true;
        if (!f.jiraCreatedAt) return false;
        const created = new Date(f.jiraCreatedAt).toISOString().slice(0, 10);
        return created >= sprintWindow.startDate && created <= sprintWindow.endDate;
    }).length;
    const totalSp = nonPunted.reduce((s, f) => s + (f.storyPoints ?? 0), 0);
    const density = totalSp > 0 ? round2(bugCount / totalSp) : 0;
    return { bugCount, totalSp: round1(totalSp), density };
}

export function computeDefectLeakage(facts: QualityFact[]): {
    prodBugCount: number;
} {
    const nonPunted = facts.filter(f => !f.wasPunted);
    const prodBugCount = nonPunted.filter(f => f.isProductionBug).length;
    return { prodBugCount };
}

/**
 * Defect-leakage RATE for the presentation/scorecard, computed straight from
 * ticket facts so it is REPORTER-AGNOSTIC: every valid production bug counts,
 * regardless of whether a QA or a developer filed it. (The per-member counters
 * in PerfMemberScore drop dev-reported bugs at write-out; this recompute does
 * not.) A bug qualifies when it is a Bug/Sub-bug created in the sprint window,
 * not punted, and not ruled invalid.
 *   numerator   = valid bugs that escaped to Production
 *   denominator = all valid bugs raised in the window
 * With `sprintWindow` omitted the window filter is skipped (un-windowed count),
 * matching computeDefectDensity's fallback.
 */
export function computeLeakageFromFacts(
    facts: QualityFact[],
    sprintWindow?: { startDate: string; endDate: string },
): { bugsRaised: number; prodBugsEscaped: number; leakageRatePct: number } {
    const valid = facts.filter(f => {
        if (!isBug(f)) return false;
        if (f.wasPunted) return false;
        if (f.invalidBug) return false;
        if (!sprintWindow) return true;
        if (!f.jiraCreatedAt) return false;
        const created = new Date(f.jiraCreatedAt).toISOString().slice(0, 10);
        return created >= sprintWindow.startDate && created <= sprintWindow.endDate;
    });
    const bugsRaised = valid.length;
    const prodBugsEscaped = valid.filter(f => f.isProductionBug).length;
    const leakageRatePct = bugsRaised > 0
        ? round1((prodBugsEscaped / bugsRaised) * 100)
        : 0;
    return { bugsRaised, prodBugsEscaped, leakageRatePct };
}

export function computeReopenRatio(facts: QualityFact[]): {
    reopenedStoryCount: number; totalStoryCount: number; reopenRatio: number;
} {
    const nonPunted = facts.filter(f => !f.wasPunted);
    const reopenScope = nonPunted.filter(f => !isSubBug(f));
    const reopenedStoryCount = reopenScope.filter(f => f.wasReopened).length;
    const totalStoryCount = reopenScope.length;
    const reopenRatio = totalStoryCount > 0
        ? round1((reopenedStoryCount / totalStoryCount) * 100)
        : 0;
    return { reopenedStoryCount, totalStoryCount, reopenRatio };
}
