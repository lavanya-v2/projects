import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import { weeklyReportKeys, dashboardKeys } from '../../../shared/queryKeys';
import type { ApiResponse } from '../../../shared/apiTypes';
import type { WeeklyReportData, WeeklyReportListResponse } from './types';

// ---- helpers inlined from the old api object ----------------------------

const getProjectWeeklyReports = async (
  projectId: number,
  page: number = 1,
  limit: number = 10,
  status?: string,
): Promise<WeeklyReportListResponse> => {
  const params: any = { page, limit };
  if (status && status !== 'All') params.status = status;
  const response = await client.get<ApiResponse<WeeklyReportListResponse>>(
    `/report/project/${projectId}/weekly`,
    { params },
  );
  return response.data.data;
};

const getAccountWeeklyReports = async (
  accountId: number,
  page: number = 1,
  limit: number = 10,
  status?: string,
  health?: string,
): Promise<WeeklyReportListResponse> => {
  const params: any = { page, limit };
  if (status && status !== 'All') params.status = status;
  if (health && health !== 'All') params.health = health;
  const response = await client.get<ApiResponse<WeeklyReportListResponse>>(
    `/report/account/${accountId}/weekly`,
    { params },
  );
  return response.data.data;
};

const generateWeeklyReport = async (
  projectName: string,
  startDate: string,
  endDate: string,
  force: boolean = false,
): Promise<WeeklyReportData> => {
  const response = await client.post<ApiResponse<WeeklyReportData>>('/report/weekly', {
    projectName,
    startDate,
    endDate,
    force,
  });
  return response.data.data;
};

const generateAccountWeeklyReport = async (
  accountId: number,
  startDate: string,
  endDate: string,
  force: boolean = false,
): Promise<any> => {
  const response = await client.post<ApiResponse<any>>('/report/account/weekly', {
    accountId,
    startDate,
    endDate,
    force,
  });
  return response.data.data;
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

const downloadWeeklyReportText = async (projectName: string, startDate: string, endDate: string) => {
  const response = await client.get(
    `/report/project/download-text?projectName=${projectName}&startDate=${startDate}&endDate=${endDate}`,
    { responseType: 'blob' },
  );
  const fileName = filenameFromHeaders(
    response.headers,
    `Weekly_Report_${projectName}_${startDate}_to_${endDate}.txt`,
  );
  downloadBlob(response.data, fileName);
};

const downloadWeeklyReportCSV = async (projectName: string, startDate: string, endDate: string) => {
  const response = await client.get(
    `/report/project/download-csv?projectName=${projectName}&startDate=${startDate}&endDate=${endDate}`,
    { responseType: 'blob' },
  );
  const fileName = filenameFromHeaders(
    response.headers,
    `Weekly_Report_${projectName}_${startDate}_to_${endDate}.csv`,
  );
  downloadBlob(response.data, fileName);
};

const downloadWeeklyReportPPT = async (projectName: string, startDate: string, endDate: string) => {
  const response = await client.get(
    `/report/project/download-ppt?projectName=${projectName}&startDate=${startDate}&endDate=${endDate}`,
    { responseType: 'blob' },
  );
  const fileName = filenameFromHeaders(
    response.headers,
    `Weekly_Report_${projectName}_${startDate}_to_${endDate}.pptx`,
  );
  downloadBlob(response.data, fileName);
};

const findWeeklyReportsInRange = async (
  projectId: number,
  startDate: string,
  endDate: string,
): Promise<any[]> => {
  const response = await client.get<any>(`/report/project/${projectId}/weekly`, {
    params: { page: 1, limit: 50 },
  });
  const reports: any[] = response.data.data?.reports ?? [];
  return reports.filter(r =>
    new Date(r.startDate) <= new Date(endDate) &&
    new Date(r.endDate) >= new Date(startDate),
  );
};

const bulkDownloadWeeklyReports = async (
  reports: { projectName: string; startDate: string; endDate: string }[],
  format: 'text' | 'csv' | 'ppt',
): Promise<void> => {
  const response = await client.post(
    '/report/project/bulk-download',
    { reports, format },
    { responseType: 'blob' },
  );
  const date = new Date().toISOString().slice(0, 10);
  const fileName = `Weekly_Reports_Bulk_${date}.zip`;
  downloadBlob(response.data, fileName);
};

const downloadAccountWeeklyReport = async (accountId: number, weekNumber: number, year: number) => {
  const response = await client.get(
    `/report/account/download?accountId=${accountId}&weekNumber=${weekNumber}&year=${year}`,
    { responseType: 'blob' },
  );
  const fileName = filenameFromHeaders(
    response.headers,
    `Account_Report_W${weekNumber}_${year}.pptx`,
  );
  downloadBlob(response.data, fileName);
};

// ---- hooks ---------------------------------------------------------------

export const useProjectWeeklyReports = (
  projectId: number,
  page: number = 1,
  limit: number = 10,
  status?: string,
) =>
  useQuery({
    queryKey: weeklyReportKeys.byProject(projectId, page, limit, status),
    queryFn: () => getProjectWeeklyReports(projectId, page, limit, status),
    enabled: !!projectId,
  });

export const useAccountWeeklyReports = (
  accountId: number,
  page: number = 1,
  limit: number = 10,
  status?: string,
  health?: string,
) =>
  useQuery({
    queryKey: weeklyReportKeys.byAccount(accountId, page, limit, status, health),
    queryFn: () => getAccountWeeklyReports(accountId, page, limit, status, health),
    enabled: !!accountId,
  });

export const useGenerateWeeklyReport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectName, startDate, endDate, force = false }:
      { projectName: string; startDate: string; endDate: string; force?: boolean }) =>
      generateWeeklyReport(projectName, startDate, endDate, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: weeklyReportKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
};

