import { useEffect, useState } from 'react';
import { useFetchPerfScorecard } from './hooks';

export interface ScorecardState {
  data: any | null;
  loading: boolean;
  error: string;
  setError: (e: string) => void;
  reload: () => Promise<void>;
}

/**
 * Loads the scorecard for `(projectId, syncId)` whenever either changes.
 * Owns the loading and error state so the orchestrator no longer has to.
 */
export function useTeamPerfScorecard(
  projectId: number | '',
  syncId: number | '',
): ScorecardState {
  const fetchScorecardMutation = useFetchPerfScorecard();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId || !syncId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    fetchScorecardMutation
      .mutateAsync({ projectId: projectId as number, syncId: syncId as number })
      .then(setData)
      .catch((e: any) =>
        setError(e?.response?.data?.error ?? 'Failed to load scorecard'),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncId, projectId]);

  const reload = async () => {
    if (!projectId || !syncId) return;
    const fresh = await fetchScorecardMutation.mutateAsync({
      projectId: projectId as number,
      syncId: syncId as number,
    });
    setData(fresh);
  };

  return { data, loading, error, setError, reload };
}
