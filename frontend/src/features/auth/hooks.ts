import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '../../api/client';
import { projectKeys } from '../../shared/queryKeys';
import type { ApiResponse } from '../../shared/apiTypes';
import type { Project } from './types';

export { useAuth } from './AuthContext';

// ---- helpers inlined from the old api object ----------------------------

const getProjects = async (accountId?: number, includeInactive?: boolean): Promise<Project[]> => {
  const params = new URLSearchParams();
  if (accountId) params.set('accountId', String(accountId));
  if (includeInactive) params.set('includeInactive', 'true');
  const qs = params.toString();
  const response = await client.get<ApiResponse<Project[]>>(`/projects${qs ? `?${qs}` : ''}`);
  return response.data.data || [];
};

// ---- hooks ---------------------------------------------------------------

/**
 * Project list, optionally scoped to an account. Defaults to ACTIVE projects
 * only -- correct for "pick something to work with" pickers (Board View,
 * Presentation, new Risk/Retro). Pass includeInactive=true for a caller
 * managing/editing an EXISTING association (permissions grid, nav/feature
 * visibility checks, Risk reassignment), or it'll silently lose sight of --
 * and for the permissions grid, silently drop -- an already-granted inactive
 * project.
 */
export const useProjects = (accountId?: number, includeInactive?: boolean) =>
  useQuery({
    queryKey: projectKeys.list(accountId, includeInactive),
    queryFn: () => getProjects(accountId, includeInactive),
  });

/**
 * Imperative project fetch using the shared query cache.
 * Memoized so the returned function keeps a stable identity across renders —
 * callers use it as a useEffect dependency, and an unstable reference would
 * re-fire those effects every render (infinite loop / frozen UI).
 */
export const useFetchProjects = () => {
  const queryClient = useQueryClient();
  return useCallback(
    (accountId?: number, includeInactive?: boolean) =>
      queryClient.fetchQuery({
        queryKey: projectKeys.list(accountId, includeInactive),
        queryFn: () => getProjects(accountId, includeInactive),
      }),
    [queryClient],
  );
};
