/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response, NextFunction } from 'express';
import { collectorAuthService } from '../modules/usageCollector/services/collectorAuthService';
import { ingestAuditLogService } from '../modules/usageCollector/services/ingestAuditLogService';

interface IngestRequest extends Request {
    ingestUserId?: number;
    ingestTokenId?: number;
}

/**
 * Machine-to-server auth for the Claude usage collector. Not JWT: the collector
 * runs headless with a per-user ingest token sent as `Authorization: Bearer <token>`.
 * We resolve it to a user, then gate on active consent (the privacy/ethics gate).
 *
 *   - missing/invalid/revoked token  -> 401  (collector stops + tells user to uninstall)
 *   - no active consent for version  -> 403  (nothing is stored)
 */
export const authenticateIngestToken = async (
    req: IngestRequest,
    res: Response,
    next: NextFunction,
) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            void ingestAuditLogService.record(req, { userId: null, tokenId: null, outcome: 'rejected-auth', httpStatus: 401 });
            return res.status(401).json({ error: 'No ingest token provided' });
        }
        const token = authHeader.slice('Bearer '.length).trim();
        const row = await collectorAuthService.resolveToken(token);
        if (!row) {
            void ingestAuditLogService.record(req, { userId: null, tokenId: null, outcome: 'rejected-auth', httpStatus: 401 });
            return res.status(401).json({ error: 'Invalid or revoked ingest token' });
        }

        const consented = await collectorAuthService.hasActiveConsent(row.userId);
        if (!consented) {
            void ingestAuditLogService.record(req, { userId: row.userId, tokenId: row.id, outcome: 'rejected-consent', httpStatus: 403 });
            return res.status(403).json({
                error: 'consent-required',
                message: 'No active consent on file for the current collector version.',
            });
        }

        req.ingestUserId = row.userId;
        req.ingestTokenId = row.id;
        // Best-effort "last seen" for fleet health; never blocks the request.
        void collectorAuthService.markSeen(row.id);
        next();
    } catch (err) {
        console.error('authenticateIngestToken error:', err);
        return res.status(500).json({ error: 'Ingest auth failed' });
    }
};
