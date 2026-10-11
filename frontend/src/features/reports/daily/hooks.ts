import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import { dailyReportKeys, dashboardKeys } from '../../../shared/queryKeys';
import type { ApiResponse } from '../../../shared/apiTypes';
import type {
  ReportData,
  ReportType,
  DailyReportListResponse,
  SaveDailyInsightsResponse,
} from './types';

interface DailyReportListParams {
  projectId: number;
  page: number;
  limit: number;
  startDate?: string;
  endDate?: string;
}

// ---- helpers inlined from the old api object ----------------------------

const getProjectDailyReports = async (
  projectId: number,
  page: number = 1,
  limit: number = 10,
  startDate?: string,
  endDate?: string,
): Promise<DailyReportListResponse> => {
  const params: any = { page, limit };
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  const response = await client.get<ApiResponse<DailyReportListResponse>>(
    `/report/project/${projectId}/daily`,
    { params },
  );
  return response.data.data;
};

const generateReport = async (projectName: string, date?: string): Promise<ReportData> => {
  const response = await client.post<ApiResponse<ReportData>>('/report', {
    projectName,
    date,
  });
  return response.data.data;
};

const generateAsyncReport = async (
  projectName: string,
  date?: string,
): Promise<{ success: boolean; message: string }> => {
  const response = await client.post<{ success: boolean; message: string }>('/report/async', {
    projectName,
    date,
  });
  return response.data;
};

const downloadBlob = (data: BlobPart, fileName: string) => {
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.parentNode?.removeChild(link);
  window.URL.revokeObjectURL(url);
};

const filenameFromHeaders = (headers: any, fallback: string): string => {
  const cd = headers['content-disposition'];
  if (cd) {
    const m = cd.match(/filename="?([^"]+)"?/);
    if (m && m.length === 2) return m[1];
  }
  return fallback;
};

const downloadReport = async (projectName: string, date: string) => {
  const response = await client.get(
    `/report/download?projectName=${projectName}&date=${date}`,
    { responseType: 'blob' },
  );
  const fileName = filenameFromHeaders(response.headers, `${projectName}_Report_${date}.docx`);
  downloadBlob(response.data, fileName);
};

const downloadDailyReportText = async (projectName: string, date: string) => {
  const response = await client.get(
    `/report/download-text?projectName=${projectName}&date=${date}`,
    { responseType: 'blob' },
  );
  const fileName = filenameFromHeaders(
    response.headers,
    `${projectName}_Daily_Report_${date}.txt`,
  );
  downloadBlob(response.data, fileName);
};

const downloadDailyReportCSV = async (projectName: string, date: string) => {
  const response = await client.get(
    `/report/download-csv?projectName=${projectName}&date=${date}`,
    { responseType: 'blob' },
  );
  const fileName = filenameFromHeaders(
    response.headers,
    `${projectName}_Daily_Report_${date}.csv`,
  );
  downloadBlob(response.data, fileName);
};

const saveDailyInsights = async (
  id: number,
  insights: string,
): Promise<SaveDailyInsightsResponse> => {
  const response = await client.patch<ApiResponse<SaveDailyInsightsResponse>>(
    `/report/daily/${id}/insights`,
    { insights },
  );
  return response.data.data || {};
};

const previewInsights = async (
  reportType: ReportType,
  id: number,
  insights: string,
): Promise<{ oldSummary: string; newSummary: string }> => {
  const response = await client.post<
    ApiResponse<{ oldSummary: string; newSummary: string }>
  >(`/report/${reportType}/${id}/insights/preview`, { insights });
  return response.data.data;
};

const acceptInsights = async (
  reportType: ReportType,
  id: number,
  insights: string,
  newSummary: string,
): Promise<void> => {
  await client.patch(`/report/${reportType}/${id}/insights/accept`, { insights, newSummary });
};

const applyInsightsHealth = async (
  id: number,
  insightsHealth: string,
  reason: string,
): Promise<void> => {
  await client.patch(`/report/daily/${id}/insights/health`, { insightsHealth, reason });
};

const addTeamNote = async (
  reportType: ReportType,
  id: number,
  text: string,
): Promise<void> => {
  await client.patch(`/report/${reportType}/${id}/team-notes`, { text });
};

// ---- hooks ---------------------------------------------------------------

export const useDailyReports = ({ projectId, page, limit, startDate, endDate }: DailyReportListParams) =>
  useQuery({
    queryKey: dailyReportKeys.byProject(projectId, page, limit, startDate, endDate),
    queryFn: () => getProjectDailyReports(projectId, page, limit, startDate, endDate),
    enabled: !!projectId,
  });

export const useGenerateDailyReport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectName, date }: { projectName: string; date?: string }) =>
      generateReport(projectName, date),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dailyReportKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
};

export const useGenerateAsyncDailyReport = () =>
  useMutation({
    mutationFn: ({ projectName, date }: { projectName: string; date?: string }) =>
      generateAsyncReport(projectName, date),
  });

export const useDownloadDailyReport = () =>
  useMutation({
    mutationFn: ({ projectName, date }: { projectName: string; date: string }) =>
      downloadReport(projectName, date),
  });

export const useDownloadDailyReportText = () =>
  useMutation({
    mutationFn: ({ projectName, date }: { projectName: string; date: string }) =>
      downloadDailyReportText(projectName, date),
  });

export const useDownloadDailyReportCSV = () =>
  useMutation({
    mutationFn: ({ projectName, date }: { projectName: string; date: string }) =>
      downloadDailyReportCSV(projectName, date),
  });

export const useSaveDailyInsights = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, insights }: { id: number; insights: string }) =>
      saveDailyInsights(id, insights),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dailyReportKeys.all });
    },
  });
};

export const usePreviewInsights = () =>
  useMutation({
    mutationFn: ({ reportType, id, insights }: { reportType: ReportType; id: number; insights: string }) =>
      previewInsights(reportType, id, insights),
  });

export const useAcceptInsights = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reportType, id, insights, newSummary }:
      { reportType: ReportType; id: number; insights: string; newSummary: string }) =>
      acceptInsights(reportType, id, insights, newSummary),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dailyReportKeys.all });
    },
  });
};

export const useApplyInsightsHealth = () =>
  useMutation({
    mutationFn: ({ id, insightsHealth, reason }: { id: number; insightsHealth: string; reason: string }) =>
      applyInsightsHealth(id, insightsHealth, reason),
  });

export const useAddTeamNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reportType, id, text }: { reportType: ReportType; id: number; text: string }) =>
      addTeamNote(reportType, id, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dailyReportKeys.all });
    },
  });
};
