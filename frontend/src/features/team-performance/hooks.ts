import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../api/client';
import { teamPerformanceKeys } from '../../shared/queryKeys';
import type { ApiResponse } from '../../shared/apiTypes';
import type {
  TeamPerformanceSprint, PerfScorecardResponse, KanbanCycle,
  ExcelSprintSummary, ExcelSprintScorecard,
} from './types';

// ---- helpers inlined from the old api object ----------------------------

const getProjectTeamMembers = async (projectId: number): Promise<any[]> => {
  const response = await client.get<ApiResponse<any[]>>(`/team-members?projectId=${projectId}`);
  return response.data.data ?? [];
};

const listTeamPerformanceSprints = async (projectId: number): Promise<TeamPerformanceSprint[]> => {
  const response = await client.get<ApiResponse<any[]>>(
    `/report/project/${projectId}/team-performance/sprints`,
  );
  return response.data.data ?? [];
};

const generateTeamPerformanceReport = async (projectId: number, body: object): Promise<any> => {
  const response = await client.post<ApiResponse<any>>(
    `/report/project/${projectId}/team-performance`,
    body,
  );
  return response.data.data;
};

const getMemberDeliveryMatrix = async (
  projectId: number,
  memberJiraId: string,
  sprintIds: number[],
): Promise<any> => {
  const params = new URLSearchParams({ memberJiraId });
  sprintIds.forEach(id => params.append('sprintIds', String(id)));
  const response = await client.get<ApiResponse<any>>(
    `/report/project/${projectId}/member-delivery-matrix?${params.toString()}`,
  );
  return response.data.data;
};

