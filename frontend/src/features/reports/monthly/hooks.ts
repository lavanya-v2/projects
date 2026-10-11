import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import { monthlyReportKeys, dashboardKeys } from '../../../shared/queryKeys';
import type { ApiResponse } from '../../../shared/apiTypes';
import type { MonthlyReportListResponse } from './types';

// ---- helpers inlined from the old api object ----------------------------

const getProjectMonthlyReports = async (
  projectId: number,
  page: number = 1,
  limit: number = 10,
  status?: string,
): Promise<MonthlyReportListResponse> => {
  const params: any = { page, limit };
  if (status && status !== 'All') params.status = status;
  const response = await client.get<ApiResponse<MonthlyReportListResponse>>(
    `/report/project/${projectId}/monthly`,
    { params },
  );
  return response.data.data;
};

const getMonthlyAccountReports = async (
  accountId: number,
  page: number = 1,
  limit: number = 10,
  health?: string,
): Promise<MonthlyReportListResponse> => {
  const params: any = { page, limit };
  if (health && health !== 'All') params.health = health;
  const response = await client.get<ApiResponse<MonthlyReportListResponse>>(
    `/report/account/${accountId}/monthly`,
    { params },
  );
  return response.data.data;
};

const generateMonthlyProjectReport = async (
  projectId: number,
  month: number,
  year: number,
  force: boolean = false,
): Promise<any> => {
  const response = await client.post<ApiResponse<any>>('/report/project/monthly', {
    projectId,
    month,
    year,
    force,
  });
  return response.data.data;
};

const generateMonthlyAccountReport = async (
  accountId: number,
  month: number,
  year: number,
  force: boolean = false,
): Promise<any> => {
  const response = await client.post<ApiResponse<any>>('/report/account/monthly', {
    accountId,
    month,
    year,
    force,
  });
  return response.data.data;
};

const downloadMonthlyAccountReport = async (accountId: number, month: number, year: number) => {
  const response = await client.get(
    `/report/account/monthly/download?accountId=${accountId}&month=${month}&year=${year}`,
    { responseType: 'blob' },
  );
  const contentDisposition = response.headers['content-disposition'];
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[month - 1] || `Month${month}`;
  let fileName = `Account_Monthly_Report_${monthName}_${year}.pptx`;
  if (contentDisposition) {
    const m = contentDisposition.match(/filename="?([^"]+)"?/);
    if (m && m.length === 2) fileName = m[1];
  }
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.parentNode?.removeChild(link);
  window.URL.revokeObjectURL(url);
};

// ---- hooks ---------------------------------------------------------------

export const useProjectMonthlyReports = (
  projectId: number,
  page: number = 1,
  limit: number = 10,
  status?: string,
) =>
  useQuery({
    queryKey: monthlyReportKeys.byProject(projectId, page, limit, status),
    queryFn: () => getProjectMonthlyReports(projectId, page, limit, status),
    enabled: !!projectId,
  });

export const useAccountMonthlyReports = (
  accountId: number,
  page: number = 1,
  limit: number = 10,
  health?: string,
) =>
  useQuery({
    queryKey: monthlyReportKeys.byAccount(accountId, page, limit, health),
    queryFn: () => getMonthlyAccountReports(accountId, page, limit, health),
    enabled: !!accountId,
  });

export const useGenerateMonthlyProjectReport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, month, year, force = false }:
      { projectId: number; month: number; year: number; force?: boolean }) =>
      generateMonthlyProjectReport(projectId, month, year, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: monthlyReportKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
    },
  });
};

export const useGenerateMonthlyAccountReport = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, month, year, force = false }:
      { accountId: number; month: number; year: number; force?: boolean }) =>
      generateMonthlyAccountReport(accountId, month, year, force),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: monthlyReportKeys.all });
    },
  });
};

export const useDownloadMonthlyAccountReport = () =>
  useMutation({
    mutationFn: ({ accountId, month, year }: { accountId: number; month: number; year: number }) =>
      downloadMonthlyAccountReport(accountId, month, year),
  });
