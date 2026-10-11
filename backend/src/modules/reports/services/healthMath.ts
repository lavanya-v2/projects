/**
 * Multi-period RAG rollup rules.
 *
 * `tallyDailyHealth` / `computeWeeklyMajorityStatus` are extracted verbatim (Phase 0 of the
 * RAG-reliability plan) from reportService.ts's inline weekly-status computation inside
 * `generateWeeklyReport` — behavior is unchanged, only relocated so the rule can be unit
 * tested directly instead of only through the full report-generation pipeline.
 * `computeWeeklyMajorityStatus` is no longer called anywhere in production as of Phase 2
 * (see `rollupHealth` below) — kept here, still exported and tested, purely as a documented
 * record of the old behavior for anyone diffing "what changed and why".
 *
 * `Health`, `healthRank`, `rankToHealth`, `meanHealth`, `statusToHealth` are moved verbatim
 * (Phase 2) from portfolioPresentationService.ts, which was the only place they lived —
 * unexported, so nothing else could reuse or test them directly. Pure move, no behavior
 * change: portfolioPresentationService.ts's Delivery Presentation health calculation is
 * UNCHANGED by this move or by anything else in Phase 2 (explicit decision — see `rollupHealth`
 * below for why the two rules are intentionally different and both kept).
 */

export type Health = 'Green' | 'Amber' | 'Red';

export const healthRank = (h: Health | string | null | undefined): number => {
    if (h === 'Red') return 3;
    if (h === 'Amber') return 2;
    return 1;
};

export const rankToHealth = (rank: number): Health => {
    if (rank >= 3) return 'Red';
    if (rank >= 2) return 'Amber';
    return 'Green';
};

// Mean severity across a list of healths, rounded to nearest integer.
// e.g. 3 Amber + 1 Red -> mean=(2+2+2+3)/4=2.25 -> round->2 -> Amber
// Empty list -> Green (neutral default used elsewhere in this service).
export const meanHealth = (healths: Health[]): Health => {
    if (healths.length === 0) return 'Green';
    const sum = healths.reduce((acc, h) => acc + healthRank(h), 0);
    return rankToHealth(Math.round(sum / healths.length));
};

/** WSR status -> health enum */
export function statusToHealth(status: string | null | undefined): Health {
    const s = String(status || '').toLowerCase();
    if (s === 'red') return 'Red';
    if (s === 'amber' || s === 'yellow') return 'Amber';
    return 'Green';
}

export interface DailyHealthCounts {
    Red: number;
    Amber: number;
    Green: number;
    Unknown: number;
}

