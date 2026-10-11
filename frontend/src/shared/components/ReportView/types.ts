// Types local to the ReportView component family.
// We deliberately keep these here (instead of extending features/reports/daily/types.ts)
// because that type is consumed elsewhere and tightening it would ripple.

export interface TeamNote {
    userId: number;
    name: string;
    text: string;
    timestamp: string;
}

export interface HealthSuggestion {
    suggestedHealth: string;
    reason: string;
}

export interface ReportWindow {
    start: string;
    end: string;
}

export interface SprintBurndown {
    /**
     * Set when the burndown was deliberately NOT computed: the report is for a past date
     * and the board's current active sprint began after it, so that sprint did not exist
     * on the day being reported. Every metric below is absent in this case — the object is
     * a marker, not data, and must not be rendered as a progress bar showing zeros.
     */
    bypassed?: boolean;
    targetDate?: string;
    activeSprintName?: string;
    activeSprintStartDate?: string;
    sprintName: string;
    // 'not-tracked' = on-the-go assignment model project (see Project.sprintAssignmentModel):
    // sprint pace is deliberately not scored -- render as neutral/grey, never a color implying
    // good or bad. completionPct/completionPctSP are team-wide (not this team's slice) in that case.
    onTrackStatus: 'on-track' | 'at-risk' | 'critical' | 'not-tracked' | string;
    daysElapsed: number;
    daysTotal: number;
    daysPending: number;
    sprintElapsedPct: number;
    completedV2Tickets: number;
    totalV2Tickets: number;
    completionPct: number;
    completionPctSP?: number;
    storiesPending: number;
    offTrackPct: number;
    usedSP?: boolean;
    totalV2SP?: number;
    completedV2SP?: number;
    // "Not yet done" SP among this team's own tickets (totalV2SP - completedV2SP) --
    // used as "V2 currently has X SP in progress" for on-the-go assignment model projects.
    inProgressV2SP?: number;
    // Whole-sprint rollup + this team's current-workload alias -- see backend
    // SprintBurndown interface doc for the full explanation.
    totalSprintSP?: number;
    completedSprintSP?: number;
    totalSprintTickets?: number;
    completedSprintTickets?: number;
    v2CurrentWorkloadSP?: number;
    v2CurrentCompletedSP?: number;
    inUatSP?: number;
    inQaSP?: number;
    inReviewSP?: number;
    inProgressSP?: number;
    blockedSP?: number;
    reopenedSP?: number;
    todoSP?: number;
    // "What counts as Done" for this project's board, computed server-side from its own
    // lane config -- not hardcoded per project. Rendered as suggestive text under the bar.
    doneStatusLabels?: string[];
}

export interface NewlyBlockedInBacklogItem {
    key: string;
    summary: string;
    timestamp: string;
}

export interface DataQualityFlags {
    healthOverridden?: boolean;
    aiHealth?: string;
    prodBugsScrubbed?: number;
    newlyBlockedInBacklog?: NewlyBlockedInBacklogItem[];
    newlyAddedProdBugs?: NewlyBlockedInBacklogItem[];
}

export interface AnalysisBase {
    workSummary?: string;
    risks?: string;
    executiveSummary?: string;
    originalExecutiveSummary?: string;
    healthRationale?: string;
    teamMemberAttribution?: Record<string, string[]> | null;
    managerInsights?: string;
    insightsHealth?: string;
    insightsAuthorId?: number | null;
    insightsAuthorName?: string;
    teamMembers?: string[];
    teamNotes?: TeamNote[];
    reportWindow?: ReportWindow;
    dataQualityFlags?: DataQualityFlags | null;
}

export interface DailyAnalysis extends AnalysisBase {
    health: string;
    planForTomorrow?: string;
    ticketDetails?: string;
    ticketKeys?: Record<string, string>;
    ticketDetailsStructured?: Array<{ key: string; issueType: string; status: string; description: string }> | null;
}

export interface WeeklyAnalysis extends AnalysisBase {
    status: string;
    achievements?: string;
}

/**
 * Raw report payload shape used by the daily report. The shared ReportView receives this
 * object at `data` and derives `analysis` from `data.analysis`.
 */
export interface DailyReportDataLike {
    boardName?: string;
    analysis: DailyAnalysis;
    sprintBurndown?: SprintBurndown;
    // Insights/teamNotes can live at either the root or inside analysis (legacy shape).
    managerInsights?: string;
    insightsAuthorId?: number | null;
    insightsAuthorName?: string;
    teamNotes?: TeamNote[];
    id?: number;
    // Informational only — surfaces in the DSR strip and powers the Live Status
    // section on the Delivery Presentation. Never used in RAG/health calc.
    subBugsLoggedCount?: number | null;
    reopenedTicketsCount?: number | null;
    estimationType?: 'story_points' | 'hours';
}

/**
 * Raw weekly report payload shape. Unlike daily, weekly reports put the "analysis" fields
 * directly on the report object, so we alias them here.
 */
export type WeeklyReportDataLike = WeeklyAnalysis & {
    id?: number;
    managerInsights?: string;
    insightsAuthorId?: number | null;
    insightsAuthorName?: string;
    teamNotes?: TeamNote[];
};

export type ReportViewType = 'daily' | 'weekly';
export type InsightsReportType = 'daily' | 'weekly_project';

export interface ReportViewProps {
    data: DailyReportDataLike | WeeklyReportDataLike;
    projectCode: string;
    projectName: string;
    date?: string;
    startDate?: string;
    endDate?: string;
    type: ReportViewType;
    reportId?: number;
    onInsightsSaved?: () => void;
    isLead?: boolean;
}
