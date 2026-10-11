import { describe, it, expect } from 'vitest';
import { checkIntegrity, detectAnomalies, vibeIndex, type HistoryPoint } from './promptQualityService';
import type { ClaudeUsageMetrics } from './promptQualityService';

/**
 * The integrity split, pinned.
 *
 * checkIntegrity REJECTS the day (400, nothing stored), so it may only contain
 * identities that are impossible for honest data — sub-counts exceeding their parent,
 * a future date. detectAnomalies only FLAGS.
 *
 * The case that motivated these tests: a day with tokens but zero prompts used to be
 * rejected as "impossible". It isn't. collector.js counts prompts off `user` records
 * and tokens off `assistant` records independently, so a session that runs past
 * midnight or is resumed books its tokens on a day whose prompt belongs to the day
 * before. Real payloads were being discarded, and the loss was biased toward the
 * people running the longest sessions.
 */

const metrics = (over: Partial<ClaudeUsageMetrics> = {}): ClaudeUsageMetrics => ({
    schemaVersion: 3,
    collectorVersion: '1.4.4',
    prompts: { total: 4, scored: 4, acks: 0 },
    scores: { good: 2, ok: 2, poor: 0, sum: 280 },
    signals: { no_context: 0, vague: 0, rework: 0, unclear_referent: 0, very_short: 0, short: 0 },
    tokensByModel: { 'claude-opus-5': { input: 1000, output: 2000, cache_read: 0, cache_write: 0 } },
    activity: { sessions: 1, distinctProjects: 1 },
    structure: {
        skillInvocations: 0, mcpCalls: 0, builtinTools: {}, freeTextTurns: 2,
        toolAssistedTurns: 2, planModeTurns: 0, acceptEditsTurns: 0,
        editsAccepted: 0, editsRejected: 0, distinctMcpServers: 0,
    },
    promptTypes: { debugging: 0, codeGen: 4, refactor: 0, review: 0, explain: 0, other: 0 },
    ...over,
} as ClaudeUsageMetrics);

/** The real rejected payload: collector 1.4.4 on Windows, a resumed session. */
const zeroPromptDay = metrics({
    prompts: { total: 0, scored: 0, acks: 0 },
    scores: { good: 0, ok: 0, poor: 0, sum: 0 },
    tokensByModel: { 'claude-opus-5': { input: 16, output: 3002, cache_read: 793068, cache_write: 180110 } },
    activity: { sessions: 1, distinctProjects: 0 },
    structure: {
        skillInvocations: 0, mcpCalls: 0, builtinTools: { Bash: 1, PowerShell: 3 }, freeTextTurns: 4,
        toolAssistedTurns: 4, planModeTurns: 0, acceptEditsTurns: 0,
        editsAccepted: 0, editsRejected: 0, distinctMcpServers: 0,
    },
    promptTypes: { debugging: 0, codeGen: 0, refactor: 0, review: 0, explain: 0, other: 0 },
});

const DAY = '2026-08-30';
/** A normal trailing history — enough rows to arm the regime-shift heuristics. */
const history: HistoryPoint[] = [
    { avgScore: 72, totalTokens: 500_000, totalPrompts: 20 },
    { avgScore: 68, totalTokens: 450_000, totalPrompts: 18 },
    { avgScore: 75, totalTokens: 600_000, totalPrompts: 25 },
];

