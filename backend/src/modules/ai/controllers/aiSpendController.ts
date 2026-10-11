import { Request, Response } from 'express';
import { aiSpendService } from '../services/aiSpendService';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Default window when the caller doesn't specify one. */
const DEFAULT_DAYS = 30;

function isoDaysAgo(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

export const aiSpendController = {
    async summary(req: Request, res: Response) {
        try {
            const rawFrom = typeof req.query.from === 'string' ? req.query.from : '';
            const rawTo = typeof req.query.to === 'string' ? req.query.to : '';

            const from = ISO_DATE.test(rawFrom) ? rawFrom : isoDaysAgo(DEFAULT_DAYS);
            const to = ISO_DATE.test(rawTo) ? rawTo : new Date().toISOString().slice(0, 10);

            if (from > to) {
                return res.status(400).json({ error: '`from` must not be after `to`' });
            }

            const data = await aiSpendService.summary(from, to);
            res.json({ success: true, data });
        } catch (error) {
            console.error('Error building AI spend summary:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
