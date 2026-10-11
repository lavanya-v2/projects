import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import type { ApiResponse } from '../../../shared/apiTypes';

export interface RateLimitToken {
  tokenId: number;
  userId: number;
  login: string;
  name: string;
  lastFour: string | null;
  minIntervalMinutesOverride: number | null;
  lastSeenAt: string | null;
}

export interface RateLimitSettings {
  globalMinutes: number;
  tokens: RateLimitToken[];
}

const keys = { all: ['ingest-rate-limit'] as const };

export const useIngestRateLimit = () =>
  useQuery({
    queryKey: keys.all,
    queryFn: async (): Promise<RateLimitSettings> => {
      const res = await client.get<ApiResponse<RateLimitSettings>>('/admin/ingest-rate-limit');
      return res.data.data;
    },
  });

export const useSetGlobalRateLimit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (minIntervalMinutes: number) => {
      await client.post('/admin/ingest-rate-limit/global', { minIntervalMinutes });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
};

export const useSetTokenOverride = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { tokenId: number; minIntervalMinutesOverride: number | null }) => {
      await client.post('/admin/ingest-rate-limit/token-override', payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
};

// --- Collector version policy (ADDENDUM 22) ---------------------------------
// A separate ingest gate from the rate limit above, but lives in the same admin
// area — both are single-row, admin-tunable ingest controls.

export interface CollectorVersionPolicy {
  minEnforcedVersion: string | null;
  enforceAfter: string | null; // ISO, or null
}

const versionPolicyKeys = { all: ['collector-version-policy'] as const };

export const useCollectorVersionPolicy = () =>
  useQuery({
    queryKey: versionPolicyKeys.all,
    queryFn: async (): Promise<CollectorVersionPolicy> => {
      const res = await client.get<ApiResponse<CollectorVersionPolicy>>('/admin/collector-version-policy');
      return res.data.data;
    },
  });

export const useSetCollectorVersionPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { minEnforcedVersion: string | null; enforceAfter: string | null }) => {
      await client.post('/admin/collector-version-policy', payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: versionPolicyKeys.all }),
  });
};
