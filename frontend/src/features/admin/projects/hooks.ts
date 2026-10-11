/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "../../../api/client";
import { projectKeys } from "../../../shared/queryKeys";
import type { ProjectApiResponse } from "../accounts/types";
import { accountTeamMemberKeys } from "../team-members/hooks";

export const accountProjectKeys = {
  all: ["account-projects"] as const,
  list: (accountId?: number, pageNumber?: number, pageLimit?: number) =>
    [
      ...accountProjectKeys.all,
      "list",
      accountId,
      pageNumber,
      pageLimit,
    ] as const,
};

// ---- helpers inlined from the old api object ----------------------------

const adminGetProjects = async (): Promise<any[]> => {
  const res = await client.get<any>("/admin/projects");
  return res.data.data;
};

export const adminGetAccountProjects = async (
  accountId?: number,
  pageNumber?: number,
  pageLimit?: number,
): Promise<ProjectApiResponse> => {
  const res = await client.get<ProjectApiResponse>(
    `/admin/accounts/${accountId}/projects`,
    { params: { pageNumber, pageLimit } },
  );
  return res.data;
};

const adminGetProject = async (id: number): Promise<any> => {
  const res = await client.get<any>(`/admin/projects/${id}`);
  return res.data.data;
};

const adminTestJira = async (data: {
  jiraBaseUrl: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraBoardId: number;
}): Promise<{
  success: boolean;
  boardName?: string;
  boardType?: string;
  message?: string;
}> => {
  const res = await client.post<any>("/admin/test-jira", data);
  return res.data;
};

const adminCreateProject = async (data: any): Promise<any> => {
  const res = await client.post<any>("/admin/projects", data);
  return res.data.data;
};

const adminUpdateProject = async (id: number, data: any): Promise<any> => {
  const res = await client.put<any>(`/admin/projects/${id}`, data);
  return res.data.data;
};

/**
 * Save a column mapping, optionally with the sample file it was built from.
 *
 * Multipart because the sample is retained server-side; the file is omitted when editing an
 * existing mapping, in which case the previous sample and its header list carry forward.
 */
const saveProjectMapping = async (
  id: number,
  data: Record<string, string>,
  file?: File | null,
): Promise<any> => {
  const form = new FormData();

  for (const [key, value] of Object.entries(data)) {
    if (value) {
      form.append(key, value);
    }
  }

  if (file) {
    form.append("file", file);
  }

  const res = await client.post<any>(`/admin/projects/${id}/template`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data.data;
};

export interface MappingDetails {
  /** Field key -> customer column header. */
  mapping: Record<string, string>;
  version?: number | null;
  /** Columns of the sample this mapping was built from; the editor's dropdown options. */
  sourceHeaders: string[];
  file: {
    originalFilename: string;
    fileSize?: number | null;
    available: boolean;
  } | null;
  updatedAt?: string | null;
}

const getProjectMappingDetails = async (
  id: number,
): Promise<MappingDetails | null> => {
  const res = await client.get<any>(`/admin/projects/${id}/template`);

  if (!res.data.data) {
    return null;
  }

  return {
    mapping: res.data.data ?? {},
    version: res.data.meta?.version ?? null,
    sourceHeaders: res.data.meta?.sourceHeaders ?? [],
    file: res.data.meta?.file ?? null,
    updatedAt: res.data.meta?.updatedAt ?? null,
  };
};

/** Read a sample file's headers and get an AI-proposed mapping. Needs no project id. */
const suggestMapping = async (
  file: File,
): Promise<{ headers: string[]; suggestions: Record<string, string> }> => {
  const form = new FormData();
  form.append("file", file);

  const res = await client.post<any>("/datasource/mapping/suggest", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });

  return {
    headers: res.data.headers ?? [],
    suggestions: res.data.suggestions ?? {},
  };
};

const adminDeleteProject = async (id: number): Promise<void> => {
  await client.delete(`/admin/projects/${id}`);
};

const adminGetProjectMembers = async (projectId: number): Promise<any[]> => {
  const res = await client.get<any>(`/admin/projects/${projectId}/members`);
  return res.data.data;
};

const adminAddProjectMember = async (
  projectId: number,
  teamMemberId: number,
  role?: string,
  dailyCapacityHours?: number | null,
): Promise<any> => {
  const res = await client.post<any>(`/admin/projects/${projectId}/members`, {
    teamMemberId,
    role,
    dailyCapacityHours,
  });
  return res.data.data;
};

