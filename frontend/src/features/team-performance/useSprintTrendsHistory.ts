import { useEffect, useState } from 'react';
import { useFetchPerfScorecard } from './hooks';
import { buildSprintTrends } from './perfTrendsBuilders';

interface Args {
  enabled: boolean;
  projectId: number | '';
  syncs: any[];
}

export interface TrendsHistoryState {
  data: any[] | null;
  loading: boolean;
  error: string;
  setError: (e: string) => void;
}

/**
 * Owns the lifecycle of the sprint Trends view: when enabled, fetches every
 * "done" scorecard for the project (in chronological order), then runs them
 * through the pure `buildSprintTrends` reducer to produce developer cards.
 */
export function useSprintTrendsHistory({
  enabled,
  projectId,
  syncs,
}: Args): TrendsHistoryState {
  const fetchScorecardMutation = useFetchPerfScorecard();
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Stable cache key so the effect only fires when the *set* of done syncs changes
  const doneSyncIds = syncs
    .filter((s: any) => s.syncStatus === 'done')
    .map((s: any) => s.id)
    .sort()
    .join(',');

  useEffect(() => {
    if (!enabled || !projectId) return;
    const doneSyncs = syncs
      .filter((s: any) => s.syncStatus === 'done')
      .sort(
        (a: any, b: any) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      )
      .slice(-5); // Last 5 sprints only
    if (doneSyncs.length === 0) {
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    setData(null);
    Promise.all(
      doneSyncs.map((s: any) =>
        fetchScorecardMutation.mutateAsync({
          projectId: projectId as number,
          syncId: s.id,
        }),
      ),
    )
      .then(scorecards => setData(buildSprintTrends(scorecards)))
      .catch((e: any) =>
        setError(e?.response?.data?.error ?? 'Failed to load team history'),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, doneSyncIds]);

  return { data, loading, error, setError };
}
