/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Project {
    id: number;
    name: string;
    code: string;
    jiraBoardId: number;
    workMode?: string;
    isKanbanProject?: boolean;
    deliveryModel?: 'sprint' | 'cadence' | 'continuous';
    // False for a Kanban project with no real committed sprint target -- delivery %
    // has no baseline to be good/bad against, so views should show raw SP delivered
    // instead of a ratio. Always effectively true for non-Kanban projects.
    tracksCommitment?: boolean;
    // Meaningless for Kanban. 'on_the_go' = team commits to a total sprint SP and
    // picks up tickets on the go (no stable per-person/per-subteam scope from day
    // 1) -- the daily report's sprint pace/health axis and progress-bar coloring
    // are suppressed for such projects. Defaults to 'planned' (fixed per-member
    // SP target) everywhere.
    sprintAssignmentModel?: 'planned' | 'on_the_go';
    piiRedactionEnabled?: boolean;
    kanbanCycleEnabled?: boolean;
    kanbanCycleDays?: number | null;
    // How often a cycle repeats, in days. Null = back-to-back (defaults to
    // kanbanCycleDays). Set longer than kanbanCycleDays for a weekday-aligned
    // cadence, e.g. window 5 / stride 7 for Mon-Fri every week.
    kanbanCycleStrideDays?: number | null;
    kanbanCycleAnchorDate?: string | null;
    kanbanAutoSync?: boolean;
    /** Jira statuses that count as "done" for this Kanban board. Empty/absent
     *  means the built-in default set is used. Surfaced so the Team Performance
     *  screen can state the definition of done instead of it being folklore. */
    kanbanDoneStatuses?: string[] | null;
    isSharedTeam?: boolean;
    estimationType?: 'story_points' | 'hours';
    hoursSource?: 'time_tracking' | 'custom_field' | null;
    hoursFieldName?: string | null;
    defaultDailyCapacityHours?: number | null;
    isActive?: boolean;
    inactiveSince?: string | null;
    accountId?: number;
    programId?: number | null;
    dataSourceType?: 'jira' | 'azure_devops' | 'excel' | 'custom-excel';
    reportingFrequency?: 'daily' | 'weekly' | 'sprint';
    // Which coding assistant (if any) this project's team uses. Gates every
    // Claude-usage UI surface — 'none' (the default) means show nothing
    // Claude-related for this project, not even a "coming soon" message.
    devAssistantAiTool?: 'claude' | 'copilot' | 'openai' | 'cursor' | 'none';
    account?: {
        id: number;
        name: string;
    };
    memberCounts?: number;
}

export interface WeeklyReportData {
    isAsync?: boolean;
    message?: string;
    id: number;
    projectId: number;
    startDate: string;
    endDate: string;
    workSummary: string;
    achievements: string;
    risks: string;
    status: string;
    additionalNotes: string;
    createdAt: string;
    executiveSummary?: string;
    teamMembers?: string[];
}

export interface ReportData {
    boardName: string;
    excelPath: string;
    jsonPath: string;
    analysis: {
        workSummary: string;
        planForTomorrow: string;
        risks: string;
        notes: string;
        health: string;
        executiveSummary: string;
        keyRisks: string;
        executivePlan: string;
        reportWindow?: {
            start: string;
            end: string;
        };
        teamMembers?: string[];
    };
}

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

export interface ActionItemComment {
    id: number;
    actionItemId: number;
    userId: number | null;
    content: string;
    createdAt: string;
    updatedAt: string;
    editedAt: Date | null;
    user?: { id: number; firstName: string; lastName: string } | null;
}

export interface AccountActionItem {
    id: number;
    accountId: number;
    title: string;
    category: string;
    owner: string;
    status: string;
    dueDate: string | null;
    createdById: number | null;
    createdAt: string;
    updatedAt: string;
    createdBy?: { id: number; firstName: string; lastName: string } | null;
    statusHistory?: any[];
}

export interface DashboardLatestSnapshot {
    id: number;
    date: string;
    overallHealth: string | null;
    insightsHealth: string | null;
    execSummarySnippet: string;
    sprintBurndown: any | null;
    managerInsights: string | null;
    blockedTickets?: any[];
    executivePlan?: string;
}

export interface DashboardProject {
    id: number;
    name: string;
    code: string;
    account?: { id: number; name: string };
    openAICount: number;
    activeRiskCount: number;
    overdueAICount?: number;
    workMode?: string;
    sprintStatus?: string | null;
    latestSnapshot: DashboardLatestSnapshot | null;
}

export interface DashboardAccount {
    id: number;
    name: string;
    projectCount: number;
    openAICount: number;
    activeRiskCount: number;
    longPendingCount: number;
    projects: { id: number; name: string }[];
}

export interface DashboardOverviewResponse {
    type: 'account' | 'project' | 'lead';
    accounts?: DashboardAccount[];
    crossProjectRisks?: any[];
    longPendingAIs?: any[];
    projectHealthList?: any[];
    projects?: DashboardProject[];
    topActionItems?: any[];
    project?: (DashboardProject & { openAIs: any[]; activeRisks: any[] }) | null;
}
