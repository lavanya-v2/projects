import { Request, Response } from 'express';
import { ingestRateLimitService } from '../services/ingestRateLimitService';
import { collectorAuthService } from '../services/collectorAuthService';
import { config } from '../../../config';

/**
 * Superuser "Installs" admin view (ADDENDUM 19). Reuses the same UsageIngestToken
 * data the Ingest Rate Limit screen already lists, but scoped to "who installed"
 * (active + revoked) rather than "whose rate limit can I tune" (active only).
 */

/**
 * ADDENDUM 22 follow-up: the "current" collector version to compare installs
 * against must never be a hardcoded string — that silently drifts the moment
 * collector.js's own COLLECTOR_VERSION is bumped without a matching edit
 * elsewhere. It is read straight from the same collector.js the install endpoints
 * serve, and now lives in collectorAuthService so My Claude Report's out-of-date
 * banner reads the same single source rather than growing a second copy.
 */
/**
 * Days since lastSeenAt, and whether that exceeds config.collector.staleAfterDays.
 * `lastSeenAt` is stamped on ANY request reaching us with a valid token — even one
 * later rejected or rate-limited — so this is a read of "has this machine reached
 * us at all lately", not "have we accepted its data lately". A revoked token is
 * never flagged: it is expected to be silent, that is not a signal to chase.
 */
function withStaleness<T extends { lastSeenAt: Date | null; revokedAt: Date | null }>(
    row: T,
): T & { staleDays: number | null; isStale: boolean } {
    if (!row.lastSeenAt) return { ...row, staleDays: null, isStale: false };
    const staleDays = Math.floor((Date.now() - row.lastSeenAt.getTime()) / (24 * 60 * 60 * 1000));
    return { ...row, staleDays, isStale: !row.revokedAt && staleDays >= config.collector.staleAfterDays };
}

export const collectorInstallsController = {
    async list(_req: Request, res: Response) {
        try {
            const [rawInstalls, currentVersion] = await Promise.all([
                ingestRateLimitService.listAllTokensWithUsers(),
                Promise.resolve(collectorAuthService.currentCollectorVersion()),
            ]);
            const installs = rawInstalls.map(withStaleness);
            res.json({ success: true, data: { installs, currentVersion, staleAfterDays: config.collector.staleAfterDays } });
        } catch (error) {
            console.error('Error loading collector installs:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
