/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "../../api/client";
import {
  actionItemKeys,
  accountActionItemKeys,
  programActionItemKeys,
} from "../../shared/queryKeys";
import type { ActionItemFilters, SortConfig } from "./types";
import { useState, useCallback } from "react";

// ---- helpers inlined from the old api object ----------------------------

const listActionItems = async (
  projectId: number,
  statusFilter?: string,
): Promise<any[]> => {
  const params = statusFilter ? `?status=${statusFilter}` : "";
  const response = await client.get<any>(
    `/report/project/${projectId}/action-items${params}`,
  );
  return response.data;
};

const createActionItem = async (projectId: number, data: any): Promise<any> => {
  const response = await client.post<any>(
    `/report/project/${projectId}/action-items`,
    data,
  );
  return response.data;
};

const getActionItem = async (id: number): Promise<any> => {
  const response = await client.get<any>(`/report/action-item/${id}`);
  return response.data;
};

const updateActionItem = async (id: number, data: any): Promise<any> => {
  const response = await client.put<any>(`/report/action-item/${id}`, data);
  return response.data;
};

const transitionActionItemStatus = async (
  id: number,
  toStatus: string,
  note?: string,
): Promise<any> => {
  const response = await client.post<any>(
    `/report/action-item/${id}/transition`,
    { toStatus, note },
  );
  return response.data;
};

const deleteActionItem = async (id: number): Promise<void> => {
  await client.delete(`/report/action-item/${id}`);
};

const addActionItemComment = async (
  itemId: number,
  content: string,
): Promise<any> => {
  const res = await client.post<any>(`/report/action-item/${itemId}/comments`, {
    content,
  });
  return res.data;
};

const deleteActionItemComment = async (commentId: number): Promise<void> => {
  await client.delete(`/report/action-item/comment/${commentId}`);
};

const updateActionItemComment = async (
  commentId: number,
  content: string,
): Promise<any> => {
  const res = await client.put<any>(
    `/report/action-item/comment/${commentId}`,
    { content },
  );
  return res.data;
};

const listAccountActionItems = async (
  accountId: number,
  statusFilter?: string,
): Promise<any[]> => {
  const params =
    statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
  const res = await client.get<any>(
    `/report/account/${accountId}/action-items${params}`,
  );
  return res.data;
};

const createAccountActionItem = async (
  accountId: number,
  data: any,
): Promise<any> => {
  const res = await client.post<any>(
    `/report/account/${accountId}/action-items`,
    data,
  );
  return res.data;
};

const getAccountActionItem = async (id: number): Promise<any> => {
  const res = await client.get<any>(`/report/account-action-item/${id}`);
  return res.data;
};

const updateAccountActionItem = async (id: number, data: any): Promise<any> => {
  const res = await client.put<any>(`/report/account-action-item/${id}`, data);
  return res.data;
};

const transitionAccountActionItemStatus = async (
  id: number,
  toStatus: string,
  note?: string,
): Promise<any> => {
  const res = await client.post<any>(
    `/report/account-action-item/${id}/transition`,
    { toStatus, note },
  );
  return res.data;
};

const deleteAccountActionItem = async (id: number): Promise<void> => {
  await client.delete(`/report/account-action-item/${id}`);
};

const addAccountActionItemComment = async (
  itemId: number,
  content: string,
): Promise<any> => {
  const res = await client.post<any>(
    `/report/account-action-item/${itemId}/comments`,
    { content },
  );
  return res.data;
};

const deleteAccountActionItemComment = async (
  commentId: number,
): Promise<void> => {
  await client.delete(`/report/account-action-item/comment/${commentId}`);
};

const updateAccountActionItemComment = async (
  commentId: number,
  content: string,
): Promise<any> => {
  const res = await client.put<any>(
    `/report/account-action-item/comment/${commentId}`,
    { content },
  );
  return res.data;
};

const listProgramActionItems = async (
  programId: number,
  statusFilter?: string,
): Promise<any[]> => {
  const params =
    statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
  const res = await client.get<any>(
    `/report/program/${programId}/action-items${params}`,
  );
  return res.data;
};

const createProgramActionItem = async (
  programId: number,
  data: any,
): Promise<any> => {
  const res = await client.post<any>(
    `/report/program/${programId}/action-items`,
    data,
  );
  return res.data;
};

