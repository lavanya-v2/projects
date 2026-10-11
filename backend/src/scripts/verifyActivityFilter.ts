
import sequelize from '../config/connection';
import { Project } from '../models/Project';
import { jiraService } from '../modules/jira/services/jiraService';

// Logic copied from reportService for verification
function identifyDailyActivity(issues: any[], targetDate: Date): { activeTickets: any[], contextTickets: any[] } {
    const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const targetDateStr = formatDate(targetDate);
    console.log(`Identifying Activity for Target Date (IST): ${targetDateStr}`);

    const activeTickets: any[] = [];
    const contextTickets: any[] = [];

    issues.forEach(issue => {
        const activities: string[] = [];
        let isActive = false;

        const changelog = issue.changelog || { histories: [] };
        changelog.histories.forEach((history: any) => {
            const historyDate = new Date(history.created);
            const historyDateIST = new Date(historyDate.getTime() + (5.5 * 60 * 60 * 1000));
            const historyDateStr = historyDateIST.toISOString().split('T')[0];

            if (historyDateStr === targetDateStr) {
                history.items.forEach((item: any) => {
                    if (item.field === 'status') {
                        isActive = true;
                        activities.push(`Moved to ${item.toString}`);
                    } else if (item.field === 'Attachment') {
                        isActive = true;
                        activities.push('Attachment added');
                    } else if (item.field === 'Link' || item.field === 'RemoteIssueLink') {
                        isActive = true;
                        activities.push('PR/Link updated');
                    }
                });
            }
        });

        if (issue.fields.comment && issue.fields.comment.comments) {
            issue.fields.comment.comments.forEach((comment: any) => {
                const commentDate = new Date(comment.created);
                const commentDateIST = new Date(commentDate.getTime() + (5.5 * 60 * 60 * 1000));
                const commentDateStr = commentDateIST.toISOString().split('T')[0];

                if (commentDateStr === targetDateStr) {
                    isActive = true;
                    activities.push('Comment added');
                }
            });
        }

        // Check Creation Date
        const createdDate = new Date(issue.fields.created);
        const createdDateIST = new Date(createdDate.getTime() + (5.5 * 60 * 60 * 1000));
        const createdDateStr = createdDateIST.toISOString().split('T')[0];
        if (createdDateStr === targetDateStr) {
            isActive = true;
            activities.push('Ticket Created');
        }

        if (isActive) {
            issue.dailyActivity = [...new Set(activities)];
            activeTickets.push(issue);
        } else {
            contextTickets.push(issue);
        }
    });

    return { activeTickets, contextTickets };
}

async function verifyFilter() {
    try {
        await sequelize.authenticate();
        console.log('Connected to DB.');

        const project = await Project.findOne({ where: { code: 'LOWA' } });
        if (!project) return;

        // 1. Fetch Issues (Active and Stale)
        // LOWA-9363 (Active Today), LOWA-9654 (Stale)
        const issues = await jiraService.getAllIssuesFromUrl(`/rest/agile/1.0/board/${project.jiraBoardId}/issue?jql=key in (LOWA-9363, LOWA-9654)&expand=changelog`);
        console.log(`Fetched ${issues.length} issues.`);

        // 2. Run Filter for Today (2026-02-05)
        // Hardcoded "Today" for the test context
        const todayStr = '2026-02-05';
        const today = new Date(todayStr);
        // Need to be careful with timezone of 'new Date("2026-02-05")'. It's UTC midnight. FormatDate uses local methods.
        // Let's ensure format matches expected IST string.

        console.log('\n--- Running Activity Filter ---');
        const { activeTickets, contextTickets } = identifyDailyActivity(issues, today);

        // 3. Verify
        console.log(`\nActive Tickets: ${activeTickets.map(i => i.key).join(', ')}`);
        console.log(`Context Tickets: ${contextTickets.map(i => i.key).join(', ')}`);

        if (activeTickets.find(i => i.key === 'LOWA-9363') && contextTickets.find(i => i.key === 'LOWA-9654')) {
            console.log('\n✅ Success: Filter correctly separated active and stale tickets.');
        } else {
            console.error('\n❌ Failure: Incorrect classification.');
        }

    } catch (error) {
        console.error(error);
    } finally {
        process.exit(0);
    }
}

verifyFilter();
