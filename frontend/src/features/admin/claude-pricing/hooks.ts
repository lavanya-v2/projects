import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import type { ApiResponse } from '../../../shared/apiTypes';
import type { PricingRates, PricingVersion } from './types';

const pricingKeys = {
  all: ['claude-pricing'] as const,
  list: () => [...pricingKeys.all, 'list'] as const,
};

export const usePricingVersions = () =>
  useQuery({
    queryKey: pricingKeys.list(),
    queryFn: async (): Promise<PricingVersion[]> => {
      const res = await client.get<ApiResponse<PricingVersion[]>>('/admin/claude-pricing');
      return res.data.data;
    },
  });

export const useCreatePricingVersion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { rates: PricingRates; note: string }) => {
      const res = await client.post<ApiResponse<PricingVersion>>('/admin/claude-pricing', payload);
      return res.data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: pricingKeys.all }),
  });
};