const getProgramActionItem = async (id: number): Promise<any> => {
  const res = await client.get<any>(`/report/program-action-item/${id}`);
  return res.data;
};

const updateProgramActionItem = async (id: number, data: any): Promise<any> => {
  const res = await client.put<any>(`/report/program-action-item/${id}`, data);
  return res.data;
};

const transitionProgramActionItemStatus = async (
  id: number,
  toStatus: string,
  note?: string,
): Promise<any> => {
  const res = await client.post<any>(
    `/report/program-action-item/${id}/transition`,
    { toStatus, note },
  );
  return res.data;
};

const deleteProgramActionItem = async (id: number): Promise<void> => {
  await client.delete(`/report/program-action-item/${id}`);
};

const addProgramActionItemComment = async (
  itemId: number,
  content: string,
): Promise<any> => {
  const res = await client.post<any>(
    `/report/program-action-item/${itemId}/comments`,
    { content },
  );
  return res.data;
};

const deleteProgramActionItemComment = async (
  commentId: number,
): Promise<void> => {
  await client.delete(`/report/program-action-item/comment/${commentId}`);
};

const updateProgramActionItemComment = async (
  commentId: number,
  content: string,
): Promise<any> => {
  const res = await client.put<any>(
    `/report/program-action-item/comment/${commentId}`,
    { content },
  );
  return res.data;
};

// ── Project-scoped action items ──────────────────────────────────────────────

export const useActionItems = (projectId: number, statusFilter?: string) =>
  useQuery({
    queryKey: actionItemKeys.list(projectId, statusFilter),
    queryFn: () => listActionItems(projectId, statusFilter),
    enabled: !!projectId,
  });

/**
 * Single-request aggregate: returns every project action item the user can
 * access, resolved server-side. Replaces the old per-project fan-out that
 * flooded the browser connection pool. `enabled` gates it to the active tab.
 */
const listMyProjectActionItems = async (
  accountId: number,
  statusFilter?: string[],
  projectId?: number | string,
  searchFilter?: string,
  sortConfig?: SortConfig,
  categoryFilter?: string[],
  pageNumber?: number,
  pageLimit?: number,
): Promise<any[]> => {
  const res = await client.get<any>(`/report/my/project-action-items`, {
    params: {
      accountId,
      statusFilter,
      projectId,
      searchFilter,
      sortBy: sortConfig?.column,
      sortOrder: sortConfig?.direction,
      categoryFilter,
      pageLimit,
      pageNumber,
    },
    paramsSerializer: (params) => {
      const searchParams = new URLSearchParams();

      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === "") return;

        if (Array.isArray(value)) {
          value.forEach((val) => {
            if (val && val.trim() !== "") {
              searchParams.append(key, val);
            }
          });
        } else {
          searchParams.append(key, String(value));
        }
      });
      return searchParams.toString();
    },
  });
  return res.data;
};

export const useMyProjectActionItems = (
  accountId: number,
  enabled: boolean,
  statusFilter?: string[],
  projectId?: number | string,
  searchFilter?: string,
  sortConfig?: SortConfig,
  categoryFilter?: string[],
  pageNumber?: number,
  pageLimit?: number,
) =>
  useQuery({
    queryKey: [
      ...actionItemKeys.all,
      "mine",
      {
        accountId,
        statusFilter: statusFilter ?? null,
        projectId,
        searchFilter,
        sortConfig,
        categoryFilter,
        pageNumber,
        pageLimit,
      },
    ] as const,
    queryFn: () =>
      listMyProjectActionItems(
        accountId,
        statusFilter,
        projectId,
        searchFilter,
        sortConfig,
        categoryFilter,
        pageNumber,
        pageLimit,
      ),
    enabled,
  });

export const useActionItem = (id: number | null | undefined) =>
  useQuery({
    queryKey: actionItemKeys.detail(id ?? 0),
    queryFn: () => getActionItem(id as number),
    enabled: !!id,
  });

export const useCreateActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: number; data: any }) =>
      createActionItem(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actionItemKeys.all });
    },
  });
};

export const useUpdateActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      updateActionItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actionItemKeys.all });
    },
  });
};

export const useTransitionActionItemStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      toStatus,
      note,
    }: {
      id: number;
      toStatus: string;
      note?: string;
    }) => transitionActionItemStatus(id, toStatus, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actionItemKeys.all });
    },
  });
};

