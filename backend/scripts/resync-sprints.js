/**
 * Generic re-sync helper. Re-runs the performance sync for one or more sprints,
 * resolving human-friendly identifiers (account code/name, project name/jira name,
 * sprint name) so you don't need raw DB ids. Reuses performanceSyncService.syncSprint
 * (the same path the UI uses), so it picks up the off-board bug supplement and any
 * other sync-time logic.
 *
 * Runs against the COMPILED build — build first:
 *   cd backend && npm run build
 *
 * Select the PROJECT (one of):
 *   --projectId 16
 *   --project "Loan Processes"        # matches projects.name or jira_name (case-insensitive)
 *   --account CCMH --project LOWA     # disambiguate by account code/name when names repeat
 *
 * Select the SPRINT(S) (one of):
 *   --sprint "LP 2026 5.2"            # match perf_sprint_syncs.sprint_name (case-insensitive, partial)
 *   --jiraSprintId 153846            # exact Jira sprint id
 *   --last 5                          # the N most recent DONE sprint syncs (default 1 if none given)
 *   --all                             # every DONE sprint sync for the project (use with care)
 *
 * Examples:
 *   node scripts/resync-sprints.js --project "Loan Processes" --last 5
 *   node scripts/resync-sprints.js --account CCMH --project LOWA --sprint "5.2"
 *   node scripts/resync-sprints.js --projectId 16 --jiraSprintId 153846
 *
 * Flags:
 *   --dry-run                         # resolve + list what WOULD be synced, then stop
 *
 * NOTE: re-syncing a sprint deletes and rebuilds its perf_ticket_facts and
 * perf_member_scores rows — this WIPES any lead overrides on that sprint. It also
 * needs a valid per-project Jira PAT stored on the project (the .env token is not used).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { performanceSyncService } = require('../dist/modules/reports/services/performanceSyncService');
const { QueryTypes } = require('sequelize');

const args = process.argv.slice(2);
const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
const q = (sql, bind) => sequelize.query(sql, { bind, type: QueryTypes.SELECT });

async function resolveProject() {
    const projectId = arg('projectId');
    if (projectId) {
        const rows = await q(
            `SELECT p.id, p.name, p.jira_name, p.is_kanban_project, a.code account_code, a.name account_name
               FROM projects p JOIN accounts a ON a.id = p.account_id WHERE p.id = $1`, [parseInt(projectId, 10)]);
        return rows[0] || null;
    }
    const project = arg('project');
    if (!project) throw new Error('Specify the project: --projectId, or --project "<name>" (optionally with --account).');

    const account = arg('account');
    const rows = await q(
        `SELECT p.id, p.name, p.jira_name, p.is_kanban_project, a.code account_code, a.name account_name
           FROM projects p JOIN accounts a ON a.id = p.account_id
          WHERE (LOWER(p.name) = LOWER($1) OR LOWER(p.jira_name) = LOWER($1))
            AND ($2::text IS NULL OR LOWER(a.code) = LOWER($2) OR LOWER(a.name) = LOWER($2))`,
        [project, account]);
    if (rows.length === 0) throw new Error(`No project matched name/jira_name "${project}"${account ? ` in account "${account}"` : ''}.`);
    if (rows.length > 1) {
        const list = rows.map(r => `  - id ${r.id}: ${r.name} (account ${r.account_code})`).join('\n');
        throw new Error(`"${project}" is ambiguous across accounts — narrow with --account:\n${list}`);
    }
    return rows[0];
}

async function resolveSprints(project) {
    const jiraSprintId = arg('jiraSprintId');
    if (jiraSprintId) {
        const rows = await q(
            `SELECT jira_sprint_id, sprint_name, sync_status FROM perf_sprint_syncs
              WHERE project_id = $1 AND jira_sprint_id = $2`, [project.id, parseInt(jiraSprintId, 10)]);
        if (!rows.length) return [{ jira_sprint_id: parseInt(jiraSprintId, 10), sprint_name: '(not yet synced)', sync_status: 'new' }];
        return rows;
    }
    const sprintName = arg('sprint');
    if (sprintName) {
        return q(
            `SELECT jira_sprint_id, sprint_name, sync_status FROM perf_sprint_syncs
              WHERE project_id = $1 AND sync_type = 'sprint' AND sprint_name ILIKE $2
              ORDER BY end_date DESC`, [project.id, `%${sprintName}%`]);
    }
    if (has('all')) {
        return q(
            `SELECT jira_sprint_id, sprint_name, sync_status FROM perf_sprint_syncs
              WHERE project_id = $1 AND sync_type = 'sprint' AND sync_status = 'done'
              ORDER BY end_date DESC`, [project.id]);
    }
    const last = parseInt(arg('last') || '1', 10);
    return q(
        `SELECT jira_sprint_id, sprint_name, sync_status FROM perf_sprint_syncs
          WHERE project_id = $1 AND sync_type = 'sprint' AND sync_status = 'done'
          ORDER BY end_date DESC LIMIT $2`, [project.id, last]);
}

(async () => {
    try {
        await sequelize.authenticate();

        const project = await resolveProject();
        if (!project) { console.error('Project not found.'); process.exit(2); }
        console.log(`Project: ${project.name} (id ${project.id}, account ${project.account_code})${project.is_kanban_project ? ' [KANBAN]' : ''}`);
        if (project.is_kanban_project) {
            console.error('This is a Kanban project — sprint re-sync does not apply. Aborting.');
            process.exit(2);
        }

        const sprints = await resolveSprints(project);
        if (!sprints.length) { console.error('No matching sprints found.'); process.exit(2); }

        console.log(`\n${sprints.length} sprint(s) to re-sync:`);
        for (const s of sprints) console.log(`  - ${s.sprint_name} (jiraSprintId ${s.jira_sprint_id}, current status: ${s.sync_status})`);

        if (has('dry-run')) {
            console.log('\n--dry-run: resolved only, nothing synced.');
            return;
        }

        console.log('\nNote: re-sync rebuilds facts + scores and WIPES lead overrides on these sprints.\n');
        let ok = 0, fail = 0;
        for (const s of sprints) {
            process.stdout.write(`  ${s.sprint_name} (${s.jira_sprint_id})... `);
            try {
                const res = await performanceSyncService.syncSprint(project.id, s.jira_sprint_id);
                console.log(`done (sync ${res.id}, status=${res.syncStatus})`);
                ok++;
            } catch (e) {
                console.log(`FAILED: ${e.message}`);
                fail++;
            }
        }
        console.log(`\nFinished: ${ok} succeeded, ${fail} failed.`);
        if (fail) process.exitCode = 1;
    } catch (err) {
        console.error('Error:', err.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
