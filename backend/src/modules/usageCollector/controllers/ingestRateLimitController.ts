/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { ingestRateLimitService } from '../services/ingestRateLimitService';

/**
 * Admin "Ingest Rate Limit" view (ADDENDUM 11 Phase 1). Global default + per-token
 * override, both UI-editable — the server-side floor the client cannot bypass.
 */
export const ingestRateLimitController = {
    async get(_req: Request, res: Response) {
        try {
            const [globalMinutes, tokens] = await Promise.all([
                ingestRateLimitService.getGlobalMinutes(),
                ingestRateLimitService.listActiveTokensWithUsers(),
            ]);
            res.json({ success: true, data: { globalMinutes, tokens } });
        } catch (error) {
            console.error('Error loading ingest rate limit settings:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async setGlobal(req: Request, res: Response) {
        try {
            const minutes = Number(req.body?.minIntervalMinutes);
            if (!Number.isFinite(minutes) || minutes <= 0) {
                return res.status(400).json({ error: 'minIntervalMinutes must be a positive number' });
            }
            const saved = await ingestRateLimitService.setGlobalMinutes(minutes);
            res.json({ success: true, data: { globalMinutes: saved } });
        } catch (error) {
            console.error('Error updating global ingest rate limit:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async setTokenOverride(req: Request, res: Response) {
        try {
            const tokenId = Number(req.body?.tokenId);
            if (!tokenId) return res.status(400).json({ error: 'tokenId required' });
            const raw = req.body?.minIntervalMinutesOverride;
            const minutes = raw === null || raw === undefined || raw === '' ? null : Number(raw);
            // 0 is valid and meaningful ("no wait — for rapid local testing"), not an error —
            // only reject negative/non-finite input. This previously rejected 0 outright,
            // silently blocking the exact use case the override exists for.
            if (minutes != null && (!Number.isFinite(minutes) || minutes < 0)) {
                return res.status(400).json({ error: 'minIntervalMinutesOverride must be a non-negative number or null' });
            }
            const ok = await ingestRateLimitService.setTokenOverride(tokenId, minutes);
            if (!ok) return res.status(404).json({ error: 'Token not found' });
            res.json({ success: true });
        } catch (error) {
            console.error('Error updating token rate-limit override:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
