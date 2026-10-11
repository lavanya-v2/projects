import { useQuery } from '@tanstack/react-query';
import { client } from '../../../api/client';
import { usageKeys } from '../../../shared/queryKeys';
import type { ApiResponse } from '../../../shared/apiTypes';
import type {
  UsageSummary,
  UsageTrendPoint,
  UsageUserRow,
  UsageFeatureRow,
  UsageWindow,
} from './types';

const getSummary = async ({ from, to }: UsageWindow): Promise<UsageSummary> => {
  const res = await client.get<ApiResponse<UsageSummary>>('/admin/usage/summary', {
    params: { from, to },
  });
  return res.data.data;
};

const getTrend = async ({ from, to }: UsageWindow): Promise<UsageTrendPoint[]> => {
  const res = await client.get<ApiResponse<UsageTrendPoint[]>>('/admin/usage/trend', {
    params: { from, to },
  });
  return res.data.data;
};

const getUsers = async ({ from, to }: UsageWindow, role?: string): Promise<UsageUserRow[]> => {
  const res = await client.get<ApiResponse<UsageUserRow[]>>('/admin/usage/users', {
    params: { from, to, role: role},
  });
  return res.data.data;
};

const getFeatures = async ({ from, to }: UsageWindow): Promise<UsageFeatureRow[]> => {
  const res = await client.get<ApiResponse<UsageFeatureRow[]>>('/admin/usage/features', {
    params: { from, to },
  });
  return res.data.data;
};

export const useUsageSummary = (window: UsageWindow) =>
  useQuery({
    queryKey: usageKeys.summary(window.from, window.to),
    queryFn: () => getSummary(window),
  });

export const useUsageTrend = (window: UsageWindow) =>
  useQuery({
    queryKey: usageKeys.trend(window.from, window.to),
    queryFn: () => getTrend(window),
  });

export const useUsageUsers = (window: UsageWindow, role?: string) =>
  useQuery({
    queryKey: usageKeys.users(window.from, window.to, role),
    queryFn: () => getUsers(window, role),
  });

export const useUsageFeatures = (window: UsageWindow) =>
  useQuery({
    queryKey: usageKeys.features(window.from, window.to),
    queryFn: () => getFeatures(window),
  });
