#!/usr/bin/env node
/**
 * Claude Usage Collector (Lens)
 * =============================
 *
 * A tiny, dependency-free Node.js agent that reads Claude Code's LOCAL session
 * transcripts (~/.claude/projects), computes CONTENT-FREE daily aggregates, and
 * pushes only those numbers to Lens. It runs daily via the OS scheduler (Task
 * Scheduler on Windows, launchd on macOS) — see the installers.
 *
 * PRIVACY (non-negotiable): engineers use the customer's Claude license, so no
 * customer data may ever leave the machine. This collector transmits ONLY counts,
 * token totals per model, category signal tallies and tool/skill/MCP usage counts.
 * It NEVER transmits prompt text, responses, code, file paths, project/repo names,
 * branches or session ids. A whitelist serializer (buildPayload) is the single seam
 * where data is shaped for the wire — nothing else is sent. Costs are computed in
 * Lens, not here.
 *
 * Node stdlib only: fs, path, os, https, http, crypto. No npm install.
 *
 * Usage:
 *   node collector.js                 # process yesterday+today, push each
 *   node collector.js --date 2026-08-01
 *   node collector.js --days 7        # backfill the last N days
 *   node collector.js --dry-run       # compute + print payloads, do NOT push
 *   node collector.js --local-dashboard   # also write a local dashboard.html
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const cp = require('child_process');
const { URL } = require('url');

const HOME = os.homedir();
const DEFAULT_CLAUDE_DIR = path.join(HOME, '.claude');
const HERE = __dirname;

function expandHome(p) {
    if (!p) return p;
    if (p === '~') return HOME;
    if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(HOME, p.slice(2));
    return p;
}

/**
 * Read ONLY the current Claude org identity — organizationUuid + organizationName.
 * Never reads or returns tokens/email. Used to attribute usage to the correct
 * customer license (and exclude others).
 *
 * The state file is `.claude.json`. In the DEFAULT setup the data dir is
 * `~/.claude/` but the file sits at `~/.claude.json` (in HOME). With an isolated
 * CLAUDE_CONFIG_DIR it lives inside that dir. So we check the config dir first,
 * then fall back to HOME only for the default dir (keeps isolation strict).
 */
function readOrgIdentity(configDir) {
    const candidates = [path.join(configDir, '.claude.json')];
    if (path.resolve(configDir) === path.resolve(DEFAULT_CLAUDE_DIR)) {
        candidates.push(path.join(HOME, '.claude.json'));
    }
    for (const file of candidates) {
        try {
            const j = JSON.parse(fs.readFileSync(file, 'utf8'));
            const acct = j && j.oauthAccount;
            if (acct && typeof acct.organizationUuid === 'string') {
                return {
                    orgUuid: acct.organizationUuid,
                    orgName: typeof acct.organizationName === 'string' ? acct.organizationName.slice(0, 160) : null,
                };
            }
        } catch { /* try next candidate */ }
    }
    return { orgUuid: null, orgName: null };
}
const CONFIG_PATH = path.join(HERE, 'config.json');
const OUTBOX_PATH = path.join(HERE, 'outbox.json');
const DEFERRALS_PATH = path.join(HERE, '.vpn-deferrals');
// Merge of the efficiency-signals work (1.5.0, schema 4) and the VPN-gate
// simplification (1.4.4) — this version carries both; schema stays at the
// higher of the two since only the efficiency-signals branch added new
// payload fields.
// 1.5.2: fixed extractPromptText silently dropping an entire turn (real
// instruction included) whenever VS Code's IDE-context tag landed as the
// leading content block — see the comment on extractPromptText. No payload
// shape change, so SCHEMA_VERSION stays put.
const COLLECTOR_VERSION = '1.5.2';
const SCHEMA_VERSION = 4;

/**
 * VPN gate. Engineers work inside customer VPNs, and a request made while a tunnel
 * is up — including the DNS lookup before it — is visible to the customer's network
 * monitoring. So nothing is sent while one is detected; the day is queued instead.
 *
 * A MISSING MODULE COUNTS AS BEING ON A VPN. This file and vpn.js are downloaded
 * separately by the installer, so a partial or interrupted install can leave one
 * without the other. Going quiet in that case is recoverable; sending unprotected
 * is not.
 */
let detectVpn;
try {
    ({ detectVpn } = require('./vpn'));
} catch {
    detectVpn = () => ({ onVpn: true, reason: 'vpn-module-missing' });
}

