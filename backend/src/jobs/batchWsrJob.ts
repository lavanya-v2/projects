/**
 * Batch WSR Generation Job
 *
 * Queues Weekly Status Report generation for ALL Jira-configured projects for
 * a given calendar week. Jobs are staggered in batches of 4 to avoid rate-limit
 * spikes on Jira / Claude.
 *
 * Usage (from backend/ directory):
 *   npm run batch:wsr -- --start 2026-03-16 --end 2026-03-20
 *
 * Constraints (enforced by the WSR service):
 *   --start  must be a Monday or Sunday
 *   --end    must be a Friday or Saturday
 *   Both dates must fall within the same ISO calendar week
 *
 * IMPORTANT PREREQUISITE:
 *   WSR generation reads the daily snapshots (DSRs) for the given week.
 *   Run the batch:dsr job first and confirm all DSRs are generated before
 *   running this job.
 *
 * Stagger strategy:
 *   - Projects are split into batches of BATCH_SIZE (default 4).
 *   - All batches are spread over SPREAD_MINUTES (default 30 min) from
 *     the moment this script is run.
 *
 * Log output: backend/logs/batch-wsr.log
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

/**
 * Total minutes over which all batches are spread.
 *
 * WSR is lighter than DSR — no Jira API calls, just reads daily snapshots
 * from the DB then runs one Claude AI call per project. The weekly queue
 * worker has concurrency 5 (vs DSR's 2), so 5 projects can run in parallel.
 *
 * For 20 projects (5 batches of 4):
 *   - Interval between batches = 15 / 4 = 3.75 min
 *   - All 20 projects queued within 15 min
 *   - Each Claude WSR call takes ~20–40 s → last batch finishes by ~17 min
 *
 * Compare: the existing scheduler staggers 1 project every 2 min → 40 min
 * for 20 projects. This batch job cuts that to ~15 min.
 *
 * Increase this only if you see Claude rate-limit errors in the app logs.
 */
const SPREAD_MINUTES = 15;

// ─── Helpers ───────────────────────────────────────────────────────────────

interface ParsedArgs {
    startDate: string;
    endDate: string;
}

/** Day-of-week names for validation messages. */
const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseArgs(): ParsedArgs {
    const args = process.argv.slice(2);
    const si = args.indexOf('--start');
    const ei = args.indexOf('--end');

    if (si === -1 || ei === -1 || !args[si + 1] || !args[ei + 1]) {
        console.error('Usage: npm run batch:wsr -- --start YYYY-MM-DD --end YYYY-MM-DD');
        console.error('  --start  Week start date (Monday or Sunday)');
        console.error('  --end    Week end date (Friday or Saturday)');
        process.exit(1);
    }

    const startDate = args[si + 1];
    const endDate = args[ei + 1];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        console.error('Error: dates must be in YYYY-MM-DD format.');
        process.exit(1);
    }

    // Start must be Sunday (0) or Monday (1)
    const startDow = new Date(startDate + 'T00:00:00Z').getUTCDay();
    if (startDow !== 0 && startDow !== 1) {
        console.error(`Error: --start ${startDate} is a ${DOW_NAMES[startDow]}. It must be a Monday or Sunday.`);
        process.exit(1);
    }

    // End must be Friday (5) or Saturday (6)
    const endDow = new Date(endDate + 'T00:00:00Z').getUTCDay();
    if (endDow !== 5 && endDow !== 6) {
        console.error(`Error: --end ${endDate} is a ${DOW_NAMES[endDow]}. It must be a Friday or Saturday.`);
        process.exit(1);
    }

    if (startDate > endDate) {
        console.error('Error: --start must not be after --end.');
        process.exit(1);
    }

    // Check both dates are in the same ISO week (max 7 days apart)
    const diffDays = (new Date(endDate + 'T00:00:00Z').getTime() - new Date(startDate + 'T00:00:00Z').getTime())
        / 86_400_000;
    if (diffDays > 7) {
        console.error(`Error: date range spans ${diffDays} days. Both dates must fall within the same calendar week (max 7 days).`);
        process.exit(1);
    }

    return { startDate, endDate };
}

function msToLabel(ms: number): string {
    const min = Math.round(ms / 60_000);
    return min < 60 ? `${min} min` : `${(min / 60).toFixed(1)} h`;
}

function appendLog(line: string): void {
    const logsDir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, 'batch-wsr.log'), line + '\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const { startDate, endDate } = parseArgs();

    console.log('\n📋 Batch WSR Job');
    console.log(`   Week range : ${startDate} → ${endDate}`);
    console.log(`   Batch size : ${BATCH_SIZE} projects`);
    console.log(`   Spread     : ${SPREAD_MINUTES} min`);

    console.warn('\n⚠️  PREREQUISITE CHECK');
    console.warn(`   WSR generation reads the daily DSR snapshots for ${startDate} → ${endDate}.`);
    console.warn('   Confirm all DSRs for this week are generated before proceeding.');
    console.warn('   If DSRs are missing, WSR generation will skip those days or produce incomplete reports.\n');

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
        ? (SPREAD_MINUTES * 60_000) / (numBatches - 1)
        : 0;
    const totalSpreadMs = (numBatches - 1) * batchIntervalMs;

    console.log(`   Projects   : ${projects.length} across ${numBatches} batch(es) of ${BATCH_SIZE}`);
    console.log(`   Batch gap  : ${msToLabel(batchIntervalMs)}`);
    console.log(`   Total span : ~${msToLabel(totalSpreadMs)}`);

    // Create a queue client — no worker started here; workers live in the main app.
    const weeklyQueue = new Queue('weekly-report-generation', { connection: redisConnection });

    let totalQueued = 0;
    const runAt = new Date();
    const logLines: string[] = [
        `[${runAt.toISOString()}] Batch WSR Job started — range: ${startDate} → ${endDate}`,
    ];

    for (let batchIdx = 0; batchIdx < numBatches; batchIdx++) {
        const batchProjects = projects.slice(batchIdx * BATCH_SIZE, (batchIdx + 1) * BATCH_SIZE);
        const delayMs = batchIdx * batchIntervalMs;
        const batchTime = new Date(runAt.getTime() + delayMs);

        console.log(`\n   Batch ${batchIdx + 1}/${numBatches} [${batchTime.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST, delay=${msToLabel(delayMs)}]:`);

        for (const project of batchProjects) {
            const acct = (project as any).account?.code ?? 'Unknown';

            await weeklyQueue.add(
                'generate-wsr-batch',
                { projectName: project.code, startDate, endDate },
                { delay: delayMs },
            );

            const entry = `  [${acct}/${project.code}] WSR ${startDate}→${endDate} → queued (delay: ${msToLabel(delayMs)})`;
            console.log(`     ✅ ${entry.trim()}`);
            logLines.push(entry);
            totalQueued++;
        }
    }

    // Write summary to log file
    logLines.push(`[${new Date().toISOString()}] Batch WSR Job complete — ${totalQueued} jobs queued`);
    logLines.forEach(l => appendLog(l));

    console.log(`\n✅ Done — ${totalQueued} WSR jobs queued.`);
    console.log(`   Log: backend/logs/batch-wsr.log`);
    console.log(`   The app's weekly-report workers will execute them staggered over ~${msToLabel(totalSpreadMs)}.`);
    console.log('   Keep the application running (or start it) to process the queued jobs.\n');

    await weeklyQueue.close();
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
});
