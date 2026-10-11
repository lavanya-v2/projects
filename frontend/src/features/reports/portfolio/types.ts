import type { Account } from "../../admin/accounts/types";

export type CustomColumnType = 'text' | 'number' | 'percentage' | 'date';

export interface PortfolioRiskSnapshot {
    projectId?: number | null;
    projectName: string;
    title: string;
    description?: string;
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    status: 'NEW' | 'WORK_IN_PROGRESS' | 'STALE' | 'DONE';
    source?: 'CLIENT' | 'INTERNAL';
}

interface PortfolioMilestone {
  milestone: string;
  status: string;
  percentComplete: number;
  eta: string;
  projectName?: string;
}

export interface VelocityCapacityFlag {
  projectId: number;
  syncId: number;
  sprintName: string;
  reason: string;
}

export interface TeamCapacityRow {
  name: string;
  jiraLoginId?: string | null;
  sprint: string;
  plannedLeaves: number | null;
  unplannedLeaves: number | null;
  storyPointsDelivered: number | null;
  carryOverSp: number | null;
  // Kanban only: weekdays (Mon-Fri) in the cycle/week this row covers.
  workingDays?: number | null;
}

export interface PortfolioActionItemSnapshot {
    id?: number;
    projectId?: number | null;
    projectName: string;
    title: string;
    owner: string;
    status: string;
    dueDate?: string | null;
    category: string;
    source: 'project' | 'program' | 'account';
}

export interface PortfolioKeyHighlights {
    summary: string;
    achievements: string[];
    blockers: string[];
    capacityNotes: string[];
}

export interface SprintMetrics {
    capacity?: number;
    planned?: number;
    actual?: number;
    scopeChange?: number;
    reworkPct?: number;
    carryoverPct?: number;
    v2Only?: boolean;
    dataSource: string;
}

export interface QualityMetrics {
    storyPoints?: number;
    validBugs?: number;
    bugDensityPct?: number;
    bugsProd?: number;
    leakageRatePct?: number;
    leakageBugsRaised?: number;
    reopenedCount?: number;
    deliveredCount?: number;
    reopenRatePct?: number;
    invalidReopenCount?: number;
    invalidBugCount?: number;
    prodBugsWorked?: number;
    prodBugsWorkedSp?: number;
    prodBugsWorkedInvalid?: number;
    prodBugsWorkedInvalidSp?: number;
    uatReopenedCount?: number;
    prodBugKeys?: string[];
    prodBugsWorkedKeys?: string[];
    prodBugsWorkedInvalidKeys?: string[];
    uatReopenedKeys?: string[];
    uiBugs?: number;
    apiBugs?: number;
    cssBugs?: number;
    dbBugs?: number;
    otherBugs?: number;
}

export interface TeamMembers {
    name: string;
    role: string;
    storyPoints?: number;
    execution?: number;
    quality?: number;
    overallRating?: number;
}

type MetricsScope = 'v2' | 'overall';

export interface DeveloperVelocitySprint {
    syncId: number;
    endDate: string;
    startDate: string;
    sprintName: string;
}

export interface DeveloperVelocityDeveloper {
    name: string;
    jiraLoginId: string;
    spDeliveredBySync: Record<string, number>;
    spCarriedOverBySync: Record<string, number>;
}

export interface DeveloperVelocity {
    maxSp: number;
    sprints: DeveloperVelocitySprint[];
    developers: DeveloperVelocityDeveloper[];
    perRowScale: boolean;
}

export interface DeveloperVelocityByScope {
  v2?: DeveloperVelocity;
  overall?: DeveloperVelocity;
}

export interface PerSprintScopedMetrics {
    syncId: number;
    actual?: number;
    planned?: number;
    bugCount?: number;
    removedSp?: number;
    deliveredSP?: number;
    removedCount?: number;
    reopenRatePct?: number;
    reopenedCount?: number;
    deliveredCount?: number;
}

export interface ScopedMetrics {
    [key: string]: number | string | PerSprintScopedMetrics[] | undefined;
    actual?: number;
    planned?: number;
    capacity?: number;
    perSprint?: PerSprintScopedMetrics[];
    removedSp?: number;
    validBugs?: number;
    metricKind?: string;
    removedPct?: number;
    spillovers?: number;
    storyPoints?: number;
    removedCount?: number;
    scopeAddedSP?: number;
    spilloverPct?: number;
    bugDensityPct?: number;
    reEstimatedSp?: number;
    reopenRatePct?: number;
    reopenedCount?: number;
    scopeCreepPct?: number;
    deliveredCount?: number;
    spilloverCount?: number;
    productivityPct?: number;
    scopeAddedCount?: number;
}

export interface MetricsByScope {
    v2?: ScopedMetrics;
    overall?: ScopedMetrics;
}

export interface PortfolioPerProjectDrilldown {
    projectId: number | null;
    // True when this project follows Kanban rules for the presented date range.
    isKanbanEffective?: boolean;
    // Kanban only: one entry per V2 developer per cycle/week in the range.
    kanbanCycleCapacity?: Array<{
        syncId: number;
        period: string;
        startDate: string;
        endDate: string;
        workingDays: number;
        jiraLoginId: string;
        name: string;
        spDelivered: number;
    }> | null;
    projectName: string;
    health?: 'Green' | 'Amber' | 'Red';             
    healthOverride?: 'Green' | 'Amber' | 'Red' | null; 
    narrative: string;
    sprintName: string;
    sprintMetrics: SprintMetrics;
    qualityMetrics: QualityMetrics;
    teamMembers: TeamMembers[]
    isVisible: boolean;
    metricsOverrideByScope?: Partial<Record<MetricsScope, Record<string, number>>>;
    metricsByScope?: Partial<Record<MetricsScope, ScopedMetrics>>;
    developerVelocityByScope?: Partial<Record<MetricsScope, DeveloperVelocity>>;
}

