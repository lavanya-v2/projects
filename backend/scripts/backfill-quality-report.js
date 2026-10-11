/**
 * Backfill `quality_report` on existing perf_sprint_syncs by fetching Jira's
 * GreenHopper sprint-report sums and comparing them against our stored numbers.
 *
 * Idempotent: by default only targets rows where quality_report IS NULL.
 * Use --force to recompute everything.
 *
 * Usage:
 *   cd backend && npm run build
 *   node scripts/backfill-quality-report.js                # all sprint syncs missing report
 *   node scripts/backfill-quality-report.js --syncId 254   # one specific sync
 *   node scripts/backfill-quality-report.js --dry-run      # preview, no writes
 *   node scripts/backfill-quality-report.js --force        # recompute even if set
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { PerfSprintSync } = require('../dist/models/PerfSprintSync');
const { PerfTicketFact } = require('../dist/models/PerfTicketFact');
const { Project } = require('../dist/models/Project');
const { JiraService } = require('../dist/modules/jira/services/jiraService');

const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

const pctDiff = (a, b) => {
    const denom = Math.max(Math.abs(a), Math.abs(b));
    return denom > 0 ? Math.abs(a - b) / denom : 0;
};

async function main() {
    await sequelize.authenticate();

    const where = { syncType: 'sprint', syncStatus: 'done' };
    if (!force) where.qualityReport = null;
    if (arg('syncId')) where.id = parseInt(arg('syncId'), 10);

    const syncs = await PerfSprintSync.findAll({ where, order: [['id', 'ASC']] });
    console.log(`${syncs.length} sync(s) to process${dryRun ? ' (dry-run)' : ''}.`);

    let ok = 0, flagged = 0, fail = 0;
    for (const sync of syncs) {
        try {
            const project = await Project.findByPk(sync.projectId);
            if (!project || !sync.jiraSprintId) { fail++; continue; }
            const jira = new JiraService(project.jiraBaseUrl, project.jiraEmail, project.jiraApiToken);

            const ghReport = await jira.getSprintReport(project.jiraBoardId, sync.jiraSprintId);
            const facts = await PerfTicketFact.findAll({ where: { syncId: sync.id, wasCompleted: true } });
            const ourCompletedSp = Math.round(
                facts.reduce((s, f) => s + Number(f.storyPoints ?? 0), 0) * 100
            ) / 100;
            const ourCommittedSp = sync.committedSp != null ? Number(sync.committedSp) : null;

            const s = ghReport.sums;
            const jiraCommitted = (s.completedInitialEstimateSp ?? 0) + (s.notCompletedInitialEstimateSp ?? 0);
            const jiraDone = (s.completedEstimateSp ?? 0) + (s.completedInAnotherSprintEstimateSp ?? 0);
            const flags = [];
            if (ourCommittedSp != null && ourCommittedSp > 0
                && s.completedInitialEstimateSp != null
                && pctDiff(ourCommittedSp, jiraCommitted) > 0.10) {
                flags.push('committed_diff_gt_10pct');
            }
            if (ourCompletedSp > 0 && s.completedEstimateSp != null
                && pctDiff(ourCompletedSp, jiraDone) > 0.10) {
                flags.push('done_diff_gt_10pct');
            }
            const qualityReport = {
                ourCommittedSp,
                jiraInitialCompletedSp: s.completedInitialEstimateSp,
                jiraInitialNotCompletedSp: s.notCompletedInitialEstimateSp,
                jiraInitialPuntedSp: s.puntedInitialEstimateSp,
                ourCompletedSp,
                jiraCompletedSp: s.completedEstimateSp,
                jiraCompletedInAnotherSp: s.completedInAnotherSprintEstimateSp,
                divergenceFlags: flags,
            };

            if (flags.length > 0) {
                console.log(`  Sync ${sync.id} (${sync.sprintName}): flags=[${flags.join(',')}]  ours_committed=${ourCommittedSp} jira_committed=${jiraCommitted}  ours_done=${ourCompletedSp} jira_done=${jiraDone}`);
                flagged++;
            } else {
                ok++;
            }
            if (!dryRun) await sync.update({ qualityReport });
        } catch (e) {
            console.error(`  Sync ${sync.id} failed: ${e.message}`);
            fail++;
        }
    }
    console.log(`\nDone. ${ok} clean, ${flagged} flagged, ${fail} failed.`);
    await sequelize.close();
}

main().catch(err => { console.error('Backfill failed:', err); process.exit(1); });
