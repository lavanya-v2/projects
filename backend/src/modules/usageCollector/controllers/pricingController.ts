/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { pricingService } from '../services/pricingService';
import type { PricingRates, RateTiers } from '../../../models/PricingModel';

interface AuthRequest extends Request {
    user?: any;
}

const TIER_KEYS: (keyof RateTiers)[] = ['input', 'output', 'cache_write', 'cache_read'];

function validTiers(v: unknown): v is RateTiers {
    if (!v || typeof v !== 'object') return false;
    return TIER_KEYS.every((k) => {
        const n = (v as any)[k];
        return typeof n === 'number' && Number.isFinite(n) && n >= 0;
    });
}

function validateRates(raw: unknown): PricingRates | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as any;
    if (!r.models || typeof r.models !== 'object' || Array.isArray(r.models)) return null;
    if (!validTiers(r.fallback)) return null;
    const models: Record<string, RateTiers> = {};
    for (const [model, tiers] of Object.entries(r.models)) {
        if (!/^[a-z][a-z0-9.\-]{0,40}$/.test(model)) return null;
        if (!validTiers(tiers)) return null;
        const t = tiers as RateTiers;
        models[model] = {
            input: t.input, output: t.output, cache_write: t.cache_write, cache_read: t.cache_read,
        };
    }
    const f = r.fallback as RateTiers;
    return { models, fallback: { input: f.input, output: f.output, cache_write: f.cache_write, cache_read: f.cache_read } };
}

const serialize = (p: any) => ({
    id: Number(p.id),
    version: p.version,
    rates: p.rates,
    note: p.note,
    effectiveFrom: p.effectiveFrom,
    createdAt: p.createdAt,
    createdBy: p.createdBy ? `${p.createdBy.firstName ?? ''} ${p.createdBy.lastName ?? ''}`.trim() || p.createdBy.userId : null,
});

export const pricingController = {
    async list(_req: AuthRequest, res: Response) {
        try {
            const rows = await pricingService.list();
            res.json({ success: true, data: rows.map(serialize) });
        } catch (error) {
            console.error('Error listing pricing versions:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async active(_req: AuthRequest, res: Response) {
        try {
            const p = await pricingService.getActive();
            res.json({ success: true, data: p ? serialize(p) : null });
        } catch (error) {
            console.error('Error fetching active pricing:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async create(req: AuthRequest, res: Response) {
        try {
            const rates = validateRates(req.body?.rates);
            if (!rates) {
                return res.status(400).json({ error: 'Invalid rates. Expect { models: { <id>: {input,output,cache_write,cache_read} }, fallback: {…} } with non-negative numbers.' });
            }
            const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : null;
            const created = await pricingService.createVersion(rates, note, req.user?.id ?? null);
            res.status(201).json({ success: true, data: serialize(created) });
        } catch (error) {
            console.error('Error creating pricing version:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
