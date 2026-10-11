/**
 * Recomputes perf_member_scores rows for every completed sprint sync, using
 * the new "net-new bugs only" formula. Run once after deploying the
 * computeAndSaveScores fix that gates bug counting on firstBugSeen.
 *
 * Reads facts and display names from the DB only — does NOT call Jira.
 *
 * Usage:
 *   cd backend
 *   npm run build
 *   node scripts/backfill-quality-scores.js
 *
 * Optional flags:
 *   --projectId <id>   Limit to a single project (handy for spot-checks)
 *   --dryRun           Loop syncs and report counts but skip the writes
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { PerfSprintSync } = require('../dist/models/PerfSprintSync');
const { performanceSyncService } = require('../dist/modules/reports/services/performanceSyncService');

const args = process.argv.slice(2);
const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1];
};
const dryRun = args.includes('--dryRun');
const projectIdFilter = arg('projectId') ? parseInt(arg('projectId'), 10) : null;

(async () => {
    try {
        await sequelize.authenticate();

        const where = { syncStatus: 'done' };
        if (projectIdFilter) where.projectId = projectIdFilter;

        const syncs = await PerfSprintSync.findAll({
            where,
            order: [['project_id', 'ASC'], ['start_date', 'ASC']],
        });

        console.log(
            `Found ${syncs.length} done syncs${projectIdFilter ? ` for project ${projectIdFilter}` : ''}.` +
            (dryRun ? ' (dry run — no writes)' : ''),
        );

        let recomputed = 0;
        let skipped = 0;
        let failed = 0;
        const startTs = Date.now();

        for (let i = 0; i < syncs.length; i++) {
            const s = syncs[i];
            const tag = `[${i + 1}/${syncs.length}] sync ${s.id} (proj ${s.projectId}, ${s.sprintName ?? s.periodLabel ?? 'unnamed'})`;
            try {
                if (dryRun) {
                    console.log(`${tag} — would recompute`);
                    recomputed++;
                    continue;
                }
                const ok = await performanceSyncService.recomputeScoresFromStored(s.id);
                if (ok) {
                    recomputed++;
                    if (recomputed % 25 === 0) {
                        const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
                        console.log(`${tag} — done (${recomputed} recomputed in ${elapsed}s)`);
                    }
                } else {
                    skipped++;
                    console.log(`${tag} — SKIPPED (no facts or no existing scores)`);
                }
            } catch (err) {
                failed++;
                console.error(`${tag} — FAILED: ${err.message}`);
            }
        }

        const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
        console.log(`\nDone in ${elapsed}s.`);
        console.log(`  Recomputed: ${recomputed}`);
        console.log(`  Skipped:    ${skipped}`);
        console.log(`  Failed:     ${failed}`);
    } catch (err) {
        console.error('FATAL:', err.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
