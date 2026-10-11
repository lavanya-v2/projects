import type { TrendDirection } from '../../../models/ReviewMemberScore';

/**
 * Composite scoring: weights, the missing-factor rule, coverage, and Provisional.
 *
 * Pure functions, no DB access, so every rule here is directly testable — these
 * are the numbers that reach HR.
 */

/** Below this a score is Provisional. */
export const LOW_COVERAGE_THRESHOLD = 60;

/** |delta| under this reads as flat rather than a real move. */
export const FLAT_TREND_EPSILON = 2.0;

/** Score assigned to an in-scope factor that has no data yet. */
export const MISSING_FACTOR_SCORE = 100;

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;

export type FactorName = 'system' | 'lead' | 'customer';

export interface FactorInput {
    weight: number;
    /** null when the factor has no data. */
    score: number | null;
    present: boolean;
    /** 0-100. Ignored when the factor is absent. */
    coverage: number;
}

export interface CompositeResult {
    composite: number;
    factors: Record<FactorName, { weight: number; score: number; present: boolean; coverage: number; inScope: boolean }>;
    overallCoverage: number;
    isProvisional: boolean;
    /** What redistributing weight across present factors would have produced. */
    effectiveWeights: Record<string, number>;
}

/**
 * Combine weighted factors into one 0-100 composite.
 *
 * Three rules, in order of subtlety:
 *
 * 1. WEIGHT 0 MEANS OUT OF SCOPE, NOT MISSING. A parked factor (customer feedback
 *    in v1) is excluded from the composite AND from coverage entirely. Without
 *    this it would default to 100 and inflate every score, or count as missing
 *    coverage and depress every score — both wrong for something switched off.
 *
 * 2. AN ABSENT IN-SCOPE FACTOR SCORES 100, at zero coverage. This is deliberate:
 *    the composite self-corrects as real data arrives rather than punishing people
 *    for work not yet done by their lead. It is only safe because of rule 3.
 *
 * 3. PROVISIONAL. Rule 2 is a machine for manufacturing 100s, so any score with
 *    low coverage OR any absent in-scope factor is flagged. Both clauses are
 *    load-bearing: at 60/40 weights, a completely un-reviewed person lands at
 *    exactly 60 coverage — just above a bare threshold test — and would otherwise
 *    present as a final score built entirely from a default.
 */
export function computeComposite(inputs: Record<FactorName, FactorInput>): CompositeResult {
    const names = Object.keys(inputs) as FactorName[];

    const factors = {} as CompositeResult['factors'];
    let weightedScore = 0;
    let weightedCoverage = 0;
    let totalWeight = 0;
    let anyAbsentInScope = false;

    for (const name of names) {
        const f = inputs[name];
        const inScope = f.weight > 0;

        if (!inScope) {
            factors[name] = { weight: 0, score: 0, present: f.present, coverage: 0, inScope: false };
            continue;
        }

        const score = f.present && f.score !== null ? f.score : MISSING_FACTOR_SCORE;
        const coverage = f.present ? f.coverage : 0;
        if (!f.present) anyAbsentInScope = true;

        factors[name] = { weight: f.weight, score: round1(score), present: f.present, coverage: round1(coverage), inScope: true };

        weightedScore += score * f.weight;
        weightedCoverage += coverage * f.weight;
        totalWeight += f.weight;
    }

    const composite = totalWeight === 0 ? 0 : weightedScore / totalWeight;
    const overallCoverage = totalWeight === 0 ? 0 : weightedCoverage / totalWeight;

    // Recorded, never applied: what the parked 'redistribute' policy would give.
    const presentWeight = names
        .filter(n => inputs[n].weight > 0 && inputs[n].present)
        .reduce((s, n) => s + inputs[n].weight, 0);
    const effectiveWeights: Record<string, number> = {};
    for (const name of names) {
        const f = inputs[name];
        effectiveWeights[name] =
            f.weight > 0 && f.present && presentWeight > 0 ? round2((f.weight / presentWeight) * 100) : 0;
    }

    return {
        composite: round1(composite),
        factors,
        overallCoverage: round1(overallCoverage),
        isProvisional: overallCoverage < LOW_COVERAGE_THRESHOLD || anyAbsentInScope,
        effectiveWeights,
    };
}

export interface CumulativeInput {
    /** Per-cycle factor score, in cycle order, for cycles in the same review year. */
    score: number | null;
    coverage: number;
    present: boolean;
}

/**
 * Coverage-weighted mean over the cycles where a factor was ACTUALLY PRESENT.
 *
 * This is the one place the missing=100 rule deliberately does not propagate.
 * Carrying defaults into the year-to-date number would inflate it permanently and
 * irrecoverably — a person never reviewed all year would show a perfect annual
 * lead score. Absent cycles are excluded, and `cyclesCounted` states how many
 * actually contributed so the number can be read honestly.
 */
export function cumulativeFactor(history: CumulativeInput[]): {
    score: number | null;
    coverage: number;
    cyclesCounted: number;
} {
    const present = history.filter(h => h.present && h.score !== null);
    if (present.length === 0) return { score: null, coverage: 0, cyclesCounted: 0 };

    // Weight by coverage so a thinly-evidenced cycle counts for less. A floor
    // keeps a present-but-zero-coverage cycle from vanishing entirely.
    const weightOf = (h: CumulativeInput) => Math.max(h.coverage, 1);
    const totalWeight = present.reduce((s, h) => s + weightOf(h), 0);

    return {
        score: round1(present.reduce((s, h) => s + (h.score as number) * weightOf(h), 0) / totalWeight),
        coverage: round1(present.reduce((s, h) => s + h.coverage, 0) / present.length),
        cyclesCounted: present.length,
    };
}

/**
 * Trend against the previous cycle in the same review year.
 *
 * The first cycle of a year is 'na', not 'flat' — no comparison exists, and
 * showing "no change" would imply one was made.
 */
export function computeTrend(
    composite: number | null,
    previousComposite: number | null,
): { direction: TrendDirection; delta: number | null } {
    if (composite === null || previousComposite === null) return { direction: 'na', delta: null };

    const delta = round1(composite - previousComposite);
    if (Math.abs(delta) < FLAT_TREND_EPSILON) return { direction: 'flat', delta };
    return { direction: delta > 0 ? 'improved' : 'declined', delta };
}
