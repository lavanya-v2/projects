export type MemberCategory = 'developer' | 'qa';

export interface SprintRef {
  syncId: number;
  sprintName: string;
  endDate: string;
  syncType: string;
}

export interface TrendPoint {
  sprintName: string;
  value: number;
}

export interface ContribSlice {
  name: string;
  value: number;
  isYou: boolean;
}

export interface Contribution {
  sprintName: string;
  slices: ContribSlice[];
}

export interface MemberProjectDashboard {
  projectId: number;
  projectName: string;
  isKanban: boolean;
  category: MemberCategory | null;
  sprints: SprintRef[];
  // developer
  spDelivered?: TrendPoint[];
  avgSp?: number;
  reopens?: TrendPoint[];
  carryovers?: TrendPoint[];
  contribution?: Contribution | null;
  // qa
  bugsLogged?: { sprintName: string; bugs: number; subBugs: number }[];
  ticketsTested?: TrendPoint[];
  qaContribution?: Contribution | null;
}

export interface MemberDashboardData {
  linked: boolean;
  memberName: string | null;
  jiraLoginId: string | null;
  projects: MemberProjectDashboard[];
}

export interface TechNotesGap {
  count: number;
  keys: Array<{ key: string; summary: string }>;
  unavailable?: boolean;
}

export interface AutomationLabelSummary {
  automated: number;
  pending: number; // NeedAutomation, not yet automated
  notRequired: number;
  unlabelled: number;
  total: number;
  unlabelledKeys: Array<{ key: string; summary: string }>;
  basis: 'assignee' | 'qaAssignee';
  unavailable?: boolean;
}
