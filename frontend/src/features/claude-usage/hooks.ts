import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '../../api/client';
import { claudeUsageKeys } from '../../shared/queryKeys';
import type { ApiResponse } from '../../shared/apiTypes';
import type { ConsentStatus, MemberDetailReport, PromptReport, TeamReport, TokenStatus } from './types';

// ---- pilot access gate ----
const getAccess = async (): Promise<{ enabled: boolean }> => {
  const res = await client.get<ApiResponse<{ enabled: boolean }>>('/member/claude-usage-access');
  return res.data.data;
};

/** Whether the current user may see the Claude Usage feature (pilot allowlist). */
export const useClaudeUsageAccess = () =>
  useQuery({
    queryKey: claudeUsageKeys.access(),
    queryFn: getAccess,
    staleTime: 5 * 60 * 1000,
  });

// ---- reads ----
const getMyReport = async (from: string, to: string): Promise<PromptReport> => {
  const res = await client.get<ApiResponse<PromptReport>>('/member/prompt-report', {
    params: { from, to },
  });
  return res.data.data;
};

/** `enabled` lets callers (e.g. the dashboard indicator) defer the request until the
 * pilot-access check has resolved true — avoids a guaranteed 403 for a non-enrolled
 * viewer, since `/member/prompt-report` stays pilot-gated. */
export const useMyPromptReport = (from: string, to: string, enabled = true) =>
  useQuery({
    queryKey: claudeUsageKeys.myReport(from, to),
    queryFn: () => getMyReport(from, to),
    enabled,
  });

const getTeamReport = async (
  from: string,
  to: string,
  search: string,
  page: number,
  pageSize: number,
): Promise<TeamReport> => {
  const res = await client.get<ApiResponse<TeamReport>>('/member/team-prompt-report', {
    params: { from, to, search: search || undefined, page, pageSize },
  });
  return res.data.data;
};

/** Members table is server-paged + server-searched (ADDENDUM 24) — `page`/`pageSize`
 * and `search` are part of the query key so paging or typing a search term fetches
 * that exact page from the server rather than slicing an already-fetched roster. */
export const useTeamPromptReport = (from: string, to: string, search: string, page: number, pageSize: number) =>
  useQuery({
    queryKey: claudeUsageKeys.teamReport(from, to, search, page, pageSize),
    queryFn: () => getTeamReport(from, to, search, page, pageSize),
    placeholderData: (prev) => prev, // keep the old page visible while the next one loads
  });

const getMemberDetail = async (userId: number, from: string, to: string): Promise<MemberDetailReport> => {
  const res = await client.get<ApiResponse<MemberDetailReport>>(`/member/team-prompt-report/${userId}`, {
    params: { from, to },
  });
  return res.data.data;
};

/** A lead's click-through to one team member's detail (ADDENDUM 24). Access is
 * enforced server-side (resolveVisibleUserIds) — a userId outside the caller's
 * team surfaces as a normal query error, not a silent empty page. */
export const useMemberDetailReport = (userId: number, from: string, to: string) =>
  useQuery({
    queryKey: claudeUsageKeys.memberDetail(userId, from, to),
    queryFn: () => getMemberDetail(userId, from, to),
    enabled: Number.isFinite(userId),
  });

const getToken = async (): Promise<TokenStatus> => {
  const res = await client.get<ApiResponse<TokenStatus>>('/member/collector-token');
  return res.data.data;
};
export const useCollectorToken = () =>
  useQuery({ queryKey: claudeUsageKeys.token(), queryFn: getToken });

const getConsent = async (): Promise<ConsentStatus> => {
  const res = await client.get<ApiResponse<ConsentStatus>>('/member/collector-consent');
  return res.data.data;
};
export const useConsentStatus = () =>
  useQuery({ queryKey: claudeUsageKeys.consent(), queryFn: getConsent });

// ---- mutations ----
export const useGenerateToken = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ token: string; lastFour: string }> => {
      const res = await client.post<ApiResponse<{ token: string; lastFour: string }>>(
        '/member/collector-token',
      );
      return res.data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: claudeUsageKeys.all }),
  });
};

export const useRecordConsent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (consentText: string) => {
      await client.post('/member/collector-consent', { consentText });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: claudeUsageKeys.all }),
  });
};

export const useDisableCollector = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await client.post('/member/collector/disable');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: claudeUsageKeys.all }),
  });
};

export const usePurgeData = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await client.post('/member/collector/purge');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: claudeUsageKeys.all }),
  });
};

export interface RefreshCoachingResult {
  success: boolean;
  skipped?: boolean;
  message?: string;
  nextAvailableAt?: string | null;
}

export const useRefreshCoaching = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<RefreshCoachingResult> => {
      const res = await client.post<RefreshCoachingResult>('/member/collector/refresh-coaching');
      return res.data;
    },
    onSuccess: (result) => {
      // A skip means nothing changed server-side (still the same cached tips) —
      // no point refetching. A real enqueue regenerates async via the coaching
      // worker, so the report will pick up new tips on its own next natural fetch.
      if (!result.skipped) qc.invalidateQueries({ queryKey: claudeUsageKeys.all });
    },
  });
};

/** Download the collector package (.zip) with the JWT attached, then save it. */
export async function downloadCollectorZip(): Promise<void> {
  const res = await client.get('/member/collector-download', { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'claude-usage-collector.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
