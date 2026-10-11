import { config } from '../../../config';
import type { ClaudeUsageMetrics, PromptTypeTally } from '../../../models/ClaudeUsageDaily';

/**
 * Server-side interpretation of the collector's content-free payload:
 *  - strict validation (the privacy firewall, enforced again on the server),
 *  - cost from the central pricing table,
 *  - authoritative score distribution + vibe-coding index.
 *
 * Nothing here can surface customer data: model-id keys and tool-name keys are
 * checked against strict allowlist regexes and everything else is coerced to an
 * integer, so a path/prompt string can never round-trip through the API.
 */

// A Claude model id: lowercase, digits, dots, dashes only. No spaces, no slashes.
const MODEL_ID_RE = /^[a-z][a-z0-9.-]{0,40}$/;
// A built-in Claude Code tool name, e.g. Edit / Bash / Read / Grep / TodoWrite.
const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_RE = /^[0-9][0-9.]{0,15}$/;
// Claude organizationUuid (a standard UUID). The ONLY tenancy identifier accepted.
const ORG_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export class PayloadError extends Error {}

/**
 * Compare two plain `X.Y.Z`-style version strings numerically, part by part —
 * a naive string compare would put '1.5.10' before '1.5.2'. Returns negative
 * if `a` < `b`, positive if `a` > `b`, 0 if equal. Missing trailing parts are
 * treated as 0 (so '1.5' === '1.5.0'). Used only for the version-enforcement
 * gate (ADDENDUM 22) — never for validation, which is regex-only (VERSION_RE).
 */
export function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
    const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i += 1) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

const int = (v: unknown, field: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
        throw new PayloadError(`Field ${field} must be a non-negative integer`);
    }
    if (v > 1e12) throw new PayloadError(`Field ${field} is implausibly large`);
    return v;
};

const obj = (v: unknown, field: string): Record<string, unknown> => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        throw new PayloadError(`Field ${field} must be an object`);
    }
    return v as Record<string, unknown>;
};

/**
 * Validate + sanitize a raw ingest body into a canonical ClaudeUsageMetrics.
 * Throws PayloadError (→ 400) on anything unexpected. Returns ONLY known keys,
 * all values coerced to integers except allowlisted string ids.
 */
/** Trigger tiers a collector may report, best first. Anything else is ignored. */
export const TRIGGER_TIERS = ['scheduler', 'startup', 'hook', 'none'] as const;
export type TriggerTier = (typeof TRIGGER_TIERS)[number];

/**
 * How the collector's VPN gate behaved on the run that transmitted a report.
 * 'enforced' means it ran and found no VPN; 'disabled' means it was switched off in
 * config; 'allowed-after-failed-check' means it sent without being able to verify.
 */
export const VPN_GATE_STATES = ['enforced', 'disabled', 'allowed-after-failed-check'] as const;
export type VpnGateState = (typeof VPN_GATE_STATES)[number];

