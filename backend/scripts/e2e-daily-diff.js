/**
 * E2E before/after harness for the daily report.
 *
 * Why this exists: changes to how we decide "who owns a ticket" must be proven not to
 * move CCM while fixing Thrive. Comparing a freshly generated report against the STORED
 * snapshot would measure Jira drift, not our change — past-date regeneration always reads
 * Jira's CURRENT state. So this harness compares regenerate-before vs regenerate-after
 * against the same live board.
 *
 * It drives the SAME entry point the BullMQ worker uses, exactly as
 * scripts/generate-daily-for-projects.js does:
 *     reportService.generateBoardReport(code, date, force = true)
 *
 * Every run restores the backup first, so baseline and compare start from an identical DB
 * state. That matters: getReportDateRange() derives the window end from the existing
 * snapshot's updatedAt, so a regenerated row would otherwise shift the window for the next
 * run and contaminate the comparison.
 *
 * Usage (run against the compiled build — npm run build first):
 *   node scripts/e2e-daily-diff.js --mode backup   --codes "TEAM DELTA,SC" --dates 2026-08-28,2026-09-01
 *   node scripts/e2e-daily-diff.js --mode baseline --label phase0
 *   node scripts/e2e-daily-diff.js --mode baseline --label phase0-noise   # 2nd run: drift check
 *   node scripts/e2e-daily-diff.js --mode diff --a phase0 --b phase0-noise
 *   ... apply code change, npm run build ...
 *   node scripts/e2e-daily-diff.js --mode compare  --label phase0
 *   node scripts/e2e-daily-diff.js --mode restore
 *
 * Exit code is 1 when a structural diff is found, so it can gate a phase.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const sequelize = require('../dist/config/connection').default;
const { Project } = require('../dist/models/Project');
const { DailyBoardSnapshot } = require('../dist/models/DailyBoardSnapshot');
const { reportService } = require('../dist/modules/reports/services/reportService');

const OUT_DIR = path.join(__dirname, '..', '.e2e');
const BACKUP = path.join(OUT_DIR, 'backup.json');

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

const MODE = arg('mode');
const LABEL = arg('label', 'run');
const CODES = (arg('codes') || '').split(',').map(s => s.trim()).filter(Boolean);
const DATES = (arg('dates') || '').split(',').map(s => s.trim()).filter(Boolean);

// Structural fields only. AI prose is non-deterministic and is reported separately.
const STRUCTURAL = [
    'totalTickets', 'statusCounts', 'blockedTickets', 'consideredJiraIds', 'overallHealth',
    'ticketKeys', 'teamMembers', 'sprintBurndown', 'teamMemberAttribution',
    'confirmedProdBugKeys', 'dataQualityFlags', 'subBugsLoggedCount', 'reopenedTicketsCount',
];
const PROSE = ['workSummary', 'executiveSummary', 'executiveRisks', 'executivePlan', 'ticketDetails', 'healthRationale'];

const norm = (v) => JSON.parse(JSON.stringify(v ?? null));

function capture(row) {
    if (!row) return null;
    const o = {};
    for (const f of [...STRUCTURAL, ...PROSE]) o[f] = norm(row[f]);
    return o;
}

async function loadTargets() {
    const spec = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
    return spec.targets;
}

// Columns stored as JSONB — passed as text and cast in SQL, since Sequelize replacements
// cannot bind a raw JS object.
const JSONB_COLS = [
    'status_counts', 'blocked_tickets', 'considered_jira_ids', 'ticket_keys', 'team_members',
    'sprint_burndown', 'confirmed_prod_bug_keys', 'data_quality_flags', 'team_member_attribution',
    'team_notes',
];
const SCALAR_COLS = [
    'total_tickets', 'work_summary', 'overall_health', 'executive_summary', 'executive_risks',
    'executive_plan', 'health_rationale', 'ticket_details', 'sub_bugs_logged_count',
    'reopened_tickets_count', 'manager_insights', 'original_executive_summary',
    'insights_health', 'insights_health_reason', 'updated_at',
];

/**
 * Put the backed-up rows back exactly, including updatedAt, via raw SQL — and DELETE any row
 * the harness itself created (a target that had no snapshot at backup time, e.g. today's date).
 * Without the delete, a test run would leave behind a snapshot the scheduler never produced.
 */
