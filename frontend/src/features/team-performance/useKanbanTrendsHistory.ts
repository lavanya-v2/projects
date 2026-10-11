import { useEffect, useState } from 'react';
import { useFetchPerfScorecard } from './hooks';
import { buildKanbanTrends } from './perfTrendsBuilders';

interface Args {
  enabled: boolean;
  projectId: number | '';
  syncs: any[];
  selectedSyncId: number | '';
}

export interface TrendsHistoryState {
  data: { developers: any[]; qa: any[] } | null;
  loading: boolean;
  error: string;
  setError: (e: string) => void;
}

const LIMIT = 5;

/**
 * Owns the lifecycle of the kanban Trends view: when enabled, fetches the last
 * 5 "done" kanban scorecards (ending at the selected span, or the most recent
 * ones when nothing is selected — e.g. live mode), oldest first, then
 * transforms them via `buildKanbanTrends` into developer + QA cards.
 */
export function useKanbanTrendsHistory({
  enabled,
  projectId,
  syncs,
  selectedSyncId,
}: Args): TrendsHistoryState {
  const fetchScorecardMutation = useFetchPerfScorecard();
  const [data, setData] = useState<{ developers: any[]; qa: any[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const doneSyncIds = syncs
    .filter((s: any) => s.syncStatus === 'done')
    .map((s: any) => s.id)
    .sort()
    .join(',');

  useEffect(() => {
    if (!enabled || !projectId) return;
    // Anchor at the selected span if one is chosen; otherwise the most recent.
    const selectedSync = selectedSyncId !== '' ? syncs.find((s: any) => s.id === selectedSyncId) : null;
    const anchorTime = selectedSync ? new Date(selectedSync.startDate).getTime() : Infinity;
    // Not filtered to syncType='kanban' -- a project that switched Scrum ->
    // Kanban mid-history keeps its Scrum-era periods here too, blended by
    // recency, mirroring useSprintTrendsHistory's (already correct) behavior.
    const periodsToShow = syncs
      .filter(
        (s: any) =>
          s.syncStatus === 'done' &&
          new Date(s.startDate).getTime() <= anchorTime,
      )
      .sort(
        (a: any, b: any) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      )
      .slice(-LIMIT); // last 5, oldest-first
    if (periodsToShow.length === 0) {
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    setData(null);
    Promise.all(
      periodsToShow.map((s: any) =>
        fetchScorecardMutation.mutateAsync({
          projectId: projectId as number,
          syncId: s.id,
        }),
      ),
    )
      .then(scorecards => setData(buildKanbanTrends(scorecards)))
      .catch((e: any) =>
        setError(e?.response?.data?.error ?? 'Failed to load trends'),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, selectedSyncId, doneSyncIds]);

  return { data, loading, error, setError };
}
