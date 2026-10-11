/**
 * One-shot backfill: populate `committed_sp` on existing `perf_sprint_syncs`
 * rows. Computes by walking each ticket's Sprint-field + Story-Points-field
 * changelogs to determine "was this in the sprint at sprint-start, and what
 * was its SP at that moment". Net Scope Change = Final Scope - Committed.
 *
 * Idempotent: by default only targets rows where committed_sp IS NULL.
 * Use --force to recompute everything.
 *
 * Usage:
 *   cd backend && npm run build
 *   node scripts/backfill-committed-sp.js                 # all sprint syncs with null committed_sp
 *   node scripts/backfill-committed-sp.js --syncId 249    # one specific sync
 *   node scripts/backfill-committed-sp.js --dry-run       # preview, no writes
 *   node scripts/backfill-committed-sp.js --force         # recompute even if already set
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { PerfSprintSync } = require('../dist/models/PerfSprintSync');
const { PerfTicketFact } = require('../dist/models/PerfTicketFact');
const { Project } = require('../dist/models/Project');
const { JiraService } = require('../dist/modules/jira/services/jiraService');
const {
    getSprintFieldIdsAt,
    getStoryPointsAt,
} = require('../dist/modules/reports/services/performanceSyncService');

const args = process.argv.slice(2);
const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1];
};
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

async function main() {
    await sequelize.authenticate();

    const where = { syncType: 'sprint', syncStatus: 'done' };
    if (!force) where.committedSp = null;
    if (arg('syncId')) where.id = parseInt(arg('syncId'), 10);

    const syncs = await PerfSprintSync.findAll({ where, order: [['id', 'ASC']] });
    if (syncs.length === 0) {
        console.log('No syncs to process.');
        return;
    }

    console.log(`Processing ${syncs.length} sync(s)${dryRun ? ' (dry-run)' : ''}.`);

    let succeeded = 0;
    let skipped = 0;
    for (const sync of syncs) {
        try {
            const project = await Project.findByPk(sync.projectId);
            if (!project) {
                console.warn(`  Sync ${sync.id}: project ${sync.projectId} missing, skipping.`);
                skipped++;
                continue;
            }
            if (!sync.jiraSprintId) {
                console.warn(`  Sync ${sync.id} (${sync.sprintName}): no jira_sprint_id, skipping.`);
                skipped++;
                continue;
            }

            const jira = new JiraService(project.jiraBaseUrl, project.jiraEmail, project.jiraApiToken);

            const sprintResp = await jira.client.get(`/rest/agile/1.0/sprint/${sync.jiraSprintId}`);
            const sprintStartIso = sprintResp.data?.startDate;
            if (!sprintStartIso) {
                console.warn(`  Sync ${sync.id} (${sync.sprintName}): no sprint startDate in Jira, skipping.`);
                skipped++;
                continue;
            }
            const sprintStartTs = new Date(sprintStartIso);

            const facts = await PerfTicketFact.findAll({ where: { syncId: sync.id } });
            const keys = facts.map(f => f.jiraKey).filter(Boolean);
            if (keys.length === 0) {
                console.log(`  Sync ${sync.id} (${sync.sprintName}): no facts, committedSp = 0.`);
                if (!dryRun) await sync.update({ committedSp: 0 });
                succeeded++;
                continue;
            }

            // Bulk fetch: one paginated call to the Agile board endpoint returns
            // ALL current-in-sprint issues with embedded changelog + created date.
            // Replaces N×per-issue changelog fetches (~70x fewer API calls).
            const changelogs = new Map();
            const createdByKey = new Map();
            const issuesUrl = `/rest/agile/1.0/board/${project.jiraBoardId}/issue?jql=${encodeURIComponent(`sprint = ${sync.jiraSprintId}`)}&expand=changelog&fields=*all`;
            const bulkIssues = await jira.getAllIssuesFromUrl(issuesUrl);
            for (const iss of bulkIssues) {
                changelogs.set(iss.key, iss.changelog?.histories ?? []);
                if (iss.fields?.created) createdByKey.set(iss.key, new Date(iss.fields.created));
            }

            // Punted tickets aren't returned by `sprint = X` JQL (they were removed).
            // Pull their changelogs/created dates separately.
            const puntedKeys = keys.filter(k => !changelogs.has(k));
            if (puntedKeys.length > 0) {
                const puntedChangelogs = await jira.getChangelogsForKeys(puntedKeys);
                for (const [k, hist] of puntedChangelogs.entries()) changelogs.set(k, hist);
                try {
                    const puntedIssues = await jira.getAllIssuesFromJql(`key in (${puntedKeys.join(',')})`);
                    for (const iss of puntedIssues) {
                        if (iss.fields?.created) createdByKey.set(iss.key, new Date(iss.fields.created));
                    }
                } catch (e) {
                    console.warn(`    punted-created-date fetch failure: ${e.message}`);
                }
            }
            console.log(`    fetched ${bulkIssues.length} in-sprint + ${puntedKeys.length} punted; created-dates: ${createdByKey.size}/${keys.length}`);

            // Mirror the algorithm in performanceSyncService.syncSprint (committedSp block).
            let committedSp = 0;
            const sprintIdStr = String(sync.jiraSprintId);
            for (const f of facts) {
                // Pattern A — unassigned punted = placeholder, never committed (see service)
                if (f.wasPunted && !f.assigneeJiraId) continue;

                const hist = changelogs.get(f.jiraKey) ?? [];
                const sprintIds = getSprintFieldIdsAt(hist, sprintStartTs);
                const createdTs = createdByKey.get(f.jiraKey) ?? null;

                let wasInSprintAtStart;
                let spAtStart = 0;
                if (sprintIds === null) {
                    const createdBeforeStart = createdTs ? createdTs <= sprintStartTs : !f.wasPunted;
                    wasInSprintAtStart = createdBeforeStart && !f.wasPunted;
                    if (wasInSprintAtStart) spAtStart = Number(f.storyPoints ?? 0);
                } else if (sprintIds.has(sprintIdStr) && (!createdTs || createdTs <= sprintStartTs)) {
                    // Pattern C — creation-date guard
                    wasInSprintAtStart = true;
                    spAtStart = getStoryPointsAt(hist, sprintStartTs, Number(f.storyPoints ?? 0));
                } else {
                    wasInSprintAtStart = false;
                }

                const wasCarryIn = !wasInSprintAtStart && !f.wasScopeChange && !f.wasPunted
                    && (!createdTs || createdTs <= sprintStartTs);
                if (wasInSprintAtStart) committedSp += spAtStart;
                else if (wasCarryIn) committedSp += Number(f.storyPoints ?? 0);
            }
            committedSp = Math.round(committedSp * 100) / 100;

            console.log(`  Sync ${sync.id} (${sync.sprintName}): committedSp = ${committedSp}`);
            if (!dryRun) await sync.update({ committedSp });
            succeeded++;
        } catch (e) {
            console.error(`  Sync ${sync.id} failed: ${e.message}`);
            skipped++;
        }
    }

    console.log(`\nDone. ${succeeded} succeeded, ${skipped} skipped/failed.`);
}

main()
    .catch(err => {
        console.error('Backfill failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await sequelize.close();
    });
