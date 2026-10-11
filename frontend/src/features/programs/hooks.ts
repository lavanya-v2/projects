/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../api/client';
import { programKeys, projectKeys } from '../../shared/queryKeys';
import type { ApiResponse } from '../../shared/apiTypes';
import type {
  Program,
  ProgramOwner,
  ProgramWeeklyReportRow,
  ProgramMonthlyReportRow,
  ProgramDailyReportRow,
  ProgramReportListResponse,
  ProgApiResponse
} from './types';

// ---- HTTP helpers ---------------------------------------------------------

const listProgramsByAccount = async (
  accountId: number,
  pageNumber?: number,
  pageLimit?: number
): Promise<ProgApiResponse> => {
  const params: any = { accountId, pageNumber, pageLimit };
  const response = await client.get<ApiResponse<Program[]>>('/programs/pagination', { params });
  return response.data;
};

const listProgByAccWithoutPagination = async (
  accountId: number,
  nonEmptyOnly: boolean = false,
): Promise<Program[]> => {
  const params: any = { accountId};
  if (nonEmptyOnly) params.nonEmptyOnly = 'true';
  const response = await client.get<Program[]>('/programs', { params });
  return response.data;
};

const listAccessiblePrograms = async (): Promise<Program[]> => {
  const response = await client.get<ApiResponse<Program[]>>('/programs/accessible');
  return response.data.data;
};

const getProgram = async (programId: number): Promise<Program> => {
  const response = await client.get<ApiResponse<Program>>(`/programs/${programId}`);
  return response.data.data;
};

const createProgram = async (input: {
  accountId: number;
  name: string;
  description?: string;
  redThresholdPercentage?: number | null;
}): Promise<Program> => {
  const response = await client.post<ApiResponse<Program>>('/programs', input);
  return response.data.data;
};

const updateProgram = async (
  programId: number,
  input: { name?: string; description?: string; redThresholdPercentage?: number | null },
): Promise<Program> => {
  const response = await client.put<ApiResponse<Program>>(`/programs/${programId}`, input);
  return response.data.data;
};

const deleteProgram = async (programId: number, force: boolean = false): Promise<void> => {
  await client.delete(`/programs/${programId}`, { params: force ? { force: 'true' } : {} });
};

const assignProjectsToProgram = async (
  programId: number,
  projectIds: number[],
  action: 'assign' | 'unassign' = 'assign',
): Promise<void> => {
  await client.post(`/programs/${programId}/projects`, { projectIds, action });
};

const listProgramOwners = async (programId: number): Promise<ProgramOwner[]> => {
  const response = await client.get<ApiResponse<ProgramOwner[]>>(`/programs/${programId}/owners`);
  return response.data.data;
};

const addProgramOwner = async (
  programId: number,
  userId: number,
  isPrimary: boolean = false,
): Promise<ProgramOwner> => {
  const response = await client.post<ApiResponse<ProgramOwner>>(
    `/programs/${programId}/owners`,
    { userId, isPrimary },
  );
  return response.data.data;
};

const removeProgramOwner = async (programId: number, userId: number): Promise<void> => {
  await client.delete(`/programs/${programId}/owners/${userId}`);
};

const setPrimaryProgramOwner = async (programId: number, userId: number): Promise<ProgramOwner> => {
  const response = await client.patch<ApiResponse<ProgramOwner>>(
    `/programs/${programId}/owners/${userId}/primary`,
    {},
  );
  return response.data.data;
};

// Reports

const getProgramDailyReports = async (
  programId: number,
  page: number = 1,
  limit: number = 10,
): Promise<ProgramReportListResponse<ProgramDailyReportRow>> => {
  const response = await client.get<ApiResponse<ProgramReportListResponse<ProgramDailyReportRow>>>(
    `/report/program/${programId}/daily`,
    { params: { page, limit } },
  );
  return response.data.data;
};

const queueProgramDailyReport = async (
  programId: number,
  date?: string,
): Promise<{ jobId: string }> => {
  const response = await client.post<ApiResponse<any>>(
    `/report/program/${programId}/daily/queue`,
    { date },
  );
  return response.data as any;
};

const queueProgramWeeklyReport = async (
  programId: number,
  startDate: string,
  endDate: string,
): Promise<{ jobId: string }> => {
  const response = await client.post<ApiResponse<any>>(
    `/report/program/${programId}/weekly/queue`,
    { startDate, endDate },
  );
  return response.data as any;
};

