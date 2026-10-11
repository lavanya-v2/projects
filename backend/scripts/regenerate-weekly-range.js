/**
 * Regenerate weekly reports covering a date range, for one project or every project under an
 * account — the weekly-level counterpart to regenerate-dsr-range.js.
 *
 * Why this exists: regenerate-dsr-range.js regenerates DAILY snapshots only, by design — it
 * deliberately does not cascade into weekly/account reports (no-auto-cascade is a standing rule
 * in this codebase). After running it, the weeks it touched still show whatever weekly numbers
 * they showed before, until separately regenerated. This script is that separate, deliberate
 * step: given the same kind of date range, it resolves the Friday-Thursday week(s) that range
 * overlaps and regenerates each project's weekly report for those weeks, plus the account-level
 * weekly rollup when run in --account mode.
 *
 * Runs against the COMPILED build (requires from ../dist/...), not source via ts-node —
 * deliberately, so it exercises the exact artifact that is actually deployed and running, same
 * convention as regenerate-dsr-range.js and every other backfill script in this folder. Build
 * first:
 *   cd backend && npm run build
 *
 * Usage:
 *   node scripts/regenerate-weekly-range.js --project LOT --start 2026-08-17 --end 2026-08-28
 *   node scripts/regenerate-weekly-range.js --account 3   --start 2026-08-17 --end 2026-08-28
 *
 * --start/--end do NOT need to already be a Friday and Thursday — any dates work. They're
 * resolved to the enclosing Friday-Thursday week(s): the Friday on or before --start, through
 * the Thursday on or after --end. Every whole week that range overlaps gets regenerated.
 *
 * Both forms DRY-RUN by default — print the resolved project list and resolved week list (real
 * Friday/Thursday dates, not just week numbers) and the total pair count, then exit without
 * touching Jira, the AI, or the database. Pass --execute to actually regenerate:
 *
 *   node scripts/regenerate-weekly-range.js --account 3 --start 2026-08-17 --end 2026-08-28 --execute
 *
 * Notes:
 *   - force=true is always used: this OVERWRITES any existing weekly report for that
 *     (project, week) / (account, week) in place. Safe to re-run.
 *   - No shared-team ordering concern here (unlike the daily script) — generateWeeklyReport has
 *     no cross-project dependency, and generateAccountWeeklyReport already excludes shared-team
 *     projects from its own rollup (isSharedTeam: false), so nothing extra to handle.
 *   - --account mode regenerates EVERY project's own weekly report first (explicitly, not
 *     relying on generateAccountWeeklyReport's internal missing-project fallback, so this script
 *     doesn't depend on that other function's behavior), then the account-level rollup, per week.
 *   - Sequential, not parallel, to avoid Jira rate-limit spikes — same as every script here.
 *   - This tool regenerates WEEKLY reports only. Daily snapshots are untouched — run
 *     regenerate-dsr-range.js first if the underlying daily data also needs refreshing.
 *     Monthly/program-level reports are also untouched — separate, not yet built.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Op } = require('sequelize');
const sequelize = require('../dist/config/connection').default;
const { Project } = require('../dist/models/Project');
const { Account } = require('../dist/models/Account');
const { reportService } = require('../dist/modules/reports/services/reportService');
const { accountReportService } = require('../dist/modules/reports/services/accountReportService');

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

// ---- Week resolution: Friday-Thursday, same day-of-week math as reportWindow.ts's
// currentFriThuWeek/daysSinceLastFriday, reimplemented here in plain JS (that file exports
// TS not requireable directly from a .js script against dist in a way that keeps this
// self-contained) — kept in exact same shape so the resolved weeks match the app exactly. ----
const daysSinceLastFriday = (d) => (d.getUTCDay() + 2) % 7; // Fri=0, Sat=1, ..., Thu=6

function fridayOnOrBefore(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - daysSinceLastFriday(d));
    return d.toISOString().slice(0, 10);
}

function weeksBetween(startIso, endIso) {
    const weeks = [];
    let weekStart = fridayOnOrBefore(startIso);
    const lastWeekStart = fridayOnOrBefore(endIso);
    while (weekStart <= lastWeekStart) {
        const wsDate = new Date(weekStart + 'T00:00:00Z');
        const weDate = new Date(wsDate);
        weDate.setUTCDate(wsDate.getUTCDate() + 6);
        weeks.push({ start: weekStart, end: weDate.toISOString().slice(0, 10) });
        wsDate.setUTCDate(wsDate.getUTCDate() + 7);
        weekStart = wsDate.toISOString().slice(0, 10);
    }
    return weeks;
}

(async () => {
    await sequelize.authenticate();

    const weeks = weeksBetween(START, END);
    if (weeks.length === 0) {
        console.error('Resolved range contains no weeks. Nothing to do.');
        process.exit(1);
    }

    // ---- Resolve project list ----
    let projects = [];
    let account = null;
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
        projects = [project];
        scopeLabel = `project ${project.code} (${project.name})`;
    } else {
        account = await Account.findByPk(ACCOUNT_ID);
        if (!account) {
            console.error(`Account ${ACCOUNT_ID} not found.`);
            process.exit(1);
        }
        projects = await Project.findAll({
            where: { accountId: ACCOUNT_ID, isActive: true, jiraBoardId: { [Op.ne]: null } },
            order: [['code', 'ASC']],
        });
        if (projects.length === 0) {
            console.error(`Account "${account.name}" (${ACCOUNT_ID}) has no active projects with a Jira board.`);
            process.exit(1);
        }
        scopeLabel = `account "${account.name}" (${ACCOUNT_ID}) — ${projects.length} project(s)`;
    }

    const projectPairs = projects.length * weeks.length;
    const accountPairs = ACCOUNT_ID ? weeks.length : 0;
    const totalPairs = projectPairs + accountPairs;

    console.log(`\nScope: ${scopeLabel}`);
    console.log(`Projects:`);
    for (const p of projects) console.log(`  - ${p.code} (${p.name})`);
    console.log(`\nWeeks (${weeks.length}, Friday-Thursday):`);
    for (const w of weeks) console.log(`  ${w.start} .. ${w.end}`);
    console.log(`\nTotal pairs: ${projectPairs} (project, week)${ACCOUNT_ID ? ` + ${accountPairs} (account, week)` : ''} = ${totalPairs}`);

    if (!EXECUTE) {
        console.log('\nDry run only (default) — no Jira/AI calls made, nothing written. Pass --execute to actually regenerate.');
        await sequelize.close();
        return;
    }

    console.log('\n--execute passed. Regenerating now.\n');

    const failures = [];
    let succeeded = 0;
    let attempted = 0;

    for (const week of weeks) {
        for (const project of projects) {
            attempted++;
            const tag = `${project.code} / ${week.start}..${week.end}`;
            try {
                const r = await reportService.generateWeeklyReport(project.code, week.start, week.end, true);
                if (r) {
                    console.log(`  ✓ [${tag}] status: ${r.status || '?'}`);
                    succeeded++;
                } else {
                    console.warn(`  ⚠ [${tag}] returned null (no data for this week)`);
                    failures.push({ tag, reason: 'returned null (no data)' });
                }
            } catch (e) {
                const reason = e && e.message ? e.message : String(e);
                console.error(`  ✗ [${tag}] ${reason}`);
                failures.push({ tag, reason });
            }
        }

        if (ACCOUNT_ID) {
            attempted++;
            const tag = `account ${account.name} / ${week.start}..${week.end}`;
            try {
                const r = await accountReportService.generateAccountWeeklyReport(ACCOUNT_ID, week.start, week.end, true);
                if (r) {
                    console.log(`  ✓ [${tag}] health: ${r.health || '?'}`);
                    succeeded++;
                } else {
                    console.warn(`  ⚠ [${tag}] returned null`);
                    failures.push({ tag, reason: 'returned null' });
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
