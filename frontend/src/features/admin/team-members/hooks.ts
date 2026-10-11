/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import type { MembersApiResponse } from '../accounts/types';

export const accountTeamMemberKeys = {
  all: ['admin-account-team-members'] as const,
  list: (searchValue?: string, accountId?: number, pageNumber?: number, pageLimit?: number) => 
    [...accountTeamMemberKeys.all, 'list', searchValue, accountId, pageNumber, pageLimit] as const,
};

export const teamMemberKeys = {
  all: ['admin-team-members'] as const,
  list: () => [...teamMemberKeys.all, 'list'] as const,
};

// ---- helpers inlined from the old api object ----------------------------

const adminGetTeamMembers = async (): Promise<any[]> => {
  const res = await client.get<any>('/admin/team-members');
  return res.data.data;
};

export const adminGetAccountTeamMembers = async (searchValue?:string, accountId?: number, pageNumber?: number, pageLimit?: number): Promise<MembersApiResponse> => {
  const res = await client.get<MembersApiResponse>(`/admin/accounts/${accountId}/team-members`, { params: {searchValue, pageNumber, pageLimit}});
  return res.data;
};

const adminCreateTeamMember = async (data: any): Promise<any> => {
  const res = await client.post<any>('/admin/team-members', data);
  return res.data.data;
};

const adminUpdateTeamMember = async (id: number, data: any): Promise<any> => {
  const res = await client.put<any>(`/admin/team-members/${id}`, data);
  return res.data.data;
};

const adminDeleteTeamMember = async (id: number): Promise<void> => {
  await client.delete(`/admin/team-members/${id}`);
};

// ---- hooks ---------------------------------------------------------------

export const useAdminTeamMembers = () =>
  useQuery({
    queryKey: teamMemberKeys.list(),
    queryFn: () => adminGetTeamMembers(),
  });

export const useAdminAccountTeamMembers = (searchValue?: string, accountId?: number, pageNumber?: number, pageLimit?: number) => {
  const queryResult = useQuery({
    queryKey: accountTeamMemberKeys.list(searchValue, accountId, pageNumber, pageLimit),
    queryFn: () => adminGetAccountTeamMembers(searchValue, accountId, pageNumber, pageLimit),
    placeholderData: (keepPreviousData) => keepPreviousData,
  });
  return queryResult;
};

export const useAdminCreateTeamMember = () => {
  return useMutation({
    mutationFn: (data: any) => adminCreateTeamMember(data),
  });
};

export const useAdminUpdateTeamMember = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => adminUpdateTeamMember(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountTeamMemberKeys.all });
    },
  });
};

export const useAdminDeleteTeamMember = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminDeleteTeamMember(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountTeamMemberKeys.all });
    },
  });
};
