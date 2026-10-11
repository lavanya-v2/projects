import { describe, it, expect } from 'vitest';
import {
    computeSystemFactor,
    QUALITY_RATE_INSUFFICIENT,
    MIN_SP_FOR_DEV_SCORE,
    MIN_TICKETS_FOR_QA_SCORE,
} from '../services/systemFactorService';
import type { SourceMemberMetrics } from '../services/factorProviders/types';

const dev = (over: Partial<SourceMemberMetrics> = {}): SourceMemberMetrics => ({
    sourceId: 1, projectId: 10, teamMemberId: 99, category: 'developer',
    spPlanned: 10, spDone: 8, spRework: 1, deliveredCount: 5, reopenedCount: 0,
    ticketsTested: null, clearedSp: null, uatFailedSp: null,
    inSprintBugCount: null, inSprintEligibleCount: null, prodBugsEscaped: null,
    qualityRate: null, bugEscapeRatePct: null, overridesApplied: [],
    ...over,
});

const qa = (over: Partial<SourceMemberMetrics> = {}): SourceMemberMetrics =>
    dev({ category: 'qa', spPlanned: 0, spDone: 0, spRework: 0, deliveredCount: 0, reopenedCount: 0,
          ticketsTested: 10, qualityRate: 20, bugEscapeRatePct: 10, prodBugsEscaped: 1, ...over });

describe('developer normalization', () => {
    it('aggregates raw counters across sources rather than averaging percentages', () => {
        // 3/30 in one sprint and 27/30 in another is 30/60 = 50%, NOT the 50% a
        // naive mean of 10% and 90% coincidentally gives. Use asymmetric numbers
        // so the two approaches genuinely differ.
        const r = computeSystemFactor(
            [
                dev({ sourceId: 1, spPlanned: 10, spDone: 1, spRework: 0, deliveredCount: 1, reopenedCount: 0 }),
                dev({ sourceId: 2, spPlanned: 90, spDone: 81, spRework: 0, deliveredCount: 9, reopenedCount: 0 }),
            ],
            2,
        );
        // Correct: 82/100 = 82%. A mean of per-sprint rates would give (10+90)/2 = 50%.
        expect(r.aggregates.deliveryPct).toBe(82);
    });

    it('sums across MULTIPLE PROJECTS for a cross-project member', () => {
        const r = computeSystemFactor(
            [
                dev({ sourceId: 1, projectId: 10, spPlanned: 10, spDone: 10 }),
                dev({ sourceId: 2, projectId: 20, spPlanned: 10, spDone: 5 }),
            ],
            2,
        );
        expect(r.aggregates.spPlanned).toBe(20);
        expect(r.aggregates.spDone).toBe(15);
        expect(r.contributingProjectIds.sort()).toEqual([10, 20]);
    });

    it('reports a below-floor volume as MISSING, never as zero', () => {
        // Someone on leave must not score 0 — that is a punishment for absence.
        const r = computeSystemFactor([dev({ spPlanned: MIN_SP_FOR_DEV_SCORE - 1, spDone: 0 })], 1);
        expect(r.present).toBe(false);
        expect(r.score).toBeNull();
        expect(r.coverage).toBe(0);
    });

    it('reuses the live scorecard execution formula', () => {
        const r = computeSystemFactor([dev({ spPlanned: 10, spDone: 10, spRework: 0, deliveredCount: 4, reopenedCount: 0 })], 1);
        expect(r.aggregates.executionScore).toBe(100);
        expect(r.score).toBe(100);
    });

    it('penalises reopens through the 15% component', () => {
        const clean = computeSystemFactor([dev({ deliveredCount: 10, reopenedCount: 0 })], 1);
        const reopened = computeSystemFactor([dev({ deliveredCount: 10, reopenedCount: 5 })], 1);
        expect(reopened.score!).toBeLessThan(clean.score!);
    });

    it('re-weights and scales coverage when a sub-metric is unavailable', () => {
        // An Excel-like source with no reopen data must still yield a real score.
        const r = computeSystemFactor([dev({ deliveredCount: null, reopenedCount: null })], 1);
        expect(r.present).toBe(true);
        expect(r.score).not.toBeNull();
        expect(r.unavailableMetrics).toContain('reopenRate');
        // 0.85 of the weight was available, so coverage scales to 85%.
        expect(r.coverage).toBe(85);
    });

    it('computes coverage as the share of attached sources with data', () => {
        const r = computeSystemFactor([dev({ sourceId: 1 }), dev({ sourceId: 2 })], 4);
        expect(r.coverage).toBe(50);
    });
});

