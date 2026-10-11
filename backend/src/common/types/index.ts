export interface JiraIssue {
    key: string;
    fields: {
        summary: string;
        status: { name: string };
        priority?: { name: string };
        assignee?: { displayName: string };
        updated: string;
        // Bodies stripped at the fetch boundary — see jira/services/jiraFields.ts
        comment?: { comments: Array<{ created?: string; author?: any }> };
        issuelinks?: any[];
        created: string;
        creator?: any;
        parent?: any;
    };
    changelog?: {
        histories: Array<{
            created: string;
            items: Array<{
                field: string;
                toString: string;
            }>;
        }>;
    };
}

export interface BoardData {
    boardName: string;
    issues: JiraIssue[];
}

export interface SnapshotData {
    date: string;
    boardId: number;
    boardName: string;
    totalTickets: number;
    statusCounts: Record<string, number>;
    blockedTickets: any[];
    workSummary: string;
    overallHealth: string;
    ticketKeys: Record<string, string>;
    projectName?: string;
    executiveSummary?: string;
    executiveRisks?: string;
    executivePlan?: string;
}
