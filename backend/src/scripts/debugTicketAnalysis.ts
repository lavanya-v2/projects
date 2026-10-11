
import sequelize from '../config/connection';
import { Project } from '../models/Project';
import { jiraService } from '../modules/jira/services/jiraService';

async function debugTicket() {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB.');

        console.log('=== Debugging Ticket LOWA-9654 ===');
        const issueKey = 'LOWA-9654';

        const project = await Project.findOne({ where: { code: 'LOWA' } });
        if (!project) {
            console.error('Project LOWA not found in DB');
            return;
        }

        const boardId = project.jiraBoardId;
        console.log(`Using Board ID: ${boardId} for Project: ${project.name}`);

        // Fetch using Agile API (same as production)
        const results = await jiraService.getAllIssuesFromUrl(`/rest/agile/1.0/board/${boardId}/issue?jql=key=${issueKey}&expand=changelog`);

        if (results.length === 0) {
            console.log('Ticket not found via Agile API!');
            return;
        }

        const issue = results[0];
        console.log(`Summary: ${issue.fields.summary}`);
        console.log(`Status: ${issue.fields.status.name}`);
        console.log(`Updated: ${issue.fields.updated}`);

        // Simulate reportService logic
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        console.log(`\nServer 'Today' (at start of day): ${today.toString()}`);
        console.log(`Server 'Today' (ISO): ${today.toISOString()}`);
        console.log(`Server Timezone Offset: ${today.getTimezoneOffset()}`);

        const changelog = issue.changelog || { histories: [] };
        console.log(`\nChangelog Histories: ${changelog.histories.length}`);

        changelog.histories.forEach((history: any) => {
            const historyDate = new Date(history.created);
            historyDate.setHours(0, 0, 0, 0);

            let isMatch = false;
            // Report logic check
            if (historyDate.getTime() === today.getTime()) {
                isMatch = true;
            }

            console.log(`\nHistory Entry: ${history.created}`);
            console.log(`  -> Converted to Date: ${new Date(history.created).toString()}`);
            console.log(`  -> Truncated (Local): ${historyDate.toString()}`);
            console.log(`  -> Match Today? ${isMatch ? 'YES' : 'NO'}`);

            history.items.forEach((item: any) => {
                if (item.field === 'status') {
                    console.log(`    Status Change: ${item.fromString} -> ${item.toString}`);
                }
            });
        });

    } catch (error: any) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Jira Response:', JSON.stringify(error.response.data, null, 2));
        }
    } finally {
        await sequelize.close(); // Clean exit
        process.exit(0);
    }
}

debugTicket();