export const useDeleteActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteActionItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actionItemKeys.all });
    },
  });
};

export const useAddActionItemComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, content }: { itemId: number; content: string }) =>
      addActionItemComment(itemId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actionItemKeys.all });
    },
  });
};

export const useDeleteActionItemComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: number) => deleteActionItemComment(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actionItemKeys.all });
    },
  });
};

export const useUpdateActionItemComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      commentId,
      content,
    }: {
      commentId: number;
      content: string;
    }) => updateActionItemComment(commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: actionItemKeys.all });
    },
  });
};

// ── Account-scoped action items ──────────────────────────────────────────────

export const useAccountActionItems = (
  accountId: number,
  statusFilter?: string,
) =>
  useQuery({
    queryKey: accountActionItemKeys.list(accountId, statusFilter),
    queryFn: () => listAccountActionItems(accountId, statusFilter),
    enabled: !!accountId,
  });

/**
 * Single-request aggregate: every account action item the user can access,
 * resolved server-side. Replaces the old per-account fan-out.
 */
const listMyAccountActionItems = async (
  accountId: number,
  statusFilter?: string[],
  sortConfig?: SortConfig,
  searchFilter?: string,
  categoryFilter?: string[],
  pageNumber?: number,
  pageLimit?: number,
): Promise<any[]> => {
  const res = await client.get<any>(`/report/my/account-action-items`, {
    params: {
      accountId,
      statusFilter,
      sortBy: sortConfig?.column,
      sortOrder: sortConfig?.direction,
      searchFilter,
      categoryFilter,
      pageNumber,
      pageLimit,
    },
    paramsSerializer: (params) => {
      const searchParams = new URLSearchParams();

      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === "") return;

        if (Array.isArray(value)) {
          value.forEach((val) => {
            if (val && val.trim() !== "") {
              searchParams.append(key, val);
            }
          });
        } else {
          searchParams.append(key, String(value));
        }
      });
      return searchParams.toString();
    },
  });
  return res.data;
};

export const useMyAccountActionItems = (
  accountId: number,
  enabled: boolean,
  statusFilter?: string[],
  sortConfig?: SortConfig,
  searchFilter?: string,
  categoryFilter?: string[],
  pageNumber?: number,
  pageLimit?: number,
) =>
  useQuery({
    queryKey: [
      ...accountActionItemKeys.all,
      "mine",
      {
        accountId,
        statusFilter: statusFilter ?? null,
        sortConfig,
        searchFilter,
        categoryFilter,
        pageNumber,
        pageLimit,
      },
    ] as const,
    queryFn: () =>
      listMyAccountActionItems(
        accountId,
        statusFilter,
        sortConfig,
        searchFilter,
        categoryFilter,
        pageNumber,
        pageLimit,
      ),
    enabled,
  });

export const useAccountActionItem = (id: number | null | undefined) =>
  useQuery({
    queryKey: accountActionItemKeys.detail(id ?? 0),
    queryFn: () => getAccountActionItem(id as number),
    enabled: !!id,
  });

export const useCreateAccountActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, data }: { accountId: number; data: any }) =>
      createAccountActionItem(accountId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountActionItemKeys.all });
    },
  });
};

export const useUpdateAccountActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      updateAccountActionItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountActionItemKeys.all });
    },
  });
};

export const useTransitionAccountActionItemStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      toStatus,
      note,
    }: {
      id: number;
      toStatus: string;
      note?: string;
    }) => transitionAccountActionItemStatus(id, toStatus, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountActionItemKeys.all });
    },
  });
};

export const useDeleteAccountActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteAccountActionItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountActionItemKeys.all });
    },
  });
};

export const useAddAccountActionItemComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, content }: { itemId: number; content: string }) =>
      addAccountActionItemComment(itemId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountActionItemKeys.all });
    },
  });
};

export const useDeleteAccountActionItemComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: number) =>
      deleteAccountActionItemComment(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountActionItemKeys.all });
    },
  });
};

export const useUpdateAccountActionItemComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      commentId,
      content,
    }: {
      commentId: number;
      content: string;
    }) => updateAccountActionItemComment(commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountActionItemKeys.all });
    },
  });
};

// ── Program-scoped action items ──────────────────────────────────────────────