export function validatePayload(raw: unknown): {
    day: string;
    orgUuid: string | null;
    orgName: string | null;
    triggerTier: TriggerTier | null;
    vpnDeferrals: number | null;
    vpnGate: VpnGateState | null;
    metrics: ClaudeUsageMetrics;
} {
    const b = obj(raw, 'body');

    const day = b.day;
    if (typeof day !== 'string' || !DAY_RE.test(day)) throw new PayloadError('Invalid day');

    const collectorVersion = b.collectorVersion;
    if (typeof collectorVersion !== 'string' || !VERSION_RE.test(collectorVersion)) {
        throw new PayloadError('Invalid collectorVersion');
    }
    const schemaVersion = int(b.schemaVersion, 'schemaVersion');

    // Tenancy identifiers — the ONLY non-integer, non-model-id fields allowed.
    // orgUuid must be a UUID (or absent); orgName is a short human label.
    let orgUuid: string | null = null;
    if (b.orgUuid != null) {
        if (typeof b.orgUuid !== 'string' || !ORG_UUID_RE.test(b.orgUuid)) throw new PayloadError('Invalid orgUuid');
        orgUuid = b.orgUuid;
    }
    let orgName: string | null = null;
    if (b.orgName != null) {
        if (typeof b.orgName !== 'string' || b.orgName.length > 160) throw new PayloadError('Invalid orgName');
        orgName = b.orgName;
    }

    // How the machine is triggered ('scheduler' | 'startup' | 'hook' | 'none'),
    // read back from its own OS. Kept out of `metrics` because it describes the
    // agent, not the usage. Absent on collectors older than the scheduler rollout,
    // and an unrecognised value is dropped rather than rejected — a stale agent
    // must never lose a day of real data over a field this peripheral.
    let triggerTier: TriggerTier | null = null;
    // How many consecutive runs this machine suppressed because it was on a VPN.
    // Only ever arrives on a run that got through, since nothing is sent while the
    // gate is closed — so a high value means "quiet because they were on a customer
    // VPN", which is otherwise indistinguishable from a broken agent. Same leniency
    // as triggerTier: a bad value is dropped, never grounds for losing a real day.
    let vpnDeferrals: number | null = null;
    // How the collector's VPN gate behaved on the run that sent this. Lens has no
    // independent view of a machine's network, so this is the only way to tell a
    // report that was properly gated from one that was not — see the flags in
    // checkAnomalies. Absent on collectors predating the gate, which is itself the
    // signal for the 'ungated-collector' flag.
    let vpnGate: VpnGateState | null = null;
    if (b.agent != null) {
        const a = obj(b.agent, 'agent');
        if (typeof a.triggerTier === 'string' && (TRIGGER_TIERS as readonly string[]).includes(a.triggerTier)) {
            triggerTier = a.triggerTier as TriggerTier;
        }
        if (typeof a.vpnDeferrals === 'number' && Number.isInteger(a.vpnDeferrals)
            && a.vpnDeferrals >= 0 && a.vpnDeferrals <= 100000) {
            vpnDeferrals = a.vpnDeferrals;
        }
        if (typeof a.vpnGate === 'string' && (VPN_GATE_STATES as readonly string[]).includes(a.vpnGate)) {
            vpnGate = a.vpnGate as VpnGateState;
        }
    }

    const prompts = obj(b.prompts, 'prompts');
    const scores = obj(b.scores, 'scores');
    const signals = obj(b.signals, 'signals');
    const activity = obj(b.activity, 'activity');
    const structure = obj(b.structure, 'structure');
    const tokensByModelRaw = obj(b.tokensByModel, 'tokensByModel');

    const tokensByModel: ClaudeUsageMetrics['tokensByModel'] = {};
    for (const [model, tiersRaw] of Object.entries(tokensByModelRaw)) {
        if (!MODEL_ID_RE.test(model)) throw new PayloadError(`Bad model id: ${model}`);
        const tiers = obj(tiersRaw, `tokensByModel.${model}`);
        tokensByModel[model] = {
            input: int(tiers.input, `${model}.input`),
            output: int(tiers.output, `${model}.output`),
            cache_write: int(tiers.cache_write, `${model}.cache_write`),
            cache_read: int(tiers.cache_read, `${model}.cache_read`),
        };
    }

    const builtinToolsRaw = obj(structure.builtinTools, 'structure.builtinTools');
    const builtinTools: Record<string, number> = {};
    for (const [tool, count] of Object.entries(builtinToolsRaw)) {
        if (!TOOL_NAME_RE.test(tool)) throw new PayloadError(`Bad tool name: ${tool}`);
        builtinTools[tool] = int(count, `builtinTools.${tool}`);
    }

    return {
        day,
        orgUuid,
        orgName,
        triggerTier,
        vpnDeferrals,
        vpnGate,
        metrics: {
            schemaVersion,
            collectorVersion,
            prompts: {
                total: int(prompts.total, 'prompts.total'),
                scored: int(prompts.scored, 'prompts.scored'),
                acks: int(prompts.acks, 'prompts.acks'),
            },
            scores: {
                good: int(scores.good, 'scores.good'),
                ok: int(scores.ok, 'scores.ok'),
                poor: int(scores.poor, 'scores.poor'),
                sum: int(scores.sum, 'scores.sum'),
            },
            signals: {
                no_context: int(signals.no_context, 'signals.no_context'),
                vague: int(signals.vague, 'signals.vague'),
                rework: int(signals.rework, 'signals.rework'),
                unclear_referent: int(signals.unclear_referent, 'signals.unclear_referent'),
                very_short: int(signals.very_short, 'signals.very_short'),
                short: int(signals.short, 'signals.short'),
            },
            tokensByModel,
            activity: {
                sessions: int(activity.sessions, 'activity.sessions'),
                distinctProjects: int(activity.distinctProjects, 'activity.distinctProjects'),
            },
            structure: {
                skillInvocations: int(structure.skillInvocations, 'structure.skillInvocations'),
                mcpCalls: int(structure.mcpCalls, 'structure.mcpCalls'),
                builtinTools,
                freeTextTurns: int(structure.freeTextTurns, 'structure.freeTextTurns'),
                toolAssistedTurns: int(structure.toolAssistedTurns, 'structure.toolAssistedTurns'),
                // schemaVersion >= 2 (collector >= 1.1.0); default 0 so older collectors still validate.
                planModeTurns: structure.planModeTurns == null
                    ? 0 : int(structure.planModeTurns, 'structure.planModeTurns'),
                acceptEditsTurns: structure.acceptEditsTurns == null
                    ? 0 : int(structure.acceptEditsTurns, 'structure.acceptEditsTurns'),
                // schemaVersion >= 3 (collector >= 1.2.0); default 0 so older collectors still validate.
                editsAccepted: structure.editsAccepted == null
                    ? 0 : int(structure.editsAccepted, 'structure.editsAccepted'),
                editsRejected: structure.editsRejected == null
                    ? 0 : int(structure.editsRejected, 'structure.editsRejected'),
                distinctMcpServers: structure.distinctMcpServers == null
                    ? 0 : int(structure.distinctMcpServers, 'structure.distinctMcpServers'),
            },
            // schemaVersion >= 3. Category tallies only — an absent block (older collectors) defaults to all-zero.
            promptTypes: b.promptTypes == null ? undefined : (() => {
                const pt = obj(b.promptTypes, 'promptTypes');
                return {
                    debugging: int(pt.debugging, 'promptTypes.debugging'),
                    codeGen: int(pt.codeGen, 'promptTypes.codeGen'),
                    refactor: int(pt.refactor, 'promptTypes.refactor'),
                    review: int(pt.review, 'promptTypes.review'),
                    explain: int(pt.explain, 'promptTypes.explain'),
                    other: int(pt.other, 'promptTypes.other'),
                };
            })(),
            // ---- schemaVersion >= 4 (collector >= 1.5.0) --------------------
            // Efficiency signals. These follow the `triggerTier` precedent rather
            // than the `promptTypes` one: a malformed block is DROPPED, never
            // grounds for a 400. These are brand-new derivations on a fleet of
            // self-updating-never laptops, and a bug in one of them must not cost
            // the user a whole day of real prompt-quality data. `undefined` is
            // also exactly what an older collector produces, so every reader
            // already has to handle it.
            context: optionalBlock(b.context, (c) => ({
                compactions: int(c.compactions, 'context.compactions'),
                autoCompactions: int(c.autoCompactions, 'context.autoCompactions'),
                manualCompactions: int(c.manualCompactions, 'context.manualCompactions'),
                droppedTokens: int(c.droppedTokens, 'context.droppedTokens'),
                preTokensSum: int(c.preTokensSum, 'context.preTokensSum'),
                compactionMs: int(c.compactionMs, 'context.compactionMs'),
                sessionsCompacted: c.sessionsCompacted == null
                    ? 0 : int(c.sessionsCompacted, 'context.sessionsCompacted'),
            })),
            sessionShape: optionalBlock(b.sessionShape, (s) => {
                const size = obj(s.sizeBuckets, 'sessionShape.sizeBuckets');
                const dur = obj(s.durationBuckets, 'sessionShape.durationBuckets');
                return {
                    sizeBuckets: {
                        s1_5: int(size.s1_5, 'sessionShape.sizeBuckets.s1_5'),
                        s6_20: int(size.s6_20, 'sessionShape.sizeBuckets.s6_20'),
                        s21_100: int(size.s21_100, 'sessionShape.sizeBuckets.s21_100'),
                        s100plus: int(size.s100plus, 'sessionShape.sizeBuckets.s100plus'),
                    },
                    durationBuckets: {
                        lt15m: int(dur.lt15m, 'sessionShape.durationBuckets.lt15m'),
                        m15_60: int(dur.m15_60, 'sessionShape.durationBuckets.m15_60'),
                        h1_4: int(dur.h1_4, 'sessionShape.durationBuckets.h1_4'),
                        h4plus: int(dur.h4plus, 'sessionShape.durationBuckets.h4plus'),
                    },
                };
            }),
            concurrency: optionalBlock(b.concurrency, (c) => ({
                maxConcurrent: int(c.maxConcurrent, 'concurrency.maxConcurrent'),
                overlappingSessions: int(c.overlappingSessions, 'concurrency.overlappingSessions'),
                switches: int(c.switches, 'concurrency.switches'),
                switchesUnder5m: int(c.switchesUnder5m, 'concurrency.switchesUnder5m'),
            })),
            pace: optionalBlock(b.pace, (p) => {
                const g = obj(p.gapBuckets, 'pace.gapBuckets');
                return {
                    gapBuckets: {
                        lt10s: int(g.lt10s, 'pace.gapBuckets.lt10s'),
                        s10_60: int(g.s10_60, 'pace.gapBuckets.s10_60'),
                        m1_5: int(g.m1_5, 'pace.gapBuckets.m1_5'),
                        m5_30: int(g.m5_30, 'pace.gapBuckets.m5_30'),
                        gt30m: int(g.gt30m, 'pace.gapBuckets.gt30m'),
                    },
                };
            }),
            // Same model-id allowlist as tokensByModel: an unrecognised key is
            // dropped, so a path or prompt fragment can never become a key here.
            promptTypesByModel: optionalBlock(b.promptTypesByModel, (raw2) => {
                const out: Record<string, PromptTypeTally> = {};
                for (const [model, v] of Object.entries(raw2)) {
                    if (!MODEL_ID_RE.test(model)) continue;
                    const t = obj(v, `promptTypesByModel.${model}`);
                    out[model] = {
                        debugging: int(t.debugging, `promptTypesByModel.${model}.debugging`),
                        codeGen: int(t.codeGen, `promptTypesByModel.${model}.codeGen`),
                        refactor: int(t.refactor, `promptTypesByModel.${model}.refactor`),
                        review: int(t.review, `promptTypesByModel.${model}.review`),
                        explain: int(t.explain, `promptTypesByModel.${model}.explain`),
                        other: int(t.other, `promptTypesByModel.${model}.other`),
                    };
                }
                return out;
            }),
        },
    };
}

