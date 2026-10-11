/**
 * Full verification of the historical-DSR path (sprint-by-date + status rewind).
 *
 * Uses DIRECT reportService calls, never the BullMQ queue. The queue is shared with the
 * running backend's in-process worker, so a queued job may be executed by whatever code
 * version that server booted with — which silently mixed two versions in an earlier run.
 * Direct calls always execute the code in THIS process.
 *
 * Every generated row is restored afterwards from a backup taken up front, so the DB is
 * left exactly as found.
 *
 *   node scripts/verify-historical-dsr.js --mode snapshot --out before.json
 *   node scripts/verify-historical-dsr.js --mode snapshot --out after.json
 *   node scripts/verify-historical-dsr.js --mode compare --a before.json --b after.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const sequelize = require('../dist/config/connection').default;
const { Project } = require('../dist/models/Project');
const { DailyBoardSnapshot } = require('../dist/models/DailyBoardSnapshot');
const { reportService } = require('../dist/modules/reports/services/reportService');

const OUT = path.join(__dirname, '..', '.e2e');
const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };

/**
 * What we generate. Chosen to cover every branch the change can reach:
 *  - CCM scrum (SC, EXP): the regression that matters most; past dates now take the new path.
 *  - CCM kanban (LS, AD): burndown is skipped for kanban, so the new code must not disturb it.
 *  - Excel (HUB-IQ): exercises the getChangelogsForKeys stub added to the adapter interface.
 *  - Thrive (DELTA): the case the change exists for.
 *  - A pre-history date: no sprint covers it, so the bypass marker must still be written.
 *  - Today: dateOverride is undefined, so the whole new path must be unreachable.
 */
const TARGETS = [
    { code: 'SC', date: '2026-08-27', why: 'CCM scrum, past date' },
    { code: 'SC', date: '2026-08-28', why: 'CCM scrum, past date' },
    { code: 'EXP', date: '2026-08-27', why: 'CCM scrum, past date' },
    { code: 'EXP', date: '2026-08-28', why: 'CCM scrum, past date' },
    { code: 'LS', date: '2026-08-28', why: 'CCM kanban, past date' },
    { code: 'AD', date: '2026-08-28', why: 'CCM kanban, past date' },
    { code: 'MTN_SDK', date: '2026-08-04', why: 'Excel-backed (has imports), past date' },
    { code: 'TEAM DELTA', date: '2026-08-20', why: 'Thrive, mid completed sprint' },
    { code: 'TEAM DELTA', date: '2026-06-01', why: 'pre-history: no sprint covers this date' },
    { code: 'SC', date: null, why: 'TODAY — new path must be unreachable' },
];

const FIELDS = ['totalTickets', 'statusCounts', 'consideredJiraIds', 'overallHealth', 'ticketKeys',
    'teamMembers', 'sprintBurndown', 'teamMemberAttribution', 'blockedTickets',
    'subBugsLoggedCount', 'reopenedTicketsCount'];

const norm = v => JSON.parse(JSON.stringify(v ?? null));
const key = t => `${t.code}|${t.date ?? 'TODAY'}`;

const JSONB = ['status_counts','blocked_tickets','considered_jira_ids','ticket_keys','team_members',
    'sprint_burndown','confirmed_prod_bug_keys','data_quality_flags','team_member_attribution','team_notes'];
