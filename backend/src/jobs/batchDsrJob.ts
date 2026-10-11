/**
 * Batch DSR Generation Job
 *
 * Queues Daily Status Report generation for ALL Jira-configured projects across
 * a given weekday date range. Jobs are staggered in batches of 4 to avoid
 * rate-limit spikes on Jira / Claude.
 *
 * Usage (from backend/ directory):
 *   npm run batch:dsr -- --start 2026-03-16 --end 2026-03-20
 *
 * This script only QUEUES jobs. The workers that actually run the DSR generation
 * are part of the main application process (dsrQueue.ts worker). Ensure the app
 * is running (or will be started soon) to process the queued jobs.
 *
 * Stagger strategy:
 *   - Projects are split into batches of BATCH_SIZE (default 4).
 *   - Each day's batches are spread over DAY_SPREAD_MINUTES (default 30 min).
 *   - A DAY_GAP_MINUTES (default 45 min) buffer separates consecutive days so
 *     that Day N's DSRs are fully committed to the DB before Day N+1 begins.
 *     (Monday's DSR window start is derived from Friday's snapshot timestamp;
 *      if Friday's snapshot does not exist, the service falls back to the
 *      previous calendar day at the configured IST window start
 *      (REPORT_WINDOW_START_HOUR/MINUTE) — pre-generate Friday's DSRs if needed.)
 *
 * Log output: backend/logs/batch-dsr.log
 */

import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { Project } from '../models/Project';
import { Account } from '../models/Account';
import { Op } from 'sequelize';
import * as fs from 'fs';
import * as path from 'path';

// Side-effect import: initialises Sequelize with all models (dotenv loaded via -r dotenv/config)
import '../config/connection';

// ─── Config ────────────────────────────────────────────────────────────────

/** Projects processed simultaneously in one batch wave. */
const BATCH_SIZE = 6;

/** Total minutes over which one day's batches are spread. */
const DAY_SPREAD_MINUTES = 20;

/**
 * Minutes between the start of consecutive days.
 *
 * Why this must be > DAY_SPREAD_MINUTES:
 *   The last batch of Day N becomes available at T + DAY_SPREAD_MINUTES.
 *   With 2 concurrent workers and BATCH_SIZE=6, the last batch (often just
 *   2–3 projects) finishes in ~2 min. So all Day N snapshots are in the DB
 *   by T + DAY_SPREAD_MINUTES + ~2 min ≈ T+22 min.
 *   Day N+1 must start AFTER this to derive its window from Day N's snapshot.
 *
 *   Example (20 projects → 4 batches of 6/6/6/2):
 *     Batch 0 at T+0, Batch 1 at T+6.7, Batch 2 at T+13.3, Batch 3 at T+20
 *     All done by T+22 min → 25 min gap leaves a 3-min safety buffer.
 *
 *   Increase this if you see Tuesday/Wednesday DSRs using an incorrect
 *   (too-early) window start — that indicates the previous day's jobs
 *   hadn't finished when the next day's batch started.
 */
const DAY_GAP_MINUTES = 25;

// ─── Helpers ───────────────────────────────────────────────────────────────

interface ParsedArgs {
    startDate: string;
    endDate: string;
}

function parseArgs(): ParsedArgs {
    const args = process.argv.slice(2);
    const si = args.indexOf('--start');
    const ei = args.indexOf('--end');

    if (si === -1 || ei === -1 || !args[si + 1] || !args[ei + 1]) {
        console.error('Usage: npm run batch:dsr -- --start YYYY-MM-DD --end YYYY-MM-DD');
        process.exit(1);
    }

    const startDate = args[si + 1];
    const endDate = args[ei + 1];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        console.error('Error: dates must be in YYYY-MM-DD format.');
        process.exit(1);
    }
    if (startDate > endDate) {
        console.error('Error: --start must not be after --end.');
        process.exit(1);
    }

    return { startDate, endDate };
}