export function tallyDailyHealth(dailyHealths: Array<string | null | undefined>): DailyHealthCounts {
    const counts: DailyHealthCounts = { Red: 0, Amber: 0, Green: 0, Unknown: 0 };
    for (const h of dailyHealths) {
        const key = (h || 'Unknown') as keyof DailyHealthCounts;
        counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
}

/**
 * Superseded by `rollupHealth` as of Phase 2. Old weekly rollup rule: strict majority Red
 * (>50% of days) -> Red; any Red/Amber day (including ties) -> Amber; all Green -> Green. The
 * "any bad day -> Amber" clause is exactly the over-reaction complaint that motivated Phase 2 —
 * a week with four Green days and one Amber day reported Amber under this rule.
 */
export function computeWeeklyMajorityStatus(counts: DailyHealthCounts, totalDays: number): string {
    return counts.Red > totalDays / 2 ? 'Red' :
        (counts.Red > 0 || counts.Amber > 0) ? 'Amber' :
        'Green';
}

const ROLLUP_SCORE: Record<string, number> = { Green: 0, Amber: 1, Red: 2 };

/**
 * Green if avg < 0.35, Amber if avg < 1.2, else Red -- calibrated to make a single Amber day
 * out of five (avg 0.20) resolve to Green, while two or more bad days (avg >= 0.40) still show.
 * "Moderate" calibration, chosen over a more lenient band, per user decision.
 */
const GREEN_CEILING = 0.35;
const AMBER_CEILING = 1.2;

export interface RollupHealthResult {
    health: string;
    avg: number;
    counts: DailyHealthCounts;
    scorableCount: number;
}

/**
 * Phase 2's replacement for `computeWeeklyMajorityStatus`: proportional/averaged rollup so a
 * single bad day among mostly-good ones no longer taints the whole period. `Unknown` entries
 * are excluded from both the sum and the denominator; if every entry is Unknown, returns
 * 'Unknown' rather than defaulting to a misleadingly reassuring Green.
 *
 * Retains one piece of the old rule as a safety escalation: a strict majority of Red entries
 * forces Red regardless of the average, so sustained severe badness can't be diluted away by
 * a long enough run of Green days.
 */
export function rollupHealth(healths: Array<string | null | undefined>): RollupHealthResult {
    const counts = tallyDailyHealth(healths);
    const scorableCount = counts.Red + counts.Amber + counts.Green;

    if (scorableCount === 0) {
        return { health: 'Unknown', avg: 0, counts, scorableCount };
    }

    const sum = counts.Red * ROLLUP_SCORE.Red + counts.Amber * ROLLUP_SCORE.Amber + counts.Green * ROLLUP_SCORE.Green;
    const avg = sum / scorableCount;

    const health = counts.Red > scorableCount / 2
        ? 'Red' // safety escalation: sustained majority-Red can't be diluted by the average
        : avg < GREEN_CEILING ? 'Green' : avg < AMBER_CEILING ? 'Amber' : 'Red';

    return { health, avg, counts, scorableCount };
}

export interface WeightedHealthEntry {
    health: string | null | undefined;
    weight: number;
}

export interface WeightedRollupResult {
    health: string;
    avg: number;
    scorableCount: number; // number of non-Unknown entries, not a weight sum
    totalWeight: number;
    weights: { Red: number; Amber: number; Green: number };
}

/**
 * Same rule as `rollupHealth` (same thresholds, same majority-Red safety escalation), but each
 * entry contributes proportionally to its `weight` instead of counting as one flat item. Built
 * for monthlyReportService.ts's weekly-statuses-into-a-month rollup, where a single trailing
 * partial-week stub (as short as one day) was previously counted exactly as heavily as a full
 * ~7-day closed week -- this lets a short stub contribute proportionally less. `rollupHealth`
 * itself is untouched and still used everywhere else (daily->weekly, and this file's own
 * daily->trailing-stub rollup in buildTrailingSummary), since same-granularity, equal-weight
 * inputs have no analogous weighting problem.
 */
export function rollupHealthWeighted(entries: WeightedHealthEntry[]): WeightedRollupResult {
    const weights = { Red: 0, Amber: 0, Green: 0 };
    let scorableCount = 0;

    for (const e of entries) {
        if (e.health !== 'Red' && e.health !== 'Amber' && e.health !== 'Green') continue; // Unknown/null excluded, same as rollupHealth
        const w = Math.max(0, e.weight);
        weights[e.health] += w;
        scorableCount += 1;
    }

    const totalWeight = weights.Red + weights.Amber + weights.Green;

    if (totalWeight === 0) {
        return { health: 'Unknown', avg: 0, scorableCount, totalWeight, weights };
    }

    const sum = weights.Red * ROLLUP_SCORE.Red + weights.Amber * ROLLUP_SCORE.Amber + weights.Green * ROLLUP_SCORE.Green;
    const avg = sum / totalWeight;

    const health = weights.Red > totalWeight / 2
        ? 'Red' // weighted majority — same safety escalation as rollupHealth, generalized to weights
        : avg < GREEN_CEILING ? 'Green' : avg < AMBER_CEILING ? 'Amber' : 'Red';

    return { health, avg, scorableCount, totalWeight, weights };
}

/**
 * Child-status-to-parent-health threshold rollup, used by accountReportService,
 * programReportService, programDailyReportService and monthlyProgramReportService (each
 * previously had its own copy-pasted version of this block). 'Unknown' children (no usable
 * data) are excluded from both the count and the percentages; if every child is Unknown, the
 * parent is 'Unknown' too ("we don't know", not "everything is fine").
 *
 * Phase 0 extracted this verbatim from accountReportService.ts's original inline
 * `deterministicAccountHealth` computation, which used a `(redCount>0||amberCount>0)->Amber`
 * floor — any single Amber or Red child tainted the whole parent, the same over-reaction Phase
 * 2 fixed one level down. Phase 3 replaces that floor with `amberThresholdPct`, an
 * already-existing, already-admin-configurable field (`Account.amberThresholdPercentage`)
 * that was never actually read anywhere in this rollup before now. Decision, confirmed with
 * the user: the RED trigger keeps its exact current meaning (`redPct >= redThresholdPct`,
 * pure percentage of Red children) so no account's configured red threshold changes meaning;
 * the AMBER trigger becomes `(redCount + amberCount) / activeCount >= amberThresholdPct` — the
 * closest generalization of "any bad child -> Amber" into a graduated rule, chosen over a
 * Red-only Amber trigger specifically because the latter would have swung CCM from "almost
 * always Amber" to "almost always Green" in one step, given CCM typically has zero Red
 * projects — a bigger, less reviewable change than intended for this phase.
 */
export interface ThresholdRollupResult {
    health: string;
    activeCount: number;
    redPct: number;
    badPct: number; // (red + amber) / active, as a percentage
    redCount: number;
}

/**
 * `redCountFloor` and `ceilingBadPct` are optional and default to "off" (floor effectively
 * infinite, ceiling disabled) so the two callers that don't yet read them from an Account/Program
 * config (rangeRollupService.ts, programDailyReportService.ts -- daily-level rollups, out of
 * scope for this change) keep their exact prior behavior unchanged. Only the four
 * account/program weekly+monthly overall-color call sites pass real config values.
 */
export function computeThresholdRollup(
    statuses: Array<string | null | undefined>,
    redThresholdPct: number,
    amberThresholdPct: number,
    redCountFloor: number = Infinity,
    ceilingBadPct: number | null = null
): ThresholdRollupResult {
    const activeStatuses = statuses.filter(s => s !== 'Unknown' && s != null);
    const activeCount = activeStatuses.length;
    const redCount = activeStatuses.filter(s => s === 'Red').length;
    const amberCount = activeStatuses.filter(s => s === 'Amber').length;
    const redPct = activeCount > 0 ? (redCount / activeCount) * 100 : 0;
    const badPct = activeCount > 0 ? ((redCount + amberCount) / activeCount) * 100 : 0;

    const health = activeCount === 0
        ? 'Unknown'
        : (redPct >= redThresholdPct || redCount >= redCountFloor || (ceilingBadPct != null && badPct >= ceilingBadPct)) ? 'Red'
        : (redCount >= 1 || badPct >= amberThresholdPct) ? 'Amber'
        : 'Green';

    return { health, activeCount, redPct, badPct, redCount };
}