describe('QA normalization', () => {
    it('EXCLUDES the -1 insufficient-data sentinel from the proxy mean', () => {
        // The highest-value trap in this file: -1 is "fewer than 5 tested", not
        // "perfect". Including it moves a score by ~100 points.
        const withSentinel = computeSystemFactor(
            [
                qa({ sourceId: 1, ticketsTested: 10, qualityRate: 20 }),
                qa({ sourceId: 2, ticketsTested: 8, qualityRate: QUALITY_RATE_INSUFFICIENT }),
            ],
            2,
        );
        const withoutSentinel = computeSystemFactor([qa({ sourceId: 1, ticketsTested: 10, qualityRate: 20 })], 2);
        expect(withSentinel.aggregates.qualityRate).toBe(withoutSentinel.aggregates.qualityRate);
        expect(withSentinel.aggregates.qualityRate).toBe(20);
    });

    it('treats quality rate as a RISK rate — lower is better', () => {
        const lowRisk = computeSystemFactor([qa({ qualityRate: 10 })], 1);
        const highRisk = computeSystemFactor([qa({ qualityRate: 60 })], 1);
        expect(lowRisk.score!).toBeGreaterThan(highRisk.score!);
    });

    it('reports below-floor tested counts as missing', () => {
        const r = computeSystemFactor([qa({ ticketsTested: MIN_TICKETS_FOR_QA_SCORE - 1 })], 1);
        expect(r.present).toBe(false);
        expect(r.score).toBeNull();
    });

    it('prefers summed raw accumulators over the proxy, and says when it approximated', () => {
        const exact = computeSystemFactor(
            [qa({ ticketsTested: 10, clearedSp: 100, uatFailedSp: 0, inSprintBugCount: 8, inSprintEligibleCount: 10 })],
            1,
        );
        expect(exact.approximations).toHaveLength(0);

        const proxied = computeSystemFactor([qa({ ticketsTested: 10, qualityRate: 20 })], 1);
        expect(proxied.approximations[0]).toMatch(/approximated/);
    });

    it('weights the proxy by tickets tested so a big sprint counts for more', () => {
        const r = computeSystemFactor(
            [
                qa({ sourceId: 1, ticketsTested: 90, qualityRate: 10 }),
                qa({ sourceId: 2, ticketsTested: 10, qualityRate: 90 }),
            ],
            2,
        );
        // Unweighted this would be 50; weighted it must sit near the large sprint.
        expect(r.aggregates.qualityRate).toBe(18);
    });

    it('re-derives bugEscapeRatePct from summed counts, never sums the per-sync percentages', () => {
        // Two sprints, each a genuine 10% escape rate (1/10 and 3/30). Summing the
        // percentages would wrongly give 20% for someone who simply had more
        // sprints attached — exactly what a wide multi-month catch-up cycle would
        // amplify. The re-derived rate must be the true combined 4/40 = 10%.
        const manySprints = computeSystemFactor(
            [
                qa({ sourceId: 1, ticketsTested: 10, prodBugsEscaped: 1, bugEscapeRatePct: 10 }),
                qa({ sourceId: 2, ticketsTested: 30, prodBugsEscaped: 3, bugEscapeRatePct: 10 }),
            ],
            2,
        );
        const oneSprint = computeSystemFactor(
            [qa({ sourceId: 1, ticketsTested: 40, prodBugsEscaped: 4, bugEscapeRatePct: 10 })],
            1,
        );
        expect(manySprints.score).toBe(oneSprint.score);
    });
});

describe('category resolution', () => {
    it('picks the dominant category by volume and records the flip', () => {
        // A tech lead who mostly codes but tested in one sprint scores as a
        // developer for the cycle — never an average of two incompatible formulas.
        const r = computeSystemFactor(
            [
                dev({ sourceId: 1, spPlanned: 40, spDone: 40 }),
                qa({ sourceId: 2, ticketsTested: 2 }),
            ],
            2,
        );
        expect(r.category).toBe('developer');
        expect(r.categoryFlips).toEqual([{ sourceId: 2, category: 'qa' }]);
    });

    it('gives the "other" category no system factor', () => {
        const r = computeSystemFactor([dev({ category: 'other' })], 1);
        expect(r.present).toBe(false);
        expect(r.score).toBeNull();
    });
});

describe('overrides', () => {
    it('surfaces applied override keys for the UI to badge', () => {
        const r = computeSystemFactor([dev({ overridesApplied: ['spDone'] })], 1);
        expect(r.overridesApplied).toEqual(['spDone']);
    });
});

describe('empty input', () => {
    it('is missing, not zero, when a member has no data at all', () => {
        const r = computeSystemFactor([], 3);
        expect(r.present).toBe(false);
        expect(r.score).toBeNull();
        expect(r.coverage).toBe(0);
    });
});
