export interface CustomRangeProject {
  id: number;
  name: string;
  code: string;
  accountId: number;
  accountName: string | null;
}

export interface CustomRangeProjectList {
  maxDays: number;
  projects: CustomRangeProject[];
}

export interface CustomRangeTicket {
  key: string;
  issueType: string;
  status: string;
  description: string;
  asOf: string;
}

export interface CustomRangeBlocker {
  key: string;
  summary: string;
  status: string;
  assignee: string;
  blockedSince: string | null;
}

export interface CustomRangeReportData {
  project: { id: number; code: string; name: string };
  window: { startDate: string; endDate: string };
  calendarDays: number;
  snapshotCount: number;
  missingDates: string[];
  health: {
    status: string;
    avg: number;
    scoredDays: number;
    counts: { Red: number; Amber: number; Green: number; Unknown: number };
  };
  healthTimeline: Array<{ date: string; health: string | null }>;
  achievements: { text: string; source: 'ai' | 'fallback' | 'none' };
  blockers: CustomRangeBlocker[];
  risks: { text: string; asOf: string | null };
  tickets: CustomRangeTicket[];
}

export interface CustomRangeParams {
  projectId: number;
  startDate: string;
  endDate: string;
}
