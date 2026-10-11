import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import type { ApiResponse } from '../../../shared/apiTypes';

export interface IntegrityFlag {
  code: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export interface FlaggedRow {
  userId: number;
  login: string;
  name: string;
  day: string;
  flags: IntegrityFlag[];
  avgScore: number;
  totalPrompts: number;
  tokens: number;
  vibeIndex: number;
  receivedAt: string | null;
  /** How that machine is triggered; anything but 'scheduler' can silently miss days. */
  triggerTier: 'scheduler' | 'startup' | 'hook' | 'none' | null;
}

const keys = {
  all: ['claude-integrity'] as const,
  list: (status: string) => ['claude-integrity', 'list', status] as const,
};

export const useFlaggedRows = (status: 'flagged' | 'ok' | 'all' = 'flagged') =>
  useQuery({
    queryKey: keys.list(status),
    queryFn: async (): Promise<FlaggedRow[]> => {
      const res = await client.get<ApiResponse<FlaggedRow[]>>('/admin/claude-integrity', {
        params: { status },
      });
      return res.data.data;
    },
  });

export const useAcknowledgeFlag = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { userId: number; day: string }) => {
      await client.post('/admin/claude-integrity/acknowledge', payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
};
