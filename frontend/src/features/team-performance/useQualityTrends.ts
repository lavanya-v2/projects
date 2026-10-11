import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import type { ApiResponse } from '../../shared/apiTypes';

export interface SprintQualityRow {
  syncId: number;
  sprintName: string;
  startDate: string;
  endDate: string;
  spDone: number;
  spPlanned: number;
  productivity: number;
  devCount: number;
  bugCount: number;
  defectDensity: number;
  prodBugCount: number;
  reopenedStoryCount: number;
  totalStoryCount: number;
  reopenRatio: number;
  invalidReopenCount: number;
}

export interface MetricSummary {
  current: number | null;
  avg: number | null;
  trend: 'up' | 'down' | 'neutral';
  trendPct: number;
  health: 'green' | 'amber' | 'red';
}

export interface ProjectQualityTrends {
  projectId: number;
  projectName: string;
  accountName: string;
  sprints: SprintQualityRow[];
  productivity: MetricSummary;
  defectDensity: MetricSummary;
  defectLeakage: MetricSummary;
  reopenRatio: MetricSummary;
  isKanbanProject?: boolean;
  metricKind?: 'percent' | 'throughput';
}

interface QualityTrendsResponse {
  projects: ProjectQualityTrends[];
}

const fetchQualityTrends = async (v2Only: boolean, accountId: number): Promise<QualityTrendsResponse> => {
  const response = await client.get<ApiResponse<QualityTrendsResponse>>(
    `/report/quality-trends-overview?v2Only=${v2Only}&accountId=${accountId}`,
  );
  return response.data.data as QualityTrendsResponse;
};

export function useQualityTrends(v2Only: boolean, accountId: number | '') {
  return useQuery({
    queryKey: ['quality-trends-overview', v2Only, accountId],
    queryFn: () => fetchQualityTrends(v2Only, accountId as number),
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000,
  });
}