const SCALAR = ['total_tickets','work_summary','overall_health','executive_summary','executive_risks',
    'executive_plan','health_rationale','ticket_details','sub_bugs_logged_count','reopened_tickets_count',
    'manager_insights','original_executive_summary','insights_health','insights_health_reason','updated_at'];

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    await sequelize.authenticate();
    const mode = arg('mode');

    if (mode === 'compare') {
        const a = JSON.parse(fs.readFileSync(path.join(OUT, arg('a')), 'utf8'));
        const b = JSON.parse(fs.readFileSync(path.join(OUT, arg('b')), 'utf8'));
        let diffs = 0;
        for (const k of Object.keys(a)) {
            for (const f of FIELDS) {
                const av = JSON.stringify(a[k]?.[f]), bv = JSON.stringify(b[k]?.[f]);
                if (av === bv) continue;
                diffs++;
                const s = v => (v && v.length > 220 ? v.slice(0, 220) + '…' : v);
                console.log(`  DIFF ${k}.${f}\n    before: ${s(av)}\n    after : ${s(bv)}`);
            }
        }
        console.log(`\nstructural diffs: ${diffs}`);
        process.exitCode = diffs === 0 ? 0 : 1;
        await sequelize.close();
        return;
    }

    // --- snapshot mode: back up, generate every target, capture, restore ---
    const resolved = [];
    for (const t of TARGETS) {
        const project = await Project.findOne({ where: { code: t.code } });
        if (!project) { console.log(`  ${t.code}: NOT FOUND — skipped`); continue; }
        resolved.push({ ...t, boardId: project.jiraBoardId, projectId: project.id });
    }

    const backup = [];
    const todayIst = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    for (const t of resolved) {
        if (!t.boardId) continue;
        const [row] = await sequelize.query(`SELECT * FROM daily_board_snapshots WHERE board_id=:b AND date=:d`,
            { replacements: { b: t.boardId, d: t.date ?? todayIst }, type: sequelize.QueryTypes.SELECT });
        if (row) backup.push(row);
    }
    console.log(`backed up ${backup.length} row(s)\n`);

    const captured = {};
    for (const t of resolved) {
        process.stdout.write(`  ${key(t).padEnd(26)} ${t.why.padEnd(38)} `);
        try {
            await reportService.generateBoardReport(t.code, t.date ?? undefined, true);
            const lookupDate = t.date ?? new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
            const row = t.boardId
                ? await DailyBoardSnapshot.findOne({ where: { boardId: t.boardId, date: lookupDate } })
                : null;
            if (!row) { captured[key(t)] = null; console.log('no snapshot written'); continue; }
            const o = {}; for (const f of FIELDS) o[f] = norm(row[f]);
            captured[key(t)] = o;
            const sb = row.sprintBurndown;
            console.log(sb?.bypassed ? 'BYPASSED' : sb ? `${sb.sprintName} ${sb.totalV2SP}SP/${sb.completedV2SP}done` : 'no burndown');
        } catch (e) {
            captured[key(t)] = { __error: e.message };
            console.log(`ERROR: ${e.message}`);
        }
    }

    fs.writeFileSync(path.join(OUT, arg('out', 'snapshot.json')), JSON.stringify(captured, null, 2));
    console.log(`\nsaved -> ${arg('out', 'snapshot.json')}`);

    // Restore, and delete anything we created that had no original.
    const had = new Set(backup.map(r => `${r.board_id}|${String(r.date).slice(0, 10)}`));
    let deleted = 0;
    for (const t of resolved) {
        const d = t.date ?? todayIst;
        if (!t.boardId || had.has(`${t.boardId}|${d}`)) continue;
        const [, meta] = await sequelize.query(`DELETE FROM daily_board_snapshots WHERE board_id=:b AND date=:d`,
            { replacements: { b: t.boardId, d } });
        deleted += meta?.rowCount ?? 0;
    }
    for (const r of backup) {
        const sets = [...SCALAR.map(c => `${c}=:${c}`), ...JSONB.map(c => `${c}=CAST(:${c} AS jsonb)`)].join(', ');
        const rep = { id: r.id };
        for (const c of SCALAR) rep[c] = r[c] ?? null;
        for (const c of JSONB) rep[c] = r[c] == null ? null : JSON.stringify(r[c]);
        await sequelize.query(`UPDATE daily_board_snapshots SET ${sets} WHERE id=:id`, { replacements: rep });
    }
    console.log(`restored ${backup.length} row(s), deleted ${deleted} created row(s) — DB left as found.`);
    await sequelize.close();
    process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
