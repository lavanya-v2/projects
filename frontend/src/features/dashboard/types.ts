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
