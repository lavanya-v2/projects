/**
 * READ-ONLY audit for persisted customer PII and leaked Jira credentials.
 *
 * Scans the database, application logs and exported files. Everything is split
 * BEFORE vs AFTER a --cutoff timestamp, so pre-existing historical data (which we
 * deliberately chose not to clean up) is never confused with a NEW leak from the
 * current code. Historical findings are reported but do NOT fail the run.
 *
 * Uses the production redactor (redactPiiDetailed) rather than hand-rolled regexes,
 * so the audit and the ingestion path agree by construction.
 *
 * Performs NO writes of any kind. Never prints a raw PII value or a token.
 *
 *   cd backend && npm run build
 *   node scripts/audit-pii-leaks.js --cutoff 2026-08-01T00:00:00Z [--scanExports] [--verbose]
 *
 * Exit: 0 = clean, 1 = post-cutoff PII / lastComment residue / token in a file,
 *       2 = infra error.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { QueryTypes } = require('sequelize');

const sequelize = require('../dist/config/connection').default;
const { redactPiiDetailed } = require('../dist/common/utils/piiRedactor');

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const flag = (n) => argv.includes(`--${n}`);

const VERBOSE = flag('verbose');
const SCAN_EXPORTS = flag('scanExports');
const JSON_PATH = arg('json');
const CUTOFF = arg('cutoff');
const SAMPLE_LIMIT = VERBOSE ? 15 : 5;

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m', bold: '\x1b[1m' };
const color = (c, s) => `${C[c]}${s}${C.reset}`;

// Only these categories are a reliable signal. `name` is reported separately —
// the redactor cannot detect free-floating personal names by design, so
// hits.name === 0 never proves a title is clean.
const STRUCTURAL = ['email', 'phone', 'ssn', 'taxId', 'card', 'account', 'address'];

const report = { db: {}, files: {}, tokens: [], notes: [] };
let exitCode = 0;
const failRun = () => { exitCode = 1; };

function scanText(text) {
    if (typeof text !== 'string' || !text) return null;
    const r = redactPiiDetailed(text);
    const structural = STRUCTURAL.filter(c => r.hits[c]);
    const nameOnly = !structural.length && !!r.hits.name;
    if (!structural.length && !nameOnly) return null;
    return { structural, nameOnly, hits: r.hits, masked: r.text.slice(0, 160) };
}

// ------------------------------------------------------------------ DB sweeps

async function auditLastCommentResidue() {
    const rows = await sequelize.query(`
        SELECT COUNT(*) FILTER (WHERE created_at <  :cutoff) AS before_cutoff,
               COUNT(*) FILTER (WHERE created_at >= :cutoff) AS after_cutoff
        FROM daily_board_snapshots
        WHERE blocked_tickets::text LIKE '%lastComment%'
    `, { replacements: { cutoff: CUTOFF }, type: QueryTypes.SELECT });

    const before = Number(rows[0].before_cutoff || 0);
    const after = Number(rows[0].after_cutoff || 0);
    report.db.lastComment = { before, after };

    console.log(color('bold', '\n[1] lastComment residue in daily_board_snapshots.blocked_tickets'));
    console.log(`    historical (before cutoff): ${before}   ${before ? color('yellow', 'known, accepted') : ''}`);
    console.log(`    post-cutoff:                ${after}    ${after ? color('red', 'FAIL — new code wrote a comment body') : color('green', 'PASS')}`);
    if (after > 0) failRun();
}

async function auditColumn(label, sql, extract, cutoffNote) {
    const rows = await sequelize.query(sql, { replacements: { cutoff: CUTOFF }, type: QueryTypes.SELECT });
    let scanned = 0, beforeHits = 0, afterHits = 0, nameOnlyHits = 0;
    const samples = [];

    for (const row of rows) {
        for (const { text, ref } of extract(row)) {
            if (!text) continue;
            scanned++;
            const hit = scanText(text);
            if (!hit) continue;
            if (hit.nameOnly) { nameOnlyHits++; continue; }
            const isAfter = row.written_at && new Date(row.written_at) >= new Date(CUTOFF);
            if (isAfter) afterHits++; else beforeHits++;
            if (samples.length < SAMPLE_LIMIT) {
                samples.push({ ref, when: isAfter ? 'AFTER' : 'before',
                    categories: hit.structural, masked: hit.masked });
            }
        }
    }

    report.db[label] = { scanned, beforeHits, afterHits, nameOnlyHits, samples };
    console.log(color('bold', `\n[+] ${label}`));
    if (cutoffNote) console.log(color('dim', `    ${cutoffNote}`));
    console.log(`    values scanned:             ${scanned}`);
    console.log(`    historical hits:            ${beforeHits}   ${beforeHits ? color('yellow', 'known, accepted') : ''}`);
    console.log(`    post-cutoff hits:           ${afterHits}    ${afterHits ? color('red', 'FAIL') : color('green', 'PASS')}`);
    console.log(color('dim', `    name-only hits (unreliable signal, informational): ${nameOnlyHits}`));
    for (const s of samples) {
        console.log(color('dim', `      ${s.when} ${s.ref} [${s.categories.join(', ')}] -> "${s.masked}"`));
    }
    if (afterHits > 0) failRun();
}

// ------------------------------------------------------------ filesystem sweep

function listFiles(root, exts) {
    const out = [];
    (function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (!exts || exts.some(x => e.name.toLowerCase().endsWith(x))) out.push(p);
        }
    })(root);
    return out;
}

async function scanFileLines(file, tokenMatchers) {
    const findings = [];
    let unscannedLongLines = 0;
    let lineNo = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
        lineNo++;
        // redactPiiDetailed returns oversized input untouched with zero hits, which
        // would look like "clean" — count these instead of silently passing them.
        if (line.length > 5000) { unscannedLongLines++; continue; }
        const hit = scanText(line);
        if (hit && hit.structural.length && findings.length < SAMPLE_LIMIT) {
            findings.push({ file, line: lineNo, categories: hit.structural, masked: hit.masked });
        }
        for (const tm of tokenMatchers) {
            if (line.includes(tm.token) || (tm.basic && line.includes(tm.basic)) || line.includes(tm.prefix)) {
                report.tokens.push({ projectId: tm.projectId, code: tm.code, file, line: lineNo, fingerprint: tm.fingerprint });
                failRun();
            }
        }
    }
    return { findings, unscannedLongLines };
}

async function auditFilesystem(tokenMatchers) {
    const roots = [
        { label: 'backend/logs', dir: path.join(__dirname, '..', 'logs'), exts: null },
        { label: 'backend/exports', dir: path.join(__dirname, '..', 'exports'), exts: ['.json', '.html', '.txt', '.csv', '.md'] },
    ];

    console.log(color('bold', '\n[+] filesystem sweep'));

    // error_analysis.log — absence is the EXPECTED post-branch state.
    const eaLog = path.join(__dirname, '..', 'error_analysis.log');
    if (!fs.existsSync(eaLog)) {
        console.log(`    error_analysis.log:         ${color('green', 'absent (expected — the write was removed)')}`);
        report.files.errorAnalysisLog = 'absent';
    } else {
        const st = fs.statSync(eaLog);
        console.log(`    error_analysis.log:         ${color('red', `PRESENT, mtime ${st.mtime.toISOString()}`)}`);
        report.files.errorAnalysisLog = st.mtime.toISOString();
        if (st.mtime >= new Date(CUTOFF)) failRun();
    }

    let totalFindings = [], totalLong = 0, filesScanned = 0;
    for (const r of roots) {
        if (!fs.existsSync(r.dir)) { console.log(color('dim', `    ${r.label}: not present`)); continue; }
        const files = listFiles(r.dir, r.exts);
        for (const f of files) {
            filesScanned++;
            try {
                const { findings, unscannedLongLines } = await scanFileLines(f, tokenMatchers);
                totalFindings.push(...findings);
                totalLong += unscannedLongLines;
            } catch (e) { report.notes.push(`could not scan ${f}: ${e.message}`); }
        }
        console.log(`    ${r.label}: ${files.length} file(s) scanned`);
    }

    // Binary exports must never be reported as clean by a text scan.
    const xlsx = fs.existsSync(path.join(__dirname, '..', 'exports'))
        ? listFiles(path.join(__dirname, '..', 'exports'), ['.xlsx', '.pptx', '.zip']) : [];
    if (xlsx.length) {
        console.log(color('yellow', `    ${xlsx.length} binary export(s) NOT text-scannable (xlsx/pptx are ZIP archives)`));
        report.files.notScanned = xlsx.length;
        if (SCAN_EXPORTS) {
            try {
                const ExcelJS = require('exceljs');
                let hits = 0;
                for (const f of xlsx.filter(x => x.endsWith('.xlsx'))) {
                    const wb = new ExcelJS.Workbook();
                    await wb.xlsx.readFile(f);
                    wb.eachSheet(ws => ws.eachRow(row => row.eachCell(cell => {
                        const hit = scanText(String(cell.text ?? ''));
                        if (hit && hit.structural.length) {
                            hits++;
                            if (totalFindings.length < SAMPLE_LIMIT) {
                                totalFindings.push({ file: f, line: 0, categories: hit.structural, masked: hit.masked });
                            }
                        }
                    })));
                }
                console.log(`    xlsx deep scan: ${hits} cell hit(s)`);
                report.files.xlsxHits = hits;
            } catch (e) { report.notes.push(`xlsx scan failed: ${e.message}`); }
        } else {
            console.log(color('dim', '    (pass --scanExports to open them with exceljs)'));
        }
    }

    report.files.scanned = filesScanned;
    report.files.piiFindings = totalFindings;
    report.files.unscannedLongLines = totalLong;

    console.log(`    files scanned:              ${filesScanned}`);
    console.log(`    PII findings:               ${totalFindings.length}  ${totalFindings.length ? color('yellow', '(see below)') : color('green', 'PASS')}`);
    if (totalLong) console.log(color('yellow', `    lines >5000 chars NOT scanned: ${totalLong}`));
    for (const f of totalFindings) {
        console.log(color('dim', `      ${path.basename(f.file)}:${f.line} [${f.categories.join(', ')}] -> "${f.masked}"`));
    }
}

// ------------------------------------------------------------------ token sweep

async function buildTokenMatchers() {
    const rows = await sequelize.query(
        `SELECT id, code, jira_email, jira_api_token FROM projects WHERE jira_api_token IS NOT NULL AND jira_api_token <> ''`,
        { type: QueryTypes.SELECT });
    return rows.map(r => ({
        projectId: r.id,
        code: r.code,
        token: r.jira_api_token,
        // What actually appears in an axios error dump: base64(email:token)
        basic: Buffer.from(`${r.jira_email || ''}:${r.jira_api_token}`).toString('base64'),
        prefix: String(r.jira_api_token).slice(0, 12),
        fingerprint: crypto.createHash('sha256').update(r.jira_api_token).digest('hex').slice(0, 8),
    }));
}

// ------------------------------------------------------------------------ main

async function main() {
    if (!CUTOFF || isNaN(Date.parse(CUTOFF))) {
        console.error(color('red', 'Required: --cutoff <ISO timestamp>  (e.g. --cutoff 2026-08-01T00:00:00Z)'));
        console.error(color('dim', 'Everything is split before/after this so historical data is not confused with a new leak.'));
        process.exit(2);
    }

    console.log(color('cyan', `\nPII & secret leak audit — READ-ONLY`));
    console.log(color('dim', `cutoff: ${CUTOFF}`));

    await auditLastCommentResidue();

    await auditColumn('daily_board_snapshots.blocked_tickets + data_quality_flags',
        `SELECT id, date, created_at AS written_at, blocked_tickets, data_quality_flags
           FROM daily_board_snapshots WHERE blocked_tickets IS NOT NULL OR data_quality_flags IS NOT NULL`,
        (row) => {
            const out = [];
            const bt = row.blocked_tickets;
            if (Array.isArray(bt)) {
                bt.forEach((t, i) => {
                    out.push({ text: t?.summary, ref: `snapshot#${row.id} blocked[${i}].summary` });
                    if (t?.lastComment) out.push({ text: t.lastComment, ref: `snapshot#${row.id} blocked[${i}].lastComment` });
                });
            }
            if (row.data_quality_flags) out.push({ text: JSON.stringify(row.data_quality_flags), ref: `snapshot#${row.id} dataQualityFlags` });
            return out;
        });

    await auditColumn('daily_board_snapshots AI prose columns',
        `SELECT id, created_at AS written_at, work_summary, executive_summary, ticket_details, health_rationale
           FROM daily_board_snapshots`,
        (row) => ['work_summary', 'executive_summary', 'ticket_details', 'health_rationale']
            .map(c => ({ text: row[c], ref: `snapshot#${row.id}.${c}` })),
        'AI-generated prose derived from titles — deliberately NOT cleaned up (out of scope)');

    await auditColumn('perf_ticket_facts.summary',
        `SELECT f.id, f.jira_key, f.summary, COALESCE(s.synced_at, s.created_at) AS written_at
           FROM perf_ticket_facts f LEFT JOIN perf_sprint_syncs s ON s.id = f.sync_id
          WHERE f.summary IS NOT NULL`,
        (row) => [{ text: row.summary, ref: `fact#${row.id} ${row.jira_key}` }],
        'APPROXIMATE cutoff: perf_ticket_facts has no created_at (timestamps:false), so the split ' +
        'joins through perf_sprint_syncs.synced_at. Rows backfilled later than their sync may be misattributed.');

    const tokenMatchers = await buildTokenMatchers();
    console.log(color('dim', `\n    ${tokenMatchers.length} project token(s) loaded for the file sweep (never printed)`));
    await auditFilesystem(tokenMatchers);

    console.log(color('bold', '\n[+] Jira credential exposure'));
    if (report.tokens.length === 0) {
        console.log(`    ${color('green', 'PASS — no project token found in any scanned file')}`);
    } else {
        console.log(`    ${color('red', `FAIL — ${report.tokens.length} occurrence(s)`)}`);
        for (const t of report.tokens) console.log(color('red', `      ${t.code} (fp ${t.fingerprint}) in ${t.file}:${t.line}`));
    }

    console.log(color('bold', '\nLimits of this audit'));
    console.log(color('dim', '  - hits.name == 0 does NOT prove a title is clean; the redactor cannot detect'));
    console.log(color('dim', '    free-floating personal names. Only the structural categories are reliable.'));
    console.log(color('dim', '  - redactPii is idempotent, so a clean post-cutoff row is indistinguishable from'));
    console.log(color('dim', '    one that never had PII. This audit cannot quantify what redaction prevented.'));
    console.log(color('dim', '  - Historical (pre-cutoff) findings are reported but do not fail the run, by design.'));

    console.log(color('bold', `\n${exitCode === 0 ? color('green', 'AUDIT CLEAN') : color('red', 'FINDINGS — see above')}\n`));

    if (JSON_PATH) {
        fs.writeFileSync(JSON_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), cutoff: CUTOFF, exitCode, report }, null, 2));
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