export const useProgramActionItems = (
  programId: number,
  statusFilter?: string,
) =>
  useQuery({
    queryKey: programActionItemKeys.list(programId, statusFilter),
    queryFn: () => listProgramActionItems(programId, statusFilter),
    enabled: !!programId,
  });

/**
 * Single-request aggregate: every program action item the user can access,
 * resolved server-side. Replaces the old per-program fan-out.
 */
const listMyProgramActionItems = async (
  accountId: number,
  statusFilter?: string[],
  searchFilter?: string,
  sortConfig?: SortConfig,
  programId?: number | string,
  categoryFilter?: string[],
  pageNumber?: number,
  pageLimit?: number,
): Promise<any[]> => {
  const res = await client.get<any>(`/report/my/program-action-items`, {
    params: {
      accountId,
      statusFilter,
      searchFilter,
      sortBy: sortConfig?.column,
      sortOrder: sortConfig?.direction,
      programId,
      categoryFilter,
      pageNumber,
      pageLimit,
    },
    paramsSerializer: (params) => {
      const searchParams = new URLSearchParams();

      Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === "") return;

        if (Array.isArray(value)) {
          value.forEach((val) => {
            if (val && val.trim() !== "") {
              searchParams.append(key, val);
            }
          });
        } else {
          searchParams.append(key, String(value));
        }
      });
      return searchParams.toString();
    },
  });
  return res.data;
};

export const useMyProgramActionItems = (
  accountId: number,
  enabled: boolean,
  statusFilter?: string[],
  searchFilter?: string,
  sortConfig?: SortConfig,
  programId?: number | string,
  categoryFilter?: string[],
  pageNumber?: number,
  pageLimit?: number,
) =>
  useQuery({
    queryKey: [
      ...programActionItemKeys.all,
      "mine",
      {
        accountId,
        statusFilter: statusFilter ?? null,
        searchFilter,
        sortConfig,
        programId,
        categoryFilter,
        pageNumber,
        pageLimit,
      },
    ] as const,
    queryFn: () =>
      listMyProgramActionItems(
        accountId,
        statusFilter,
        searchFilter,
        sortConfig,
        programId,
        categoryFilter,
        pageNumber,
        pageLimit,
      ),
    enabled,
  });

export const useProgramActionItem = (id: number | null | undefined) =>
  useQuery({
    queryKey: programActionItemKeys.detail(id ?? 0),
    queryFn: () => getProgramActionItem(id as number),
    enabled: !!id,
  });

export const useCreateProgramActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ programId, data }: { programId: number; data: any }) =>
      createProgramActionItem(programId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: programActionItemKeys.all });
    },
  });
};

export const useUpdateProgramActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      updateProgramActionItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: programActionItemKeys.all });
    },
  });
};

export const useTransitionProgramActionItemStatus = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      toStatus,
      note,
    }: {
      id: number;
      toStatus: string;
      note?: string;
    }) => transitionProgramActionItemStatus(id, toStatus, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: programActionItemKeys.all });
    },
  });
};

export const useDeleteProgramActionItem = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteProgramActionItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: programActionItemKeys.all });
    },
  });
};

export const useAddProgramActionItemComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, content }: { itemId: number; content: string }) =>
      addProgramActionItemComment(itemId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: programActionItemKeys.all });
    },
  });
};

export const useDeleteProgramActionItemComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: number) =>
      deleteProgramActionItemComment(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: programActionItemKeys.all });
    },
  });
};

export const useUpdateProgramActionItemComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      commentId,
      content,
    }: {
      commentId: number;
      content: string;
    }) => updateProgramActionItemComment(commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: programActionItemKeys.all });
    },
  });
};

const initialFilters: ActionItemFilters = {
  search: "",
  status: "",
  category: "",
  owner: "",
};

export const useActionItemFilters = () => {
  const [filters, setFilters] = useState<ActionItemFilters>(initialFilters);

  const updateFilter = useCallback(
    <K extends keyof ActionItemFilters>(
      key: K,
      value: ActionItemFilters[K],
    ) => {
      setFilters((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    [],
  );

  const resetFilters = useCallback(() => {
    setFilters(initialFilters);
  }, []);

  const hasActiveFilters = Object.values(filters).some(Boolean);

  return {
    filters,
    updateFilter,
    resetFilters,
    hasActiveFilters,
  };
};
