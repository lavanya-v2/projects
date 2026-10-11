export interface Program {
  id: number;
  accountId: number;
  name: string;
  description?: string | null;
  redThresholdPercentage?: number | null;
  createdBy?: number | null;
  createdAt?: string;
  updatedAt?: string;
  projects?: Array<{ id: number; name: string; code: string }>;
  account?: { id: number; name: string; code: string; redThresholdPercentage?: number };
}

export interface ProgramOwner {
  id: number;
  userId: number;
  isPrimary: boolean;
  user?: {
    id: number;
    firstName: string;
    lastName: string;
    email?: string;
  };
}

export interface ProgramWeeklyReportRow {
  id: number;
  programId: number;
  accountId: number;
  weekNumber: number;
  year: number;
  startDate: string;
  endDate: string;
  summary?: string;
  health?: string;
  risks?: { summary?: string; items?: string[] } | string;
  keyAccomplishments?: string[];
  redProjects?: string[];
  projectsIncluded?: string[];
  projectsMissing?: string[];
  actionItems?: string[];
  managerInsights?: string | null;
}

export interface ProgramMonthlyReportRow extends Omit<ProgramWeeklyReportRow, 'weekNumber' | 'startDate' | 'endDate'> {
  month: number;
  annexure?: { title: string; points: string[] }[];
}

export interface SprintBurndown {
    /**
     * Set when the burndown was deliberately NOT computed: the report is for a past date
     * and the board's current active sprint began after it. The object is a marker, not
     * data — every metric below is absent — so it must not be drawn as a progress bar.
     */
    bypassed?: boolean;
    activeSprintName?: string;
  sprintName: string;
  startDate?: string;
  endDate?: string;
  daysTotal?: number;
  daysElapsed?: number;
  daysPending?: number;
  sprintElapsedPct?: number;
  totalV2Tickets?: number;
  completedV2Tickets?: number;
  storiesPending?: number;
  completionPct?: number;
  offTrackPct?: number;
  // 'not-tracked' = on-the-go assignment model project -- sprint pace deliberately not
  // scored, render neutral/grey. completionPct is team-wide (not this team's slice) then.
  onTrackStatus?: 'on-track' | 'at-risk' | 'critical' | 'not-tracked';
  totalV2SP?: number;
  completedV2SP?: number;
  inProgressV2SP?: number;
  usedSP?: boolean;
  totalSprintSP?: number;
  completedSprintSP?: number;
  totalSprintTickets?: number;
  completedSprintTickets?: number;
  v2CurrentWorkloadSP?: number;
  v2CurrentCompletedSP?: number;
  todoSP?: number;
  inProgressSP?: number;
  inReviewSP?: number;
  inQaSP?: number;
  inUatSP?: number;
  blockedSP?: number;
  reopenedSP?: number;
  doneStatusLabels?: string[];
}

export interface ProjectIncludedDailySnapshot {
  projectName: string;
  health?: string;
  sprintBurndown?: SprintBurndown | null;
}

export interface ProgramDailyReportRow {
  id: number;
  programId: number;
  accountId: number;
  reportDate: string;
  summary?: string;
  health?: string;
  risks?: { summary?: string; items?: string[] } | string;
  keyAccomplishments?: string[];
  redProjects?: string[];
  /**
   * Phase 4 stores rich objects (with sprintBurndown) instead of just names.
   * Older rows (if any) may still be plain strings — render code falls back gracefully.
   */
  projectsIncluded?: Array<ProjectIncludedDailySnapshot | string>;
  projectsMissing?: string[];
  actionItems?: string[];
  managerInsights?: string | null;
}

export interface ProgramReportListResponse<T> {
  reports: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ProgApiResponse {
  success: boolean;
  data: Program[];
  totalItems?: number;
}
