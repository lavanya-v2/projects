import { useQuery } from '@tanstack/react-query';
import { client } from '../../../api/client';
import type { ApiResponse } from '../../../shared/apiTypes';

export interface CollectorInstallRow {
  tokenId: number;
  userId: number;
  login: string;
  name: string;
  lastFour: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  /** Collector version stamped on this user's most recent push — null if they've
   * never pushed, or it predates the version field. */
  collectorVersion: string | null;
  /** Days since lastSeenAt, or null if never synced. lastSeenAt is stamped on ANY
   * request reaching the server with a valid token, even a rejected/rate-limited
   * one — this is "has the machine reached us lately", the server-side safety net
   * for a stuck VPN gate (which would mean nothing reaches us at all) as well as
   * an inactive person. */
  staleDays: number | null;
  /** staleDays >= staleAfterDays, and the token is not revoked (a revoked token is
   * expected to be silent — not something to chase). */
  isStale: boolean;
}

export interface CollectorInstallsResponse {
  installs: CollectorInstallRow[];
  /** The version currently served by /api/collector/collector.js — read straight from
   * that file server-side (ADDENDUM 22 follow-up), never hardcoded on the frontend, so
   * the "outdated" flag can't silently drift from what collector.js actually says. */
  currentVersion: string | null;
  /** The threshold isStale was computed against — shown in the empty-state copy so
   * the number on screen always matches what's actually configured. */
  staleAfterDays: number;
}

const keys = { all: ['collector-installs'] as const };

/** Who has ever installed the Claude usage collector + last sync (ADDENDUM 19). */
export const useCollectorInstalls = () =>
  useQuery({
    queryKey: keys.all,
    queryFn: async (): Promise<CollectorInstallsResponse> => {
      const res = await client.get<ApiResponse<CollectorInstallsResponse>>('/admin/collector-installs');
      return res.data.data;
    },
  });