const getTeamDashboard = async (projectId: number, body: object): Promise<any> => {
  const response = await client.post<ApiResponse<any>>(
    `/report/project/${projectId}/team-dashboard`,
    body,
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

const downloadTrendsReport = async ({ accountId, projectId, format }: { accountId: number; projectId?: number; format: 'html' | 'xlsx' }) => {
  const params = new URLSearchParams({ accountId: String(accountId), format });
  if (projectId) params.set('projectId', String(projectId));
  const response = await client.get(
    `/report/team-performance/trends/download?${params.toString()}`,
    { responseType: 'blob' },
  );
  const fileName = filenameFromHeaders(response.headers, `team-performance-trends.${format}`);
  downloadBlob(response.data, fileName);
};

const getPerfSyncHistory = async (projectId: number): Promise<any[]> => {
  const res = await client.get<any>(`/report/project/${projectId}/perf/syncs`);
  return res.data.data ?? [];
};

const getPerfScorecard = async (projectId: number, syncId: number): Promise<PerfScorecardResponse> => {
  const res = await client.get<any>(`/report/project/${projectId}/perf/sync/${syncId}/scorecard`);
  return res.data.data;
};

const getPerfTicketFacts = async (projectId: number, syncId: number, jiraLoginId?: string): Promise<any[]> => {
  const params = jiraLoginId ? `?jiraLoginId=${encodeURIComponent(jiraLoginId)}` : '';
  const res = await client.get<any>(`/report/project/${projectId}/perf/sync/${syncId}/tickets${params}`);
  return res.data.data ?? [];
};

const savePerfOverride = async (
  projectId: number,
  syncId: number,
  jiraLoginId: string,
  metrics: Record<string, number>,
  reason: string,
): Promise<any> => {
  const res = await client.patch<any>(
    `/report/project/${projectId}/perf/sync/${syncId}/member/override`,
    { jiraLoginId, metrics, reason },
  );
  return res.data.data;
};

const clearPerfOverride = async (projectId: number, syncId: number, jiraLoginId: string): Promise<void> => {
  await client.delete(
    `/report/project/${projectId}/perf/sync/${syncId}/member/override`,
    { data: { jiraLoginId } },
  );
};

const triggerPerfSprintSync = async (projectId: number, jiraSprintId: number): Promise<void> => {
  await client.post(`/report/project/${projectId}/perf/sync/sprint`, { jiraSprintId });
};

const triggerPerfKanbanSync = async (
  projectId: number,
  fromDate: string,
  toDate: string,
  label: string,
): Promise<void> => {
  await client.post(`/report/project/${projectId}/perf/sync/kanban`, { fromDate, toDate, label });
};

const getLiveKanbanSpan = async (projectId: number): Promise<PerfScorecardResponse> => {
  const res = await client.get<any>(`/report/project/${projectId}/perf/kanban/live-span`);
  return res.data.data;
};

const listKanbanCycles = async (projectId: number): Promise<KanbanCycle[]> => {
  const res = await client.get<ApiResponse<KanbanCycle[]>>(`/report/project/${projectId}/perf/kanban/cycles`);
  return res.data.data ?? [];
};

const triggerPerfKanbanCycleSync = async (projectId: number, cycleIndex: number): Promise<void> => {
  await client.post(`/report/project/${projectId}/perf/sync/kanban-cycle`, { cycleIndex });
};

const overrideKanbanCycle = async (
  projectId: number,
  cycleIndex: number,
  startDate: string,
  endDate: string,
): Promise<void> => {
  await client.put(`/report/project/${projectId}/perf/kanban/cycles/${cycleIndex}/override`, { startDate, endDate });
};

const recomputePerfScores = async (projectId: number, syncId: number): Promise<void> => {
  await client.post(`/report/project/${projectId}/perf/sync/${syncId}/recompute`);
};

const retryPerfSync = async (projectId: number, syncId: number): Promise<void> => {
  await client.post(`/report/project/${projectId}/perf/sync/${syncId}/retry`);
};

const deletePerfSync = async (projectId: number, syncId: number): Promise<void> => {
  await client.delete(`/report/project/${projectId}/perf/sync/${syncId}`);
};

// ---- hooks ---------------------------------------------------------------

export const useProjectTeamMembers = (projectId: number) =>
  useQuery({
    queryKey: teamPerformanceKeys.members(projectId),
    queryFn: () => getProjectTeamMembers(projectId),
    enabled: !!projectId,
  });

export const useTeamPerformanceSprints = (projectId: number) =>
  useQuery({
    queryKey: teamPerformanceKeys.sprints(projectId),
    queryFn: () => listTeamPerformanceSprints(projectId),
    enabled: !!projectId,
  });

export const usePerfSyncHistory = (projectId: number) =>
  useQuery({
    queryKey: teamPerformanceKeys.syncHistory(projectId),
    queryFn: () => getPerfSyncHistory(projectId),
    enabled: !!projectId,
  });

export const usePerfScorecard = (projectId: number, syncId: number | null | undefined) =>
  useQuery({
    queryKey: teamPerformanceKeys.scorecard(projectId, syncId ?? 0),
    queryFn: () => getPerfScorecard(projectId, syncId as number),
    enabled: !!projectId && !!syncId,
  });

export const usePerfTicketFacts = (
  projectId: number,
  syncId: number | null | undefined,
  jiraLoginId?: string,
) =>
  useQuery({
    queryKey: teamPerformanceKeys.ticketFacts(projectId, syncId ?? 0, jiraLoginId),
    queryFn: () => getPerfTicketFacts(projectId, syncId as number, jiraLoginId),
    enabled: !!projectId && !!syncId,
  });

export const useDownloadTrendsReport = () =>
  useMutation({
    mutationFn: (args: { accountId: number; projectId?: number; format: 'html' | 'xlsx' }) =>
      downloadTrendsReport(args),
  });

export const useGenerateTeamPerformanceReport = () =>
  useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: object }) =>
      generateTeamPerformanceReport(projectId, body),
  });

export const useMemberDeliveryMatrix = () =>
  useMutation({
    mutationFn: ({ projectId, memberJiraId, sprintIds }:
      { projectId: number; memberJiraId: string; sprintIds: number[] }) =>
      getMemberDeliveryMatrix(projectId, memberJiraId, sprintIds),
  });

export const useTeamDashboard = () =>
  useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: object }) =>
      getTeamDashboard(projectId, body),
  });


export const useSavePerfOverride = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, syncId, jiraLoginId, metrics, reason }:
      { projectId: number; syncId: number; jiraLoginId: string; metrics: Record<string, number>; reason: string }) =>
      savePerfOverride(projectId, syncId, jiraLoginId, metrics, reason),
    onSuccess: (_, { projectId, syncId }) => {
      queryClient.invalidateQueries({ queryKey: teamPerformanceKeys.scorecard(projectId, syncId) });
    },
  });
};

