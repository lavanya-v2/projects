import { Request, Response } from 'express';
import { collectorVersionPolicyService } from '../services/collectorVersionPolicyService';

const VERSION_RE = /^[0-9][0-9.]{0,15}$/;

/**
 * Admin "minimum collector version" policy (ADDENDUM 22) — the fleet-wide floor
 * enforced at ingest once its effective date passes. Lives alongside the ingest
 * rate limit in the admin UI: both are single-row, admin-tunable ingest gates.
 */
export const collectorVersionPolicyController = {
    async get(_req: Request, res: Response) {
        try {
            const policy = await collectorVersionPolicyService.getPolicy();
            res.json({ success: true, data: policy });
        } catch (error) {
            console.error('Error loading collector version policy:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async set(req: Request, res: Response) {
        try {
            const rawVersion = req.body?.minEnforcedVersion;
            const rawDate = req.body?.enforceAfter;

            let minVersion: string | null = null;
            if (rawVersion != null && rawVersion !== '') {
                if (typeof rawVersion !== 'string' || !VERSION_RE.test(rawVersion)) {
                    return res.status(400).json({ error: 'minEnforcedVersion must be a plain X.Y.Z version string' });
                }
                minVersion = rawVersion;
            }

            let enforceAfter: Date | null = null;
            if (rawDate != null && rawDate !== '') {
                const d = new Date(rawDate);
                if (Number.isNaN(d.getTime())) {
                    return res.status(400).json({ error: 'enforceAfter must be a valid date' });
                }
                enforceAfter = d;
            }

            // Both-or-neither: a version with no date would enforce immediately (no
            // grace window, the exact thing this field exists to prevent), and a
            // date with no version enforces nothing. Reject the half-set case rather
            // than silently guessing which one was meant.
            if ((minVersion == null) !== (enforceAfter == null)) {
                return res.status(400).json({
                    error: 'set-both-or-neither',
                    message: 'Set both minEnforcedVersion and enforceAfter together, or clear both.',
                });
            }

            const saved = await collectorVersionPolicyService.setPolicy(minVersion, enforceAfter);
            res.json({ success: true, data: saved });
        } catch (error) {
            console.error('Error updating collector version policy:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