/**
 * Parse an optional schema-4 block, dropping it entirely if anything about it is
 * malformed. See the comment at the call sites for why these degrade rather than
 * reject: losing a new metric is recoverable, losing the day is not.
 */
function optionalBlock<T>(
    raw: unknown,
    parse: (o: Record<string, unknown>) => T,
): T | undefined {
    if (raw == null) return undefined;
    try {
        return parse(obj(raw, 'block'));
    } catch {
        return undefined;
    }
}

/** Total tokens across all tiers/models. */
export function totalTokens(m: ClaudeUsageMetrics): number {
    return Object.values(m.tokensByModel).reduce(
        (s, t) => s + t.input + t.output + t.cache_write + t.cache_read,
        0,
    );
}

/** A per-model rate set: { models: {id: {input,output,cache_write,cache_read}}, fallback }. */
export interface RateSet {
    models: Record<string, { input: number; output: number; cache_write: number; cache_read: number }>;
    fallback: { input: number; output: number; cache_write: number; cache_read: number };
}

/** The config rates as a RateSet — the seed/fallback when no DB pricing row applies. */
export function configRateSet(): RateSet {
    return { models: config.collector.pricing, fallback: config.collector.fallbackPrice };
}

/** Resolve the rate row for a model id: exact match, prefix match, else the fallback. */
export function rateForModel(
    model: string,
    rates: RateSet,
): { input: number; output: number; cache_write: number; cache_read: number } {
    return (
        rates.models[model] ||
        Object.entries(rates.models).find(([k]) => model.startsWith(k))?.[1] ||
        rates.fallback
    );
}

