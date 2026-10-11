import { describe, it, expect } from 'vitest';
import {
    computeComposite,
    cumulativeFactor,
    computeTrend,
    MISSING_FACTOR_SCORE,
} from '../services/compositeScoringService';

const factors = (over: Partial<Record<'system' | 'lead' | 'customer', any>> = {}) => ({
    system: { weight: 60, score: 80, present: true, coverage: 100 },
    lead: { weight: 40, score: 70, present: true, coverage: 100 },
    customer: { weight: 0, score: null, present: false, coverage: 0 },
    ...over,
}) as any;

describe('computeComposite — the v1 launch configuration', () => {
    /**
     * The assertion the plan singles out as catching the highest-value bug: with
     * customer parked at weight 0 and no lead review yet, the numbers must be
     * exactly these. If overallCoverage reads 100, or a customer factor is scored,
     * the module ships inflated scores to HR.
     */
    it('scores an un-reviewed developer at 0.6·system + 40 with 60% coverage, flagged provisional', () => {
        const r = computeComposite(
            factors({ lead: { weight: 40, score: null, present: false, coverage: 0 } }),
        );

        expect(r.factors.lead.score).toBe(MISSING_FACTOR_SCORE);
        expect(r.factors.lead.present).toBe(false);
        expect(r.factors.lead.coverage).toBe(0);
        expect(r.composite).toBe(0.6 * 80 + 40); // 88
        expect(r.overallCoverage).toBe(60);
        expect(r.isProvisional).toBe(true);
    });

    it('excludes a weight-0 factor from the composite and from coverage entirely', () => {
        const r = computeComposite(factors());

        expect(r.factors.customer.inScope).toBe(false);
        // Parked factor contributes neither a phantom 100 nor missing coverage.
        expect(r.composite).toBe(round1(0.6 * 80 + 0.4 * 70)); // 76
        expect(r.overallCoverage).toBe(100);
        expect(r.isProvisional).toBe(false);
    });

    it('does not let a parked factor inflate the score', () => {
        const withParked = computeComposite(factors());
        const noCustomerAtAll = computeComposite({
            system: { weight: 60, score: 80, present: true, coverage: 100 },
            lead: { weight: 40, score: 70, present: true, coverage: 100 },
            customer: { weight: 0, score: null, present: false, coverage: 0 },
        } as any);
        expect(withParked.composite).toBe(noCustomerAtAll.composite);
    });
});

describe('computeComposite — the Provisional guardrail', () => {
    it('flags a fully-covered score as provisional when an in-scope factor is absent', () => {
        // The boundary case the second clause exists for: coverage lands on exactly
        // 60, which a bare `< 60` test would pass as final.
        const r = computeComposite(
            factors({ lead: { weight: 40, score: null, present: false, coverage: 0 } }),
        );
        expect(r.overallCoverage).toBe(60);
        expect(r.overallCoverage < 60).toBe(false); // threshold alone would NOT flag
        expect(r.isProvisional).toBe(true); // ...but absence does
    });

    it('flags a score whose factors are all present but thinly evidenced', () => {
        const r = computeComposite(
            factors({
                system: { weight: 60, score: 80, present: true, coverage: 20 },
                lead: { weight: 40, score: 70, present: true, coverage: 40 },
            }),
        );
        expect(r.isProvisional).toBe(true);
    });

    it('does not flag a fully-evidenced complete score', () => {
        expect(computeComposite(factors()).isProvisional).toBe(false);
    });
});

describe('computeComposite — effective weights', () => {
    it('records what redistribution would have given without applying it', () => {
        const r = computeComposite(
            factors({ lead: { weight: 40, score: null, present: false, coverage: 0 } }),
        );
        // System would carry 100% under the parked 'redistribute' policy...
        expect(r.effectiveWeights.system).toBe(100);
        expect(r.effectiveWeights.lead).toBe(0);
        // ...but the actual composite still used the real 60/40 split.
        expect(r.composite).toBe(88);
    });
});

describe('cumulativeFactor', () => {
    it('excludes absent cycles rather than counting them as 100', () => {
        const r = cumulativeFactor([
            { score: 60, coverage: 100, present: true },
            { score: null, coverage: 0, present: false },
            { score: 80, coverage: 100, present: true },
        ]);
        // The missing cycle must not drag the mean toward 100.
        expect(r.score).toBe(70);
        expect(r.cyclesCounted).toBe(2);
    });

    it('returns null when a factor was never present', () => {
        const r = cumulativeFactor([
            { score: null, coverage: 0, present: false },
            { score: null, coverage: 0, present: false },
        ]);
        expect(r.score).toBeNull();
        expect(r.cyclesCounted).toBe(0);
    });

    it('weights a thinly-evidenced cycle less than a well-evidenced one', () => {
        const r = cumulativeFactor([
            { score: 100, coverage: 100, present: true },
            { score: 0, coverage: 10, present: true },
        ]);
        // A plain mean would be 50; coverage weighting pulls it toward the
        // better-evidenced cycle.
        expect(r.score).toBeGreaterThan(50);
    });
});

describe('computeTrend', () => {
    it('reports the first cycle of a year as na, not flat', () => {
        expect(computeTrend(80, null)).toEqual({ direction: 'na', delta: null });
    });

    it('treats a sub-epsilon move as flat', () => {
        expect(computeTrend(81, 80)).toMatchObject({ direction: 'flat' });
    });

    it('reports real movement in both directions', () => {
        expect(computeTrend(90, 80)).toMatchObject({ direction: 'improved', delta: 10 });
        expect(computeTrend(70, 80)).toMatchObject({ direction: 'declined', delta: -10 });
    });
});

function round1(v: number) {
    return Math.round(v * 10) / 10;
}
