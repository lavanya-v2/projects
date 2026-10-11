/**
 * Re-sync performance data for a SET of projects — by explicit ids OR by account —
 * auto-detecting Kanban vs Sprint per project and running the right sync path.
 * Reuses performanceSyncService.syncSprint / syncKanbanPeriod (the same code the UI
 * uses), so it picks up the status-based reopen detection and every other sync-time
 * rule. Prints a before/after "was_reopened" count per project.
 *
 * Build first (runs against compiled dist):  cd backend && npm run build
 *
 * Select projects (one of):
 *   --projectIds 13,17,8     explicit project ids
 *   --account CCMH           account by code or name (case-insensitive)
 *   --accountId 3            account by id
 * Optional:
 *   --exclude 19,14          skip these project ids (e.g. control / no-op projects)
 *   --last 6                 only the N most recent completed spans PER project
 *                            (Trends shows the last 5, so 6 covers everything displayed)
 *   --dry-run                list what WOULD sync, then stop
 *   --include-empty          also process projects with 0 done syncs (default: skip)
 *
 * Examples:
 *   node scripts/resync-projects.js --account CCMH --last 6 --dry-run
 *   node scripts/resync-projects.js --account CCMH --exclude 19,14 --last 6
 *
 * NOTE: re-syncing rebuilds perf_ticket_facts + perf_member_scores for each span —
 * this WIPES any lead overrides on those spans. Needs a valid per-project Jira PAT.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { performanceSyncService } = require('../dist/modules/reports/services/performanceSyncService');
const { QueryTypes } = require('sequelize');

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(`--${name}`); return i === -1 ? null : args[i + 1]; };
const has = (name) => args.includes(`--${name}`);
const q = (sql, bind) => sequelize.query(sql, { bind, type: QueryTypes.SELECT });

async function resolveProjects() {
    const idsArg = arg('projectIds');
    if (idsArg) {
        const ids = idsArg.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
        if (!ids.length) throw new Error('--projectIds had no valid ids');
        return q(`SELECT id, name, code, is_kanban_project FROM projects WHERE id = ANY($1) ORDER BY code`, [ids]);
    }
    const accountId = arg('accountId');
    if (accountId) {
        return q(`SELECT id, name, code, is_kanban_project FROM projects
                   WHERE account_id = $1 AND is_shared_team = false ORDER BY code`, [parseInt(accountId, 10)]);
    }
    const account = arg('account');
    if (account) {
        return q(`SELECT p.id, p.name, p.code, p.is_kanban_project
                    FROM projects p JOIN accounts a ON a.id = p.account_id
                   WHERE (LOWER(a.code) = LOWER($1) OR LOWER(a.name) = LOWER($1))
                     AND p.is_shared_team = false ORDER BY p.code`, [account]);
    }
    throw new Error('Select projects with --projectIds, --account, or --accountId.');
}

const reopenedCount = async (projectId) => (await q(
    `SELECT count(*)::int AS n FROM perf_ticket_facts f JOIN perf_sprint_syncs s ON s.id = f.sync_id
      WHERE s.project_id = $1 AND s.sync_status = 'done' AND f.was_reopened = true`, [projectId]))[0].n;

const sprintSyncs = (projectId) => q(
    `SELECT jira_sprint_id, sprint_name FROM perf_sprint_syncs
      WHERE project_id = $1 AND sync_type = 'sprint' AND sync_status = 'done'
        AND jira_sprint_id IS NOT NULL ORDER BY start_date`, [projectId]);

const kanbanSpans = (projectId) => q(
    `SELECT start_date, end_date, period_label, sprint_name FROM perf_sprint_syncs
      WHERE project_id = $1 AND sync_type = 'kanban' AND sync_status = 'done' ORDER BY start_date`, [projectId]);

(async () => {
    try {
        await sequelize.authenticate();
        const excludeArg = arg('exclude');
        const exclude = new Set((excludeArg ? excludeArg.split(',') : []).map(s => parseInt(s.trim(), 10)).filter(Boolean));
        const projects = (await resolveProjects()).filter(p => !exclude.has(p.id));
        if (!projects.length) { console.error('No matching projects.'); process.exit(2); }

        const lastArg = arg('last');
        const limit = lastArg ? Math.max(1, parseInt(lastArg, 10)) : null;

        const plan = [];
        for (const p of projects) {
            // Spans come back oldest-first; when --last N is set keep the N most recent.
            let spans = p.is_kanban_project ? await kanbanSpans(p.id) : await sprintSyncs(p.id);
            if (limit) spans = spans.slice(-limit);
            if (spans.length > 0 || has('include-empty')) plan.push({ p, spans });
        }

        console.log(`\nProjects (${plan.length}):`);
        for (const { p, spans } of plan)
            console.log(`  ${p.code} (id ${p.id}) [${p.is_kanban_project ? 'KANBAN' : 'SPRINT'}] — ${spans.length} span(s)`);

        if (has('dry-run')) { console.log('\n--dry-run: nothing synced.'); return; }
        console.log('\nNote: re-sync rebuilds facts + scores and WIPES lead overrides on these spans.\n');

        let totalOk = 0, totalFail = 0;
        for (const { p, spans } of plan) {
            const before = await reopenedCount(p.id);
            console.log(`\n=== ${p.code} (id ${p.id}) [${p.is_kanban_project ? 'KANBAN' : 'SPRINT'}] — reopened before: ${before} ===`);
            let ok = 0, fail = 0;
            for (const s of spans) {
                if (p.is_kanban_project) {
                    const label = s.period_label || s.sprint_name || `${s.start_date}..${s.end_date}`;
                    process.stdout.write(`  ${label}... `);
                    try { const r = await performanceSyncService.syncKanbanPeriod(p.id, String(s.start_date), String(s.end_date), label);
                          console.log(`done (sync ${r.id})`); ok++; } catch (e) { console.log(`FAILED: ${e.message}`); fail++; }
                } else {
                    process.stdout.write(`  ${s.sprint_name} (${s.jira_sprint_id})... `);
                    try { const r = await performanceSyncService.syncSprint(p.id, s.jira_sprint_id);
                          console.log(`done (sync ${r.id}, ${r.syncStatus})`); ok++; } catch (e) { console.log(`FAILED: ${e.message}`); fail++; }
                }
            }
            const after = await reopenedCount(p.id);
            console.log(`  ${p.code}: ${ok} ok, ${fail} failed — reopened ${before} → ${after}`);
            totalOk += ok; totalFail += fail;
        }
        console.log(`\nAll done: ${totalOk} spans synced, ${totalFail} failed.`);
        if (totalFail) process.exitCode = 1;
    } catch (err) {
        console.error('Error:', err.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