async function restoreFromBackup() {
    const spec = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));

    const backedUp = new Set(spec.rows.map(r => `${r.board_id}|${String(r.date).slice(0, 10)}`));
    let deleted = 0;
    for (const t of spec.targets) {
        if (backedUp.has(`${t.boardId}|${t.date}`)) continue;
        const [, meta] = await sequelize.query(
            `DELETE FROM daily_board_snapshots WHERE board_id=:b AND date=:d`,
            { replacements: { b: t.boardId, d: t.date } }
        );
        deleted += meta?.rowCount ?? 0;
    }
    if (deleted) console.log(`deleted ${deleted} harness-created row(s) that had no original`);

    for (const r of spec.rows) {
        const sets = [
            ...SCALAR_COLS.map(c => `${c}=:${c}`),
            ...JSONB_COLS.map(c => `${c}=CAST(:${c} AS jsonb)`),
        ].join(', ');
        const replacements = { id: r.id };
        for (const c of SCALAR_COLS) replacements[c] = r[c] ?? null;
        for (const c of JSONB_COLS) replacements[c] = r[c] == null ? null : JSON.stringify(r[c]);
        await sequelize.query(`UPDATE daily_board_snapshots SET ${sets} WHERE id=:id`, { replacements });
    }
    console.log(`restored ${spec.rows.length} row(s) to their original state`);
}

function diff(a, b, labelA, labelB) {
    let structural = 0, prose = 0;
    for (const key of Object.keys(a)) {
        for (const field of [...STRUCTURAL, ...PROSE]) {
            const av = JSON.stringify(a[key]?.[field]);
            const bv = JSON.stringify(b[key]?.[field]);
            if (av === bv) continue;
            if (PROSE.includes(field)) { prose++; continue; }
            structural++;
            const short = (s) => (s && s.length > 300 ? s.slice(0, 300) + '…' : s);
            console.log(`  DIFF ${key}.${field}`);
            console.log(`    ${labelA}: ${short(av)}`);
            console.log(`    ${labelB}: ${short(bv)}`);
        }
    }
    console.log(`\n  structural diffs: ${structural}   (AI prose fields differing: ${prose} — informational)`);
    return structural;
}

async function regenerate(targets) {
    const out = {};
    for (const t of targets) {
        process.stdout.write(`  regenerating ${t.code} ${t.date} ... `);
        try {
            await reportService.generateBoardReport(t.code, t.date, true);
        } catch (e) {
            console.log(`ERROR: ${e.message}`);
            out[`${t.code}|${t.date}`] = { __error: e.message };
            continue;
        }
        const row = await DailyBoardSnapshot.findOne({ where: { boardId: t.boardId, date: t.date } });
        out[`${t.code}|${t.date}`] = capture(row);
        console.log('ok');
    }
    return out;
}

