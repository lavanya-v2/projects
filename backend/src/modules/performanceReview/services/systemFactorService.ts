import type { SourceMemberMetrics } from './factorProviders/types';
import type { MemberCategory } from '../../../models/ReviewCycleParticipant';

/**
 * Normalises raw delivery metrics into a 0-100 system factor.
 *
 * Two rules govern everything here:
 *
 *  1. AGGREGATE RAW COUNTERS, NEVER AVERAGE PERCENTAGES. A 3-point sprint and a
 *     40-point sprint are not equal observations; averaging their delivery
 *     percentages would treat them as such.
 *
 *  2. ABSENT DATA IS NOT ZERO. Someone on leave, or below the volume floor, has
 *     an *insufficient* factor — reported as missing — not a score of 0.
 */

/**
 * `quality_rate = -1` means "fewer than 5 tickets tested", not "perfect quality".
 * Including it in any mean moves a score by roughly 100 points. Every aggregation
 * site must filter it, so it lives behind a name rather than a bare -1.
 */
export const QUALITY_RATE_INSUFFICIENT = -1;

/** Below this total planned SP a developer's system factor is insufficient. */
export const MIN_SP_FOR_DEV_SCORE = 3;

/** Below this total tested count a QA member's system factor is insufficient. */
export const MIN_TICKETS_FOR_QA_SCORE = 5;

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export interface SystemFactorResult {
    /** 0-100, higher is better. null when the factor is insufficient/missing. */
    score: number | null;
    present: boolean;
    /** Share of attached sources that had data for this member, 0-100. */
    coverage: number;
    category: MemberCategory;
    contributingProjectIds: number[];
    aggregates: Record<string, number | null>;
    unavailableMetrics: string[];
    approximations: string[];
    overridesApplied: string[];
    /** Overrides ignored as out-of-range or not overridable. Must stay visible. */
    overridesRejected: string[];
    categoryFlips: Array<{ sourceId: number; category: string }>;
    sourcesWithData: number;
}

/** Sum, treating null as absent. Returns null when NO row supplied the metric. */
function sumOrNull(rows: SourceMemberMetrics[], key: keyof SourceMemberMetrics): number | null {
    let total = 0;
    let seen = false;
    for (const r of rows) {
        const v = r[key] as number | null;
        if (v !== null && v !== undefined && Number.isFinite(v)) {
            total += v;
            seen = true;
        }
    }
    return seen ? total : null;
}

/**
 * The member's category for the whole cycle: whichever category carried the most
 * work, not whichever sprint happened to be last.
 *
 * A tech lead who codes one sprint and only tests the next would otherwise switch
 * scoring formula mid-period. Disagreements are recorded rather than smoothed —
 * averaging a delivery score against a QA risk score is meaningless.
 */
function dominantCategory(rows: SourceMemberMetrics[]): {
    category: MemberCategory;
    flips: Array<{ sourceId: number; category: string }>;
} {
    const weight = new Map<MemberCategory, number>();
    for (const r of rows) {
        const volume =
            (r.spDone ?? 0) + (r.spPlanned ?? 0) + (r.ticketsTested ?? 0) + (r.deliveredCount ?? 0);
        weight.set(r.category, (weight.get(r.category) ?? 0) + Math.max(volume, 0.001));
    }
    let category: MemberCategory = 'developer';
    let best = -1;
    for (const [c, w] of weight) {
        if (w > best) {
            best = w;
            category = c;
        }
    }
    const distinct = new Set(rows.map(r => r.category));
    const flips =
        distinct.size > 1
            ? rows.filter(r => r.category !== category).map(r => ({ sourceId: r.sourceId, category: r.category }))
            : [];
    return { category, flips };
}

/**
 * Weighted mean over available components, re-normalising when some are absent.
 *
 * This is what lets a source that cannot supply every sub-metric still produce a
 * real score: the missing component is dropped and the rest are re-weighted, with
 * `availableWeight` reported so coverage can be scaled down honestly.
 */