const adminAddProjectMembers = async (
  accountId: number,
  teamMemberId: number,
  data: { id?: number, projectId: number; role: string }[],
): Promise<any> => {
  const res = await client.post<any>(
    `/admin/account/${accountId}/members/${teamMemberId}/projects`,
    {
      data,
    },
  );
  return res.data.data;
};

const adminUpdateProjectMemberRole = async (
  projectId: number,
  teamMemberId: number,
  role: string,
  dailyCapacityHours?: number | null,
): Promise<void> => {
  await client.put(`/admin/projects/${projectId}/members/${teamMemberId}`, {
    role,
    dailyCapacityHours,
  });
};

const adminRemoveProjectMember = async (
  projectId: number,
  teamMemberId: number,
): Promise<void> => {
  await client.delete(`/admin/projects/${projectId}/members/${teamMemberId}`);
};

// ---- hooks ---------------------------------------------------------------

export const useAdminProjects = () =>
  useQuery({
    queryKey: [...projectKeys.all, "admin"] as const,
    queryFn: () => adminGetProjects(),
  });

export const useAdminAccountProjects = (
  accountId?: number,
  pageNumber?: number,
  pageLimit?: number,
) => {
  const queryResult = useQuery({
    queryKey: [
      ...accountProjectKeys.all,
      "admin",
      accountId,
      pageNumber,
      pageLimit,
    ] as const,
    queryFn: () => adminGetAccountProjects(accountId, pageNumber, pageLimit),
    placeholderData: (keepPreviousData) => keepPreviousData,
  });
  return queryResult;
};

export const useAdminProject = (id: number | null | undefined) =>
  useQuery({
    queryKey: [...projectKeys.all, "admin", id] as const,
    queryFn: () => adminGetProject(id as number),
    enabled: !!id,
  });

export const useProjectMembers = (projectId: number) =>
  useQuery({
    queryKey: projectKeys.members(projectId),
    queryFn: () => adminGetProjectMembers(projectId),
    enabled: !!projectId,
  });

export const useTestJira = () =>
  useMutation({
    mutationFn: (data: {
      jiraBaseUrl: string;
      jiraEmail: string;
      jiraApiToken: string;
      jiraBoardId: number;
    }) => adminTestJira(data),
  });

export const useAdminCreateProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => adminCreateProject(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountProjectKeys.all });
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
};

export const useAdminUpdateProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      adminUpdateProject(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountProjectKeys.all });
    },
  });
};

export const useProjectMapping = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
      file,
    }: {
      id: number;
      data: Record<string, string>;
      file?: File | null;
    }) => saveProjectMapping(id, data, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
};

/** AI-proposed mapping for a freshly picked sample file. Read-only; no project needed. */
export const useSuggestMapping = () =>
  useMutation({
    mutationFn: (file: File) => suggestMapping(file),
  });

export const useProjectMappingDetails = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => getProjectMappingDetails(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.all });
    },
  });
};

export const useAdminDeleteProject = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => adminDeleteProject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountProjectKeys.all });
    },
  });
};

export const useAdminAddProjectMember = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      teamMemberId,
      role,
      dailyCapacityHours,
    }: {
      projectId: number;
      teamMemberId: number;
      role?: string;
      dailyCapacityHours?: number | null;
    }) =>
      adminAddProjectMember(projectId, teamMemberId, role, dailyCapacityHours),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.members(projectId),
      });
    },
  });
};

export const useAdminAddProjectMembers = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      accountId,
      teamMemberId,
      data,
    }: {
      accountId: number;
      teamMemberId: number;
      data: { id?: number, projectId: number; role: string }[];
    }) => adminAddProjectMembers(accountId, teamMemberId, data),
    onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: accountProjectKeys.all,
        });
      queryClient.invalidateQueries({
        queryKey: accountTeamMemberKeys.all,
      });
    },
  });
};

export const useAdminUpdateProjectMemberRole = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      teamMemberId,
      role,
      dailyCapacityHours,
    }: {
      projectId: number;
      teamMemberId: number;
      role: string;
      dailyCapacityHours?: number | null;
    }) =>
      adminUpdateProjectMemberRole(
        projectId,
        teamMemberId,
        role,
        dailyCapacityHours,
      ),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.members(projectId),
      });
    },
  });
};

export const useAdminRemoveProjectMember = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      projectId,
      teamMemberId,
    }: {
      projectId: number;
      teamMemberId: number;
    }) => adminRemoveProjectMember(projectId, teamMemberId),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.members(projectId),
      });
    },
  });
};
