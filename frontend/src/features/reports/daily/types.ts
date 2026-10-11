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

export type ReportType =
  | 'daily'
  | 'weekly_project'
  | 'weekly_account'
  | 'monthly_project'
  | 'monthly_account';

export interface DailyReportListResponse {
  reports: any[];
  total: number;
  page: number;
  totalPages: number;
}

export interface SaveDailyInsightsResponse {
  healthSuggestion?: { suggestedHealth: string; reason: string };
  healthCleared?: boolean;
  clearedFrom?: string;
}