/** USD cost for a single model's token tally, priced with the given rate set (per 1,000,000 tokens). */
export function computeModelCost(
    t: { input: number; output: number; cache_write: number; cache_read: number },
    p: { input: number; output: number; cache_write: number; cache_read: number },
): number {
    return (t.input / 1e6) * p.input
        + (t.output / 1e6) * p.output
        + (t.cache_write / 1e6) * p.cache_write
        + (t.cache_read / 1e6) * p.cache_read;
}

/**
 * Prompt-caching efficiency for a day.
 *
 * Claude re-reads the whole conversation on every turn; `cache_read` is that
 * re-reading served from cache at roughly a tenth of the input rate. So the
 * meaningful denominator is the CONTEXT tokens (read + write + fresh input) —
 * output is generated, never cached, and including it would dilute the rate
 * into meaninglessness for output-heavy days.
 *
 * Needs no collector change: cache_read/cache_write have been on the wire since
 * the first version, so this works on every historical row.
 */
export function cacheStats(m: ClaudeUsageMetrics): {
    read: number;
    write: number;
    fresh: number;
    hitRate: number;
} {
    let read = 0;
    let write = 0;
    let fresh = 0;
    for (const t of Object.values(m.tokensByModel)) {
        read += t.cache_read;
        write += t.cache_write;
        fresh += t.input;
    }
    const context = read + write + fresh;
    return { read, write, fresh, hitRate: context > 0 ? read / context : 0 };
}

