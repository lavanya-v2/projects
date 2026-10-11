/**
 * Backfill daily DSRs across each project's most recently COMPLETED sprint, via BullMQ.
 *
 * Why a queue rather than a loop: each report is a Jira fetch plus an AI call, so ~45 of them
 * takes tens of minutes. Enqueuing lets the existing worker process them two at a time with
 * retries, and keeps a failure on one day from sinking the whole batch.
 *
 * It reuses the SAME queue and entry point the scheduler uses
 * (dsrQueue -> reportService.generateBoardReport(code, date, force = true)), so a backfilled
 * report is produced by exactly the code path that produces a scheduled one.
 *
 * In-flight sprints are ignored by design — only the latest closed sprint is backfilled.
 * Weekends are skipped, matching how the daily reports are produced.
 *
 * IMPORTANT: regenerating a past date reads Jira's CURRENT state. Activity signals stay
 * date-accurate (they come from changelog entries filtered to that day's window), but status
 * counts, ticket lists and blocked/stale sets reflect the board as it is today. A backfilled
 * report is therefore a re-analysis of history, not a recording of it. Back up first.
 *
 * Usage (against the compiled build — npm run build first):
 *   node scripts/backfill-sprint-dsr.js --codes "TEAM DELTA,PHX-YPSILON,TEAM BETA" --dry-run
 *   node scripts/backfill-sprint-dsr.js --codes "TEAM DELTA,PHX-YPSILON,TEAM BETA"
 *   node scripts/backfill-sprint-dsr.js --codes "TEAM DELTA" --direct   # bypass the shared queue
 *
 * --start/--end (both required together) override the auto-detected "latest closed sprint"
 * with an explicit date range instead. The same range applies to every code in --codes.
 *   node scripts/backfill-sprint-dsr.js --codes "TEAM DELTA" --start 2026-08-01 --end 2026-08-14
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { Project } = require('../dist/models/Project');
const { JiraService } = require('../dist/modules/jira/services/jiraService');
const { reportService } = require('../dist/modules/reports/services/reportService');

// NOT required at module scope: importing dsrQueue starts a BullMQ Worker, whose Redis
// connection holds the event loop open forever. A --dry-run that never exits is worse than
// useless, so the queue is loaded only on the path that actually needs it.
const loadQueue = () => require('../dist/modules/reports/queues/dsrQueue').dsrQueue;

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const flag = (n) => argv.includes(`--${n}`);

const CODES = (arg('codes') || '').split(',').map(s => s.trim()).filter(Boolean);
const DRY_RUN = flag('dry-run');
const DIRECT = flag('direct');

const START = arg('start');
const END = arg('end');
if ((START && !END) || (END && !START)) {
    throw new Error('--start and --end must be given together');
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
if (START && (!DATE_RE.test(START) || !DATE_RE.test(END))) {
    throw new Error('--start/--end must be YYYY-MM-DD');
}
if (START && START > END) {
    throw new Error(`--start (${START}) must be <= --end (${END})`);
}

/** YYYY-MM-DD in IST, matching how report dates are keyed elsewhere. */
const istDate = (d) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Weekdays between two dates inclusive, never past today. */
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
    if (!CODES.length) throw new Error('pass --codes "CODE1,CODE2"');
    await sequelize.authenticate();

    const plan = [];
    for (const code of CODES) {
        const project = await Project.findOne({ where: { code } });
        if (!project) { console.log(`  ${code}: NOT FOUND — skipped`); continue; }

        if (START) {
            // Explicit range: skip sprint auto-detection entirely.
            const dates = weekdaysBetween(START, END);
            plan.push({ code, sprint: null, dates });
            console.log(`  ${code.padEnd(14)} [explicit range]  ${START} -> ${END}  ${dates.length} weekdays`);
            continue;
        }

        if (!project.jiraBoardId) { console.log(`  ${code}: no Jira board — skipped`); continue; }

        const jira = JiraService.forProject(project);
        const sprints = await jira.getSprints(project.jiraBoardId, 'closed');
        const closed = (sprints || [])
            .filter(s => s.endDate)
            .sort((a, b) => new Date(b.endDate) - new Date(a.endDate));
        if (!closed.length) { console.log(`  ${code}: no closed sprint — skipped`); continue; }

        const sprint = closed[0];
        const dates = weekdaysBetween(sprint.startDate, sprint.endDate);
        plan.push({ code, sprint, dates });
        console.log(`  ${code.padEnd(14)} "${sprint.name}"  ${sprint.startDate.slice(0, 10)} -> ${sprint.endDate.slice(0, 10)}  ${dates.length} weekdays`);
    }

    const total = plan.reduce((n, p) => n + p.dates.length, 0);
    console.log(`\n${total} report-day(s) across ${plan.length} project(s).`);
    if (DRY_RUN) {
        for (const p of plan) console.log(`  ${p.code}: ${p.dates.join(', ')}`);
        console.log('\n--dry-run: nothing enqueued.');
        await sequelize.close();
        return;
    }

    // --direct: generate in THIS process instead of enqueuing.
    //
    // The queue is shared with the running backend, which starts a BullMQ worker in-process at
    // boot. That worker keeps whatever code was built when the server started, so if the server
    // has not been restarted since a deploy it silently processes some jobs with stale code —
    // producing a run whose rows came from two different versions, with nothing to indicate it.
    // Direct mode always executes the code in this process, at the cost of no retries and no
    // concurrency. Prefer it whenever you cannot guarantee the server was restarted.
    if (DIRECT) {
        console.log('running DIRECTLY in this process (queue bypassed)\n');
        let ok = 0, failed = 0;
        for (const p of plan) {
            for (const date of p.dates) {
                process.stdout.write(`  ${p.code} ${date} ... `);
                try {
                    await reportService.generateBoardReport(p.code, date, true);
                    ok++; console.log('ok');
                } catch (e) {
                    failed++; console.log(`FAILED: ${e.message}`);
                }
            }
        }
        console.log(`\ndone (direct). generated=${ok} failed=${failed}`);
        await sequelize.close();
        process.exit(failed ? 1 : 0);
    }

    const dsrQueue = loadQueue();

    // Deterministic jobId per (project, date) so a re-run does not double-process.
    const jobs = [];
    for (const p of plan) {
        for (const date of p.dates) {
            jobs.push(await dsrQueue.add(
                'generate-dsr',
                { projectName: p.code, date },
                { jobId: `backfill:${p.code}:${date}` },
            ));
        }
    }
    console.log(`enqueued ${jobs.length} job(s); waiting for the queue to drain...\n`);

    // Track OUR jobs by id, not queue-wide counts. This queue is shared with the running
    // backend's scheduler, so getJobCounts()/getFailed() also report its jobs — an earlier
    // version of this script blamed itself for 93 failures that belonged to CCM scheduler runs.
    const ourIds = new Set(jobs.map(j => j.id));
    const started = Date.now();
    let lastLine = '';
    for (;;) {
        await new Promise(r => setTimeout(r, 5000));
        const states = await Promise.all(jobs.map(async j => {
            const fresh = await dsrQueue.getJob(j.id);
            return fresh ? await fresh.getState() : 'completed'; // removeOnComplete drops finished jobs
        }));
        const tally = states.reduce((acc, s) => (acc[s] = (acc[s] ?? 0) + 1, acc), {});
        const pending = (tally.waiting ?? 0) + (tally.active ?? 0) + (tally.delayed ?? 0);
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        const line = `  [${mins}m] completed ${tally.completed ?? 0}  failed ${tally.failed ?? 0}  active ${tally.active ?? 0}  waiting ${(tally.waiting ?? 0) + (tally.delayed ?? 0)}`;
        if (line.slice(line.indexOf(']')) !== lastLine) { console.log(line); lastLine = line.slice(line.indexOf(']')); }
        if (pending === 0) break;
    }

    const failedJobs = [];
    for (const j of jobs) {
        const fresh = await dsrQueue.getJob(j.id);
        if (fresh && (await fresh.getState()) === 'failed') failedJobs.push(fresh);
    }
    if (failedJobs.length) {
        console.log(`\n${failedJobs.length} of OUR job(s) failed:`);
        for (const j of failedJobs) console.log(`  ${j.data?.projectName} ${j.data?.date}: ${j.failedReason}`);
    }
    console.log(`\ndone. ours: enqueued=${ourIds.size} failed=${failedJobs.length}`);

    await sequelize.close();
    process.exit(failedJobs.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
