import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import type { ApiResponse } from '../../shared/apiTypes';

export interface SprintProductivity {
  syncId: number;
  sprintName: string;
  startDate: string;
  endDate: string;
  spDone: number;
  spPlanned: number;
  productivity: number;
  devCount: number;
  syncType: string;
  periodDays: number;
}

export interface ProjectProductivity {
  projectId: number;
  projectName: string;
  accountName: string;
  sprints: SprintProductivity[];
  currentProductivity: number | null;
  avgProductivity: number | null;
  trend: 'up' | 'down' | 'neutral';
  trendPct: number;
  health: 'green' | 'amber' | 'red';
  isKanbanProject?: boolean;
  metricKind?: 'percent' | 'throughput';
  hasLegacySprintHistory?: boolean;
}

interface ProductivityOverviewResponse {
  projects: ProjectProductivity[];
}

const fetchProductivityOverview = async (v2Only: boolean, accountId: number): Promise<ProductivityOverviewResponse> => {
  const response = await client.get<ApiResponse<ProductivityOverviewResponse>>(
    `/report/productivity-overview?v2Only=${v2Only}&accountId=${accountId}`,
  );
  return response.data.data as ProductivityOverviewResponse;
};

export function useProductivityOverview(v2Only: boolean, accountId: number | '') {
  return useQuery({
    queryKey: ['productivity-overview', v2Only, accountId],
    queryFn: () => fetchProductivityOverview(v2Only, accountId as number),
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000,
  });
}

export interface LegacySprintView {
  projectId: number;
  projectName: string;
  sprints: SprintProductivity[];
  currentProductivity: number | null;
  avgProductivity: number | null;
  trend: 'up' | 'down' | 'neutral';
  trendPct: number;
  health: 'green' | 'amber' | 'red';
  metricKind: 'percent';
}

const fetchLegacySprintView = async (projectId: number): Promise<LegacySprintView> => {
  const response = await client.get<ApiResponse<LegacySprintView>>(
    `/report/productivity-overview/${projectId}/legacy-sprint-view`,
  );
  return response.data.data as LegacySprintView;
};

// Opt-in only -- fetched on demand when a user toggles "Scrum history" for a
// project that switched to Kanban mid-history, not part of the default page load.
export function useLegacySprintView(projectId: number | null) {
  return useQuery({
    queryKey: ['legacy-sprint-view', projectId],
    queryFn: () => fetchLegacySprintView(projectId as number),
    enabled: projectId != null,
    staleTime: 5 * 60 * 1000,
  });
}
