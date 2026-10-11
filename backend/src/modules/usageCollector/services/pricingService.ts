import { Op } from 'sequelize';
import { PricingModel, PricingRates } from '../../../models/PricingModel';
import { User } from '../../../models/User';

/**
 * Versioned Claude cost model. The "active" model is the highest version; editing
 * creates a new version (old ones are immutable). Daily rows are stamped with the
 * version active at ingest, so cost is frozen per row.
 */
export const pricingService = {
    async getActive(): Promise<PricingModel | null> {
        return PricingModel.findOne({ order: [['version', 'DESC']] });
    },

    async getById(id: number): Promise<PricingModel | null> {
        return PricingModel.findByPk(id);
    },

    /** Batch-load versions by id (for pricing a set of daily rows). */
    async getByIds(ids: number[]): Promise<Map<number, PricingModel>> {
        const unique = [...new Set(ids.filter((x) => x != null))];
        if (!unique.length) return new Map();
        const rows = await PricingModel.findAll({ where: { id: { [Op.in]: unique } } });
        return new Map(rows.map((r) => [Number(r.id), r]));
    },

    async list(): Promise<PricingModel[]> {
        return PricingModel.findAll({
            order: [['version', 'DESC']],
            include: [{ model: User, attributes: ['id', 'userId', 'firstName', 'lastName'] }],
        });
    },

    /** Create the next version. Old versions are never mutated. */
    async createVersion(rates: PricingRates, note: string | null, userId: number | null): Promise<PricingModel> {
        const latest = await this.getActive();
        const nextVersion = (latest?.version ?? 0) + 1;
        return PricingModel.create({
            version: nextVersion,
            rates,
            note: note ?? null,
            createdByUserId: userId,
        } as any);
    },
};

/** Resolve a model id to its tiers within a rate set (prefix match, then fallback). */
export function ratesFor(model: string, rates: PricingRates) {
    if (rates.models[model]) return rates.models[model];
    const prefix = Object.entries(rates.models).find(([k]) => model.startsWith(k));
    return prefix ? prefix[1] : rates.fallback;
}
