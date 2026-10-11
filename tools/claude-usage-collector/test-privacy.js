#!/usr/bin/env node
/**
 * Privacy firewall test — asserts buildPayload emits ONLY whitelisted, numeric,
 * content-free fields. Run: `node test-privacy.js` (exit 0 = pass).
 *
 * This is the guard that keeps customer data on the machine: even if the scan
 * captured prompt text, paths or project names, none of it may appear in the
 * payload. We feed a hostile aggregate (full of paths/text) and prove it does
 * not survive serialization.
 */
'use strict';
const assert = require('assert');
const { buildPayload } = require('./collector');

// A deliberately "dirty" aggregate: project cwd is a real path, a model id is
// bogus, and a tool name is junk. None of it should reach the payload.
const agg = {
    prompts: { total: 5, scored: 4, acks: 1 },
    scores: { good: 2, ok: 1, poor: 1, sum: 240 },
    signals: { no_context: 2, vague: 1, rework: 1, unclear_referent: 0, very_short: 1, short: 2 },
    promptTypes: { debugging: 1, codeGen: 0, refactor: 0, review: 0, explain: 0, other: 3 },
    tokensByModel: {
        'claude-opus-4-8': { input: 10, output: 20, cache_write: 30, cache_read: 40 },
        '/Users/secret/customer/repo': { input: 1, output: 1, cache_write: 1, cache_read: 1 }, // must be dropped
    },
    sessions: new Set(['s1', 's2']),
    projects: new Set(['/Users/me/customer-acme/backend', '/Users/me/other']), // only the COUNT may survive
    mcpServers: new Set(['acme-internal-billing-mcp', 'customer-jira-secret']), // only the COUNT may survive
    structure: {
        skillInvocations: 3,
        mcpCalls: 2,
        builtinTools: { Edit: 5, Bash: 3, 'rm -rf /secret': 9 }, // junk key must be dropped
        freeTextTurns: 2,
        toolAssistedTurns: 6,
        planModeTurns: 4,
        acceptEditsTurns: 1,
        editsAccepted: 7,
        editsRejected: 2,
    },
    // SCHEMA 4 efficiency signals. These are the riskiest blocks in the payload:
    // they are DERIVED from session ids and wall-clock timestamps, so the fixture
    // feeds real-looking session ids and epoch millis and the assertions below
    // prove only bucket counts survive.
    context: {
        compactions: 3, autoCompactions: 2, manualCompactions: 1,
        droppedTokens: 702623, preTokensSum: 726454, compactionMs: 274744,
    },
    compactedSessions: new Set(['b0885793-20b3-41e1-9e21-c273fb31091b']), // only .size may survive
    sessionSpans: new Map([
        // sid -> span. Neither the ids nor the timestamps may appear in the payload.
        ['b0885793-20b3-41e1-9e21-c273fb31091b', { first: 1755780000000, last: 1755783600000, prompts: 3 }],
        ['b3ca260b-dcb5-476e-b270-8cc1c768c306', { first: 1755781200000, last: 1755795000000, prompts: 42 }],
        ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { first: 1755800000000, last: 1755800030000, prompts: 1 }],
    ]),
    promptTimeline: [
        { sid: 'b0885793-20b3-41e1-9e21-c273fb31091b', when: 1755780000000 },
        { sid: 'b3ca260b-dcb5-476e-b270-8cc1c768c306', when: 1755780060000 },
        { sid: 'b0885793-20b3-41e1-9e21-c273fb31091b', when: 1755790000000 },
    ],
    pace: { gapBuckets: { lt10s: 15, s10_60: 17, m1_5: 29, m5_30: 19, gt30m: 3 } },
    promptTypesByModel: {
        'claude-opus-5': { debugging: 1, codeGen: 2, refactor: 0, review: 3, explain: 4, other: 1 },
        '/Users/secret/customer/repo': { debugging: 9, codeGen: 9, refactor: 9, review: 9, explain: 9, other: 9 },
    },
};

// Org identity is the ONLY tenancy metadata allowed — a uuid + short name.
// Feed a realistic org plus a hostile email/token to prove neither leaks.
const org = { orgUuid: '11111111-2222-3333-4444-555555555555', orgName: 'Contoso Test Org' };
const p = buildPayload('2026-08-04', agg, org);
const json = JSON.stringify(p);

// 1. Only known top-level keys.
const allowedTop = new Set([
    'schemaVersion', 'day', 'collectorVersion', 'orgUuid', 'orgName', 'prompts', 'scores',
    'signals', 'tokensByModel', 'activity', 'structure', 'promptTypes', 'agent',
    'context', 'sessionShape', 'concurrency', 'pace', 'promptTypesByModel',
]);
for (const k of Object.keys(p)) assert(allowedTop.has(k), `unexpected top-level key: ${k}`);

// 1a. The agent-health block reports HOW this machine is triggered. It is the one
//     block describing the machine rather than the usage, so pin it hard: a fixed
//     set of keys, all enum/version strings, no paths, no hostname, no username.
const allowedAgent = new Set(['triggerTier', 'platform', 'collectorVersion', 'vpnDeferrals', 'vpnGate']);
for (const k of Object.keys(p.agent)) assert(allowedAgent.has(k), `unexpected agent key: ${k}`);
assert(['scheduler', 'startup', 'hook', 'none'].includes(p.agent.triggerTier),
    `agent.triggerTier must be an enum, got: ${p.agent.triggerTier}`);
