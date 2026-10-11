/**
 * One-shot helper: trigger a fresh sync for a single (projectId, jiraSprintId).
 * Used to verify code changes without going through the UI.
 *
 * Usage:
 *   cd backend && npm run build
 *   node scripts/resync-one-sprint.js --projectId 8 --jiraSprintId 152520
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const sequelize = require('../dist/config/connection').default;
const { performanceSyncService } = require('../dist/modules/reports/services/performanceSyncService');

const args = process.argv.slice(2);
const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? null : args[i + 1];
};

(async () => {
    const projectId = parseInt(arg('projectId'), 10);
    const jiraSprintId = parseInt(arg('jiraSprintId'), 10);
    if (!projectId || !jiraSprintId) {
        console.error('Usage: --projectId <id> --jiraSprintId <id>');
        process.exit(2);
    }

    try {
        await sequelize.authenticate();
        console.log(`Triggering sync for project ${projectId}, sprint ${jiraSprintId}...`);
        const sync = await performanceSyncService.syncSprint(projectId, jiraSprintId);
        console.log(`Sync ${sync.id} (${sync.sprintName}) status=${sync.syncStatus}`);
    } catch (err) {
        console.error('Sync failed:', err.message);
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
})();
