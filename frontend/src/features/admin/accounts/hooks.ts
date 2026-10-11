import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import { accountKeys } from '../../../shared/queryKeys';
import type { Account } from './types';

// ---- helpers inlined from the old api object ----------------------------

const getAccounts = async (): Promise<Account[]> => {
  const response = await client.get<any>('/accounts');
  return response.data.data;
};

const adminGetAccounts = async (): Promise<any[]> => {
  const res = await client.get<any>('/admin/accounts');
  return res.data.data;
};

const adminCreateAccount = async (data: any): Promise<any> => {
  const res = await client.post<any>('/admin/accounts', data);
  return res.data.data;
};

const adminUpdateAccount = async (id: number, data: any): Promise<any> => {
  const res = await client.put<any>(`/admin/accounts/${id}`, data);
  return res.data.data;
};

const adminDeleteAccount = async (id: number): Promise<void> => {
  await client.delete(`/admin/accounts/${id}`);
};

// ---- hooks ---------------------------------------------------------------

/** Public account list (for the account switcher / report scoping) */
export const useAccountsQuery = () =>
  useQuery({
    queryKey: accountKeys.list(),
    queryFn: () => getAccounts(),
  });

/** Admin-only account list (full data, for the admin page) */
export const useAdminAccounts = () =>
  useQuery({
    queryKey: [...accountKeys.all, 'admin'] as const,
    queryFn: () => adminGetAccounts(),
  });

export const useAdminCreateAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => adminCreateAccount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
    },
  });
};

export const useAdminUpdateAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => adminUpdateAccount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
    },
  });
};

export const useAdminDeleteAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminDeleteAccount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountKeys.all });
    },
  });
};
