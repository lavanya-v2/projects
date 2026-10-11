/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { claudeUsageReportService } from '../services/claudeUsageReportService';

interface AuthRequest extends Request {
    user?: any;
}

/**
 * Admin "Data Quality" view (ADDENDUM 5). Lists rows flagged by the plausibility
 * heuristics for human review. Read-only except acknowledge (clears a flag).
 */
export const integrityController = {
    async list(req: AuthRequest, res: Response) {
        try {
            const status = (String(req.query.status || 'flagged') as 'flagged' | 'ok' | 'all');
            const rows = await claudeUsageReportService.listFlagged(
                ['flagged', 'ok', 'all'].includes(status) ? status : 'flagged',
            );
            res.json({ success: true, data: rows });
        } catch (error) {
            console.error('Error listing integrity flags:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async acknowledge(req: AuthRequest, res: Response) {
        try {
            const userId = Number(req.body?.userId);
            const day = String(req.body?.day || '');
            if (!userId || !day) return res.status(400).json({ error: 'userId and day required' });
            const ok = await claudeUsageReportService.acknowledgeFlag(userId, day);
            if (!ok) return res.status(404).json({ error: 'Row not found' });
            res.json({ success: true });
        } catch (error) {
            console.error('Error acknowledging integrity flag:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
