/**
 * READ-ONLY A/B verification of the Jira field-allowlist policy.
 *
 * Fetches the SAME board twice, seconds apart:
 *   RAW     — fields=*all via jira.client, bypassing applyFieldPolicy, unsanitized
 *   POLICED — the normal getAllIssuesFromUrl path (allowlist + sanitize + redact)
 * then runs the real production derivation logic over BOTH sets and diffs.
 *
 * Because both legs hit Jira at the same moment, any difference is caused by the
 * field policy and nothing else — unlike a report resync, which rebuilds a past
 * date from Jira's CURRENT state and is confounded by ticket drift.
 *
 * Performs NO database writes, no report generation and no AI calls.
 *
 *   cd backend && npm run build
 *   node scripts/verify-field-policy-parity.js --codes LS,LOSAI,EXP --drift-check --verbose
 *
 * Exit: 0 = all checks passed, 1 = differences/inconclusive, 2 = infra error.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');

const sequelize = require('../dist/config/connection').default;
const { Project } = require('../dist/models/Project');
const { JiraService } = require('../dist/modules/jira/services/jiraService');
const { reportService } = require('../dist/modules/reports/services/reportService');
const jiraFields = require('../dist/modules/jira/services/jiraFields');
const { redactPii, redactPiiDetailed } = require('../dist/common/utils/piiRedactor');
const { resolveEstimateFields, extractEstimate } = require('../dist/modules/reports/services/estimateExtraction');
const { getLaneConfig, getStatusesForRole } = require('../dist/common/laneDefaults');

// ---------------------------------------------------------------- CLI + output

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const flag = (n) => argv.includes(`--${n}`);

const VERBOSE = flag('verbose') || flag('v');
const DRIFT_CHECK = flag('drift-check');
const JSON_PATH = arg('json');
const MAX_ISSUES = parseInt(arg('maxIssues', '2000'), 10);

const C = {
    reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m',
    yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m',
};
const color = (c, s) => `${C[c]}${s}${C.reset}`;
const PASS = color('green', 'PASS');
const FAIL = color('red', 'FAIL');
const INCONCLUSIVE = color('yellow', 'INCONCLUSIVE');

// ------------------------------------------------------------- startup guards

function assertFreshBuild() {
    const missing = ['redactIssueTitles', 'BASE_ISSUE_FIELDS', 'FALLBACK_CUSTOM_FIELDS', 'sanitizeIssues']
        .filter(n => jiraFields[n] === undefined);
    if (missing.length) {
        console.error(color('red',
            `dist/ is stale — jiraFields is missing: ${missing.join(', ')}.\n` +
            `Run:  cd backend && npm run build   (on the privacy/jira-pii-phase1 branch)`));
        process.exit(2);
    }
    if (typeof JiraService.forProject !== 'function') {
        console.error(color('red', 'dist/ is stale — JiraService.forProject is missing. Run npm run build.'));
        process.exit(2);
    }
}

// -------------------------------------------------------------- source index
// Used to decide whether a field dropped by the allowlist is actually READ
// anywhere in the backend. Evidence beats assertion.

function buildSourceIndex(srcDir) {
    const chunks = [];
    (function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (e.name === 'node_modules' || e.name === '__tests__') continue;
                walk(p);
            } else if (e.name.endsWith('.ts')) {
                try { chunks.push(fs.readFileSync(p, 'utf8')); } catch { /* skip */ }
            }
        }
    })(srcDir);
    const text = chunks.join('\n');
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
        // A bare substring match is far too loose: words like "sprint", "flagged",
        // "epic" and "progress" appear throughout source prose and prompt strings,
        // which produced 11 false positives on the first run. Require an actual
        // field-ACCESS pattern, or the id as a quoted literal.
        referencesId: (id) => {
            const e = esc(id);
            if (new RegExp(`fields\\s*\\.\\s*${e}\\b`).test(text)) return true;
            if (new RegExp(`fields\\s*\\[\\s*['"\`]${e}['"\`]\\s*\\]`).test(text)) return true;
            // A bare quoted literal only counts for customfield_NNNNN ids, which are
            // unambiguous. Generic names like 'sprint' or 'flagged' appear as quoted
            // enum values ('sprint' is a workMode) and would false-positive.
            if (/^customfield_\d+$/.test(id)) return new RegExp(`['"\`]${e}['"\`]`).test(text);
            return false;
        },
        // A display name only counts when it is used to RESOLVE a field id — i.e.
        // passed to getFieldIdByName(), or listed in jiraFields' DYNAMIC_FIELD_NAMES.
        // Matching any quoted occurrence is far too loose: "Notes" is an Excel
        // column header in excelGenerator.ts and would flag customfield_10248.
        referencesName: (name) => {
            if (!name) return false;
            const e = esc(name);
            if (new RegExp(`getFieldIdByName\\(\\s*['"\`]${e}['"\`]`).test(text)) return true;
            return resolverNames.has(String(name).toLowerCase());
        },
    };
}