describe('checkIntegrity — only the genuinely impossible', () => {
    it('accepts tokens with zero prompts (session resumed across midnight)', () => {
        expect(checkIntegrity(zeroPromptDay, DAY)).toEqual([]);
    });

    it('accepts an ordinary day', () => {
        expect(checkIntegrity(metrics(), DAY)).toEqual([]);
    });

    it('still rejects a scored prompt with no prompts at all', () => {
        const m = metrics({
            prompts: { total: 0, scored: 1, acks: 0 },
            scores: { good: 0, ok: 0, poor: 0, sum: 0 },
        });
        expect(checkIntegrity(m, DAY).length).toBeGreaterThan(0);
    });

    it.each([
        ['scored exceeds total', { prompts: { total: 2, scored: 5, acks: 0 } }],
        ['acks exceed total', { prompts: { total: 2, scored: 2, acks: 9 } }],
        ['buckets exceed scored', { scores: { good: 9, ok: 0, poor: 0, sum: 100 } }],
        ['score sum exceeds 100 per scored prompt', { scores: { good: 4, ok: 0, poor: 0, sum: 99_999 } }],
        ['a signal exceeds scored', {
            signals: { no_context: 99, vague: 0, rework: 0, unclear_referent: 0, very_short: 0, short: 0 },
        }],
    ])('still rejects when %s', (_label, over) => {
        expect(checkIntegrity(metrics(over as Partial<ClaudeUsageMetrics>), DAY).length).toBeGreaterThan(0);
    });

    it('still rejects a day in the future', () => {
        const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
        expect(checkIntegrity(metrics(), future)).toContain(`day ${future} is in the future`);
    });
});

describe('detectAnomalies — the zero-prompt day is flagged, not silently dropped', () => {
    const codes = (m: ClaudeUsageMetrics, h: HistoryPoint[] = history) =>
        detectAnomalies(m, h, 'enforced').map((f) => f.code);

    it('flags tokens-without-prompts', () => {
        expect(codes(zeroPromptDay)).toContain('tokens-without-prompts');
    });

    it('does not also fire score-regime-shift on it', () => {
        // avgScore() returns 0 for "nothing scored", which without a guard reads as a
        // maximal drop against any normal median and would flag every such day.
        expect(codes(zeroPromptDay)).not.toContain('score-regime-shift');
    });

    it('flags nothing else on that day', () => {
        expect(codes(zeroPromptDay)).toEqual(['tokens-without-prompts']);
    });

    it('leaves an ordinary day unflagged', () => {
        expect(codes(metrics())).toEqual([]);
    });

    it('still catches a real score regime shift', () => {
        const m = metrics({ scores: { good: 0, ok: 0, poor: 4, sum: 40 } }); // avg 10 vs median 72
        expect(codes(m)).toContain('score-regime-shift');
    });

    it('does not flag tokens-without-prompts on a day with prompts', () => {
        expect(codes(metrics())).not.toContain('tokens-without-prompts');
    });
});

describe('vibeIndex — no score penalty for a score that was never measured', () => {
    /** The same day, but with one scored prompt, so the score term applies. */
    const twinScoring = (sum: number) => metrics({
        prompts: { total: 1, scored: 1, acks: 0 },
        scores: { good: sum >= 70 ? 1 : 0, ok: 0, poor: sum >= 70 ? 0 : 1, sum },
        signals: zeroPromptDay.signals,
        structure: zeroPromptDay.structure,
    });

    it('does not charge the zero-prompt day for its absent score', () => {
        // Scoring 0 costs a full 15-point shortfall; scoring 100 costs nothing. The
        // unmeasured day must sit at the unpenalised end — before the fix it landed on
        // the penalised one, because avgScore()'s "0 = no reading" was read as "0/100".
        const worst = vibeIndex(twinScoring(0));
        const best = vibeIndex(twinScoring(100));
        const actual = vibeIndex(zeroPromptDay);
        expect(actual).toBeLessThan(worst);
        expect(actual - best).toBeLessThan(worst - actual);
    });

    it('reads identically to the same day scoring perfectly', () => {
        // Dropping the score term (rather than rescaling the rest) means an unmeasured
        // day lands exactly where a flawless one does, driven only by structure — the
        // one ingredient that IS measurable without prompts.
        expect(vibeIndex(zeroPromptDay)).toBe(vibeIndex(twinScoring(100)));
    });

    it('stays within range', () => {
        const v = vibeIndex(zeroPromptDay);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
    });
});
