/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { monitoredOrgService } from '../services/monitoredOrgService';

interface AuthRequest extends Request {
    user?: any;
}

const serialize = (o: any) => ({
    orgUuid: o.orgUuid,
    orgName: o.orgName,
    enabled: o.enabled,
    firstSeenAt: o.firstSeenAt,
    licenseType: o.licenseType ?? null,
    seatMonthlyUsd: o.seatMonthlyUsd ?? null,
});

export const monitoredOrgController = {
    async list(_req: AuthRequest, res: Response) {
        try {
            const rows = await monitoredOrgService.list();
            res.json({ success: true, data: rows.map(serialize) });
        } catch (error) {
            console.error('Error listing monitored orgs:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async setEnabled(req: AuthRequest, res: Response) {
        try {
            const orgUuid = String(req.body?.orgUuid || '');
            const enabled = !!req.body?.enabled;
            if (!orgUuid) return res.status(400).json({ error: 'orgUuid required' });
            const row = await monitoredOrgService.setEnabled(orgUuid, enabled);
            if (!row) return res.status(404).json({ error: 'Org not found' });
            res.json({ success: true, data: serialize(row) });
        } catch (error) {
            console.error('Error updating monitored org:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    /**
     * Set license economics for the VALUE view. Body: { orgUuid, licenseType?, seatMonthlyUsd? }.
     * Send null in a field to clear the override and fall back to the global benchmark.
     */
    async setLicense(req: AuthRequest, res: Response) {
        try {
            const orgUuid = String(req.body?.orgUuid || '');
            if (!orgUuid) return res.status(400).json({ error: 'orgUuid required' });

            const patch: { licenseType?: 'seat' | 'api' | null; seatMonthlyUsd?: number | null } = {};
            if ('licenseType' in (req.body || {})) {
                const lt = req.body.licenseType;
                if (lt !== null && lt !== 'seat' && lt !== 'api') {
                    return res.status(400).json({ error: "licenseType must be 'seat', 'api', or null" });
                }
                patch.licenseType = lt;
            }
            if ('seatMonthlyUsd' in (req.body || {})) {
                const v = req.body.seatMonthlyUsd;
                patch.seatMonthlyUsd = v === null || v === '' ? null : Number(v);
            }

            const row = await monitoredOrgService.setLicense(orgUuid, patch);
            if (!row) return res.status(404).json({ error: 'Org not found' });
            res.json({ success: true, data: serialize(row) });
        } catch (error) {
            console.error('Error updating org license:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