function weightedAvailable(
    parts: Array<{ value: number | null; weight: number; name: string }>,
): { value: number | null; availableWeight: number; missing: string[] } {
    let acc = 0;
    let w = 0;
    const missing: string[] = [];
    for (const p of parts) {
        if (p.value === null) {
            missing.push(p.name);
            continue;
        }
        acc += p.value * p.weight;
        w += p.weight;
    }
    const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
    return {
        value: w === 0 ? null : acc / w,
        availableWeight: totalWeight === 0 ? 0 : w / totalWeight,
        missing,
    };
}

/**
 * Compute one member's system factor across every source attached to a cycle.
 *
 * @param rows            metrics for this member only, one row per source
 * @param attachedSources total non-excluded sources on the cycle (coverage denominator)
 */
export function computeSystemFactor(
    rows: SourceMemberMetrics[],
    attachedSources: number,
): SystemFactorResult {
    const approximations: string[] = [];
    const overridesApplied = [...new Set(rows.flatMap(r => r.overridesApplied))];
    const overridesRejected = [...new Set(rows.flatMap(r => r.overridesRejected ?? []))];
    const contributingProjectIds = [...new Set(rows.map(r => r.projectId))];
    const { category, flips } = dominantCategory(rows);
    const sourcesWithData = new Set(rows.map(r => r.sourceId)).size;

    // Coverage is share of the cycle's sources that had data for this member. Zero
    // attached sources means the cycle itself has no data — not the member's doing.
    const coverage = attachedSources === 0 ? 0 : round1((sourcesWithData / attachedSources) * 100);

    const empty = (aggregates: Record<string, number | null>): SystemFactorResult => ({
        score: null,
        present: false,
        coverage: 0,
        category,
        contributingProjectIds,
        aggregates,
        unavailableMetrics: [],
        approximations,
        overridesApplied,
        overridesRejected,
        categoryFlips: flips,
        sourcesWithData,
    });

    if (rows.length === 0) return empty({});

    if (category === 'qa') {
        const ticketsTested = sumOrNull(rows, 'ticketsTested') ?? 0;
        const clearedSp = sumOrNull(rows, 'clearedSp');
        const uatFailedSp = sumOrNull(rows, 'uatFailedSp');
        const inSprintBugs = sumOrNull(rows, 'inSprintBugCount');
        const inSprintEligible = sumOrNull(rows, 'inSprintEligibleCount');
        // Re-derived from summed raw counts, never averaged/summed as a percentage
        // (rule #1 above) — a plain sum of each sync's already-computed percentage
        // used to grow purely with sprint count: someone with 4 sprints at a true 5%
        // escape rate would show 20%, four times worse than reality, and this
        // compounds badly for a wide multi-month catch-up cycle.
        const prodBugsEscapedTotal = sumOrNull(rows, 'prodBugsEscaped');
        const bugEscape =
            ticketsTested > 0 && prodBugsEscapedTotal !== null
                ? round1((prodBugsEscapedTotal / ticketsTested) * 100)
                : null;

        if (ticketsTested < MIN_TICKETS_FOR_QA_SCORE) {
            return empty({ ticketsTested, clearedSp, uatFailedSp });
        }

        // Preferred: re-derive the risk rate from summed numerators/denominators.
        let qualityRate: number | null = null;
        if (clearedSp !== null && clearedSp > 0 && uatFailedSp !== null) {
            const passRate = 1 - uatFailedSp / clearedSp;
            const inSprintCatch =
                inSprintEligible && inSprintEligible > 0 && inSprintBugs !== null
                    ? inSprintBugs / inSprintEligible
                    : passRate; // no eligible bugs: don't penalise on missing signal
            qualityRate = (1 - (0.7 * passRate + 0.3 * inSprintCatch)) * 100;
        } else {
            // Interim proxy until the raw accumulators are populated by a sync.
            // Weighted by tickets tested so a large sprint counts for more, and
            // strictly excluding the -1 sentinel.
            const usable = rows.filter(
                r =>
                    r.qualityRate !== null &&
                    r.qualityRate !== QUALITY_RATE_INSUFFICIENT &&
                    (r.ticketsTested ?? 0) > 0,
            );
            if (usable.length > 0) {
                const w = usable.reduce((s, r) => s + (r.ticketsTested ?? 0), 0);
                qualityRate = usable.reduce((s, r) => s + (r.qualityRate as number) * (r.ticketsTested ?? 0), 0) / w;
                approximations.push(
                    'qualityRate approximated as a tickets-tested-weighted mean of per-sync rates; raw UAT/in-sprint accumulators not yet persisted',
                );
            }
        }

        if (qualityRate === null) {
            return empty({ ticketsTested, clearedSp, uatFailedSp });
        }

        const { value, availableWeight, missing } = weightedAvailable([
            { value: 100 - clamp(qualityRate), weight: 0.75, name: 'qualityRate' },
            { value: bugEscape === null ? null : 100 - clamp(bugEscape), weight: 0.25, name: 'bugEscapeRate' },
        ]);

        return {
            score: value === null ? null : round1(clamp(value)),
            present: value !== null,
            coverage: round1(coverage * availableWeight),
            category,
            contributingProjectIds,
            aggregates: { ticketsTested, clearedSp, uatFailedSp, inSprintBugs, inSprintEligible, qualityRate: round1(qualityRate) },
            unavailableMetrics: missing,
            approximations,
            overridesApplied,
            overridesRejected,
            categoryFlips: flips,
            sourcesWithData,
        };
    }

    if (category === 'other') {
        // No delivery signal defined for this category — genuinely absent, and
        // treated as a missing factor rather than scored.
        return empty({});
    }

    // ── Developer ───────────────────────────────────────────────────────────
    const spPlanned = sumOrNull(rows, 'spPlanned') ?? 0;
    const spDone = sumOrNull(rows, 'spDone');
    const spRework = sumOrNull(rows, 'spRework');
    const delivered = sumOrNull(rows, 'deliveredCount');
    const reopened = sumOrNull(rows, 'reopenedCount');

    if (spPlanned < MIN_SP_FOR_DEV_SCORE) {
        return empty({ spPlanned, spDone, spRework });
    }

    const deliveryPct = spDone === null ? null : clamp((spDone / spPlanned) * 100);
    const reworkFactor = spRework === null ? null : clamp((spRework / spPlanned) * 100);
    const reopenRate =
        delivered !== null && delivered > 0 && reopened !== null
            ? clamp((reopened / delivered) * 100)
            : null;

    // executionScore intentionally reuses the live scorecard's own formula, so a
    // review score can never disagree with the number the lead is looking at on
    // the same screen.
    const executionScore =
        deliveryPct === null
            ? null
            : reworkFactor === null
              ? deliveryPct
              : 0.8 * deliveryPct + 0.2 * (100 - reworkFactor);

    const { value, availableWeight, missing } = weightedAvailable([
        { value: executionScore, weight: 0.85, name: 'executionScore' },
        { value: reopenRate === null ? null : 100 - reopenRate, weight: 0.15, name: 'reopenRate' },
    ]);

    return {
        score: value === null ? null : round1(clamp(value)),
        present: value !== null,
        coverage: round1(coverage * availableWeight),
        category,
        contributingProjectIds,
        aggregates: {
            spPlanned,
            spDone,
            spRework,
            deliveredCount: delivered,
            reopenedCount: reopened,
            deliveryPct: deliveryPct === null ? null : round1(deliveryPct),
            reworkFactor: reworkFactor === null ? null : round1(reworkFactor),
            reopenRate: reopenRate === null ? null : round1(reopenRate),
            executionScore: executionScore === null ? null : round1(executionScore),
        },
        unavailableMetrics: missing,
        approximations,
        overridesApplied,
        overridesRejected,
        categoryFlips: flips,
        sourcesWithData,
    };
}
