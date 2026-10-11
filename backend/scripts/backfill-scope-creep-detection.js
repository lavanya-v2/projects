/**
 * One-shot backfill: re-run perf-sprint-sync against every existing
 * PerfSprintSync row so that the corrected wasScopeChange detection (which
 * excludes carry-in from the immediately-preceding sprint) gets applied to
 * historical perf_ticket_facts.
 *
 * Iterates rows in ascending endDate order so each sync's prior is
 * already-corrected before it re-runs. Calls the same syncSprint orchestrator
 * the UI uses, which deletes and rebuilds PerfTicketFact + PerfMemberScore
 * for the target sync — idempotent and safe to re-run.
 *
 * Usage:
 *   cd backend && npm run build
 *   node scripts/backfill-scope-creep-detection.js                   # all projects
 *   node scripts/backfill-scope-creep-detection.js --projectId 8     # scope to EXP only
 *   node scripts/backfill-scope-creep-detection.js --syncId 229      # one specific sync
 *   node scripts/backfill-scope-creep-detection.js --dry-run         # list, do not call Jira
 *
 * Cost: each call hits Jira's REST API and rebuilds the per-sprint facts.
 * Run during off-hours and watch for rate limits.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { PerfSprintSync } = require('../dist/models/PerfSprintSync');
const { performanceSyncService } = require('../dist/modules/reports/services/performanceSyncService');

function parseArgs(argv) {
    const out = { projectId: null, syncId: null, dryRun: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--projectId') out.projectId = parseInt(argv[++i], 10);
        else if (a === '--syncId') out.syncId = parseInt(argv[++i], 10);
        else if (a === '--dry-run') out.dryRun = true;
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv);
    await sequelize.authenticate();

    const where = { syncStatus: 'done' };
    if (args.projectId) where.projectId = args.projectId;
    if (args.syncId) where.id = args.syncId;

    const syncs = await PerfSprintSync.findAll({
        where,
        order: [['endDate', 'ASC'], ['id', 'ASC']],
        attributes: ['id', 'projectId', 'jiraSprintId', 'sprintName', 'endDate'],
    });

    const eligible = syncs.filter(s => s.jiraSprintId != null);
    console.log(`[backfill] ${eligible.length} eligible PerfSprintSync rows (skipped ${syncs.length - eligible.length} non-sprint syncs)`);

    if (args.dryRun) {
        for (const s of eligible) {
            console.log(`  [dry-run] would re-sync id=${s.id} project=${s.projectId} jiraSprint=${s.jiraSprintId} (${s.sprintName})`);
        }
        await sequelize.close();
        return;
    }

    let okCount = 0;
    let failCount = 0;
    const failures = [];

    for (const s of eligible) {
        try {
            console.log(`[backfill] re-syncing id=${s.id} project=${s.projectId} jiraSprint=${s.jiraSprintId} (${s.sprintName})`);
            await performanceSyncService.syncSprint(s.projectId, s.jiraSprintId);
            okCount++;
        } catch (err) {
            failCount++;
            failures.push({ id: s.id, projectId: s.projectId, jiraSprintId: s.jiraSprintId, error: err.message });
            console.error(`[backfill]  FAILED id=${s.id}: ${err.message}`);
        }
    }

    console.log(`\n[backfill] done. ok=${okCount} fail=${failCount}`);
    if (failures.length) {
        console.log('[backfill] failures:');
        for (const f of failures) console.log(`  id=${f.id} project=${f.projectId} jiraSprint=${f.jiraSprintId}: ${f.error}`);
    }

    await sequelize.close();
}

main().catch(err => {
    console.error('[backfill] fatal:', err);
    process.exit(1);
});