/** Names listed in jiraFields' DYNAMIC_FIELD_NAMES — the fields we deliberately resolve. */
function readResolverNames(jiraFieldsPath) {
    const set = new Set();
    try {
        const src = fs.readFileSync(jiraFieldsPath, 'utf8');
        const block = src.match(/DYNAMIC_FIELD_NAMES[^=]*=\s*\[([\s\S]*?)\]/);
        if (block) {
            for (const m of block[1].matchAll(/['"`]([^'"`]+)['"`]/g)) set.add(m[1].toLowerCase());
        }
    } catch { /* leave empty */ }
    return set;
}
const resolverNames = readResolverNames(
    path.join(__dirname, '..', 'src', 'modules', 'jira', 'services', 'jiraFields.ts'));

/**
 * Nested paths production actually reads, which a top-level key diff cannot see.
 * e.g. statusCategory is read as fields.status.statusCategory.key — `status` is in
 * the allowlist so the nested object arrives intact, even though the Agile API's
 * separate TOP-LEVEL statusCategory field is (correctly) absent.
 */
const NESTED_PATHS = [
    ['status', 'statusCategory', 'key'],
    ['parent', 'fields', 'summary'],
    ['timetracking', 'originalEstimateSeconds'],
    ['issuetype', 'name'],
    ['priority', 'name'],
    ['assignee', 'displayName'],
    ['reporter', 'displayName'],
];

const dig = (obj, pathArr) => pathArr.reduce((o, k) => (o == null ? undefined : o[k]), obj);

function diffNestedPaths(rawMap, polMap) {
    const findings = [];
    for (const p of NESTED_PATHS) {
        let rawN = 0, polN = 0;
        for (const [k, r] of rawMap) {
            const pol = polMap.get(k);
            if (!pol) continue;
            if (meaningful(dig(r.fields, p))) rawN++;
            if (meaningful(dig(pol.fields, p))) polN++;
        }
        if (rawN !== polN) findings.push(`fields.${p.join('.')}: RAW ${rawN} vs POLICED ${polN}`);
    }
    return findings;
}

// ------------------------------------------------------------------- fetching

/** Mirrors getAllIssuesFromUrl's pagination + dedupe exactly, but with fields=*all. */
async function fetchRaw(jira, boardUrl) {
    let issues = [];
    let startAt = 0;
    const url = `${boardUrl}&fields=*all`;
    for (;;) {
        const { data } = await jira.client.get(`${url}&startAt=${startAt}&maxResults=100`);
        if (!data.issues || data.issues.length === 0) break;
        issues = issues.concat(data.issues);
        startAt += data.issues.length;              // NOT += maxResults — matches production
        if (startAt >= (data.total || 0)) break;
        if (issues.length > MAX_ISSUES * 3) throw new Error(`exceeded maxIssues guard (${MAX_ISSUES})`);
    }
    // Agile board `total` counts sub-tasks, causing re-fetched pages. Production
    // dedupes by key; without this the raw leg shows phantom extra issues.
    const seen = new Set();
    return issues.filter(i => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

// ---------------------------------------------------------------- comparisons

const meaningful = (v) =>
    !(v === null || v === undefined || v === '' ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0));

const INTENTIONAL_STRIP = new Set(['description', 'environment', 'attachment', 'worklog']);

function diffFieldPresence(rawIssue, policedIssue) {
    const pf = policedIssue.fields || {};
    return Object.keys(rawIssue.fields || {})
        .filter(f => meaningful(rawIssue.fields[f]))
        .filter(f => !meaningful(pf[f]));
}

function countByStatus(issues) {
    const counts = {};
    for (const i of issues) {
        const s = i.fields?.status?.name ?? '(none)';
        counts[s] = (counts[s] || 0) + 1;
    }
    return counts;
}

function presenceProfile(issues) {
    let withAssignee = 0, withReporter = 0, withCreator = 0, withParent = 0, withComments = 0, commentCount = 0;
    for (const i of issues) {
        const f = i.fields || {};
        if (f.assignee) withAssignee++;
        if (f.reporter) withReporter++;
        if (f.creator) withCreator++;
        if (f.parent) withParent++;
        const cs = f.comment?.comments;
        if (Array.isArray(cs) && cs.length) { withComments++; commentCount += cs.length; }
    }
    return { withAssignee, withReporter, withCreator, withParent, withComments, commentCount };
}

const objDiff = (a, b) => {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.filter(k => (a[k] || 0) !== (b[k] || 0)).map(k => `${k}: ${a[k] || 0}!=${b[k] || 0}`);
};

const setDiff = (a, b) => ({
    onlyA: [...a].filter(x => !b.has(x)),
    onlyB: [...b].filter(x => !a.has(x)),
});

/** Trimmed port of reportService's inline isTeamMember. Applied to BOTH legs, so
 *  an imperfect port cannot cause a false pass/fail — it only shifts population. */
function buildIsTeamMember(teamMembers) {
    const norm = (e) => String(e || '').toLowerCase().trim()
        .replace(/_ext@|_int@|_contractor@/, '@')
        .replace(/@myccmortgage\.com$/, '@ccm.com');
    const emails = new Set(teamMembers.map(m => norm(m.jiraLoginId)).filter(Boolean));
    const names = new Set(teamMembers.map(m => `${m.firstName || ''} ${m.lastName || ''}`.toLowerCase().trim()).filter(Boolean));
    return (user) => {
        if (!user) return false;
        if (user.emailAddress && emails.has(norm(user.emailAddress))) return true;
        if (user.accountId && emails.has(String(user.accountId).toLowerCase())) return true;
        if (user.displayName && names.has(String(user.displayName).toLowerCase().trim())) return true;
        return false;
    };
}

function activityProfile(issues, window, isTeamMember, devStatuses, devFieldId, doneStatuses) {
    // identifyDailyActivity MUTATES issues (writes dailyActivity/weekendActivity),
    // so always hand it a deep clone.
    const clone = JSON.parse(JSON.stringify(issues));
    const r = reportService.identifyDailyActivity(clone, window, isTeamMember, devStatuses, devFieldId, doneStatuses);
    const keys = (arr) => new Set(arr.map(i => i.key));
    const commentAdded = new Set(
        clone.filter(i => Array.isArray(i.dailyActivity) && i.dailyActivity.some(a => String(a).includes('Comment added')))
             .map(i => i.key));
    return {
        active: keys(r.teamActiveTickets),
        queued: keys(r.queuedWorkTickets),
        context: keys(r.contextTickets),
        weekend: keys(r.weekendActivityTickets),
        commentAdded,
    };
}

function classifySummary(rawSummary, policedSummary, redactionOn) {
    if (rawSummary === policedSummary) return 'IDENTICAL';
    if (redactionOn && redactPii(String(rawSummary ?? '')) === policedSummary) return 'REDACTED';
    return 'DRIFT';
}

/** Structural sweep for an Atlassian Document Format node surviving under any key. */
function findAdfNodes(issue) {
    const hits = [];
    (function walk(v, p) {
        if (!v || typeof v !== 'object') return;
        if (!Array.isArray(v) && v.type === 'doc' && v.version && Array.isArray(v.content)) hits.push(p);
        for (const [k, val] of Object.entries(v)) {
            if (k === 'changelog') continue;
            walk(val, `${p}.${k}`);
        }
    })(issue.fields, 'fields');
    return hits;
}

// ------------------------------------------------------------------ per-project

async function verifyProject(project, sourceIndex) {
    const out = { projectId: project.id, code: project.code, name: project.name, checks: {}, findings: [] };
    const fail = (msg) => { out.findings.push(msg); };

    const jira = JiraService.forProject(project);

    // Wire capture — proves each leg really used the intended field set.
    const wire = [];
    jira.client.interceptors.request.use((cfg) => { wire.push(decodeURIComponent(cfg.url || '')); return cfg; });

    const activeSprint = await jira.getActiveSprint(project.jiraBoardId).catch(() => null);
    const jql = activeSprint
        ? `sprint = ${activeSprint.id} OR updated >= -2d`
        : 'statusCategory != Done OR updated >= -1d';
    const boardUrl = `/rest/agile/1.0/board/${project.jiraBoardId}/issue?jql=${encodeURIComponent(jql)}&expand=changelog`;
    out.shape = activeSprint ? `sprint board (active ${activeSprint.id})` : 'kanban / no active sprint';
    out.jql = jql;

    // --- fetch both legs back-to-back -------------------------------------
    const rawMark = wire.length;
    const rawIssues = await fetchRaw(jira, boardUrl);
    const rawWire = wire.slice(rawMark);

    const polMark = wire.length;
    const policedIssues = await jira.getAllIssuesFromUrl(boardUrl);
    const policedWire = wire.slice(polMark);

    let drifted = new Set();
    if (DRIFT_CHECK) {
        const raw2 = await fetchRaw(jira, boardUrl);
        const upd = new Map(raw2.map(i => [i.key, i.fields?.updated]));
        for (const i of rawIssues) {
            if (upd.has(i.key) && upd.get(i.key) !== i.fields?.updated) drifted.add(i.key);
        }
    }
    out.drifted = [...drifted];

    const rawMap = new Map(rawIssues.filter(i => !drifted.has(i.key)).map(i => [i.key, i]));
    const polMap = new Map(policedIssues.filter(i => !drifted.has(i.key)).map(i => [i.key, i]));
    const rawArr = [...rawMap.values()];
    const polArr = [...polMap.values()];

    // --- wire self-check ---------------------------------------------------
    const rawHasAll = rawWire.some(u => u.includes('*all'));
    const polHasAll = policedWire.some(u => u.includes('*all'));
    const polHasDesc = policedWire.some(u => /fields=[^&]*\bdescription\b/.test(u));
    out.checks.wire = rawHasAll && !polHasAll && !polHasDesc ? 'PASS' : 'FAIL';
    if (!rawHasAll) fail('RAW leg did not send fields=*all — the A/B is invalid, every diff would be a false PASS');
    if (polHasAll) fail('POLICED leg sent *all — field policy not applied');
    if (polHasDesc) fail('POLICED leg requested description');

    // --- allowlist resolution guard ---------------------------------------
    const allowlist = await jira.fieldList ? null : null; // not public; infer from wire
    const polFieldsParam = (policedWire.find(u => u.includes('fields=')) || '').split('fields=')[1] || '';
    const allowCount = polFieldsParam ? polFieldsParam.split(',').length : 0;
    const staticCount = jiraFields.BASE_ISSUE_FIELDS.length + jiraFields.FALLBACK_CUSTOM_FIELDS.length;
    out.allowlistSize = allowCount;
    out.checks.resolution = allowCount > staticCount ? 'PASS' : 'INCONCLUSIVE';
    if (allowCount <= staticCount) {
        fail(`dynamic field resolution appears to have FAILED (allowlist ${allowCount} <= static ${staticCount}) — run is inconclusive, not clean`);
    }

    // --- counts ------------------------------------------------------------
    const kd = setDiff(new Set(rawMap.keys()), new Set(polMap.keys()));
    out.counts = { raw: rawArr.length, policed: polArr.length, onlyRaw: kd.onlyA, onlyPoliced: kd.onlyB };
    out.checks.counts = (kd.onlyA.length === 0 && kd.onlyB.length === 0) ? 'PASS' : 'FAIL';
    if (kd.onlyA.length) fail(`${kd.onlyA.length} issue(s) present in RAW but missing from POLICED: ${kd.onlyA.slice(0, 5).join(', ')}`);
    if (kd.onlyB.length) fail(`${kd.onlyB.length} issue(s) only in POLICED: ${kd.onlyB.slice(0, 5).join(', ')}`);

    const statusDiff = objDiff(countByStatus(rawArr), countByStatus(polArr));
    out.checks.statuses = statusDiff.length === 0 ? 'PASS' : 'FAIL';
    if (statusDiff.length) fail(`status counts differ: ${statusDiff.join('; ')}`);

    // --- field presence ----------------------------------------------------
    const fieldNames = new Map();
    try { (await jira.getFields()).forEach(f => fieldNames.set(f.id, f.name)); } catch { /* names optional */ }

    const buckets = { INTENTIONAL: new Map(), NOT_REFERENCED: new Map(), UNEXPECTED: new Map() };
    for (const [key, rawIssue] of rawMap) {
        const pol = polMap.get(key);
        if (!pol) continue;
        for (const f of diffFieldPresence(rawIssue, pol)) {
            let bucket;
            if (INTENTIONAL_STRIP.has(f)) bucket = 'INTENTIONAL';
            else if (!sourceIndex.referencesId(f) && !sourceIndex.referencesName(fieldNames.get(f))) bucket = 'NOT_REFERENCED';
            else bucket = 'UNEXPECTED';
            buckets[bucket].set(f, (buckets[bucket].get(f) || 0) + 1);
        }
    }
    out.fields = {
        intentional: [...buckets.INTENTIONAL.keys()],
        notReferenced: [...buckets.NOT_REFERENCED.keys()],
        unexpected: [...buckets.UNEXPECTED.entries()].map(([id, n]) => ({ id, name: fieldNames.get(id) || null, issues: n })),
    };
    out.checks.fields = out.fields.unexpected.length === 0 ? 'PASS' : 'FAIL';
    for (const u of out.fields.unexpected) {
        fail(`UNEXPECTED missing field ${u.id}${u.name ? ` ("${u.name}")` : ''} on ${u.issues} issue(s) — it IS referenced in backend source`);
    }

    // Nested-path integrity — the top-level key diff cannot see these.
    const nested = diffNestedPaths(rawMap, polMap);
    out.nested = nested;
    out.checks.nested = nested.length === 0 ? 'PASS' : 'FAIL';
    for (const n of nested) fail(`nested path lost: ${n}`);

    // --- story points ------------------------------------------------------
    const resolved = await resolveEstimateFields(project, jira);
    out.spField = resolved.spFieldId;
    out.hoursField = resolved.hoursFieldId || null;
    const sum = (arr) => arr.reduce((a, i) => a + (Number(extractEstimate(i.fields, project, resolved)) || 0), 0);
    const rawSp = sum(rawArr), polSp = sum(polArr);
    out.storyPoints = { raw: rawSp, policed: polSp };
    out.checks.storyPoints = rawSp === polSp ? 'PASS' : 'FAIL';
    if (rawSp !== polSp) {
        fail(`story point total differs: RAW ${rawSp} vs POLICED ${polSp} (resolved field ${resolved.spFieldId})`);
        for (const [k, r] of rawMap) {
            const p = polMap.get(k); if (!p) continue;
            const a = Number(extractEstimate(r.fields, project, resolved)) || 0;
            const b = Number(extractEstimate(p.fields, project, resolved)) || 0;
            if (a !== b) fail(`  ${k}: RAW ${a} vs POLICED ${b}`);
        }
    }
    if (resolved.spFieldId === 'story_points') {
        out.checks.storyPoints = 'INCONCLUSIVE';
        fail("story point field resolution fell back to the 'story_points' sentinel — inconclusive");
    }

    // --- blocked tickets ---------------------------------------------------
    const lane = getLaneConfig(project);
    const blockedStatuses = getStatusesForRole(lane, 'blocked');
    const t0 = new Date();
    const normBlocked = (t) => `${t.key}|${t.status}|${t.movedToBlockedToday}|${t.blockedSince ?? ''}|${t.assignee}`;
    const rawBlocked = jira.extractBlockedInfo(rawArr, blockedStatuses).map(normBlocked).sort();
    const polBlocked = jira.extractBlockedInfo(polArr, blockedStatuses).map(normBlocked).sort();
    const t1 = new Date();
    out.blocked = { raw: rawBlocked.length, policed: polBlocked.length };
    out.checks.blocked = JSON.stringify(rawBlocked) === JSON.stringify(polBlocked) ? 'PASS' : 'FAIL';
    if (out.checks.blocked === 'FAIL') {
        const only = rawBlocked.filter(x => !polBlocked.includes(x)).concat(polBlocked.filter(x => !rawBlocked.includes(x)));
        fail(`blocked-ticket tuples differ (${only.length}): ${only.slice(0, 5).join(' | ')}`);
    }
    if (t0.toDateString() !== t1.toDateString()) {
        fail('run straddled local midnight — movedToBlockedToday may differ between legs for reasons unrelated to the policy');
    }

    // --- daily activity ----------------------------------------------------
    const window = await reportService.getReportDateRange(
        new Date().toISOString().slice(0, 10), project.jiraBoardId);
    const members = await project.$get('teamMembers').catch(() => []);
    const teamRows = (members || []).map(m => m.teamMember || m).filter(Boolean);
    const isMember = buildIsTeamMember(teamRows);
    const devStatuses = getStatusesForRole(lane, 'in_progress');
    const doneStatuses = getStatusesForRole(lane, 'done');

    const actRawStrict = activityProfile(rawArr, window, isMember, devStatuses, undefined, doneStatuses);
    const actPolStrict = activityProfile(polArr, window, isMember, devStatuses, undefined, doneStatuses);
    const actRawPerm = activityProfile(rawArr, window, () => true, devStatuses, undefined, doneStatuses);
    const actPolPerm = activityProfile(polArr, window, () => true, devStatuses, undefined, doneStatuses);

    const cmpSets = (label, a, b) => {
        const d = setDiff(a, b);
        if (d.onlyA.length || d.onlyB.length) {
            fail(`${label}: RAW-only [${d.onlyA.slice(0, 5).join(', ')}] POLICED-only [${d.onlyB.slice(0, 5).join(', ')}]`);
            return false;
        }
        return true;
    };
    const actOk = [
        cmpSets('activity.strict.active', actRawStrict.active, actPolStrict.active),
        cmpSets('activity.permissive.active', actRawPerm.active, actPolPerm.active),
        cmpSets('activity.commentAdded', actRawPerm.commentAdded, actPolPerm.commentAdded),
        cmpSets('activity.context', actRawStrict.context, actPolStrict.context),
    ].every(Boolean);
    out.activity = {
        strict: { raw: actRawStrict.active.size, policed: actPolStrict.active.size },
        permissive: { raw: actRawPerm.active.size, policed: actPolPerm.active.size },
        commentAdded: { raw: actRawPerm.commentAdded.size, policed: actPolPerm.commentAdded.size },
    };
    out.checks.activity = actOk ? 'PASS' : 'FAIL';

    // --- presence profile --------------------------------------------------
    const pRaw = presenceProfile(rawArr), pPol = presenceProfile(polArr);
    const presDiff = objDiff(pRaw, pPol);
    out.presence = { raw: pRaw, policed: pPol };
    out.checks.presence = presDiff.length === 0 ? 'PASS' : 'FAIL';
    if (presDiff.length) fail(`presence profile differs: ${presDiff.join('; ')}`);

    // --- titles ------------------------------------------------------------
    const redactionOn = project.piiRedactionEnabled !== false;
    let identical = 0, redacted = 0, drift = 0;
    const samples = [];
    for (const [k, r] of rawMap) {
        const p = polMap.get(k); if (!p) continue;
        const cls = classifySummary(r.fields?.summary, p.fields?.summary, redactionOn);
        if (cls === 'IDENTICAL') identical++;
        else if (cls === 'REDACTED') {
            redacted++;
            if (samples.length < (VERBOSE ? 20 : 5)) {
                const hits = redactPiiDetailed(String(r.fields?.summary ?? '')).hits;
                // Print the POST-redaction string only — safe by construction.
                samples.push({ key: k, categories: hits, redactedTitle: p.fields?.summary });
            }
        } else { drift++; fail(`title DRIFT on ${k} — policed title is neither identical nor redactPii(raw)`); }
    }
    out.titles = { redactionEnabled: redactionOn, identical, redacted, drift, samples };
    out.checks.titles = drift === 0 ? 'PASS' : 'FAIL';

    // --- PII assertions on the policed set ---------------------------------
    let desc = 0, bodies = 0, badMeta = 0, polComments = 0, adf = 0, stripped = 0;
    for (const i of polArr) {
        const f = i.fields || {};
        if (f.description !== undefined) desc++;
        if (f.parent?.fields?.description !== undefined) desc++;
        if (f.environment !== undefined || f.attachment !== undefined || f.worklog !== undefined) stripped++;
        for (const c of (f.comment?.comments || [])) {
            polComments++;
            if (c.body !== undefined || c.renderedBody !== undefined || c.jsdPublic !== undefined) bodies++;
            if (!c.created || isNaN(Date.parse(c.created)) || !c.author || typeof c.author !== 'object') badMeta++;
        }
        adf += findAdfNodes(i).length;
    }
    const rawComments = rawArr.reduce((a, i) => a + (i.fields?.comment?.comments?.length || 0), 0);
    out.pii = { descriptions: desc, commentBodies: bodies, badMetadata: badMeta, adfNodes: adf,
                strippedFieldsPresent: stripped, rawComments, policedComments: polComments };

    if (desc || bodies || badMeta || adf || stripped) {
        out.checks.pii = 'FAIL';
        if (desc) fail(`${desc} description(s) survived into the policed set`);
        if (bodies) fail(`${bodies} comment body/bodies survived into the policed set`);
        if (badMeta) fail(`${badMeta} comment(s) lost created/author metadata — breaks the "Comment added" activity signal`);
        if (adf) fail(`${adf} Atlassian-Document-Format node(s) found under an unexpected key`);
        if (stripped) fail(`${stripped} issue(s) still carry environment/attachment/worklog`);
    } else if (rawComments > 0 && polComments === 0) {
        out.checks.pii = 'FAIL';
        fail(`RAW had ${rawComments} comments but POLICED has 0 — comments were DROPPED, not just stripped`);
    } else if (rawComments === 0) {
        out.checks.pii = 'INCONCLUSIVE';
        fail('no comments in the sampled window — comment-metadata check is inconclusive, not a pass');
    } else {
        out.checks.pii = 'PASS';
    }

    return out;
}

// ---------------------------------------------------------------------- render

function render(r) {
    const st = (k) => r.checks[k] === 'PASS' ? PASS : r.checks[k] === 'INCONCLUSIVE' ? INCONCLUSIVE : FAIL;
    console.log(color('bold', `\nProject ${r.projectId}  ${r.code}  "${r.name}"  board ${r.boardId}`));
    console.log(`  ${color('dim', r.shape)}  redaction=${r.titles?.redactionEnabled ? 'ON' : 'OFF'}  spField=${r.spField}  allowlist=${r.allowlistSize}`);
    console.log(`  ${color('dim', 'jql')} ${r.jql}`);
    console.log(`  fetch          RAW ${r.counts.raw}  POLICED ${r.counts.policed}  drifted ${r.drifted.length}`);
    console.log(`  wire           ${st('wire')}`);
    console.log(`  resolution     ${st('resolution')}`);
    console.log(`  counts         ${st('counts')}`);
    console.log(`  statuses       ${st('statuses')}`);
    console.log(`  fields         intentional ${r.fields.intentional.length}  not-referenced ${r.fields.notReferenced.length}  UNEXPECTED ${r.fields.unexpected.length}   ${st('fields')}`);
    console.log(`  nested paths   ${r.nested.length === 0 ? 'all intact' : r.nested.join('; ')}   ${st('nested')}`);
    console.log(`  storypoints    RAW ${r.storyPoints.raw}  POLICED ${r.storyPoints.policed}   ${st('storyPoints')}`);
    console.log(`  blocked        RAW ${r.blocked.raw}  POLICED ${r.blocked.policed}   ${st('blocked')}`);
    console.log(`  activity       strict ${r.activity.strict.raw}=${r.activity.strict.policed}  permissive ${r.activity.permissive.raw}=${r.activity.permissive.policed}  'Comment added' ${r.activity.commentAdded.raw}=${r.activity.commentAdded.policed}   ${st('activity')}`);
    console.log(`  presence       assignee ${r.presence.raw.withAssignee}=${r.presence.policed.withAssignee}  comments ${r.presence.raw.commentCount}=${r.presence.policed.commentCount}   ${st('presence')}`);
    console.log(`  titles         identical ${r.titles.identical}  redacted ${r.titles.redacted}  drift ${r.titles.drift}   ${st('titles')}`);
    console.log(`  pii            desc ${r.pii.descriptions}  bodies ${r.pii.commentBodies}  comments ${r.pii.policedComments}/${r.pii.rawComments} metadata-ok   ${st('pii')}`);

    if (r.titles.samples.length) {
        console.log(color('dim', '  redaction samples (post-redaction text only):'));
        for (const s of r.titles.samples) {
            console.log(color('dim', `    ${s.key} [${Object.entries(s.categories).map(([k, v]) => `${k} x${v}`).join(', ')}] -> "${s.redactedTitle}"`));
        }
    }
    if (r.fields.notReferenced.length && VERBOSE) {
        console.log(color('dim', `  not-referenced fields dropped: ${r.fields.notReferenced.join(', ')}`));
    }
    for (const f of r.findings) console.log(color('red', `  ! ${f}`));
}

// ------------------------------------------------------------------------ main

async function main() {
    assertFreshBuild();

    const codes = arg('codes');
    const ids = arg('projectIds');
    if (!codes && !ids) {
        console.error(color('red', 'Refusing to sweep every project — pass --codes LS,LOSAI,EXP or --projectIds 10,6,8'));
        console.error(color('dim', 'fields=*all against every board is real load on the customer Jira instance.'));
        process.exit(2);
    }

    const where = ids
        ? { id: { [Op.in]: ids.split(',').map(s => parseInt(s.trim(), 10)) } }
        : { code: { [Op.in]: codes.split(',').map(s => s.trim()) } };
    const projects = await Project.findAll({ where });
    if (!projects.length) { console.error(color('red', 'No matching projects.')); process.exit(2); }

    console.log(color('cyan', `\nField-policy parity check — READ-ONLY, no DB writes, no AI calls`));
    console.log(color('dim', `Scanning backend/src for field references...`));
    const sourceIndex = buildSourceIndex(path.join(__dirname, '..', 'src'));

    const results = [];
    let exitCode = 0;
    for (const p of projects) {
        if ((p.dataSourceType || 'jira') !== 'jira' || !p.jiraBoardId) {
            console.log(color('yellow', `\nSkipping ${p.code} — not a Jira project or no board id`));
            continue;
        }
        try {
            const r = await verifyProject(p, sourceIndex);
            r.boardId = p.jiraBoardId;
            results.push(r);
            render(r);
            const states = Object.values(r.checks);
            if (states.includes('FAIL')) exitCode = 1;
            else if (states.includes('INCONCLUSIVE') && exitCode === 0) exitCode = 1;
        } catch (e) {
            console.log(color('yellow', `\n${p.code}: Skipped — Jira/runtime error: ${e.message}`));
            results.push({ projectId: p.id, code: p.code, skipped: e.message });
            exitCode = 1;   // a skip is never a silent pass
        }
    }

    const verdict = exitCode === 0 ? color('green', 'ALL CHECKS PASSED') : color('red', 'DIFFERENCES OR INCONCLUSIVE RESULTS — see above');
    console.log(color('bold', `\n${verdict}\n`));

    if (JSON_PATH) {
        fs.writeFileSync(JSON_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), exitCode, projects: results }, null, 2));
        console.log(color('dim', `JSON written to ${JSON_PATH}`));
    }
    return exitCode;
}

main()
    .then(async (code) => { await sequelize.close(); process.exit(code); })
    .catch(async (e) => {
        console.error(color('red', `\nINFRA ERROR: ${e.message}`));
        if (VERBOSE) console.error(e);
        try { await sequelize.close(); } catch { /* ignore */ }
        process.exit(2);
    });
