/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '../../../api/client';
import { userKeys } from '../../../shared/queryKeys';
import type { ApiResponse } from '../../../shared/apiTypes';
import type { User, Role, UsersApiResponse} from './types';
import type { SortConfig } from './UserManagement';

// ---- helpers inlined from the old api object ----------------------------

const getUsers = async (
  searchValue?: string,
  accountName?: string,
  projectName?: string[],
  roleName?: string[],
  statusFilter?: string,
  pageNumber?: number,
  pageLimit?: number,
  sortConfig?: SortConfig
): Promise<UsersApiResponse> => {

  const response = await client.get<UsersApiResponse>('/users', {
    params: {
      searchValue,
      accountName,
      projectName,
      roleName,
      statusFilter,
      pageNumber,
      pageLimit,
      sortBy: sortConfig?.column,
      sortOrder: sortConfig?.direction
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
  })
  return response.data;
};

const createUser = async (userData: Partial<User>): Promise<any> => {
  const response = await client.post<ApiResponse<User>>('/users', userData);
  return response.data;
};

const getUser = async (id: number): Promise<User> => {
  const response = await client.get<ApiResponse<User>>(`/users/${id}`);
  return response.data.data;
};

const updateUser = async (id: number, userData: Partial<User>): Promise<any> => {
  const response = await client.put<ApiResponse<User>>(`/users/${id}`, userData);
  return response.data;
};

const getRoles = async (): Promise<Role[]> => {
  const response = await client.get<ApiResponse<Role[]>>('/users/roles');
  return response.data.data;
};

const deactivateUser = async (id: number): Promise<any> => {
  const response = await client.delete<ApiResponse<User>>(`/users/${id}`);
  return response.data;
};

const adminGetAllUsers = async (): Promise<User[]> => {
  const res = await client.get<ApiResponse<User[]>>('/admin/users');
  return res.data.data;
};

// ---- hooks ---------------------------------------------------------------


export const useUsers = (searchValue?: string, accountName?: string, projectName?: string[], roleName?: string[], statusFilter?:string, pageNumber?:number, pageLimit?:number, sortConfig?: SortConfig) =>
  useQuery({
    queryKey: [...userKeys.list(), searchValue, accountName, projectName, roleName, statusFilter, pageNumber, pageLimit, sortConfig],
    queryFn: () => getUsers(searchValue, accountName, projectName, roleName,statusFilter, pageNumber, pageLimit, sortConfig),
  });

export const useRoles = () =>
  useQuery({
    queryKey: userKeys.roles(),
    queryFn: () => getRoles(),
  });

export const useCreateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<User>) => createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
};

export const useGetUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) => getUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<User> }) => updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
};

export const useDeactivateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deactivateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
};

export const useActivateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<User> }) => updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
};

// Flat, unpaginated user list — used by pickers that need every user at once
// (e.g. Performance Review's reviewer-assignment fallback), distinct from the
// paginated/filtered `useUsers` behind the User Management grid.
export const useAdminAllUsers = () =>
  useQuery({
    queryKey: [...userKeys.all, 'admin'] as const,
    queryFn: () => adminGetAllUsers(),
  });
