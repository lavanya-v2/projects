/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import { portfolioPresentationKeys } from '../../../shared/queryKeys';
import type { SortConfig } from './PortfolioPresentationList';
import type { PortfolioPresentation } from './types';

const listByAccount = async (accountId: number, searchValue?: string,  projectId?: number | string| 'all', pageNumber?: number, pageLimit?: number, sortConfig?: SortConfig): Promise<any[]> => {
  const res = await client.get<any>(`/report/account/${accountId}/portfolio-presentation`,{
    params: {
      searchParams: searchValue, 
      projectId: projectId,
      pageNumber: pageNumber,
      pageLimit: pageLimit,
      sortBy: sortConfig?.column,
      sortOrder: sortConfig?.direction,
    },
    paramsSerializer: (params) => {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === '') return;
        
        if (Array.isArray(value)) {
          value.forEach(val => {
            if (val && val.trim() !== '') {
              searchParams.append(key, val);
            }
          });
        } else {
          searchParams.append(key, String(value));
        }
      });
      return searchParams.toString();
    }
  });
  return res.data;
};

const getPresentation = async (id: number): Promise<PortfolioPresentation> => {
  const res = await client.get<any>(`/report/portfolio-presentation/${id}`);
  return res.data.data;
};

const previewPayload = async (accountId: number, data: any): Promise<any> => {
  const res = await client.post<any>(`/report/account/${accountId}/portfolio-presentation/preview`, data);
  return res.data.data;
};

const createPresentation = async (accountId: number, data: any): Promise<any> => {
  const res = await client.post<any>(`/report/account/${accountId}/portfolio-presentation`, data);
  return res.data.data;
};

const updatePresentation = async (id: number, data: any): Promise<any> => {
  const res = await client.put<any>(`/report/portfolio-presentation/${id}`, data);
  return res.data.data;
};

const refreshPresentation = async (id: number): Promise<any> => {
  const res = await client.post<any>(`/report/portfolio-presentation/${id}/refresh`);
  return res.data.data;
};

const deletePresentation = async (id: number): Promise<void> => {
  await client.delete(`/report/portfolio-presentation/${id}`);
};

const duplicatePresentation = async (id: number): Promise<any> => {
  const res = await client.post<any>(`/report/portfolio-presentation/${id}/duplicate`);
  return res.data.data;
};

const generatePortfolioMOM = async (
  id: number,
  args: { transcript: string; useAI: boolean; includeNotes: boolean }
): Promise<any> => {
  const res = await client.post<any>(`/report/portfolio-presentation/${id}/mom/generate`, args);
  return res.data.data;
};

const savePortfolioMOM = async (id: number, momContent: string): Promise<any> => {
  const res = await client.post<any>(`/report/portfolio-presentation/${id}/mom/save`, { momContent });
  return res.data.data;
};

const acceptPortfolioMOM = async (id: number, momContent?: string): Promise<any> => {
  const res = await client.post<any>(`/report/portfolio-presentation/${id}/mom/accept`, { momContent });
  return res.data.data;
};

export const usePortfolioPresentations = (accountId: number, searchValue?: string, projectId?: number | string, pageNumber?: number, pageLimit?: number, sortConfig?: SortConfig) =>
  useQuery({
    queryKey: [...portfolioPresentationKeys.list(accountId, projectId), searchValue, pageNumber, pageLimit, sortConfig],
    queryFn: () => listByAccount(accountId, searchValue, projectId, pageNumber, pageLimit, sortConfig),
    enabled: !!accountId,
  });

export const usePortfolioPresentation = (id: number | null | undefined) =>
  useQuery({
    queryKey: portfolioPresentationKeys.detail(id ?? 0),
    queryFn: () => getPresentation(id as number),
    enabled: !!id,
  });

export const usePortfolioPresentationPrefetch = () => {
  const queryClient = useQueryClient();
   return (id: number | null | undefined) => {
    queryClient.prefetchQuery({
      queryKey: portfolioPresentationKeys.detail(id ?? 0),
      queryFn: () => getPresentation(id as number),
    });
  };
}

export const useFetchPortfolioPresentation = () =>
  useMutation({
    mutationFn: (id: number) => getPresentation(id),
  });

export const usePreviewPortfolioPayload = () =>
  useMutation({
    mutationFn: ({ accountId, data }: { accountId: number; data: any }) =>
      previewPayload(accountId, data),
  });

export const useCreatePortfolioPresentation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, data }: { accountId: number; data: any }) =>
      createPresentation(accountId, data),
    onSuccess: (_, { accountId }) => {
      qc.invalidateQueries({ queryKey: portfolioPresentationKeys.list(accountId) });
    },
  });
};

export const useUpdatePortfolioPresentation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updatePresentation(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: portfolioPresentationKeys.detail(id) });
      qc.invalidateQueries({ queryKey: portfolioPresentationKeys.all });
    },
  });
};

export const useRefreshPortfolioPresentation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => refreshPresentation(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: portfolioPresentationKeys.detail(id) });
    },
  });
};

export const useDeletePortfolioPresentation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deletePresentation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioPresentationKeys.all });
    },
  });
};

export const useDuplicatePortfolioPresentation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => duplicatePresentation(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portfolioPresentationKeys.all });
    },
  });
};

export const useGeneratePortfolioMOM = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, transcript, useAI, includeNotes }: { id: number; transcript: string; useAI: boolean; includeNotes: boolean }) =>
      generatePortfolioMOM(id, { transcript, useAI, includeNotes }),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: portfolioPresentationKeys.detail(id) });
    },
  });
};

export const useSavePortfolioMOM = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, momContent }: { id: number; momContent: string }) =>
      savePortfolioMOM(id, momContent),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: portfolioPresentationKeys.detail(id) });
    },
  });
};

export const useAcceptPortfolioMOM = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, momContent }: { id: number; momContent?: string }) =>
      acceptPortfolioMOM(id, momContent),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: portfolioPresentationKeys.detail(id) });
    },
  });
};
