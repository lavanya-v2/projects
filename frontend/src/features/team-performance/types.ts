export interface TeamPerformanceSprint {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  state: string;
}

// Excel Sprint Board — reduced per-sprint delivery scorecard for dataSourceType='excel'
// projects (mirrors backend excelSprintBoardService).
export interface ExcelSprintSummary {
  sprintName: string;
  start: string | null;
  end: string | null;
  ticketCount: number;
}

export interface ExcelSprintDeveloperRow {
  assignee: string;
  spPlanned: number;
  spDone: number;
  deliveryPct: number;
  ticketCount: number;
  completedCount: number;
  bugCount: number;
}

export interface ExcelSprintScorecard {
  projectId: number;
  sprintName: string;
  start: string | null;
  end: string | null;
  sourceImportIds: number[];
  totals: {
    finalScopeSp: number;
    completedSp: number;
    deliveryPct: number;
    ticketDeliveryPct: number;
    hasStoryPoints: boolean;
    ticketCount: number;
    completedCount: number;
    spilloverCount: number;
    spilloverSp: number;
    bugCount: number;
    unassignedCount: number;
    typeBreakdown: Array<{ type: string; count: number; sp: number }>;
  };
  developers: ExcelSprintDeveloperRow[];
  dataQuality: {
    rowsMissingSp: number;
    sprintWindowVaries: boolean;
    containersExcluded?: number;
    staleMappingTickets?: number;
  };
}

export interface KanbanCycle {
  index: number;
  startDate: string;
  endDate: string;
  label: string;
  isComplete: boolean;
  isOverridden: boolean;
  syncStatus: "pending" | "running" | "done" | "error" | null;
  syncId: number | null;
}

export interface PerfScorecardResponse {
  sync: unknown;
  scores: unknown[];
  scopeCreepCount: number;
  scopeCreepSp: number;
  committedSp: number | null;
  finalScopeSp: number;
  netScopeChangeSp: number | null;
  totalCompletedSp: number;
  unassignedTicketCount: number;
  qualityReport?: {
    ourCommittedSp: number | null;
    jiraInitialCompletedSp: number | null;
    jiraInitialNotCompletedSp: number | null;
    jiraInitialPuntedSp: number | null;
    ourCompletedSp: number | null;
    jiraCompletedSp: number | null;
    jiraCompletedInAnotherSp: number | null;
    divergenceFlags: string[];
  } | null;
}

interface PerfSprintQualityReport {
  ourCommittedSp: number | null;
  jiraInitialCompletedSp: number | null;
  jiraInitialNotCompletedSp: number | null;
  jiraInitialPuntedSp: number | null;
  ourCompletedSp: number | null;
  jiraCompletedSp: number | null;
  jiraCompletedInAnotherSp: number | null;
  divergenceFlags: string[];
  bugsRaised?: number;
  prodBugsEscaped?: number;
  leakageRatePct?: number;
  prodBugKeys?: string[];
  prodBugsWorkedCount?: number;
  prodBugsWorkedSp?: number;
  prodBugsWorkedKeys?: string[];
  prodBugsWorkedInvalidCount?: number;
  prodBugsWorkedInvalidSp?: number;
  prodBugsWorkedInvalidKeys?: string[];
  uatReopenedCount?: number;
  uatReopenedKeys?: string[];
}

export interface PerfSyncs {
  id: number;
  projectId: number;
  jiraSprintId: number | null;
  sprintName: string;
  periodLabel: string | null;
  startDate: string;
  endDate: string;
  syncType: 'sprint' | 'kanban';
  syncStatus:  'pending' | 'running' | 'done' | 'error' ;
  errorMessage: string | null;
  syncedAt: Date | null;
  triggeredByUserId: number | null;
  createdAt: Date;
  updatedAt: Date;
  committedSp: number | null;
  qualityReport: PerfSprintQualityReport | null;
}
export interface ProjectTeamMembers {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  jiraLoginId: string;
  partnerEmailId: string;
  v2Member: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MemberBreakdown {
  todo: number;
  inProgress: number;
  inReview: number;
  inQa: number;
  inUat: number;
  blocked: number;
  done: number;
}

interface MemberStat {
  jiraLoginId: string;
  displayName: string;
  storyPointsDone: number;
  storyPointsCarriedOver: number;
  reopenedCount: number;
  breakdown?: MemberBreakdown; // active sprint only
}

interface LateQaMover {
  key: string;
  summary: string;
  assignee: string;
  currentStatus: string;
  movedToQaAt: string;
  movedToQaStatus: string;
}

interface BacklogContribution {
  key: string;
  summary: string;
  memberId: string;
  displayName: string;
  sp: number;
  currentStatus: string;
  progressedFrom: string;
  progressedTo: string;
  movedAt: string;
}

interface ScopeCreepTicket {
  key: string;
  summary: string;
  assignee: string;
  isV2Member: boolean;
  sp: number;
  currentStatus: string;
  addedAt: string;
}

export interface TeamPerformanceResult {
  sprintName: string;
  sprintStartDate: string;
  sprintEndDate: string;
  isHistorical: boolean;
  memberStats: MemberStat[];
  overallSpPlanned: number;
  overallSpDone: number;
  overallDeliveryPct: number;
  v2SpPlanned: number;
  v2SpDone: number;
  v2DeliveryPct: number;
  totalSpilloverCount: number;
  totalSpilloverSp: number;
  v2SpilloverCount: number;
  v2SpilloverSp: number;
  inProgressSp: number;
  inReviewSp: number;
  inQaSp: number;
  inUatSp: number;
  blockedSp: number;
  todoSp: number;
  scopeChangeSp: number;
  scopeChangeCount: number;
  v2ScopeChangeSp: number;
  v2ScopeChangeCount: number;
  lateQaMovers: LateQaMover[];
  scopeCreepTickets: ScopeCreepTicket[];
  backlogContributions: BacklogContribution[];
}
