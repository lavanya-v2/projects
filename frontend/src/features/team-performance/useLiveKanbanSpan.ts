import { useEffect, useState } from 'react';
import { useFetchLiveKanbanSpan } from './hooks';

export interface LiveKanbanSpanState {
  data: any | null;
  loading: boolean;
  error: string;
  setError: (e: string) => void;
  reload: () => Promise<void>;
}

/**
 * Loads the LIVE (always-fresh) scorecard for the in-progress Kanban cycle.
 * Only fetches when `enabled` (the "Current span" view is active) to avoid a
 * live Jira call on every project load. Payload is shape-compatible with the
 * persisted scorecard, so the same render block consumes it.
 */
export function useLiveKanbanSpan(
  projectId: number | '',
  enabled: boolean,
): LiveKanbanSpanState {
  const fetchLive = useFetchLiveKanbanSpan();
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !projectId) {
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    fetchLive
      .mutateAsync({ projectId: projectId as number })
      .then(setData)
      .catch((e: any) =>
        setError(e?.response?.data?.error ?? 'Failed to load current span'),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, enabled]);

  const reload = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const fresh = await fetchLive.mutateAsync({ projectId: projectId as number });
      setData(fresh);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Failed to load current span');
    } finally {
      setLoading(false);
    }
  };

  return { data, loading, error, setError, reload };
}