// ---------------------------------------------------------------------------
// Heuristic prompt scoring — identical intent to the standalone Python tool.
// Only TALLIES of which signals fired are ever sent (never the text itself).
// ---------------------------------------------------------------------------
const VAGUE_RE = new RegExp(
    [
        'fix it', 'fix this', 'do it', 'make it work', "doesn'?t work", 'not working',
        'still (?:broken|not working|failing|wrong)', 'same (?:error|issue|problem)',
        'try again', "it'?s broken", "that'?s wrong", 'redo', 'still (?:the same|there)',
    ].join('|'),
    'i',
);
const CONTEXT_RE = /(?:```)|(?:[\w./-]+\.\w{1,5}\b)|(?:\/[\w./-]+)|(?:\b\w+\(\))|(?:line\s+\d+)|(?:https?:\/\/)/i;
// ADDENDUM 20 item 4a: "continue"/"go ahead"-style follow-ups behave like acks (a nudge
// to keep working, not a new instruction) — skipped from scoring entirely, same as
// "ok"/"thanks", instead of falling into the "other" prompt-type bucket as a real prompt.
const ACK_RE = /^\s*(?:ok(?:ay)?|thanks?|thank you|thx|yes|yep|yeah|no|nope|cool|great|nice|perfect|done|got it|k|continue|go ahead|keep going|proceed|next|sounds good|lgtm|do it)\s*[.!]*\s*$/i;
const PRONOUN_ONLY_RE = /^\s*(?:this|that|it|these|those)\b/i;
const SYNTHETIC_PREFIXES = ['<ide_', '<command-', '<local-command', '<system-reminder', '<user-prompt-submit', 'caveat:', '<bash-'];

const THRESHOLDS = { good: 70, ok: 40 };

// ---------------------------------------------------------------------------
// Prompt-type classification — a category TALLY only (never the text itself).
// Same idea as the standalone Python analysis tool, ported into the content-free
// model: each prompt increments exactly one bucket, buckets are counts on the wire.
// ---------------------------------------------------------------------------
const PROMPT_TYPE_RULES = [
    ['debugging', /\b(bug|error|exception|stack ?trace|crash(?:es|ed|ing)?|fail(?:s|ed|ing)?|broken|not working|doesn'?t work|traceback)\b/i],
    ['review', /\b(review|feedback on|thoughts on|does this look|is this (?:ok|okay|good|right|correct))\b/i],
    ['explain', /\b(explain|what does|how does|why does|why is|walk me through|help me understand|what is)\b/i],
    ['refactor', /\b(refactor|clean ?up|simplify|restructure|reorgani[sz]e|rename|extract|dedupe|de-?duplicate)\b/i],
    // ADDENDUM 20 item 4b: widened noun list — "create a migration"/"add a route"/"build
    // a pipeline" were falling to 'other' despite being clearly build/coding work.
    ['codeGen', /\b(add|implement|build|create|write|generate)\b.*\b(function|feature|component|endpoint|test|script|class|method|page|screen|migration|route|pipeline|api|model|query|job|handler|hook|integration)\b/i],
];
function classifyPromptType(text) {
    for (const [key, re] of PROMPT_TYPE_RULES) if (re.test(text)) return key;
    return 'other';
}

// Best-effort accept/reject signal for Edit/Write-family tool calls: a rejection
// shows up as an is_error tool_result, or as a matching decline phrase, on the
// matching tool_use_id. Counts only — the diff/content itself is never inspected
// beyond this boolean classification, and no file path or content is retained.
const EDIT_TOOL_RE = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const REJECT_PHRASE_RE = /(user (?:doesn'?t|does ?not) want to proceed|user rejected|user declined|permission denied|user (?:canceled|cancelled)|operation (?:canceled|cancelled))/i;
function resultLooksRejected(block) {
    if (block.is_error === true) return true;
    const c = block.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b && b.text) || '').join(' ') : '';
    return REJECT_PHRASE_RE.test(text);
}

function scorePrompt(text, secsSincePrevAssistant) {
    let score = 50;
    const tags = new Set();
    const words = text.trim().split(/\s+/).filter(Boolean);
    const wc = words.length;

    if (wc < 3) { score -= 25; tags.add('very_short'); }
    else if (wc <= 6) { score -= 10; tags.add('short'); }
    else if (wc >= 30) { score += 15; }
    else { score += 10; }

    if (CONTEXT_RE.test(text)) score += 15;
    else tags.add('no_context');

    if (VAGUE_RE.test(text)) { score -= 20; tags.add('vague'); }
    if (PRONOUN_ONLY_RE.test(text) && !CONTEXT_RE.test(text)) { score -= 10; tags.add('unclear_referent'); }
    if (secsSincePrevAssistant != null && secsSincePrevAssistant <= 90 && (wc <= 6 || VAGUE_RE.test(text))) {
        score -= 15; tags.add('rework');
    }

    score = Math.max(0, Math.min(100, score));
    return { score, tags };
}

// ---------------------------------------------------------------------------
// Transcript discovery + parsing
// ---------------------------------------------------------------------------
function walkJsonl(dir) {
    const out = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walkJsonl(full));
        else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
    }
    return out;
}

function extractPromptText(rec) {
    const msg = rec && rec.message;
    if (!msg || typeof msg !== 'object') return null;
    const content = msg.content;
    const blocks = [];
    if (typeof content === 'string') blocks.push(content);
    else if (Array.isArray(content)) {
        for (const block of content) {
            if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
                blocks.push(block.text);
            }
        }
    }
    // Drop only the SYNTHETIC blocks (IDE open/selection tags, system reminders,
    // slash-command wrappers) — not the whole turn. VS Code injects an
    // <ide_opened_file>/<ide_selection> block as its own leading block, ahead of
    // the person's real typed instruction, on the SAME turn. Previously this
    // function joined every block first and then checked whether the JOINED
    // string started with a synthetic prefix, so any turn carrying an IDE tag had
    // its entire record discarded — tag AND the real instruction — never counted
    // in prompts.total, never scored. That's silent undercounting, not scoring:
    // it's how a day could show real token usage with zero prompts recorded.
    // Filtering per-block instead keeps the person's real content while still
    // dropping the synthetic wrapper. This does NOT make an open/selected file
    // count as "context" for scoring — the IDE tag itself says "may or may not
    // be related to the current task", so crediting it would often be wrong;
    // only what the person actually types is ever scored.
    const real = blocks.filter((b) => {
        const low = b.trim().toLowerCase();
        return !SYNTHETIC_PREFIXES.some((p) => low.startsWith(p));
    });
    const text = real.join('\n').trim();
    return text || null;
}

function localDay(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    // Local calendar date (YYYY-MM-DD).
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function newDayAgg() {
    return {
        prompts: { total: 0, scored: 0, acks: 0 },
        scores: { good: 0, ok: 0, poor: 0, sum: 0 },
        signals: { no_context: 0, vague: 0, rework: 0, unclear_referent: 0, very_short: 0, short: 0 },
        promptTypes: { debugging: 0, codeGen: 0, refactor: 0, review: 0, explain: 0, other: 0 },
        tokensByModel: {},
        sessions: new Set(),
        projects: new Set(),
        mcpServers: new Set(), // server names, LOCAL ONLY — buildPayload sends .size, never names
        structure: {
            skillInvocations: 0, mcpCalls: 0, builtinTools: {}, freeTextTurns: 0, toolAssistedTurns: 0,
            planModeTurns: 0, acceptEditsTurns: 0, editsAccepted: 0, editsRejected: 0,
        },
        // ---- SCHEMA 4 efficiency signals -----------------------------------
        // Context lost to compaction. Every compaction throws away a context
        // window that then has to be re-established, so this is the one signal
        // that puts a token number on "the conversation got too long".
        context: {
            compactions: 0, autoCompactions: 0, manualCompactions: 0,
            droppedTokens: 0, preTokensSum: 0, compactionMs: 0,
        },
        compactedSessions: new Set(), // session ids, LOCAL ONLY — .size is sent
        // Per-session time spans and sizes. THIS MAP NEVER LEAVES THE MACHINE:
        // buildPayload collapses it to bucket counts and a concurrency peak.
        // Keyed by session id and accumulated across files, because one session
        // can be spread over several transcripts.
        sessionSpans: new Map(), // sid -> { first, last, prompts }
        // Session-switch detection needs the previous scored prompt's session in
        // DAY order, which is not file order — collected here, resolved at the end.
        promptTimeline: [], // { sid, when } for scored prompts, local only
        // Gap between Claude finishing and the next SCORED prompt.
        pace: { gapBuckets: { lt10s: 0, s10_60: 0, m1_5: 0, m5_30: 0, gt30m: 0 } },
        // Prompt category x answering model. Category tallies only, as promptTypes.
        promptTypesByModel: {},
    };
}

/** Bucket a session's prompt count. Mirrors sessionShape.sizeBuckets. */
function sessionSizeBucket(prompts) {
    if (prompts <= 5) return 's1_5';
    if (prompts <= 20) return 's6_20';
    if (prompts <= 100) return 's21_100';
    return 's100plus';
}

/** Bucket a session's wall-clock span. Mirrors sessionShape.durationBuckets. */
function sessionDurationBucket(ms) {
    const min = ms / 60000;
    if (min < 15) return 'lt15m';
    if (min < 60) return 'm15_60';
    if (min < 240) return 'h1_4';
    return 'h4plus';
}

/** Bucket the delay before a prompt. Mirrors pace.gapBuckets. */
function gapBucket(secs) {
    if (secs < 10) return 'lt10s';
    if (secs < 60) return 's10_60';
    if (secs < 300) return 'm1_5';
    if (secs < 1800) return 'm5_30';
    return 'gt30m';
}

/**
 * Peak number of sessions open at the same moment, by sweeping sorted
 * start/end events. Spans under a minute are ignored: a one-shot session that
 * merely starts while another is open is not "working in parallel", and
 * counting it would make the peak read 3-4 for everyone.
 */
function concurrencyFromSpans(sessionSpans) {
    const spans = [...sessionSpans.values()].filter(
        (s) => s.first != null && s.last != null && s.last - s.first >= 60000,
    );
    const events = [];
    for (const s of spans) {
        events.push([s.first, 1]);
        events.push([s.last, -1]);
    }
    // Ends before starts at an identical timestamp, so touching spans don't
    // register as an overlap.
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let open = 0;
    let peak = 0;
    let overlapping = 0;
    for (const [, delta] of events) {
        open += delta;
        if (delta === 1 && open > 1) overlapping += 1;
        if (open > peak) peak = open;
    }
    return { maxConcurrent: peak, overlappingSessions: overlapping };
}

/**
 * Session switches: adjacent SCORED prompts (in day order) answered in different
 * sessions. `switchesUnder5m` is the subset that happened within five minutes,
 * which is the one that actually indicates thrashing rather than simply moving
 * on to the next task later in the day.
 */
function switchesFromTimeline(timeline) {
    const ordered = [...timeline].sort((a, b) => a.when - b.when);
    let switches = 0;
    let under5m = 0;
    for (let i = 1; i < ordered.length; i += 1) {
        if (ordered[i].sid === ordered[i - 1].sid) continue;
        switches += 1;
        if (ordered[i].when - ordered[i - 1].when < 300000) under5m += 1;
    }
    return { switches, switchesUnder5m: under5m };
}

/**
 * Structure signals from an assistant message's content blocks. `pendingEdits`
 * (Map<tool_use_id, agg>) records Edit/Write-family calls so the FOLLOWING
 * tool_result (in the next user record) can be classified accepted/rejected —
 * only the day's agg reference and tool id are kept, never the diff/content.
 */
function tallyAssistantStructure(agg, msg, pendingEdits) {
    const content = Array.isArray(msg.content) ? msg.content : [];
    let hadTool = false;
    for (const block of content) {
        if (block && block.type === 'tool_use' && typeof block.name === 'string') {
            hadTool = true;
            const name = block.name;
            // MCP tools are namespaced (mcp__server__tool); skills invoke via a Skill tool.
            if (name.startsWith('mcp__')) {
                agg.structure.mcpCalls += 1;
                const server = name.split('__')[1];
                if (server) agg.mcpServers.add(server); // name kept locally only; never sent
            } else if (name === 'Skill') agg.structure.skillInvocations += 1;
            else {
                // Built-in Claude Code tool — count by generic tool name only, never args.
                agg.structure.builtinTools[name] = (agg.structure.builtinTools[name] || 0) + 1;
            }
            if (EDIT_TOOL_RE.test(name) && typeof block.id === 'string' && pendingEdits) {
                pendingEdits.set(block.id, agg);
            }
        }
    }
    if (hadTool) agg.structure.toolAssistedTurns += 1;
    else agg.structure.freeTextTurns += 1;
}

/** Resolve tool_result blocks in a user record against pending Edit/Write calls. */
function tallyToolResults(rec, pendingEdits) {
    if (!pendingEdits || !pendingEdits.size) return;
    const content = rec && rec.message && rec.message.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
        if (!block || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        const agg = pendingEdits.get(block.tool_use_id);
        if (!agg) continue;
        pendingEdits.delete(block.tool_use_id);
        if (resultLooksRejected(block)) agg.structure.editsRejected += 1;
        else agg.structure.editsAccepted += 1;
    }
}

/**
 * Scan all transcripts once, bucketed by local day. Returns Map<day, agg>.
 */
function scan(projectsDir) {
    const byDay = new Map();
    const files = walkJsonl(projectsDir);

    for (const file of files) {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        let prevAssistantMs = null;
        const pendingEdits = new Map(); // tool_use_id -> day agg, scoped to this file/session
        // The category of the most recent scored prompt in THIS file, waiting to be
        // credited to whichever model answers it. Cleared once credited so a single
        // prompt is never attributed to two models.
        let pendingPromptType = null;

        for (const line of text.split('\n')) {
            const s = line.trim();
            if (!s) continue;
            let rec;
            try { rec = JSON.parse(s); } catch { continue; }

            const ts = rec.timestamp;
            const day = ts ? localDay(ts) : null;
            const when = ts ? Date.parse(ts) : NaN;

            // Subagent turns. They are Claude talking to itself, not a person
            // prompting — counting them would inflate session size, invent
            // "parallel work" that is really one task, and fill the pace
            // histogram with sub-second machine gaps. Excluded from the SCHEMA 4
            // signals only; the existing counters keep their old behaviour so
            // score and volume trends stay continuous across the upgrade.
            const sidechain = rec.isSidechain === true;

            // Compaction — the context-loss signal. NOTE these are `system`
            // records, a type this loop ignored entirely before schema 4.
            if (rec.type === 'system' && rec.subtype === 'compact_boundary' && day && !sidechain) {
                const agg = byDay.get(day) || byDay.set(day, newDayAgg()).get(day);
                const meta = rec.compactMetadata || {};
                agg.context.compactions += 1;
                if (meta.trigger === 'auto') agg.context.autoCompactions += 1;
                else if (meta.trigger === 'manual') agg.context.manualCompactions += 1;
                const pre = Number(meta.preTokens) || 0;
                const post = Number(meta.postTokens) || 0;
                // Per-event drop. Deliberately NOT meta.cumulativeDroppedTokens:
                // that field is a running total for the session, so summing it
                // across a session's compactions counts the early ones repeatedly.
                if (pre > post) agg.context.droppedTokens += pre - post;
                agg.context.preTokensSum += pre;
                agg.context.compactionMs += Number(meta.durationMs) || 0;
                if (rec.sessionId) agg.compactedSessions.add(rec.sessionId);
                continue;
            }

            if (rec.type === 'user') {
                tallyToolResults(rec, pendingEdits); // accept/reject on prior Edit/Write calls

                const prompt = extractPromptText(rec);
                if (prompt == null || !day) continue;
                const agg = byDay.get(day) || byDay.set(day, newDayAgg()).get(day);
                agg.prompts.total += 1;
                if (rec.sessionId) agg.sessions.add(rec.sessionId);
                if (rec.sessionId && !sidechain && !isNaN(when)) {
                    const span = agg.sessionSpans.get(rec.sessionId)
                        || { first: when, last: when, prompts: 0 };
                    if (when < span.first) span.first = when;
                    if (when > span.last) span.last = when;
                    span.prompts += 1;
                    agg.sessionSpans.set(rec.sessionId, span);
                }
                if (rec.cwd) agg.projects.add(rec.cwd); // counted only; name never leaves
                // Permission mode of this turn (plan / acceptEdits) — a count only, no content.
                if (rec.permissionMode === 'plan') agg.structure.planModeTurns += 1;
                else if (rec.permissionMode === 'acceptEdits') agg.structure.acceptEditsTurns += 1;

                if (ACK_RE.test(prompt)) { agg.prompts.acks += 1; continue; }

                const secs = prevAssistantMs != null && !isNaN(when) ? (when - prevAssistantMs) / 1000 : null;
                const { score, tags } = scorePrompt(prompt, secs);
                agg.prompts.scored += 1;
                agg.scores.sum += score;
                if (score >= THRESHOLDS.good) agg.scores.good += 1;
                else if (score >= THRESHOLDS.ok) agg.scores.ok += 1;
                else agg.scores.poor += 1;
                for (const t of tags) if (t in agg.signals) agg.signals[t] += 1;
                const ptype = classifyPromptType(prompt); // category tally only, never the text
                agg.promptTypes[ptype] += 1;

                if (!sidechain) {
                    // Pace. `secs` is measured from the previous ASSISTANT message and
                    // is reused from the rework heuristic above rather than recomputed.
                    // It matters that this sits here, past the extractPromptText null
                    // check and the ack skip: measured over raw `user` records instead,
                    // the tool_result turns dominate and the whole histogram collapses
                    // into the <10s bucket.
                    if (secs != null && secs >= 0) agg.pace.gapBuckets[gapBucket(secs)] += 1;
                    if (rec.sessionId && !isNaN(when)) {
                        agg.promptTimeline.push({ sid: rec.sessionId, when });
                    }
                    // Hold this category until a model answers it.
                    pendingPromptType = ptype;
                }
            } else if (rec.type === 'assistant') {
                const msg = rec.message || {};
                const usage = msg.usage || {};
                const model = typeof msg.model === 'string' ? msg.model : '';
                if (day && (usage.input_tokens != null || usage.output_tokens != null)) {
                    const agg = byDay.get(day) || byDay.set(day, newDayAgg()).get(day);
                    if (rec.sessionId) agg.sessions.add(rec.sessionId);
                    if (model) {
                        const t = agg.tokensByModel[model] || { input: 0, output: 0, cache_write: 0, cache_read: 0 };
                        t.input += usage.input_tokens || 0;
                        t.output += usage.output_tokens || 0;
                        // ADDENDUM 20 item 2: the flat field today always equals the sum of
                        // the nested ephemeral tiers (verified against real transcripts) —
                        // fall back to that sum only if Anthropic ever stops sending the flat
                        // field, so cache-write tokens never silently drop to 0.
                        const cacheWrite = usage.cache_creation_input_tokens != null
                            ? usage.cache_creation_input_tokens
                            : ((usage.cache_creation && usage.cache_creation.ephemeral_1h_input_tokens) || 0)
                                + ((usage.cache_creation && usage.cache_creation.ephemeral_5m_input_tokens) || 0);
                        t.cache_write += cacheWrite;
                        t.cache_read += usage.cache_read_input_tokens || 0;
                        agg.tokensByModel[model] = t;
                        // Credit the waiting prompt to the model that answered it.
                        // Same MODEL_ID_RE guard buildPayload applies to tokensByModel,
                        // so no unexpected string can become a key here either.
                        if (pendingPromptType && !sidechain && MODEL_ID_RE.test(model)) {
                            const byType = agg.promptTypesByModel[model]
                                || { debugging: 0, codeGen: 0, refactor: 0, review: 0, explain: 0, other: 0 };
                            byType[pendingPromptType] += 1;
                            agg.promptTypesByModel[model] = byType;
                            pendingPromptType = null;
                        }
                    }
                    tallyAssistantStructure(agg, msg, pendingEdits);
                    // Assistant turns extend a session's span too — a long answer at
                    // the end of a session is still time that session was open.
                    if (rec.sessionId && !sidechain && !isNaN(when)) {
                        const span = agg.sessionSpans.get(rec.sessionId);
                        if (span && when > span.last) span.last = when;
                    }
                }
                if (!isNaN(when)) prevAssistantMs = when;
            }
        }
    }
    return byDay;
}

// ---------------------------------------------------------------------------
// Payload — the single privacy seam. ONLY whitelisted numeric fields go out.
// ---------------------------------------------------------------------------
const MODEL_ID_RE = /^[a-z][a-z0-9.\-]{0,40}$/;
const TOOL_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,30}$/;

function buildPayload(day, agg, org) {
    const tokensByModel = {};
    for (const [model, t] of Object.entries(agg.tokensByModel)) {
        if (!MODEL_ID_RE.test(model)) continue; // drop anything unexpected
        tokensByModel[model] = {
            input: t.input | 0,
            output: t.output | 0,
            cache_write: t.cache_write | 0,
            cache_read: t.cache_read | 0,
        };
    }
    const builtinTools = {};
    for (const [name, count] of Object.entries(agg.structure.builtinTools)) {
        if (TOOL_NAME_RE.test(name)) builtinTools[name] = count | 0;
    }
    // SCHEMA 4. The session map and prompt timeline are collapsed to counts HERE
    // and only here — no session id, span or timestamp exists past this point.
    const sizeBuckets = { s1_5: 0, s6_20: 0, s21_100: 0, s100plus: 0 };
    const durationBuckets = { lt15m: 0, m15_60: 0, h1_4: 0, h4plus: 0 };
    for (const span of agg.sessionSpans.values()) {
        sizeBuckets[sessionSizeBucket(span.prompts)] += 1;
        durationBuckets[sessionDurationBucket(Math.max(0, span.last - span.first))] += 1;
    }
    const { maxConcurrent, overlappingSessions } = concurrencyFromSpans(agg.sessionSpans);
    const { switches, switchesUnder5m } = switchesFromTimeline(agg.promptTimeline);
    const promptTypesByModel = {};
    for (const [model, t] of Object.entries(agg.promptTypesByModel)) {
        if (!MODEL_ID_RE.test(model)) continue; // same guard as tokensByModel
        promptTypesByModel[model] = {
            debugging: t.debugging | 0,
            codeGen: t.codeGen | 0,
            refactor: t.refactor | 0,
            review: t.review | 0,
            explain: t.explain | 0,
            other: t.other | 0,
        };
    }
    org = org || { orgUuid: null, orgName: null };
    return {
        schemaVersion: SCHEMA_VERSION,
        day,
        collectorVersion: COLLECTOR_VERSION,
        // Tenancy identity (which customer license) — NOT content. Never tokens/email.
        orgUuid: org.orgUuid || null,
        orgName: org.orgName || null,
        prompts: { total: agg.prompts.total | 0, scored: agg.prompts.scored | 0, acks: agg.prompts.acks | 0 },
        scores: { good: agg.scores.good | 0, ok: agg.scores.ok | 0, poor: agg.scores.poor | 0, sum: agg.scores.sum | 0 },
        signals: {
            no_context: agg.signals.no_context | 0,
            vague: agg.signals.vague | 0,
            rework: agg.signals.rework | 0,
            unclear_referent: agg.signals.unclear_referent | 0,
            very_short: agg.signals.very_short | 0,
            short: agg.signals.short | 0,
        },
        tokensByModel,
        activity: { sessions: agg.sessions.size | 0, distinctProjects: agg.projects.size | 0 },
        structure: {
            skillInvocations: agg.structure.skillInvocations | 0,
            mcpCalls: agg.structure.mcpCalls | 0,
            builtinTools,
            freeTextTurns: agg.structure.freeTextTurns | 0,
            toolAssistedTurns: agg.structure.toolAssistedTurns | 0,
            planModeTurns: agg.structure.planModeTurns | 0,
            acceptEditsTurns: agg.structure.acceptEditsTurns | 0,
            editsAccepted: agg.structure.editsAccepted | 0,
            editsRejected: agg.structure.editsRejected | 0,
            // A COUNT of distinct MCP servers used — never their names (agg.mcpServers is local-only).
            distinctMcpServers: agg.mcpServers.size | 0,
        },
        promptTypes: {
            debugging: agg.promptTypes.debugging | 0,
            codeGen: agg.promptTypes.codeGen | 0,
            refactor: agg.promptTypes.refactor | 0,
            review: agg.promptTypes.review | 0,
            explain: agg.promptTypes.explain | 0,
            other: agg.promptTypes.other | 0,
        },
        // ---- SCHEMA 4 efficiency signals (counts and bucket tallies only) ----
        context: {
            compactions: agg.context.compactions | 0,
            autoCompactions: agg.context.autoCompactions | 0,
            manualCompactions: agg.context.manualCompactions | 0,
            droppedTokens: agg.context.droppedTokens | 0,
            preTokensSum: agg.context.preTokensSum | 0,
            compactionMs: agg.context.compactionMs | 0,
            sessionsCompacted: agg.compactedSessions.size | 0,
        },
        sessionShape: { sizeBuckets, durationBuckets },
        concurrency: {
            maxConcurrent: maxConcurrent | 0,
            overlappingSessions: overlappingSessions | 0,
            switches: switches | 0,
            switchesUnder5m: switchesUnder5m | 0,
        },
        pace: {
            gapBuckets: {
                lt10s: agg.pace.gapBuckets.lt10s | 0,
                s10_60: agg.pace.gapBuckets.s10_60 | 0,
                m1_5: agg.pace.gapBuckets.m1_5 | 0,
                m5_30: agg.pace.gapBuckets.m5_30 | 0,
                gt30m: agg.pace.gapBuckets.gt30m | 0,
            },
        },
        promptTypesByModel,
        // How this machine is triggered, so Lens can tell "no schedule installed"
        // apart from "took the day off" — two states that otherwise look identical
        // (a missing row) and once hid a fleet-wide scheduling gap for weeks.
        agent: agentHealth(),
    };
}

/**
 * Which trigger is actually live on this machine, read from the OS rather than
 * assumed. Numbers/enums only — no paths, no hostnames, no user identity.
 */
function agentHealth() {
    let tier = 'hook';
    try {
        if (process.platform === 'darwin') {
            const label = 'com.lens.claude-usage-collector';
            const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
            const out = cp.execFileSync('launchctl', ['list'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            // Loaded is not enough: a job left by an install in a different folder
            // keeps the same label while pointing at a path with no config, and
            // fails daily. Only count it if it points at THIS collector.
            const ours = fs.readFileSync(plist, 'utf8').includes(__filename);
            tier = (out.includes(label) && ours) ? 'scheduler' : 'hook';
        } else if (process.platform === 'win32') {
            const xml = cp.execFileSync('schtasks', ['/Query', '/TN', 'LensClaudeUsageCollector', '/XML'],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\0/g, '');
            tier = /<StartWhenAvailable>\s*true/i.test(xml) ? 'scheduler' : 'startup';
        }
    } catch {
        // No scheduler registered (or the query is blocked) — the hook is all there is.
        if (process.platform === 'win32') {
            const bat = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows',
                'Start Menu', 'Programs', 'Startup', 'claude-usage-collector.bat');
            tier = fs.existsSync(bat) ? 'startup' : 'hook';
        }
    }
    return {
        triggerTier: tier,
        platform: process.platform,
        collectorVersion: COLLECTOR_VERSION,
        // How many runs in a row were suppressed by the VPN gate. Reported only
        // once a send finally succeeds — by definition nothing leaves the machine
        // while the gate is closed — so Lens can tell "quiet because they were on
        // a VPN all fortnight" from "quiet because the agent is broken". An
        // integer, like everything else here: no reason string, no interface name.
        vpnDeferrals: readDeferrals(),
        // Stamped at send time by gateState(), not here — see the send loop. The
        // gate has to be evaluated as late as possible to be accurate, which is
        // after this block is built.
        vpnGate: 'enforced',
    };
}

/**
 * How the VPN gate behaved on the run that is actually transmitting.
 *
 * Lens cannot see a machine's network, so it has no way to catch a report that
 * slipped through a failed check. This is the collector declaring its own state so
 * the server can flag the two bypasses that ARE knowable — the gate switched off,
 * and the gate waved a send through without being able to verify. It is an audit
 * trail rather than a prevention, and it is deliberately an enum: no interface
 * names, no addresses, nothing about the machine.
 *
 *   enforced                   - ran, and confidently found no VPN
 *   disabled                   - skipOnVpn:false, the gate did not run at all
 *   allowed-after-failed-check - a check could not run, so this sent WITHOUT
 *                                knowing whether a VPN was up (vpn.js reason
 *                                'unverified' — see its module header for why
 *                                this is the default now, not an opt-in)
 *
 * This reads straight off detectVpn's own verdict — vpn.js already tells us
 * which of these happened, so there is nothing left to re-derive here.
 */
function gateState(cfg, verdict) {
    if (cfg && cfg.skipOnVpn === false) return 'disabled';
    if (verdict && verdict.reason === 'unverified') return 'allowed-after-failed-check';
    return 'enforced';
}

// Count of consecutive VPN-suppressed runs. Local until a send succeeds.
function readDeferrals() {
    try { return Math.max(0, parseInt(fs.readFileSync(DEFERRALS_PATH, 'utf8'), 10) || 0); } catch { return 0; }
}
function writeDeferrals(n) {
    try {
        if (n > 0) fs.writeFileSync(DEFERRALS_PATH, String(n));
        else fs.unlinkSync(DEFERRALS_PATH);
    } catch { /* best effort — the counter is diagnostic, never load-bearing */ }
}

// Saturday/Sunday, per the machine's own calendar (same basis as localDay).
function isWeekend(dayKey) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const wd = new Date(y, m - 1, d).getDay();
    return wd === 0 || wd === 6;
}

// ---------------------------------------------------------------------------
// Config, outbox, HTTP push
// ---------------------------------------------------------------------------
function loadConfig() {
    try {
        const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        return cfg;
    } catch {
        return null;
    }
}

function loadOutbox() {
    try { return JSON.parse(fs.readFileSync(OUTBOX_PATH, 'utf8')); } catch { return []; }
}
function saveOutbox(items) {
    try { fs.writeFileSync(OUTBOX_PATH, JSON.stringify(items, null, 2)); } catch { /* ignore */ }
}

function postJson(baseUrl, token, payload) {
    return new Promise((resolve) => {
        let u;
        try { u = new URL('/api/ingest/claude-usage', baseUrl); } catch {
            return resolve({ ok: false, status: 0, error: 'bad-url' });
        }
        const body = Buffer.from(JSON.stringify(payload));
        const lib = u.protocol === 'https:' ? https : http;
        const req = lib.request(
            u,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': body.length,
                    Authorization: `Bearer ${token}`,
                },
                timeout: 15000,
            },
            (res) => {
                let body = '';
                res.on('data', (c) => { if (body.length < 2000) body += c; });
                res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }));
            },
        );
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
        req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message }));
        req.write(body);
        req.end();
    });
}

const UNINSTALL_NOTICE = [
    '',
    'Your Lens ingest token was rejected (disabled or revoked).',
    'The collector has stopped sending data. To fully remove it:',
    os.platform() === 'win32'
        ? '  Run: uninstall-windows.ps1  (removes the scheduled task + files)'
        : '  Run: ./uninstall-mac.sh     (unloads the launchd agent + files)',
    'You can re-enable anytime from Lens > My Claude Report.',
    '',
].join('\n');

// ---------------------------------------------------------------------------
// Network lock
// ---------------------------------------------------------------------------

/**
 * Physically prevent this process from reaching the network until the VPN gate
 * has passed.
 *
 * WHY THIS EXISTS. The guarantee — nothing leaves the machine while a VPN is up —
 * otherwise rests on nothing above the gate in main() happening to touch the
 * network. That is a POSITIONAL invariant: true only because of the current order
 * of the lines, enforced by a comment, and quietly broken by ordinary maintenance.
 * The realistic failure is someone later adding a plausible line near the top of
 * main() — a version check, a heartbeat, a token refresh. Every test still passes
 * and the collector still refuses to send reports, but resolving the Lens hostname
 * has now emitted a DNS query from inside a customer network. No error, no flag,
 * nothing wrong-looking in review. That is precisely the thing we are preventing.
 *
 * So the ordering is made irrelevant instead. Name resolution and socket connects
 * are replaced with functions that throw until release() is called, which happens
 * only once the gate has cleared. A future network call in the wrong place now
 * fails loudly on the developer's own machine rather than leaking silently.
 *
 * LIMIT, stated honestly: this covers Node's own networking. Code that shells out
 * (curl, PowerShell) would bypass it — nothing here does, and nothing should.
 */
function installNetworkLock() {
    const dns = require('dns');
    const net = require('net');
    const blocked = () => {
        const e = new Error(
            'Network access attempted before the VPN check. Nothing may contact the '
            + 'network until detectVpn() has run and passed — see the gate in main().',
        );
        e.code = 'ECOLLECTORGATE';
        throw e;
    };

    const saved = { lookup: dns.lookup, connect: net.Socket.prototype.connect, resolvers: {} };
    dns.lookup = blocked;
    net.Socket.prototype.connect = blocked;
    for (const m of ['resolve', 'resolve4', 'resolve6']) {
        saved.resolvers[m] = dns[m];
        dns[m] = blocked;
    }

    let released = false;
    return {
        release() {
            if (released) return;
            released = true;
            dns.lookup = saved.lookup;
            net.Socket.prototype.connect = saved.connect;
            for (const [m, fn] of Object.entries(saved.resolvers)) dns[m] = fn;
        },
    };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    // Locked before anything else runs. Released only after the gate passes.
    const netLock = installNetworkLock();
    const args = process.argv.slice(2);
    const has = (f) => args.includes(f);
    const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

    const dryRun = has('--dry-run');
    const doLocalDashboard = has('--local-dashboard');
    const onlyDate = val('--date');
    const days = parseInt(val('--days') || '2', 10);
    // Weekday-only reporting. Set by the scheduled run; weekend work stays local.
    const skipWeekends = has('--skip-weekends');
    // Skip if we already ran within this many hours (used by the hook / login-item
    // paths so frequent triggers don't spam). Ingest is idempotent regardless.
    const throttleHours = parseFloat(val('--throttle') || '0');
    // SessionStart hook mode: gate on a separate, config-driven interval (seconds),
    // independent of --throttle above so the two hooks never interfere with each
    // other. The interval is a plain config.json field (not a CLI arg) specifically
    // so it can be tuned for testing (e.g. 900 for 15 min) without touching the
    // installed hook command or re-running setup.js — default 86400 (1 day).
    const sessionStart = has('--session-start');

    const cfg = loadConfig();

    // Read-only self-diagnosis: print the VPN verdict and exit. This is the answer
    // to "why has my data stopped appearing in Lens". There is deliberately no flag
    // that forces the verdict the other way — that would be a quiet way to defeat
    // the whole gate.
    if (has('--vpn-check')) {
        const v = detectVpn(cfg || {});
        console.log(`VPN: ${v.onVpn ? 'yes' : 'no'} (${v.reason})`);
        console.log(v.onVpn ? 'Nothing will be sent while this is the case.' : 'Sending is allowed.');
        return;
    }
    if (!cfg && !dryRun) {
        console.error(`No config.json found at ${CONFIG_PATH}. Run "node setup.js --token <t> --url <u>" first.`);
        process.exit(1);
    }
    if (cfg && cfg.enabled === false && !dryRun) {
        console.log('Collector is disabled in config.json (enabled=false). Nothing to do.');
        return;
    }

    // Which Claude config dir to read (default ~/.claude). A dedicated dir is how
    // teams isolate the customer license from a personal Claude Code account.
    const configDir = cfg && cfg.claudeConfigDir ? expandHome(cfg.claudeConfigDir) : DEFAULT_CLAUDE_DIR;
    const projectsDir = path.join(configDir, 'projects');

    // Current customer org (from the config dir's .claude.json). Local self-gate:
    // if an expected org is configured and the current login differs, do nothing.
    const org = readOrgIdentity(configDir);
    if (cfg && cfg.expectedOrgUuid && org.orgUuid !== cfg.expectedOrgUuid && !dryRun) {
        console.log(`Current Claude org (${org.orgUuid || 'none'}) is not the expected customer license — skipping.`);
        return;
    }

    const lastRunPath = path.join(HERE, '.last-run');
    // NOTE the stamp is READ here but WRITTEN at the very end, and that split is
    // load-bearing. Stamping up front would mean a run suppressed by the VPN gate
    // burned the full throttle window, leaving the machine silent for hours after
    // the tunnel dropped — turning a short deferral into a lost day.
    const throttleActive = throttleHours > 0 && !dryRun && !onlyDate;
    if (throttleActive) {
        try {
            const t = parseInt(fs.readFileSync(lastRunPath, 'utf8'), 10);
            if (t && Date.now() - t < throttleHours * 3600 * 1000) {
                console.log(`Throttled: ran within the last ${throttleHours}h, skipping.`);
                return;
            }
        } catch { /* no prior run */ }
    }

    // SessionStart gate — own stamp file, own interval, checked (and updated) only
    // on success further below so a failed run doesn't falsely mark the interval met.
    const sessionStartStampPath = path.join(HERE, '.last-session-start-push');
    const sessionStartIntervalMs = (cfg && Number(cfg.sessionStartIntervalSeconds) > 0
        ? Number(cfg.sessionStartIntervalSeconds) : 86400) * 1000;
    if (sessionStart && !dryRun && !onlyDate) {
        try {
            const t = parseInt(fs.readFileSync(sessionStartStampPath, 'utf8'), 10);
            const elapsedMs = t ? Date.now() - t : Infinity;
            if (t && elapsedMs < sessionStartIntervalMs) {
                console.log(`SessionStart: last push ${Math.round(elapsedMs / 1000)}s ago, interval is ${Math.round(sessionStartIntervalMs / 1000)}s — skipping.`);
                return;
            }
        } catch { /* no prior push recorded */ }
    }

    const byDay = scan(projectsDir);

    // Which days to push: an explicit --date, else the most recent `days`.
    //
    // NOTE the weekend filter runs BEFORE the last-N slice, and that ordering is
    // load-bearing. These are the most recent *active* days, not calendar days, so
    // filtering afterwards would let Sat+Sun consume the window: someone who worked
    // Fri/Sat/Sun would push [Sat, Sun, Mon] on Monday and Friday would never be
    // sent at all. Filtering first yields [Thu, Fri, Mon].
    let targetDays;
    if (onlyDate) targetDays = [onlyDate];
    else {
        let candidates = [...byDay.keys()].sort();
        if (skipWeekends) candidates = candidates.filter((d) => !isWeekend(d));
        targetDays = candidates.slice(-Math.max(1, days));
    }

    const payloads = targetDays
        .filter((d) => byDay.has(d))
        .map((d) => buildPayload(d, byDay.get(d), org));

    if (doLocalDashboard) writeLocalDashboard(byDay); // examples/text stay local only

    if (dryRun) {
        console.log(JSON.stringify(payloads, null, 2));
        console.log(`\n[dry-run] ${payloads.length} day(s) computed; nothing sent.`);
        return;
    }

    // Retry the outbox first, then today's payloads.
    const outbox = loadOutbox();
    const queue = [...outbox, ...payloads];

    // ---- THE VPN GATE ----------------------------------------------------
    // Nothing above this line may touch the network. That is not left to the
    // reader to respect: installNetworkLock() at the top of main() makes name
    // resolution and socket connects throw until the line below releases them,
    // so a network call added above here fails loudly instead of leaking a DNS
    // query from inside a customer network. See installNetworkLock for why.
    const vpn = detectVpn(cfg || {});
    if (vpn.onVpn) {
        saveOutbox(trimOutbox(queue));
        const n = readDeferrals() + 1;
        writeDeferrals(n);
        console.log(`VPN detected (${vpn.reason}) — nothing sent. ${queue.length} day(s) queued.`);
        console.log('These will be sent automatically the next time the collector runs off VPN.');
        return;
    }
    // ----------------------------------------------------------------------

    // Declare how the gate behaved on THIS run, onto every payload about to go —
    // including days queued by earlier runs, since this is the run transmitting
    // them. Lets Lens flag a report that was sent without the gate enforcing.
    const gate = gateState(cfg, vpn);
    for (const p of queue) {
        if (p && p.agent) p.agent.vpnGate = gate;
    }

    // The gate has cleared: this is the only place the network is unlocked, and
    // the only code allowed to reach it is what follows.
    netLock.release();

    const stillPending = [];
    let stopped = false;
    let anyPushed = false;

    for (const payload of queue) {
        if (stopped) { stillPending.push(payload); continue; }
        const r = await postJson(cfg.lensBaseUrl, cfg.ingestToken, payload);
        if (r.ok) {
            console.log(`pushed ${payload.day}`);
            anyPushed = true;
        } else if (r.status === 401) {
            console.error(UNINSTALL_NOTICE);
            stopped = true;
            stillPending.push(payload);
        } else if (r.status === 403) {
            let code = '';
            try { code = (JSON.parse(r.body || '{}').error) || ''; } catch { /* non-json */ }
            if (code === 'org-not-monitored') {
                console.error('Your Claude organization is not enabled for monitoring yet. Ask an admin to enable it in Lens > Admin > Monitored Orgs (it appears there as "pending" now), then re-run.');
            } else if (code === 'org-required') {
                console.error('No Claude organization detected — sign into Claude Code with the customer license, then re-run.');
            } else {
                console.error('Consent required — open Lens > My Claude Report and consent. Not sending until then.');
            }
            stopped = true;
            stillPending.push(payload);
        } else if (r.status === 426) {
            // Fleet-wide minimum version enforcement (ADDENDUM 22). Unlike 401/403
            // this is fixable from THIS machine — re-running the installer is the
            // whole remedy — so say that plainly rather than pointing at Lens.
            // stopped=true so this doesn't spam-retry with a version that can only
            // ever fail the same way; the day stays queued and sends automatically
            // once the machine is updated.
            let msg = 'Your collector is below the version required by your organization.';
            try { msg = JSON.parse(r.body || '{}').message || msg; } catch { /* non-json */ }
            console.error(`${msg} Re-run the installer to update — see Lens > My Claude Report > How it works & consent.`);
            stopped = true;
            stillPending.push(payload);
        } else if (r.status === 429) {
            // Lens already holds this day and is declining a duplicate. That is a
            // finished state, not a transient failure — re-queueing it means
            // re-offering the same day on every run for ever, which is what filled
            // outboxes with days that were never actually missing.
            //
            // Safe to drop for both kinds of day: a past day is final, and today's
            // payload is recomputed from the local transcripts on every run, so it
            // does not depend on the outbox to survive.
            console.log(`already recorded in Lens: ${payload.day} — not resending`);
            // Counts as reaching the server: the VPN streak is genuinely over, and
            // the SessionStart interval should be honoured rather than retried at
            // once, since there is nothing outstanding to deliver.
            anyPushed = true;
        } else {
            console.error(`failed ${payload.day} (status ${r.status}${r.error ? ', ' + r.error : ''}) — will retry next run`);
            stillPending.push(payload);
        }
    }

    saveOutbox(trimOutbox(stillPending));

    // A successful send means the gate is open again, so the deferral streak ends.
    if (anyPushed) writeDeferrals(0);

    // Only mark the SessionStart interval as satisfied if a push actually succeeded —
    // a transient network failure or auth error should NOT make the next SessionStart
    // wait a full interval before retrying.
    if (sessionStart && anyPushed) {
        try { fs.writeFileSync(sessionStartStampPath, String(Date.now())); } catch { /* ignore */ }
    }

    // Throttle stamp goes here, not up front — see the note where it is read. A run
    // that reached this point genuinely attempted to send.
    if (throttleActive) {
        try { fs.writeFileSync(lastRunPath, String(Date.now())); } catch { /* ignore */ }
    }
}

/**
 * Bound the outbox, keeping the most recent unsent days.
 *
 * 90 rather than the original 30: someone who is on a customer VPN most working
 * days accumulates deferrals faster than they get chances to send, and these
 * entries are a few hundred bytes each.
 */
function trimOutbox(items) {
    const dedup = new Map();
    for (const p of items) dedup.set(p.day, p);
    return [...dedup.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-90);
}

// Optional local-only dashboard (examples stay on the machine, never uploaded).
function writeLocalDashboard(byDay) {
    const days = [...byDay.keys()].sort();
    const rows = days.map((d) => {
        const a = byDay.get(d);
        const avg = a.prompts.scored ? Math.round(a.scores.sum / a.prompts.scored) : 0;
        return `<tr><td>${d}</td><td>${a.prompts.total}</td><td>${avg}</td><td>${a.scores.good}/${a.scores.ok}/${a.scores.poor}</td></tr>`;
    }).join('');
    const html = `<!doctype html><meta charset=utf-8><title>Claude Usage (local)</title>
<style>body{font:15px system-ui;margin:40px;max-width:720px}table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}</style>
<h1>Claude Usage — local</h1><p>This file stays on your machine. Only numbers are sent to Lens.</p>
<table><thead><tr><th>Day</th><th>Prompts</th><th>Avg score</th><th>Good/OK/Poor</th></tr></thead><tbody>${rows}</tbody></table>`;
    try { fs.writeFileSync(path.join(HERE, 'dashboard.html'), html); } catch { /* ignore */ }
}

// Exported for tests (privacy assertion runs against buildPayload).
module.exports = { buildPayload, scorePrompt, extractPromptText, classifyPromptType, ACK_RE };

// Only run the agent when invoked directly (so `require()` in tests is side-effect free).
if (require.main === module) {
    main().catch((e) => { console.error('collector error:', e); process.exit(1); });
}
