/**
 * Regenerate daily DSRs for a date range, for one project or every project under an account.
 *
 * Why this exists: the RAG-reliability work (severity-weighted bug scoring, proportional
 * weekly/account rollups) changes how daily health is computed. Any daily snapshot generated
 * BEFORE that code deploys still reflects the old formulas. Run this right after a deploy,
 * covering the window from whenever the old code was last known-good through the deploy date,
 * so historical daily data in that window reflects the corrected logic instead of a mix of old
 * and new.
 *
 * Runs against the COMPILED build (requires from ../dist/...), not source via ts-node —
 * deliberately, so it exercises the exact artifact that is actually deployed and running,
 * matching the convention every other backfill script in this folder already follows
 * (backfill-sprint-dsr.js, verify-historical-dsr.js). Build first:
 *   cd backend && npm run build
 *
 * Usage:
 *   node scripts/regenerate-dsr-range.js --project EXP --start 2026-09-28 --end 2026-10-06
 *   node scripts/regenerate-dsr-range.js --account 3   --start 2026-09-28 --end 2026-10-06
 *
 * Both forms DRY-RUN by default — they print the resolved project list and date list and the
 * total number of (project, date) pairs, then exit without touching Jira, the AI, or the
 * database. Pass --execute to actually regenerate:
 *
 *   node scripts/regenerate-dsr-range.js --account 3 --start 2026-09-28 --end 2026-10-06 --execute
 *
 * Notes (the same caveats every backfill script in this folder documents):
 *   - Weekends are skipped automatically (daily snapshots are never generated for Sat/Sun in
 *     this app) and --end is clamped to "today IST" if given a future date.
 *   - force=true is always used: this OVERWRITES any existing snapshot for that (project, date)
 *     in place (upsert on (date, project_id) — no duplicate rows). Safe to re-run the same
 *     range twice; a partial failure can be re-run without re-doing already-succeeded pairs
 *     causing any harm.
 *   - Regenerating a past date reads Jira's CURRENT live state, not a point-in-time capture of
 *     that day — activity/changelog signals stay date-accurate, but the ticket list itself
 *     reflects today's board, same as every other backfill tool here.
 *   - An isSharedTeam project's daily aggregation reads other projects' SAME-DAY snapshots, so
 *     for each date, non-shared-team projects are generated before shared-team ones.
 *   - Sequential, not parallel, to avoid Jira rate-limit spikes — same as every script here.
 *   - This tool regenerates DAILY snapshots ONLY. It does not regenerate weekly or account-
 *     weekly reports for weeks inside the range — those will keep showing whatever they showed
 *     before until separately regenerated (reportService.generateWeeklyReport /
 *     accountReportService.generateAccountWeeklyReport, run by hand for any week that matters).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Op } = require('sequelize');
const sequelize = require('../dist/config/connection').default;
const { Project } = require('../dist/models/Project');
const { Account } = require('../dist/models/Account');
const { reportService } = require('../dist/modules/reports/services/reportService');

// ---- CLI args ---------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, def = null) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? def : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const PROJECT_CODE = arg('project', null);
const ACCOUNT_ID = arg('account', null) ? Number(arg('account')) : null;
const START = arg('start', null);
const END = arg('end', null);
const EXECUTE = flag('execute');

if (!PROJECT_CODE && !ACCOUNT_ID) {
    console.error('Pass exactly one of --project <CODE> or --account <ID>.');
    process.exit(1);
}
if (PROJECT_CODE && ACCOUNT_ID) {
    console.error('Pass only one of --project or --account, not both.');
    process.exit(1);
}
if (!START || !/^\d{4}-\d{2}-\d{2}$/.test(START)) {
    console.error(`Invalid or missing --start (expected YYYY-MM-DD). Got: "${START}"`);
    process.exit(1);
}
if (!END || !/^\d{4}-\d{2}-\d{2}$/.test(END)) {
    console.error(`Invalid or missing --end (expected YYYY-MM-DD). Got: "${END}"`);
    process.exit(1);
}

// ---- Date range: weekdays only, clamped to today IST -------------------------
const istDate = (d) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

function weekdaysBetween(startIso, endIso) {
    const out = [];
    const today = istDate(new Date());
    const cur = new Date(startIso.slice(0, 10) + 'T00:00:00Z');
    const end = new Date(endIso.slice(0, 10) + 'T00:00:00Z');
    while (cur <= end) {
        const day = cur.getUTCDay();
        const iso = cur.toISOString().slice(0, 10);
        if (day !== 0 && day !== 6 && iso <= today) out.push(iso);
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
}

(async () => {
    await sequelize.authenticate();

    const today = istDate(new Date());
    if (END > today) {
        console.warn(`--end (${END}) is in the future; clamping to today IST (${today}).`);
    }
    const dates = weekdaysBetween(START, END);
    if (dates.length === 0) {
        console.error('Resolved date range contains no weekdays on or before today. Nothing to do.');
        process.exit(1);
    }

    // ---- Resolve project list ----
    let nonSharedProjects = [];
    let sharedProjects = [];
    let scopeLabel;

    if (PROJECT_CODE) {
        const project = await Project.findOne({ where: { code: PROJECT_CODE } });
        if (!project) {
            console.error(`Project "${PROJECT_CODE}" not found.`);
            process.exit(1);
        }
        if (!project.jiraBoardId) {
            console.error(`Project "${PROJECT_CODE}" has no Jira board configured — nothing to regenerate.`);
            process.exit(1);
        }
        (project.isSharedTeam ? sharedProjects : nonSharedProjects).push(project);
        scopeLabel = `project ${project.code} (${project.name})`;
    } else {
        const account = await Account.findByPk(ACCOUNT_ID);
        if (!account) {
            console.error(`Account ${ACCOUNT_ID} not found.`);
            process.exit(1);
        }
        const projects = await Project.findAll({
            where: { accountId: ACCOUNT_ID, isActive: true, jiraBoardId: { [Op.ne]: null } },
            order: [['code', 'ASC']],
        });
        if (projects.length === 0) {
            console.error(`Account "${account.name}" (${ACCOUNT_ID}) has no active projects with a Jira board.`);
            process.exit(1);
        }
        nonSharedProjects = projects.filter((p) => !p.isSharedTeam);
        sharedProjects = projects.filter((p) => p.isSharedTeam);
        scopeLabel = `account "${account.name}" (${ACCOUNT_ID}) — ${projects.length} project(s)`;
    }

    const allProjects = [...nonSharedProjects, ...sharedProjects];
    const totalPairs = allProjects.length * dates.length;

    console.log(`\nScope: ${scopeLabel}`);
    console.log(`Projects (non-shared-team first, generated in this order per date):`);
    for (const p of nonSharedProjects) console.log(`  - ${p.code} (${p.name})`);
    for (const p of sharedProjects) console.log(`  - ${p.code} (${p.name})  [shared team — generated last per date]`);
    console.log(`\nDates (${dates.length} weekday(s)): ${dates[0]} .. ${dates[dates.length - 1]}`);
    console.log(`  ${dates.join(', ')}`);
    console.log(`\nTotal (project, date) pairs: ${totalPairs}`);

    if (!EXECUTE) {
        console.log('\nDry run only (default) — no Jira/AI calls made, nothing written. Pass --execute to actually regenerate.');
        await sequelize.close();
        return;
    }

    console.log('\n--execute passed. Regenerating now.');
    console.log('NOTE: each regenerated day reflects Jira\'s CURRENT live board state, not a historical');
    console.log('point-in-time capture of that day — activity/changelog signals stay date-accurate, but');
    console.log('the ticket list itself reflects today\'s board, same as every other backfill tool here.\n');

    const failures = [];
    let succeeded = 0;
    let attempted = 0;

    for (const date of dates) {
        for (const project of allProjects) {
            attempted++;
            const tag = `${project.code} / ${date}`;
            try {
                const snap = await reportService.generateBoardReport(project.code, date, true);
                if (snap) {
                    console.log(`  ✓ [${tag}] health: ${snap.overallHealth || '?'}`);
                    succeeded++;
                } else {
                    console.warn(`  ⚠ [${tag}] returned null (no team issues found for this day)`);
                    failures.push({ tag, reason: 'returned null (no team issues)' });
                }
            } catch (e) {
                const reason = e && e.message ? e.message : String(e);
                console.error(`  ✗ [${tag}] ${reason}`);
                failures.push({ tag, reason });
            }
        }
    }

    console.log(`\nDone. ${succeeded}/${attempted} succeeded, ${failures.length} failed.`);
    if (failures.length > 0) {
        console.log('\nFailed pairs (safe to re-run individually — regeneration is idempotent):');
        for (const f of failures) console.log(`  ${f.tag}: ${f.reason}`);
    }

    await sequelize.close();
    process.exit(failures.length > 0 ? 1 : 0);
})().catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
});
