/**
 * One-shot backfill: replace anonymized "User <last5>" displayNames in
 * perf_ticket_facts with the real names resolved via Jira's per-user API.
 *
 * Why this exists:
 * Between 2026-05-11 and 2026-05-14 Atlassian rolled out displayName
 * redaction on the bulk JQL search API (POST /rest/api/3/search/jql).
 * Any sync re-run after that change persisted "User <last5>" placeholders
 * into perf_ticket_facts.assignee_name / reporter_name / qa_tester_name.
 * Older rows (synced before the rollout) still have real names and are
 * left untouched.
 *
 * The fix in performanceSyncService.ts already prevents future syncs from
 * writing redacted names — this script repairs the already-damaged rows.
 *
 * Usage:
 *   cd backend && npm run build
 *   node scripts/backfill-anonymized-assignee-names.js                 # all affected syncs
 *   node scripts/backfill-anonymized-assignee-names.js --syncId 249    # scope to one sync
 *   node scripts/backfill-anonymized-assignee-names.js --dry-run       # report only, no writes
 *
 * Idempotent: safe to re-run. Rows that already have real names are skipped.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { PerfSprintSync } = require('../dist/models/PerfSprintSync');
const { PerfTicketFact } = require('../dist/models/PerfTicketFact');
const { Project } = require('../dist/models/Project');
const { JiraService } = require('../dist/modules/jira/services/jiraService');
const { buildAccountIdMap } = require('../dist/modules/reports/services/performanceSyncService');
const { Op } = require('sequelize');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const syncIdArg = (() => {
    const i = args.indexOf('--syncId');
    if (i === -1) return null;
    return parseInt(args[i + 1], 10);
})();

const isAnonymized = (name) => typeof name === 'string' && /^User [a-f0-9]{5}$/i.test(name);

async function main() {
    await sequelize.authenticate();

    // 1. Find affected syncs
    const factWhere = {
        [Op.or]: [
            { assigneeName: { [Op.like]: 'User %' } },
            { reporterName: { [Op.like]: 'User %' } },
            { qaTesterName: { [Op.like]: 'User %' } },
        ],
    };
    if (syncIdArg) factWhere.syncId = syncIdArg;

    const affectedRows = await PerfTicketFact.findAll({
        where: factWhere,
        attributes: ['syncId'],
        group: ['syncId'],
    });
    const affectedSyncIds = affectedRows.map(r => r.syncId);

    if (affectedSyncIds.length === 0) {
        console.log('No affected syncs found. Nothing to backfill.');
        return;
    }

    console.log(`Found ${affectedSyncIds.length} affected sync(s): [${affectedSyncIds.join(', ')}]`);
    if (dryRun) console.log('--dry-run: no writes will be performed.');

    let totalUpdated = 0;
    let totalScanned = 0;

    for (const syncId of affectedSyncIds) {
        const sync = await PerfSprintSync.findByPk(syncId);
        if (!sync) {
            console.warn(`  Sync ${syncId} not found, skipping.`);
            continue;
        }
        const project = await Project.findByPk(sync.projectId);
        if (!project) {
            console.warn(`  Project ${sync.projectId} for sync ${syncId} not found, skipping.`);
            continue;
        }

        const jira = new JiraService(project.jiraBaseUrl, project.jiraEmail, project.jiraApiToken);

        const facts = await PerfTicketFact.findAll({ where: { syncId } });
        const accountIds = new Set();
        for (const f of facts) {
            if (f.assigneeJiraId && isAnonymized(f.assigneeName)) accountIds.add(f.assigneeJiraId);
            if (f.reporterJiraId && isAnonymized(f.reporterName)) accountIds.add(f.reporterJiraId);
            if (f.qaTesterJiraId && isAnonymized(f.qaTesterName)) accountIds.add(f.qaTesterJiraId);
        }

        if (accountIds.size === 0) {
            console.log(`  Sync ${syncId} (${sync.sprintName}): no anonymized rows after filtering; skipping.`);
            continue;
        }

        console.log(`  Sync ${syncId} (${sync.sprintName}): resolving ${accountIds.size} unique accountIds...`);
        const accountIdMap = await buildAccountIdMap(jira, accountIds);

        // Count how many we can actually resolve (per-user API may still return
        // the accountId for deactivated users — we treat that as unresolvable).
        let resolvedCount = 0;
        for (const [accountId, info] of accountIdMap.entries()) {
            if (info && info.displayName && info.displayName !== accountId && !isAnonymized(info.displayName)) {
                resolvedCount++;
            }
        }
        console.log(`    Resolved ${resolvedCount}/${accountIds.size} accountIds to real names.`);

        let syncUpdated = 0;
        for (const f of facts) {
            const updates = {};
            const resolve = (jiraId, currentName) => {
                if (!jiraId || !isAnonymized(currentName)) return null;
                const entry = accountIdMap.get(jiraId);
                if (!entry) return null;
                const real = entry.displayName;
                if (!real || real === jiraId || isAnonymized(real)) return null;
                return real;
            };
            const a = resolve(f.assigneeJiraId, f.assigneeName);
            if (a) updates.assigneeName = a;
            const r = resolve(f.reporterJiraId, f.reporterName);
            if (r) updates.reporterName = r;
            const q = resolve(f.qaTesterJiraId, f.qaTesterName);
            if (q) updates.qaTesterName = q;

            totalScanned++;
            if (Object.keys(updates).length === 0) continue;

            if (!dryRun) await f.update(updates);
            syncUpdated++;
        }

        totalUpdated += syncUpdated;
        console.log(`    ${dryRun ? 'Would update' : 'Updated'} ${syncUpdated} row(s) in sync ${syncId}.`);
    }

    console.log(`\nDone. ${dryRun ? 'Would update' : 'Updated'} ${totalUpdated} row(s) across ${affectedSyncIds.length} sync(s). Scanned ${totalScanned} fact rows.`);
}

main()
    .catch(err => {
        console.error('Backfill failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await sequelize.close();
    });