(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await sequelize.authenticate();

    if (MODE === 'backup') {
        const projects = await Project.findAll({ where: { code: CODES } });
        if (projects.length !== CODES.length) {
            const found = projects.map(p => p.code);
            throw new Error(`codes not found: ${CODES.filter(c => !found.includes(c)).join(', ')}`);
        }
        const targets = [];
        for (const p of projects) for (const d of DATES) targets.push({ code: p.code, projectId: p.id, boardId: p.jiraBoardId, date: d });

        const rows = [];
        for (const t of targets) {
            const [r] = await sequelize.query(
                `SELECT * FROM daily_board_snapshots WHERE board_id=:b AND date=:d`,
                { replacements: { b: t.boardId, d: t.date }, type: sequelize.QueryTypes.SELECT }
            );
            if (!r) { console.log(`  WARNING no existing snapshot for ${t.code} ${t.date} — it will be created, not restored`); continue; }
            rows.push(r);
        }
        fs.writeFileSync(BACKUP, JSON.stringify({ targets, rows }, null, 2));
        console.log(`backed up ${rows.length} row(s) for ${targets.length} target(s) -> ${BACKUP}`);

    } else if (MODE === 'baseline' || MODE === 'compare') {
        const targets = await loadTargets();
        await restoreFromBackup();               // identical starting state for every run
        console.log(`\n${MODE} run [${LABEL}]:`);
        const captured = await regenerate(targets);
        const file = path.join(OUT_DIR, `${MODE === 'baseline' ? 'baseline' : 'after'}-${LABEL}.json`);
        fs.writeFileSync(file, JSON.stringify(captured, null, 2));
        console.log(`saved -> ${file}`);

        if (MODE === 'compare') {
            const baseFile = path.join(OUT_DIR, `baseline-${LABEL}.json`);
            const before = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
            console.log(`\n=== ${LABEL}: baseline vs after ===`);
            const n = diff(before, captured, 'before', 'after ');
            process.exitCode = n === 0 ? 0 : 1;
        }

    } else if (MODE === 'baseline-from-backup') {
        // Use the ORIGINAL scheduler-produced rows as the baseline, rather than a
        // regenerate-before run. For a backfill the question is precisely "how does the
        // rebuilt report differ from what was really reported that day", so the stored row
        // is the right comparison — unlike a code change, where regenerate-vs-regenerate is
        // needed to avoid measuring Jira drift.
        const spec = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
        const snake = (s) => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
        const captured = {};
        for (const t of spec.targets) {
            const row = spec.rows.find(r => r.board_id === t.boardId && String(r.date).slice(0, 10) === t.date);
            if (!row) { captured[`${t.code}|${t.date}`] = null; continue; }
            const o = {};
            for (const f of [...STRUCTURAL, ...PROSE]) o[f] = norm(row[snake(f)]);
            captured[`${t.code}|${t.date}`] = o;
        }
        const file = path.join(OUT_DIR, `baseline-${LABEL}.json`);
        fs.writeFileSync(file, JSON.stringify(captured, null, 2));
        console.log(`baseline built from ${spec.rows.length} stored row(s) -> ${file}`);

    } else if (MODE === 'capture') {
        // Read current DB state into an after-<label> file WITHOUT regenerating — for when
        // something else (the backfill queue) has already written the rows.
        const targets = await loadTargets();
        const captured = {};
        for (const t of targets) {
            const row = await DailyBoardSnapshot.findOne({ where: { boardId: t.boardId, date: t.date } });
            captured[`${t.code}|${t.date}`] = capture(row);
        }
        const file = path.join(OUT_DIR, `after-${LABEL}.json`);
        fs.writeFileSync(file, JSON.stringify(captured, null, 2));
        console.log(`captured ${targets.length} target(s) -> ${file}`);

        const baseFile = path.join(OUT_DIR, `baseline-${LABEL}.json`);
        if (fs.existsSync(baseFile)) {
            const before = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
            console.log(`\n=== ${LABEL}: stored original vs backfilled ===`);
            const n = diff(before, captured, 'stored', 'backfil');
            process.exitCode = n === 0 ? 0 : 1;
        }

    } else if (MODE === 'diff') {
        const a = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `baseline-${arg('a')}.json`), 'utf8'));
        const b = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `baseline-${arg('b')}.json`), 'utf8'));
        console.log(`=== noise floor: ${arg('a')} vs ${arg('b')} ===`);
        const n = diff(a, b, arg('a'), arg('b'));
        process.exitCode = n === 0 ? 0 : 1;

    } else if (MODE === 'restore') {
        await restoreFromBackup();

    } else {
        throw new Error('--mode must be one of: backup, baseline, compare, diff, restore');
    }

    await sequelize.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