/** Returns YYYY-MM-DD strings for every Monday–Friday in [startDate, endDate]. */
function getWeekdays(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const cur = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');

    while (cur <= end) {
        const dow = cur.getUTCDay(); // 0 = Sun, 6 = Sat
        if (dow >= 1 && dow <= 5) {
            dates.push(cur.toISOString().substring(0, 10));
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
}

function msToLabel(ms: number): string {
    const min = Math.round(ms / 60_000);
    return min < 60 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
}

function appendLog(line: string): void {
    const logsDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, 'batch-dsr.log'), line + '\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const { startDate, endDate } = parseArgs();
    const dates = getWeekdays(startDate, endDate);

    if (dates.length === 0) {
        console.error('No weekdays found in the given date range. Nothing to do.');
        process.exit(1);
    }

    // Monday-specific warning
    const mondays = dates.filter(d => new Date(d + 'T00:00:00Z').getUTCDay() === 1);
    if (mondays.length > 0) {
        console.warn('\n⚠️  MONDAY WINDOW NOTE');
        console.warn(`   Monday(s) detected: ${mondays.join(', ')}`);
        console.warn('   The DSR report-window start for Monday is derived from the most recent');
        console.warn('   existing snapshot (ideally Friday\'s DSR updatedAt timestamp).');
        console.warn('   If Friday\'s DSR does not exist, the service falls back to the previous');
        console.warn('   calendar day at the configured IST window start (Sunday), which may miss any weekend activity.');
        console.warn('   Ensure Friday\'s DSRs are generated before running this job.\n');
    }

    // Fetch active projects
    const projects = await Project.findAll({
        where: { jiraBoardId: { [Op.ne]: null }, isActive: true },
        include: [{ model: Account, attributes: ['code'] }],
        order: [['code', 'ASC']],
    });

    if (projects.length === 0) {
        console.error('No projects with a Jira board configured. Aborting.');
        process.exit(1);
    }

    const numBatches = Math.ceil(projects.length / BATCH_SIZE);
    // Spread batches evenly; if only 1 batch, no interval needed.
    const batchIntervalMs = numBatches > 1
        ? (DAY_SPREAD_MINUTES * 60_000) / (numBatches - 1)
        : 0;
    const dayGapMs = DAY_GAP_MINUTES * 60_000;
    const totalSpreadMs = (dates.length - 1) * dayGapMs + (numBatches - 1) * batchIntervalMs;

    console.log('\n🗓️  Batch DSR Job');
    console.log(`   Range      : ${startDate} → ${endDate}`);
    console.log(`   Weekdays   : ${dates.join(', ')} (${dates.length} day(s))`);
    console.log(`   Projects   : ${projects.length} across ${numBatches} batch(es) of ${BATCH_SIZE}`);
    console.log(`   Day spread : ${DAY_SPREAD_MINUTES} min per day`);
    console.log(`   Day gap    : ${DAY_GAP_MINUTES} min between days`);
    console.log(`   Batch gap  : ${msToLabel(batchIntervalMs)}`);
    console.log(`   Total span : ~${msToLabel(totalSpreadMs)}`);

    // Create a queue client — no worker started here; workers live in the main app.
    const dsrQueue = new Queue('dsr-generation', { connection: redisConnection });

    let totalQueued = 0;
    const runAt = new Date();
    const logLines: string[] = [
        `[${runAt.toISOString()}] Batch DSR Job started — range: ${startDate} → ${endDate}`,
    ];

    for (let dayIdx = 0; dayIdx < dates.length; dayIdx++) {
        const dateStr = dates[dayIdx];
        const dayBaseDelayMs = dayIdx * dayGapMs;
        const dayQueueTime = new Date(runAt.getTime() + dayBaseDelayMs);

        console.log(`\n📅 Day ${dayIdx + 1}/${dates.length}: ${dateStr}`);
        console.log(`   Queue window starts at: ${dayQueueTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);

        for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
            const batchProjects = projects.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
            const delayMs = dayBaseDelayMs + batchIdx * batchIntervalMs;
            const batchTime = new Date(runAt.getTime() + delayMs);

            console.log(`\n   Batch ${batchIdx + 1}/${numBatches} [${batchTime.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST, delay=${msToLabel(delayMs)}]:`);

            for (const project of batchProjects) {
                const acct = (project as any).account?.code ?? 'Unknown';

                await dsrQueue.add(
                    'generate-dsr-batch',
                    { projectName: project.code, date: dateStr },
                    { delay: delayMs },
                );

                const entry = `  [${acct}/${project.code}] DSR ${dateStr} → queued (delay: ${msToLabel(delayMs)})`;
                console.log(`     ✅ ${entry.trim()}`);
                logLines.push(entry);
                totalQueued++;
            }
        }
    }

    // Write summary to log file
    logLines.push(`[${new Date().toISOString()}] Batch DSR Job complete — ${totalQueued} jobs queued`);
    logLines.forEach(l => appendLog(l));

    console.log(`\n✅ Done — ${totalQueued} DSR jobs queued across ${dates.length} day(s).`);
    console.log(`   Log: backend/logs/batch-dsr.log`);
    console.log(`   The app's DSR workers will execute them staggered over ~${msToLabel(totalSpreadMs)}.`);
    console.log('   Keep the application running (or start it) to process the queued jobs.');
    console.log('   Sprint rollover note: if a new sprint started after any target date, sprint burndown');
    console.log('   and health scoring will be bypassed for those dates. Search [SprintRolloverBypass] in');
    console.log('   the application logs (pm2 logs / server stdout) to see which dates were affected.\n');

    await dsrQueue.close();
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
});
