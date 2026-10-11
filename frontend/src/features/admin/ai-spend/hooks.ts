import { useQuery } from '@tanstack/react-query';
import { client } from '../../../api/client';
import type { ApiResponse } from '../../../shared/apiTypes';
import type { AiSpendSummary } from './types';

const aiSpendKeys = {
    all: ['ai-spend'] as const,
    summary: (from: string, to: string) => [...aiSpendKeys.all, 'summary', from, to] as const,
};

export const useAiSpendSummary = (from: string, to: string) =>
    useQuery({
        queryKey: aiSpendKeys.summary(from, to),
        queryFn: async (): Promise<AiSpendSummary> => {
            const res = await client.get<ApiResponse<AiSpendSummary>>('/admin/ai-spend/summary', {
                params: { from, to },
            });
            return res.data.data;
        },
    });
