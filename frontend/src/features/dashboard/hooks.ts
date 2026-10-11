import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import { dashboardKeys } from '../../shared/queryKeys';

// ---- helpers inlined from the old api object ----------------------------

const getDashboardOverview = async (): Promise<any> => {
  const res = await client.get<any>('/report/dashboard-overview');
  return res.data;
};

const getProjectDashboardDetail = async (projectId: number): Promise<any> => {
  const res = await client.get<any>(`/report/dashboard-project/${projectId}`);
  return res.data;
};

// ---- hooks ---------------------------------------------------------------

export const useDashboardOverview = () =>
  useQuery({
    queryKey: dashboardKeys.overview(),
    queryFn: () => getDashboardOverview(),
  });

export const useProjectDashboard = (projectId: number | null | undefined) =>
  useQuery({
    queryKey: dashboardKeys.project(projectId ?? 0),
    queryFn: () => getProjectDashboardDetail(projectId as number),
    enabled: !!projectId,
  });