export interface PortfolioTrendSprint {
    syncId: number;
    name: string;
    startDate?: string;
    endDate?: string;
    metrics: SprintMetrics;
    qualityMetrics: QualityMetrics
}

export interface PortfolioTrendData {
    [projectId: string]: {
        projectName: string;
        sprints: PortfolioTrendSprint[];
        jiraBaseUrl?: string | null;
    };
}

export interface CustomColumn {
    key: string;
    label: string;
    type: CustomColumnType;
}

export interface CustomChartConfig {
    type: 'bar' | 'stacked-bar' | 'line';
    categoryColumn: string;
    valueColumns: string[];
}

export interface CustomSection {
    id: string;
    title: string;
    displayMode: 'table' | 'chart';
    columns: CustomColumn[];
    rows: Array<Record<string, string | number | null>>;
    chart?: CustomChartConfig;
}

export interface currentValues {
    actionItems: PortfolioActionItemSnapshot[];
    customSections: CustomSection[];
    discussion: string[];
    endDate: string;
    health: string;
    highlights: PortfolioKeyHighlights;
    meetingDate: string;
    drilldown: PortfolioPerProjectDrilldown[];
    risks: PortfolioRiskSnapshot[];
    selectedProjectIds: number[];
    selectedSprintMap: Record<string, number | null>;
    startDate: string;
    techRecs: string[];
    title: string;
    trendData: PortfolioTrendData;
}

export interface existValues {
    id?: number;
    actionItemsSnapshot: PortfolioActionItemSnapshot[];
    customSections: CustomSection[];
    discussionPoints: string[];
    endDate: string;
    health: string;
    keyHighlights: PortfolioKeyHighlights;
    meetingDate: string;
    perProjectDrilldown: PortfolioPerProjectDrilldown[];
    risks: PortfolioRiskSnapshot[];
    selectedProjectIds: number[];
    selectedSprintMap: Record<string, number | null>;
    startDate: string;
    techRecommendations: string[];
    title: string;
    trendData: PortfolioTrendData;
    createdAt?: string;
    momStatus?: string | null;
    momContent?: string | null;
    momGenerateAttempts?: number;
    meetingTranscript?: string | null;
    presenterNotes?: Record<string, string>;
    lockedAt?: Date | null;
    projectNames?: string[];
}

export interface PortfolioPresentation {
    id: number;
    accountId: number;
    programId: number;
    title: string;
    meetingDate: string;
    startDate: string;
    endDate: string;
    health: string;
    selectedProjectIds: number[];
    selectedSprintMap: Record<string, number>;
    dateSelectionMode: 'range' | 'sprint';
    selectedSprintId: number | null;
    keyHighlights: PortfolioKeyHighlights;
    originalAiSummary: string | null;
    mileStones: PortfolioMilestone[];
    risks: PortfolioRiskSnapshot[];
    actionItemsSnapshot: PortfolioActionItemSnapshot[];
    techRecommendations: string[];
    discussionPoints: string[];
    perProjectDrilldown: PortfolioPerProjectDrilldown[];
    trendData: PortfolioTrendData;
    customSections: CustomSection[];
    createdByUserId: number;
    meetingTranscript: string | null;
    presenterNotes: Record<string, string>;
    hiddenCharts: Record<string, boolean>;
    graphNotes: Record<string, string>;
    velocityCapacityFlags: VelocityCapacityFlag[];
    teamCapacityRows: TeamCapacityRow[];
    momContent: string;
    monGeneratedAt: string;
    momStatus: string;
    momGenerateAttempts: number;
    lockedAt: string;
    lockedById: number;
    createdAt: string;
    updatedAt: string;
    created_by_user_id: number;
    account: Account;
    projectNames: string[];
}

export interface PortfolioPresentationFormData {
    title: string;
    meetingDate: string;
    startDate: string;
    endDate: string;
    health: 'Green' | 'Amber' | 'Red';
    dateSelectionMode: 'range' | 'sprint';
    selectedSprintId: number | null;
    scopeMode: 'account' | 'program';
    programId: number | null;
    selectedProjectIds: number[];
    selectedSprintMap: Record<string, number | null>;
    keyHighlights: PortfolioKeyHighlights;
    risks: PortfolioRiskSnapshot[];
    actionItemsSnapshot: PortfolioActionItemSnapshot[];
    techRecommendations: string[];
    discussionPoints: string[];
    perProjectDrilldown: PortfolioPerProjectDrilldown[];
    trendData: PortfolioTrendData;
    hiddenCharts: Record<string, boolean>;
    graphNotes: Record<string, string>;
    velocityCapacityFlags: Record<string, VelocityCapacityFlag>;
    teamCapacityRows: TeamCapacityRow[];
    customSections: CustomSection[];
    milestones: PortfolioMilestone[];
}
