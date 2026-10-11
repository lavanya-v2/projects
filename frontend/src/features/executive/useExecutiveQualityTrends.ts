import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import type { ApiResponse } from '../../shared/apiTypes';
import type { ProjectQualityTrends } from '../team-performance/useQualityTrends';

/**
 * Executive-scoped trends: same payload shape as the org-wide quality-trends
 * endpoint, but the backend narrows `projects` to the caller's accessible
 * projects within the account. Always whole-team (v2Only is not exposed to
 * customers).
 */
interface ExecutiveTrendsResponse {
  projects: ProjectQualityTrends[];
}

const fetchExecutiveTrends = async (accountId: number): Promise<ExecutiveTrendsResponse> => {
  const response = await client.get<ApiResponse<ExecutiveTrendsResponse>>(
    `/report/executive/quality-trends-overview?accountId=${accountId}`,
  );
  return response.data.data as ExecutiveTrendsResponse;
};

export function useExecutiveQualityTrends(accountId: number | '') {
  return useQuery({
    queryKey: ['executive-quality-trends', accountId],
    queryFn: () => fetchExecutiveTrends(accountId as number),
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000,
  });
}

export type { ProjectQualityTrends };
