import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../api/client';
import { riskKeys } from '../../shared/queryKeys';
import type { ApiResponse } from '../../shared/apiTypes';
import type {
  Risk,
  RiskDetail,
  RiskUser,
  RiskStatus,
  CreateRiskPayload,
  RiskApiResponse,
  RiskOperations,
  RiskMitigationPlan,
  RiskComment,
} from './types';

// ---- helpers inlined from the old api object ----------------------------

const getRisks = async (sourceFilter?: string): Promise<Risk[]> => {
  const url = sourceFilter ? `/risks?sourceFilter=${sourceFilter}` : '/risks'
  const response = await client.get<ApiResponse<Risk[]>>(url);
  return response.data.data;
};

const getRiskById = async (id: number): Promise<RiskDetail> => {
  const response = await client.get<ApiResponse<RiskDetail>>(`/risks/${id}`);
  return response.data.data;
};

const createRisk = async (data: CreateRiskPayload): Promise<Risk> => {
  const response = await client.post<ApiResponse<Risk>>('/risks', data);
  return response.data.data;
};

const updateRisk = async (id: number, data: Partial<CreateRiskPayload>): Promise<Risk> => {
  const response = await client.put<ApiResponse<Risk>>(`/risks/${id}`, data);
  return response.data.data;
};

const transitionRiskStatus = async (id: number, status: RiskStatus, comment: string): Promise<RiskApiResponse> => {
  const response = await client.put<ApiResponse<RiskOperations>>(`/risks/${id}/status`, { status, comment });
  return response.data;
};

const deleteRisk = async (id: number): Promise<RiskApiResponse> => {
  const response = await client.delete<ApiResponse<RiskOperations>>(`/risks/${id}`);
  return response.data;
};

const addRiskComment = async (riskId: number, comment: string): Promise<RiskApiResponse> => {
  const response = await client.post<ApiResponse<RiskComment>>(`/risks/${riskId}/comments`, { comment });
  return response.data;
};

const updateRiskComment = async (riskId: number, commentId: number, comment: string): Promise<RiskApiResponse> => {
  const response = await client.put<ApiResponse<RiskComment>>(`/risks/${riskId}/comments/${commentId}`, { comment });
  return response.data;
};

const addMitigationPlan = async (riskId: number, description: string): Promise<RiskApiResponse> => {
  const response = await client.post<ApiResponse<RiskMitigationPlan>>(`/risks/${riskId}/mitigation-plans`, { description });
  return response.data;
};

const updateMitigationPlan = async (riskId: number, planId: number, description: string): Promise<RiskApiResponse> => {
  const response = await client.put<ApiResponse<RiskMitigationPlan>>(
    `/risks/${riskId}/mitigation-plans/${planId}`,
    { description },
  );
  return response.data;
};

const deleteMitigationPlan = async (riskId: number, planId: number): Promise<RiskApiResponse> => {
  const response = await client.delete<ApiResponse<RiskMitigationPlan>>(
    `/risks/${riskId}/mitigation-plans/${planId}`,
  );
  return response.data;
};

const getRiskSuperusers = async (): Promise<RiskUser[]> => {
  const response = await client.get<ApiResponse<RiskUser[]>>('/risks/superusers');
  return response.data.data;
};

const markRiskDone = async (id: number, resolution: string): Promise<RiskApiResponse> => {
  const response = await client.put<ApiResponse<RiskDetail>>(`/risks/${id}/done`, { resolution });
  return response.data;
};

// ---- hooks ---------------------------------------------------------------

export const useRisks = (sourceFilter?:string) =>
  useQuery({
    queryKey: riskKeys.list(sourceFilter),
    queryFn: () => getRisks(sourceFilter),
  });

export const useRisk = (id: number | null | undefined) =>
  useQuery({
    queryKey: riskKeys.detail(id ?? 0),
    queryFn: () => getRiskById(id as number),
    enabled: !!id,
  });

export const useRiskSuperusers = () =>
  useQuery({
    queryKey: riskKeys.superusers(),
    queryFn: () => getRiskSuperusers(),
  });

export const useCreateRisk = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateRiskPayload) => createRisk(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskKeys.all });
    },
  });
};

export const useUpdateRisk = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateRiskPayload> }) =>
      updateRisk(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskKeys.all });
    },
  });
};

export const useTransitionRiskStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, comment }: { id: number; status: RiskStatus; comment: string }) =>
      transitionRiskStatus(id, status, comment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskKeys.all });
    },
  });
};

export const useDeleteRisk = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteRisk(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskKeys.all });
    },
  });
};

export const useAddRiskComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ riskId, comment }: { riskId: number; comment: string }) =>
      addRiskComment(riskId, comment),
    onSuccess: (_, { riskId }) => {
      queryClient.invalidateQueries({ queryKey: riskKeys.detail(riskId) });
    },
  });
};

export const useUpdateRiskComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ riskId, commentId, comment }: { riskId: number; commentId: number; comment: string }) =>
      updateRiskComment(riskId, commentId, comment),
    onSuccess: (_, { riskId }) => {
      queryClient.invalidateQueries({ queryKey: riskKeys.detail(riskId) });
    },
  });
};

export const useAddMitigationPlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ riskId, description }: { riskId: number; description: string }) =>
      addMitigationPlan(riskId, description),
    onSuccess: (_, { riskId }) => {
      queryClient.invalidateQueries({ queryKey: riskKeys.detail(riskId) });
    },
  });
};

export const useUpdateMitigationPlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ riskId, planId, description }:
      { riskId: number; planId: number; description: string }) =>
      updateMitigationPlan(riskId, planId, description),
    onSuccess: (_, { riskId }) => {
      queryClient.invalidateQueries({ queryKey: riskKeys.detail(riskId) });
    },
  });
};

export const useMarkRiskDone = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolution }: { id: number; resolution: string }) =>
      markRiskDone(id, resolution),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: riskKeys.all });
    },
  });
};

export const useDeleteMitigationPlan = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ riskId, planId }: { riskId: number; planId: number }) =>
      deleteMitigationPlan(riskId, planId),
    onSuccess: (_, { riskId }) => {
      queryClient.invalidateQueries({ queryKey: riskKeys.detail(riskId) });
    },
  });
};
