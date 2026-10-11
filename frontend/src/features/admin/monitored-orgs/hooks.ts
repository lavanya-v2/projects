import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import type { ApiResponse } from '../../../shared/apiTypes';

export interface MonitoredOrg {
  orgUuid: string;
  orgName: string | null;
  enabled: boolean;
  firstSeenAt: string;
  licenseType: 'seat' | 'api' | null;
  seatMonthlyUsd: number | null;
}

const keys = { all: ['monitored-orgs'] as const, list: () => ['monitored-orgs', 'list'] as const };

export const useMonitoredOrgs = () =>
  useQuery({
    queryKey: keys.list(),
    queryFn: async (): Promise<MonitoredOrg[]> => {
      const res = await client.get<ApiResponse<MonitoredOrg[]>>('/admin/monitored-orgs');
      return res.data.data;
    },
  });

export const useSetOrgEnabled = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { orgUuid: string; enabled: boolean }) => {
      await client.post('/admin/monitored-orgs/set', payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
};

export const useSetOrgLicense = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      orgUuid: string;
      licenseType?: 'seat' | 'api' | null;
      seatMonthlyUsd?: number | null;
    }) => {
      await client.post('/admin/monitored-orgs/license', payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
};