export const useRecomputePerfScores = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, syncId }: { projectId: number; syncId: number }) =>
      recomputePerfScores(projectId, syncId),
    onSuccess: (_, { projectId, syncId }) => {
      queryClient.invalidateQueries({ queryKey: teamPerformanceKeys.scorecard(projectId, syncId) });
    },
  });
};

export const useRetryPerfSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, syncId }: { projectId: number; syncId: number }) =>
      retryPerfSync(projectId, syncId),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: teamPerformanceKeys.syncHistory(projectId) });
    },
  });
};

export const useClearPerfOverride = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, syncId, jiraLoginId }:
      { projectId: number; syncId: number; jiraLoginId: string }) =>
      clearPerfOverride(projectId, syncId, jiraLoginId),
    onSuccess: (_, { projectId, syncId }) => {
      queryClient.invalidateQueries({ queryKey: teamPerformanceKeys.scorecard(projectId, syncId) });
    },
  });
};

export const useTriggerPerfSprintSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, jiraSprintId }: { projectId: number; jiraSprintId: number }) =>
      triggerPerfSprintSync(projectId, jiraSprintId),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: teamPerformanceKeys.syncHistory(projectId) });
    },
  });
};

export const useTriggerPerfKanbanSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, fromDate, toDate, label }:
      { projectId: number; fromDate: string; toDate: string; label: string }) =>
      triggerPerfKanbanSync(projectId, fromDate, toDate, label),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: teamPerformanceKeys.syncHistory(projectId) });
    },
  });
};

export const useKanbanCycles = (projectId: number, enabled = true) =>
  useQuery({
    queryKey: teamPerformanceKeys.kanbanCycles(projectId),
    queryFn: () => listKanbanCycles(projectId),
    enabled: !!projectId && enabled,
  });

export const useTriggerPerfKanbanCycleSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, cycleIndex }: { projectId: number; cycleIndex: number }) =>
      triggerPerfKanbanCycleSync(projectId, cycleIndex),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: teamPerformanceKeys.syncHistory(projectId) });
      queryClient.invalidateQueries({ queryKey: teamPerformanceKeys.kanbanCycles(projectId) });
    },
  });
};

export const useOverrideKanbanCycle = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, cycleIndex, startDate, endDate }:
      { projectId: number; cycleIndex: number; startDate: string; endDate: string }) =>
      overrideKanbanCycle(projectId, cycleIndex, startDate, endDate),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: teamPerformanceKeys.kanbanCycles(projectId) });
    },
  });
};

/** Imperative variant for the live Kanban current-span read */
export const useFetchLiveKanbanSpan = () =>
  useMutation({
    mutationFn: ({ projectId }: { projectId: number }) => getLiveKanbanSpan(projectId),
  });

/** Imperative variant for Promise.all / re-fetch patterns */
export const useFetchPerfScorecard = () =>
  useMutation({
    mutationFn: ({ projectId, syncId }: { projectId: number; syncId: number }) =>
      getPerfScorecard(projectId, syncId),
  });

export const useDeletePerfSync = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, syncId }: { projectId: number; syncId: number }) =>
      deletePerfSync(projectId, syncId),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: teamPerformanceKeys.syncHistory(projectId) });
    },
  });
};

// ---- Excel Sprint Board (dataSourceType='excel' projects) ----------------

const listExcelSprints = async (projectId: number): Promise<ExcelSprintSummary[]> => {
  const response = await client.get<ApiResponse<ExcelSprintSummary[]>>(
    `/report/project/${projectId}/excel-board/sprints`,
  );
  return response.data.data ?? [];
};

const getExcelScorecard = async (projectId: number, sprint: string): Promise<ExcelSprintScorecard> => {
  const response = await client.get<ApiResponse<ExcelSprintScorecard>>(
    `/report/project/${projectId}/excel-board/scorecard`,
    { params: { sprint } },
  );
  return response.data.data;
};

export const useExcelSprints = (projectId: number, enabled = true) =>
  useQuery({
    queryKey: teamPerformanceKeys.excelSprints(projectId),
    queryFn: () => listExcelSprints(projectId),
    enabled: enabled && !!projectId,
  });

export const useExcelScorecard = (projectId: number, sprint: string | null, enabled = true) =>
  useQuery({
    queryKey: teamPerformanceKeys.excelScorecard(projectId, sprint ?? ''),
    queryFn: () => getExcelScorecard(projectId, sprint as string),
    enabled: enabled && !!projectId && !!sprint,
  });
