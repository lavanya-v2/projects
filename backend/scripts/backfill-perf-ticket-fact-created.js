/**
 * One-shot backfill: populate `jira_created_at` on existing `perf_ticket_facts`
 * rows. Required because the "new bug in sprint" attribution logic now compares
 * Jira's native created timestamp against the sprint's date window — a bug is
 * only "new in sprint X" if it was actually created within X's start/end dates.
 *
 * Idempotent: only rows where jira_created_at IS NULL are touched (unless --force).
 *
 * Usage:
 *   cd backend && npm run build
 *   node scripts/backfill-perf-ticket-fact-created.js                  # all projects
 *   node scripts/backfill-perf-ticket-fact-created.js --projectId 7    # one project
 *   node scripts/backfill-perf-ticket-fact-created.js --dry-run        # preview, no writes
 *   node scripts/backfill-perf-ticket-fact-created.js --force          # refetch even where already set
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { PerfTicketFact } = require('../dist/models/PerfTicketFact');
const { Project } = require('../dist/models/Project');
const { JiraService } = require('../dist/modules/jira/services/jiraService');
const { Op } = require('sequelize');

const args = process.argv.slice(2);
const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1];
};
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const projectIdArg = arg('projectId');

const BATCH = 100;

async function main() {
    await sequelize.authenticate();

    const factWhere = {};
    if (!force) factWhere.jiraCreatedAt = null;
    if (projectIdArg) factWhere.projectId = parseInt(projectIdArg, 10);

    // Pull distinct (projectId, jiraKey) so we hit Jira once per ticket regardless
    // of how many sprint syncs that ticket appears under.
    const distinctRows = await PerfTicketFact.findAll({
        where: factWhere,
        attributes: [
            [sequelize.fn('DISTINCT', sequelize.col('project_id')), 'projectId'],
            'jiraKey',
        ],
        raw: true,
    });

    if (distinctRows.length === 0) {
        console.log('No rows to backfill.');
        return;
    }

    const byProject = new Map();
    for (const r of distinctRows) {
        const arr = byProject.get(r.projectId) ?? [];
        arr.push(r.jiraKey);
        byProject.set(r.projectId, arr);
    }
    console.log(`Backfilling ${distinctRows.length} unique ticket(s) across ${byProject.size} project(s)${dryRun ? ' (dry-run)' : ''}.`);

    let totalUpdated = 0;
    let totalMissing = 0;

    for (const [projectId, keys] of byProject.entries()) {
        const project = await Project.findByPk(projectId);
        if (!project) {
            console.warn(`  Project ${projectId} not found, skipping ${keys.length} key(s).`);
            continue;
        }
        if (!project.jiraBaseUrl || !project.jiraEmail || !project.jiraApiToken) {
            console.warn(`  Project ${projectId} (${project.name}): Jira credentials missing, skipping ${keys.length} key(s).`);
            continue;
        }

        const jira = new JiraService(project.jiraBaseUrl, project.jiraEmail, project.jiraApiToken);
        console.log(`  Project ${projectId} (${project.name}): ${keys.length} key(s) to look up.`);

        const createdByKey = new Map();
        for (let i = 0; i < keys.length; i += BATCH) {
            const batch = keys.slice(i, i + BATCH);
            const jql = `key in (${batch.join(',')})`;
            try {
                const issues = await jira.getAllIssuesFromJql(jql);
                for (const iss of issues) {
                    if (iss.fields?.created) createdByKey.set(iss.key, new Date(iss.fields.created));
                }
            } catch (e) {
                console.warn(`    batch fetch failed (offset ${i}): ${e.message}`);
            }
        }

        const found = createdByKey.size;
        const missing = keys.length - found;
        totalMissing += missing;
        if (missing > 0) {
            const missingKeys = keys.filter(k => !createdByKey.has(k));
            console.warn(`    ${missing} key(s) not returned by Jira (deleted?): ${missingKeys.slice(0, 5).join(', ')}${missing > 5 ? ` …+${missing - 5} more` : ''}`);
        }

        if (dryRun) {
            console.log(`    [dry-run] would update ${found} key(s).`);
            continue;
        }

        for (const [key, createdAt] of createdByKey.entries()) {
            const [count] = await PerfTicketFact.update(
                { jiraCreatedAt: createdAt },
                { where: { projectId, jiraKey: key, ...(force ? {} : { jiraCreatedAt: null }) } },
            );
            totalUpdated += count;
        }
        console.log(`    updated ${found} key(s).`);
    }

    console.log(`\nDone. Updated ${totalUpdated} row(s). Unresolved keys: ${totalMissing}.`);
    await sequelize.close();
}

main().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
