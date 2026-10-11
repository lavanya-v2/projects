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

export interface WeeklyReportListResponse {
  reports: any[];
  total: number;
  page: number;
  totalPages: number;
}
