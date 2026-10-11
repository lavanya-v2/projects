import { useQuery } from '@tanstack/react-query';
import { client } from '../../../api/client';
import type { ApiResponse } from '../../../shared/apiTypes';

export interface AuditLogRow {
  id: number;
  userId: number | null;
  login: string | null;
  name: string | null;
  tokenId: number | null;
  day: string | null;
  userAgent: string | null;
  collectorVersion: string | null;
  orgUuid: string | null;
  outcome: string;
  httpStatus: number;
  payload: Record<string, unknown> | null;
  /** VPN gate Stage 2 — 'enforced' (confirmed clear), 'disabled', or
   * 'allowed-after-failed-check' (unverified — sent without confirming a VPN
   * wasn't up). Null on rows rejected before the payload validated, or from a
   * collector that predates the gate. */
  vpnGate: string | null;
  receivedAt: string;
}

const keys = {
  list: (includeRateLimited: boolean) => ['claude-ingest-audit-log', { includeRateLimited }] as const,
};

/** `includeRateLimited` defaults to false — 429s are mostly IDE-restart/session-hook
 * noise, not something worth an admin's attention by default (ADDENDUM 17 item 5). */
export const useIngestAuditLog = (includeRateLimited = false) =>
  useQuery({
    queryKey: keys.list(includeRateLimited),
    queryFn: async (): Promise<AuditLogRow[]> => {
      const res = await client.get<ApiResponse<AuditLogRow[]>>('/admin/claude-ingest-audit', {
        params: { includeRateLimited: includeRateLimited ? 'true' : undefined },
      });
      return res.data.data;
    },
  });
