/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { ingestAuditLogService } from '../services/ingestAuditLogService';

interface AuthRequest extends Request {
    user?: any;
}

/**
 * Admin "Audit Log" view (ADDENDUM 11 Phase 3) — superuser-only (see
 * superuserOnlyMiddleware), and even then project-scoped to the caller (see
 * resolveAuditVisibleUserIds). Read-only.
 */
export const ingestAuditLogController = {
    async list(req: AuthRequest, res: Response) {
        try {
            const includeRateLimited = req.query.includeRateLimited === 'true';
            const rows = await ingestAuditLogService.list(req.user, { includeRateLimited });
            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('Error listing ingest audit log:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