const queueProgramMonthlyReport = async (
  programId: number,
  month: number,
  year: number,
): Promise<{ jobId: string }> => {
  const response = await client.post<ApiResponse<any>>(
    `/report/program/${programId}/monthly/queue`,
    { month, year },
  );
  return response.data as any;
};

const getProgramWeeklyReports = async (
  programId: number,
  page: number = 1,
  limit: number = 10,
): Promise<ProgramReportListResponse<ProgramWeeklyReportRow>> => {
  const response = await client.get<ApiResponse<ProgramReportListResponse<ProgramWeeklyReportRow>>>(
    `/report/program/${programId}/weekly`,
    { params: { page, limit } },
  );
  return response.data.data;
};

const generateProgramWeeklyReport = async (
  programId: number,
  startDate: string,
  endDate: string,
  force: boolean = false,
): Promise<ProgramWeeklyReportRow> => {
  const response = await client.post<ApiResponse<ProgramWeeklyReportRow>>(
    `/report/program/${programId}/weekly`,
    { startDate, endDate, force },
  );
  return response.data.data;
};

const getProgramMonthlyReports = async (
  programId: number,
  page: number = 1,
  limit: number = 10,
): Promise<ProgramReportListResponse<ProgramMonthlyReportRow>> => {
  const response = await client.get<ApiResponse<ProgramReportListResponse<ProgramMonthlyReportRow>>>(
    `/report/program/${programId}/monthly`,
    { params: { page, limit } },
  );
  return response.data.data;
};

const generateProgramMonthlyReport = async (
  programId: number,
  month: number,
  year: number,
  force: boolean = false,
): Promise<ProgramMonthlyReportRow> => {
  const response = await client.post<ApiResponse<ProgramMonthlyReportRow>>(
    `/report/program/${programId}/monthly`,
    { month, year, force },
  );
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

export const downloadProgramWeeklyReport = async (
  programId: number,
  weekNumber: number,
  year: number,
): Promise<void> => {
  const response = await client.get(`/report/program/${programId}/weekly/download`, {
    params: { weekNumber, year },
    responseType: 'blob',
  });
  const fileName = filenameFromHeaders(
    response.headers,
    `Program_Report_W${weekNumber}_${year}.pptx`,
  );
  downloadBlob(response.data, fileName);
};

export const downloadProgramMonthlyReport = async (
  programId: number,
  month: number,
  year: number,
): Promise<void> => {
  const response = await client.get(`/report/program/${programId}/monthly/download`, {
    params: { month, year },
    responseType: 'blob',
  });
  const fileName = filenameFromHeaders(
    response.headers,
    `Program_Monthly_Report_${month}_${year}.pptx`,
  );
  downloadBlob(response.data, fileName);
};

// ---- Queries --------------------------------------------------------------

export const useProgramsByAccount = (accountId: number | null, pageNumber?: number, pageLimit?: number) =>
  useQuery({
    queryKey: programKeys.byAccountWithPagination(accountId ?? 0, pageNumber, pageLimit),
    queryFn: () => listProgramsByAccount(accountId!, pageNumber, pageLimit),
    enabled: !!accountId,
  });

export const useProgByAccWithoutPagination = (accountId: number | null, nonEmptyOnly: boolean) =>
  useQuery({
    queryKey: programKeys.byAccount(accountId ?? 0, nonEmptyOnly),
    queryFn: () => listProgByAccWithoutPagination(accountId!, nonEmptyOnly),
    enabled: !!accountId,
  });

export const useAccessiblePrograms = (enabled: boolean = true) =>
  useQuery({
    queryKey: programKeys.accessible(),
    queryFn: () => listAccessiblePrograms(),
    enabled,
  });

export const useProgram = (programId: number | null) =>
  useQuery({
    queryKey: programKeys.detail(programId ?? 0),
    queryFn: () => getProgram(programId!),
    enabled: !!programId,
  });

export const useProgramOwners = (programId: number | null) =>
  useQuery({
    queryKey: programKeys.owners(programId ?? 0),
    queryFn: () => listProgramOwners(programId!),
    enabled: !!programId,
  });

export const useProgramDailyReports = (programId: number | null, page: number = 1, limit: number = 10) =>
  useQuery({
    queryKey: [...programKeys.all, 'daily', programId ?? 0, { page, limit }] as const,
    queryFn: () => getProgramDailyReports(programId!, page, limit),
    enabled: !!programId,
  });

export const useQueueProgramDailyReport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programId, date }: { programId: number; date?: string }) =>
      queueProgramDailyReport(programId, date),
    onSuccess: (_data, { programId }) => {
      qc.invalidateQueries({ queryKey: [...programKeys.all, 'daily', programId] });
    },
  });
};