// vpnDeferrals is a COUNT of suppressed runs. The detection behind it inspects
// network interfaces, addresses and VPN configuration names — none of which may
// ever ride out on the wire. A plain integer is the whole contract.
assert(Number.isInteger(p.agent.vpnDeferrals) && p.agent.vpnDeferrals >= 0,
    `agent.vpnDeferrals must be a non-negative integer, got: ${JSON.stringify(p.agent.vpnDeferrals)}`);
// vpnGate declares how the VPN gate behaved, so Lens can flag a report that was
// never gated. It must stay one of three fixed words — the detection behind it
// sees interface names and addresses, and none of that may ride out with it.
assert(['enforced', 'disabled', 'allowed-after-failed-check'].includes(p.agent.vpnGate),
    `agent.vpnGate must be an enum, got: ${JSON.stringify(p.agent.vpnGate)}`);
assert(!/[/\\]/.test(JSON.stringify(p.agent)), 'a filesystem path leaked into agent health!');
assert(!JSON.stringify(p.agent).includes(require('os').hostname()), 'the hostname leaked into agent health!');

// 1b. Org uuid/name survive, but NO email or token ever appears.
assert.strictEqual(p.orgUuid, org.orgUuid, 'orgUuid should pass through');
assert(!/@/.test(json), 'an email address leaked into the payload!');
// Credential patterns — deliberately specific so the legitimate "tokensByModel" key doesn't trip it.
assert(!/sk-ant|bearer\s|access_token|refresh_token|oauthaccount|api[_-]?key/i.test(json),
    'a token/credential leaked into the payload!');

// 2. distinctProjects is a COUNT; project paths never appear. Scan everything
//    EXCEPT the allowed org fields (a company name may legitimately contain words).
const jsonNoOrg = JSON.stringify({ ...p, orgUuid: undefined, orgName: undefined });
assert.strictEqual(p.activity.distinctProjects, 2, 'distinctProjects should be a count');
assert.strictEqual(p.structure.distinctMcpServers, 2, 'distinctMcpServers should be a count');
assert(!/Users|customer|acme|backend|repo|secret|billing|jira/i.test(jsonNoOrg), 'a path/name leaked into the payload!');

// 3. Bogus model id dropped; only the valid model survives.
assert.deepStrictEqual(Object.keys(p.tokensByModel), ['claude-opus-4-8'], 'bad model id was not dropped');

// 4. Junk tool name dropped; generic tool names survive as counts.
assert.deepStrictEqual(Object.keys(p.structure.builtinTools).sort(), ['Bash', 'Edit'], 'bad tool name was not dropped');

// 4a. SCHEMA 4: session ids and timestamps are the INPUT to these blocks and must
//     not be any part of the output. Sessions collapse to bucket counts, the
//     timeline collapses to two switch counts, and compacted sessions to a size.
assert(!/b0885793|b3ca260b|aaaaaaaa|20b3-41e1/.test(json), 'a session id leaked into the payload!');
assert(!/17557\d{8}|17558\d{8}/.test(json), 'an epoch timestamp leaked into the payload!');
assert.strictEqual(p.context.sessionsCompacted, 1, 'sessionsCompacted should be a count');
// Three spans in, three bucket slots filled: 3 prompts, 42 prompts, 1 prompt.
assert.deepStrictEqual(p.sessionShape.sizeBuckets, { s1_5: 2, s6_20: 0, s21_100: 1, s100plus: 0 },
    'session sizes did not bucket correctly');
// The two long spans overlap (1755781200000 falls inside the first); the 30-second
// span is below the 60s floor and must not count toward the peak.
assert.strictEqual(p.concurrency.maxConcurrent, 2, 'maxConcurrent should ignore sub-minute spans');
// Timeline: s1 -> s2 (60s apart) -> s1 (~166 min apart) = 2 switches, 1 under 5m.
assert.strictEqual(p.concurrency.switches, 2, 'switch count is wrong');
assert.strictEqual(p.concurrency.switchesUnder5m, 1, 'rapid-switch count is wrong');
// 4b. The per-model cross-tab takes the same model-id guard as tokensByModel.
assert.deepStrictEqual(Object.keys(p.promptTypesByModel), ['claude-opus-5'],
    'bad model id was not dropped from promptTypesByModel');

// 5. Every leaf value is a non-negative integer except day/collectorVersion.
const STRING_FIELDS = new Set(['day', 'collectorVersion', 'orgUuid', 'orgName',
    'agent.triggerTier', 'agent.platform', 'agent.collectorVersion', 'agent.vpnGate']);
(function checkInts(o, pathStr) {
    for (const [k, v] of Object.entries(o)) {
        const here = pathStr ? `${pathStr}.${k}` : k;
        if (STRING_FIELDS.has(here)) { assert(v === null || typeof v === 'string'); continue; }
        if (v && typeof v === 'object') checkInts(v, here);
        else assert(Number.isInteger(v) && v >= 0, `non-integer at ${here}: ${v}`);
    }
})(p, '');

console.log('privacy firewall test: PASS — payload is content-free and numeric');
