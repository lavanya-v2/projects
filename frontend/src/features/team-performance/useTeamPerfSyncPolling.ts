import { useEffect } from 'react';
import { SYNC_POLL_INTERVAL_MS } from './perfConstants';

interface PollableQuery {
  refetch: () => Promise<unknown>;
}

/**
 * While any of the supplied syncs is in `pending` or `running` state,
 * re-fetch the syncs query every `SYNC_POLL_INTERVAL_MS` milliseconds.
 * Stops automatically once nothing is in-flight.
 */
export function useTeamPerfSyncPolling(
  syncs: any[],
  enabled: boolean,
  query: PollableQuery,
) {
  useEffect(() => {
    if (!enabled) return;
    const inFlight = syncs.some(
      (s: any) => s.syncStatus === 'pending' || s.syncStatus === 'running',
    );
    if (!inFlight) return;
    const timer = setTimeout(() => {
      query.refetch().catch(() => {
        /* ignore */
      });
    }, SYNC_POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncs, enabled]);
}