/**
 * What caching saved, in USD: the cache-read tokens billed at the cache-read
 * rate versus the same tokens at the full input rate. Priced per model so a
 * day split across Opus and Haiku is valued correctly.
 */
export function cacheSavings(m: ClaudeUsageMetrics, rates: RateSet): number {
    let usd = 0;
    for (const [model, t] of Object.entries(m.tokensByModel)) {
        const p = rateForModel(model, rates);
        usd += (t.cache_read / 1e6) * (p.input - p.cache_read);
    }
    return Math.round(usd * 100) / 100;
}

/** USD cost for a day, priced with the given rate set (rates are per 1,000,000 tokens). */
export function computeCostWithRates(m: ClaudeUsageMetrics, rates: RateSet): number {
    let usd = 0;
    for (const [model, t] of Object.entries(m.tokensByModel)) {
        usd += computeModelCost(t, rateForModel(model, rates));
    }
    return Math.round(usd * 100) / 100;
}

/** Back-compat: cost from the current config rates. */
export function computeCost(m: ClaudeUsageMetrics): number {
    return computeCostWithRates(m, configRateSet());
}

/** Average prompt score for the day (0 when nothing was scored). */
export function avgScore(m: ClaudeUsageMetrics): number {
    const n = m.prompts.scored;
    return n > 0 ? Math.round((m.scores.sum / n) * 10) / 10 : 0;
}

/**
 * Vibe-coding index, 0-100 (higher = more "vibe coding"). Blends four signals:
 * low structured-help ratio, high rework rate, high no-context rate, low avg score.
 * Tunable; deliberately simple and explainable.
 */