export const useGenerateAccountWeeklyReport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, startDate, endDate, force = false }:
      { accountId: number; startDate: string; endDate: string; force?: boolean }) =>
      generateAccountWeeklyReport(accountId, startDate, endDate, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: weeklyReportKeys.all });
    },
  });
};

export const useDownloadWeeklyReportText = () =>
  useMutation({
    mutationFn: ({ projectName, startDate, endDate }: { projectName: string; startDate: string; endDate: string }) =>
      downloadWeeklyReportText(projectName, startDate, endDate),
  });

export const useDownloadWeeklyReportCSV = () =>
  useMutation({
    mutationFn: ({ projectName, startDate, endDate }: { projectName: string; startDate: string; endDate: string }) =>
      downloadWeeklyReportCSV(projectName, startDate, endDate),
  });

export const useDownloadWeeklyReportPPT = () =>
  useMutation({
    mutationFn: ({ projectName, startDate, endDate }: { projectName: string; startDate: string; endDate: string }) =>
      downloadWeeklyReportPPT(projectName, startDate, endDate),
  });

export const useDownloadAccountWeeklyReport = () =>
  useMutation({
    mutationFn: ({ accountId, weekNumber, year }: { accountId: number; weekNumber: number; year: number }) =>
      downloadAccountWeeklyReport(accountId, weekNumber, year),
  });

export const useFindWeeklyReportsInRange = () =>
  useMutation({
    mutationFn: ({ projectId, startDate, endDate }: { projectId: number; startDate: string; endDate: string }) =>
      findWeeklyReportsInRange(projectId, startDate, endDate),
  });

export const useFetchProjectWeeklyReports = () =>
  useMutation({
    mutationFn: ({ projectId, page = 1, limit = 10, status }: {
      projectId: number; page?: number; limit?: number; status?: string;
    }) => getProjectWeeklyReports(projectId, page, limit, status),
  });

export const useBulkDownloadWeeklyReports = () =>
  useMutation({
    mutationFn: ({ reports, format }: {
      reports: { projectName: string; startDate: string; endDate: string }[];
      format: 'text' | 'csv' | 'ppt';
    }) => bulkDownloadWeeklyReports(reports, format),
  });