export const useQueueProgramWeeklyReport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      programId,
      startDate,
      endDate,
    }: {
      programId: number;
      startDate: string;
      endDate: string;
    }) => queueProgramWeeklyReport(programId, startDate, endDate),
    onSuccess: (_data, { programId }) => {
      qc.invalidateQueries({ queryKey: programKeys.weeklyReports(programId, 1, 10) });
    },
  });
};

export const useQueueProgramMonthlyReport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programId, month, year }: { programId: number; month: number; year: number }) =>
      queueProgramMonthlyReport(programId, month, year),
    onSuccess: (_data, { programId }) => {
      qc.invalidateQueries({ queryKey: programKeys.monthlyReports(programId, 1, 10) });
    },
  });
};

export const useProgramWeeklyReports = (programId: number | null, page: number = 1, limit: number = 10) =>
  useQuery({
    queryKey: programKeys.weeklyReports(programId ?? 0, page, limit),
    queryFn: () => getProgramWeeklyReports(programId!, page, limit),
    enabled: !!programId,
  });

export const useProgramMonthlyReports = (programId: number | null, page: number = 1, limit: number = 10) =>
  useQuery({
    queryKey: programKeys.monthlyReports(programId ?? 0, page, limit),
    queryFn: () => getProgramMonthlyReports(programId!, page, limit),
    enabled: !!programId,
  });

// ---- Mutations ------------------------------------------------------------

export const useCreateProgram = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof createProgram>[0]) => createProgram(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: programKeys.all });
    },
  });
};

export const useUpdateProgram = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programId, input }: { programId: number; input: Parameters<typeof updateProgram>[1] }) =>
      updateProgram(programId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: programKeys.all });
    },
  });
};

export const useDeleteProgram = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programId, force }: { programId: number; force?: boolean }) =>
      deleteProgram(programId, force ?? false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: programKeys.all });
      // force=true unassigns projects, so the projects list is stale
      qc.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
};

export const useAssignProjectsToProgram = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      programId,
      projectIds,
      action,
    }: {
      programId: number;
      projectIds: number[];
      action?: 'assign' | 'unassign';
    }) => assignProjectsToProgram(programId, projectIds, action ?? 'assign'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: programKeys.all });
      // Project rows now have a different programId — admin projects list must refetch
      qc.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
};

export const useAddProgramOwner = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programId, userId, isPrimary }: { programId: number; userId: number; isPrimary?: boolean }) =>
      addProgramOwner(programId, userId, isPrimary ?? false),
    onSuccess: (_data, { programId }) => {
      qc.invalidateQueries({ queryKey: programKeys.owners(programId) });
    },
  });
};

export const useRemoveProgramOwner = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programId, userId }: { programId: number; userId: number }) =>
      removeProgramOwner(programId, userId),
    onSuccess: (_data, { programId }) => {
      qc.invalidateQueries({ queryKey: programKeys.owners(programId) });
    },
  });
};

export const useSetPrimaryProgramOwner = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ programId, userId }: { programId: number; userId: number }) =>
      setPrimaryProgramOwner(programId, userId),
    onSuccess: (_data, { programId }) => {
      qc.invalidateQueries({ queryKey: programKeys.owners(programId) });
    },
  });
};

export const useGenerateProgramWeeklyReport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      programId,
      startDate,
      endDate,
      force,
    }: {
      programId: number;
      startDate: string;
      endDate: string;
      force?: boolean;
    }) => generateProgramWeeklyReport(programId, startDate, endDate, force ?? false),
    onSuccess: (_data, { programId }) => {
      qc.invalidateQueries({ queryKey: programKeys.weeklyReports(programId, 1, 10) });
      qc.invalidateQueries({ queryKey: programKeys.all });
    },
  });
};

export const useGenerateProgramMonthlyReport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      programId,
      month,
      year,
      force,
    }: {
      programId: number;
      month: number;
      year: number;
      force?: boolean;
    }) => generateProgramMonthlyReport(programId, month, year, force ?? false),
    onSuccess: (_data, { programId }) => {
      qc.invalidateQueries({ queryKey: programKeys.monthlyReports(programId, 1, 10) });
      qc.invalidateQueries({ queryKey: programKeys.all });
    },
  });
};