export function vibeIndex(m: ClaudeUsageMetrics): number {
    const turns = m.structure.freeTextTurns + m.structure.toolAssistedTurns;
    const structuredRatio = turns > 0
        ? (m.structure.toolAssistedTurns + m.structure.skillInvocations + m.structure.mcpCalls) /
          (turns + m.structure.skillInvocations + m.structure.mcpCalls)
        : 0;
    const scored = m.prompts.scored || 1;
    const reworkRate = m.signals.rework / scored;
    const noContextRate = m.signals.no_context / scored;

    const raw =
        0.40 * (1 - Math.min(structuredRatio, 1)) +
        0.25 * Math.min(reworkRate, 1) +
        0.20 * Math.min(noContextRate, 1);

    // With nothing scored, avgScore() is 0 — "no reading", not "scored zero". Folding it
    // in would charge a full 15-point shortfall for a score that was never measured, so
    // drop the term. Deliberately NOT renormalized: rework and no-context are per-scored-
    // prompt rates and are equally unmeasurable here, so rescaling would inflate the
    // index off the one term that IS real (structure). Capping such a day at 40 biases it
    // toward "low vibe", which is the safe direction for a reading nobody can verify.
    if (m.prompts.scored === 0) {
        return Math.max(0, Math.min(100, Math.round(raw * 100)));
    }
    const scoreShortfall = 1 - Math.min(avgScore(m), 100) / 100;
    return Math.max(0, Math.min(100, Math.round((raw + 0.15 * scoreShortfall) * 100)));
}

export function vibeBucket(index: number): 'low' | 'medium' | 'high' {
    if (index >= 60) return 'high';
    if (index >= 35) return 'medium';
    return 'low';
}

/** Recompute the fast-list scalars we denormalize onto the row. */
export function deriveScalars(m: ClaudeUsageMetrics): {
    totalPrompts: number;
    avgScore: number;
    vibeIndex: number;
} {
    return { totalPrompts: m.prompts.total, avgScore: avgScore(m), vibeIndex: vibeIndex(m) };
}

// ---------------------------------------------------------------------------
// Integrity (ADDENDUM 5) — the collector is self-reported from a user-controlled
// machine, so tampering cannot be PREVENTED, only detected + deterred.
//  - checkIntegrity: hard arithmetic identities BETWEEN COUNTS THE COLLECTOR DERIVES
//    FROM THE SAME RECORDS (a sub-count exceeding its parent, a future day). A
//    violation is IMPOSSIBLE for honest data → reject the row (400), store nothing.
//    Prompts and tokens are NOT such a pair: collector.js counts prompts from `user`
//    records and tokens from `assistant` records independently, so a session that
//    crosses midnight or is resumed legitimately yields tokens with zero prompts.
//    That belongs below, as a flag.
//  - detectAnomalies: plausibility heuristics. These only FLAG a row for admin
//    review; they never block (honest heavy users can trip them).
// ---------------------------------------------------------------------------

export interface IntegrityFlag {
    code: string;
    detail: string;
    severity: 'low' | 'medium' | 'high';
}

/** Prior-day scalars used to detect regime shifts (from claude_usage_daily). */
export interface HistoryPoint {
    avgScore: number;
    totalTokens: number;
    totalPrompts: number;
}

/** Hard arithmetic identities. Returns human-readable violations; empty = clean. */
export function checkIntegrity(m: ClaudeUsageMetrics, day: string): string[] {
    const errs: string[] = [];
    const p = m.prompts;
    const s = m.scores;

    if (s.good + s.ok + s.poor > p.scored) {
        errs.push('scores.good+ok+poor exceeds prompts.scored');
    }
    if (p.scored > p.total) errs.push('prompts.scored exceeds prompts.total');
    if (p.acks > p.total) errs.push('prompts.acks exceeds prompts.total');
    if (s.sum > 100 * p.scored) errs.push('scores.sum exceeds 100 × prompts.scored');
    for (const [k, v] of Object.entries(m.signals)) {
        if ((v as number) > p.scored) errs.push(`signals.${k} exceeds prompts.scored`);
    }
    // Tokens with zero prompts is NOT checked here — see the block comment above; it is
    // flagged as 'tokens-without-prompts' instead. A scored prompt with zero prompts
    // total remains impossible: both come off the same record.
    if (p.total === 0 && p.scored > 0) {
        errs.push('prompts.scored is non-zero but prompts.total is 0');
    }
    // day must not be in the future (UTC, allow same-day)
    const today = new Date().toISOString().slice(0, 10);
    if (day > today) errs.push(`day ${day} is in the future`);

    return errs;
}

