import { describe, it, expect } from 'vitest';
import { validatePayload, TRIGGER_TIERS } from './promptQualityService';

/**
 * The agent-health field exists so a missing day can be told apart from a broken
 * schedule. It travels OUTSIDE `metrics` (it describes the machine, not the usage),
 * which is easy to get wrong: an earlier cut of this read `metrics.agent`, and
 * because validatePayload rebuilds `metrics` from an explicit allowlist, that read
 * was silently always null. These tests pin the wiring end to end.
 */

const base = {
    schemaVersion: 1,
    day: '2026-08-07',
    collectorVersion: '1.2.0',
    prompts: { total: 1, scored: 1, acks: 0 },
    scores: { good: 1, ok: 0, poor: 0, sum: 80 },
    signals: { no_context: 0, vague: 0, rework: 0, unclear_referent: 0, very_short: 0, short: 0 },
    tokensByModel: {},
    activity: { sessions: 1, distinctProjects: 1 },
    structure: {
        skillInvocations: 0, mcpCalls: 0, builtinTools: {}, freeTextTurns: 1,
        toolAssistedTurns: 0, planModeTurns: 0, acceptEditsTurns: 0,
        editsAccepted: 0, editsRejected: 0, distinctMcpServers: 0,
    },
    promptTypes: { debugging: 0, codeGen: 1, refactor: 0, review: 0, explain: 0, other: 0 },
};

describe('validatePayload — agent trigger tier', () => {
    it.each(TRIGGER_TIERS)('accepts the known tier %s', (tier) => {
        const r = validatePayload({ ...base, agent: { triggerTier: tier, platform: 'darwin' } });
        expect(r.triggerTier).toBe(tier);
    });

    it('is null when the collector predates the field', () => {
        expect(validatePayload({ ...base }).triggerTier).toBeNull();
    });

    it('drops an unrecognised tier instead of storing it', () => {
        const r = validatePayload({ ...base, agent: { triggerTier: 'totally-made-up' } });
        expect(r.triggerTier).toBeNull();
    });

    it('drops a non-string tier without throwing', () => {
        expect(validatePayload({ ...base, agent: { triggerTier: 42 } }).triggerTier).toBeNull();
    });

    it('never rejects the whole day over a malformed agent block', () => {
        // A stale or buggy agent must not cost a member a day of real usage data.
        const r = validatePayload({ ...base, agent: { triggerTier: { nested: 'junk' } } });
        expect(r.triggerTier).toBeNull();
        expect(r.metrics.prompts.total).toBe(1);
    });

    it('keeps agent data out of metrics entirely', () => {
        const r = validatePayload({ ...base, agent: { triggerTier: 'scheduler', platform: 'darwin' } });
        expect(r.metrics).not.toHaveProperty('agent');
        expect(r.metrics).not.toHaveProperty('platform');
    });
});
