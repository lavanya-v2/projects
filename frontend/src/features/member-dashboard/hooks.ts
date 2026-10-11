import { useQuery } from '@tanstack/react-query';
import { client } from '../../api/client';
import { memberDashboardKeys } from '../../shared/queryKeys';
import type { ApiResponse } from '../../shared/apiTypes';
import type { AutomationLabelSummary, MemberDashboardData, TechNotesGap } from './types';

const getMemberDashboard = async (): Promise<MemberDashboardData> => {
  const response = await client.get<ApiResponse<MemberDashboardData>>('/member/dashboard');
  return response.data.data;
};

export const useMemberDashboard = () =>
  useQuery({
    queryKey: memberDashboardKeys.dashboard(),
    queryFn: getMemberDashboard,
  });

const getTechNotesGap = async (projectId: number): Promise<TechNotesGap> => {
  const response = await client.get<ApiResponse<TechNotesGap>>(
    `/member/project/${projectId}/tech-notes-gap`,
  );
  return response.data.data;
};

export const useTechNotesGap = (projectId: number, enabled: boolean) =>
  useQuery({
    queryKey: memberDashboardKeys.techNotesGap(projectId),
    queryFn: () => getTechNotesGap(projectId),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

const getAutomationLabels = async (projectId: number): Promise<AutomationLabelSummary> => {
  const response = await client.get<ApiResponse<AutomationLabelSummary>>(
    `/member/project/${projectId}/automation-labels`,
  );
  return response.data.data;
};

/** Live-Jira call — deliberately lazy so it resolves after the DB-driven charts render. */
export const useAutomationLabels = (projectId: number, enabled: boolean) =>
  useQuery({
    queryKey: memberDashboardKeys.automationLabels(projectId),
    queryFn: () => getAutomationLabels(projectId),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