/** Plausibility heuristics — FLAG only, never block. `history` = prior rows in range. */
export function detectAnomalies(
    m: ClaudeUsageMetrics,
    history: HistoryPoint[],
    vpnGate?: VpnGateState | null,
): IntegrityFlag[] {
    const flags: IntegrityFlag[] = [];
    const t = config.collector.integrity;
    const tokens = totalTokens(m);
    const scored = m.prompts.scored;
    const avg = avgScore(m);

    // A day of pure assistant output: the collector counts prompts off `user` records and
    // tokens off `assistant` ones, so a session that ran past midnight (or was resumed)
    // books its tokens here while its prompt belongs to the previous day. Honest, but
    // worth surfacing — it also looks like this when prompt extraction is broken.
    if (m.prompts.total === 0 && tokens > 0) {
        flags.push({ code: 'tokens-without-prompts', severity: 'low',
            detail: 'tokens were used but no prompt was recorded — usually a session that ran past midnight or was resumed, so the prompt belongs to the previous day' });
    }

    if (m.prompts.total >= 5) {
        const perPrompt = tokens / m.prompts.total;
        if (perPrompt < t.minTokensPerPrompt) {
            flags.push({ code: 'tokens-too-low', severity: 'medium',
                detail: `~${Math.round(perPrompt)} tokens/prompt across ${m.prompts.total} prompts is implausibly low` });
        } else if (perPrompt > t.maxTokensPerPrompt) {
            flags.push({ code: 'tokens-too-high', severity: 'medium',
                detail: `~${Math.round(perPrompt)} tokens/prompt is implausibly high` });
        }
    }

    if (avg >= t.perfectScore && scored >= t.perfectScoreMinScored) {
        flags.push({ code: 'score-too-perfect', severity: 'medium',
            detail: `avg score ${avg} across ${scored} scored prompts is implausibly high` });
    }

    // Internal inconsistency: claims low vibe (structured) yet high rework/no-context.
    const vibe = vibeIndex(m);
    const reworkRate = scored ? m.signals.rework / scored : 0;
    const noCtxRate = scored ? m.signals.no_context / scored : 0;
    if (vibe < 20 && (reworkRate > 0.5 || noCtxRate > 0.6)) {
        flags.push({ code: 'inconsistent-vibe', severity: 'low',
            detail: `vibe index ${vibe} conflicts with high rework/no-context rates` });
    }

    // Regime shift vs trailing median of prior days.
    if (history.length >= 3) {
        const med = (arr: number[]) => {
            const a = [...arr].sort((x, y) => x - y);
            return a[Math.floor(a.length / 2)];
        };
        const medScore = med(history.map((h) => h.avgScore).filter((x) => x > 0));
        const medTokens = med(history.map((h) => h.totalTokens).filter((x) => x > 0));
        // `scored > 0` guard: avgScore() is 0 when nothing was scored, which would read as
        // a maximal drop against any normal median and flag every zero-prompt day.
        if (scored > 0 && medScore && Math.abs(avg - medScore) >= t.regimeScoreJump) {
            flags.push({ code: 'score-regime-shift', severity: 'low',
                detail: `avg score ${avg} vs recent median ${medScore}` });
        }
        if (medTokens && tokens >= medTokens * t.regimeTokenFactor) {
            flags.push({ code: 'token-regime-shift', severity: 'low',
                detail: `tokens ${tokens} ≥ ${t.regimeTokenFactor}× recent median ${medTokens}` });
        }
    }

    if (!t.knownCollectorVersions.includes(m.collectorVersion)) {
        flags.push({ code: 'unknown-collector', severity: 'low',
            detail: `collector version ${m.collectorVersion} is not a known release` });
    }

    // --- Did this report bypass the VPN gate? --------------------------------
    //
    // Engineers work inside customer networks, and the collector is supposed to
    // stay silent while a VPN is up. Lens has no independent view of a machine's
    // network, so it cannot catch a report that slipped past a FAILED check — that
    // gap is real and unclosable from here. What it can catch with certainty is a
    // report that was never gated in the first place. This is an audit trail after
    // the fact, not a prevention.
    if (vpnGate == null) {
        // No gate state at all means a build that predates the gate. Not a
        // heuristic — a fact about that release.
        flags.push({ code: 'ungated-collector', severity: 'medium',
            detail: `collector ${m.collectorVersion} predates the VPN gate — this report was not checked against a VPN. Ask this user to update.` });
    } else if (vpnGate === 'disabled') {
        flags.push({ code: 'vpn-gate-disabled', severity: 'high',
            detail: 'the VPN gate is switched off in this machine\'s config (skipOnVpn:false) — it will report from inside customer networks' });
    } else if (vpnGate === 'allowed-after-failed-check') {
        flags.push({ code: 'vpn-gate-unverified', severity: 'medium',
            detail: 'the VPN check could not run on this machine — this report went out without verifying whether a VPN was connected' });
    }

    // --- schema 4 efficiency signals: internal consistency -------------------
    //
    // These are FLAGS, deliberately not identities in checkIntegrity. The blocks
    // are new derivations, and a bug in one of them must show up as a row an
    // admin can look at, not as a rejected day that loses the user's real
    // prompt-quality data along with it.
    if (m.context) {
        const c = m.context;
        if (c.autoCompactions + c.manualCompactions > c.compactions) {
            flags.push({ code: 'context-trigger-mismatch', severity: 'low',
                detail: `context: auto (${c.autoCompactions}) + manual (${c.manualCompactions}) exceeds total compactions (${c.compactions})` });
        }
        if (c.droppedTokens > c.preTokensSum) {
            flags.push({ code: 'context-dropped-exceeds-pre', severity: 'low',
                detail: `context: droppedTokens (${c.droppedTokens}) exceeds preTokensSum (${c.preTokensSum}) — a per-event drop cannot exceed the context it came from` });
        }
        if (c.sessionsCompacted > m.activity.sessions) {
            flags.push({ code: 'context-sessions-exceed-total', severity: 'low',
                detail: `context: sessionsCompacted (${c.sessionsCompacted}) exceeds the day's sessions (${m.activity.sessions})` });
        }
    }
    if (m.sessionShape) {
        const sizeSum = Object.values(m.sessionShape.sizeBuckets).reduce((a, b2) => a + b2, 0);
        if (sizeSum > m.activity.sessions) {
            flags.push({ code: 'session-buckets-exceed-sessions', severity: 'low',
                detail: `sessionShape: buckets total ${sizeSum} but the day recorded ${m.activity.sessions} sessions` });
        }
    }
    if (m.concurrency) {
        if (m.concurrency.maxConcurrent > m.activity.sessions) {
            flags.push({ code: 'concurrency-exceeds-sessions', severity: 'low',
                detail: `concurrency: peak ${m.concurrency.maxConcurrent} exceeds the day's ${m.activity.sessions} sessions` });
        }
        if (m.concurrency.switchesUnder5m > m.concurrency.switches) {
            flags.push({ code: 'concurrency-switch-mismatch', severity: 'low',
                detail: `concurrency: switchesUnder5m (${m.concurrency.switchesUnder5m}) exceeds total switches (${m.concurrency.switches})` });
        }
    }
    if (m.pace) {
        const gapSum = Object.values(m.pace.gapBuckets).reduce((a, b2) => a + b2, 0);
        if (gapSum > m.prompts.scored) {
            flags.push({ code: 'pace-buckets-exceed-scored', severity: 'low',
                detail: `pace: ${gapSum} gaps recorded but only ${m.prompts.scored} prompts were scored` });
        }
    }
    if (m.promptTypesByModel && m.promptTypes) {
        const byModel = Object.values(m.promptTypesByModel)
            .reduce((s, t) => s + t.debugging + t.codeGen + t.refactor + t.review + t.explain + t.other, 0);
        const dayTotal = m.promptTypes.debugging + m.promptTypes.codeGen + m.promptTypes.refactor
            + m.promptTypes.review + m.promptTypes.explain + m.promptTypes.other;
        if (byModel > dayTotal) {
            flags.push({ code: 'model-mix-exceeds-prompt-types', severity: 'low',
                detail: `promptTypesByModel totals ${byModel} but only ${dayTotal} prompts were classified — a prompt was attributed to more than one model` });
        }
    }

    return flags;
}
