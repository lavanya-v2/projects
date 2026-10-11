import { Op } from 'sequelize';
import { AiCallUsage } from '../../../models/AiCallUsage';
import { PricingModel, RateTiers } from '../../../models/PricingModel';
import { pricingService, ratesFor } from '../../usageCollector/services/pricingService';

/**
 * Read side of the AI spend meter.
 *
 * Rows store token counts plus the pricing version in force when the call was made.
 * Cost is computed here, at read time, from that version's rates — so a later
 * correction to the rate card changes what future reads report without rewriting
 * history, and rows written before any rate card existed can still be priced with the
 * current one rather than being dropped from the totals.
 */

export interface SpendBucket {
    key: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
}

export interface AiSpendSummary {
    from: string;
    to: string;
    totals: SpendBucket;
    byCallSite: SpendBucket[];
    byModel: SpendBucket[];
    byDay: SpendBucket[];
    /** True when at least one row could not be priced (no pricing model configured at all). */
    unpriced: boolean;
}

const ZERO = (key: string): SpendBucket => ({
    key,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
});

/** Rates are USD per 1,000,000 tokens. */
function costOf(row: AiCallUsage, tiers: RateTiers | null): number {
    if (!tiers) return 0;
    return (
        (row.inputTokens * tiers.input +
            row.outputTokens * tiers.output +
            row.cacheReadTokens * tiers.cache_read +
            row.cacheCreationTokens * tiers.cache_write) /
        1_000_000
    );
}

function add(bucket: SpendBucket, row: AiCallUsage, cost: number): void {
    bucket.calls += 1;
    bucket.inputTokens += row.inputTokens;
    bucket.outputTokens += row.outputTokens;
    bucket.cacheReadTokens += row.cacheReadTokens;
    bucket.cacheCreationTokens += row.cacheCreationTokens;
    bucket.costUsd += cost;
}

function intoBucket(map: Map<string, SpendBucket>, key: string, row: AiCallUsage, cost: number): void {
    let b = map.get(key);
    if (!b) {
        b = ZERO(key);
        map.set(key, b);
    }
    add(b, row, cost);
}

const round = (b: SpendBucket): SpendBucket => ({ ...b, costUsd: Math.round(b.costUsd * 10000) / 10000 });

export const aiSpendService = {
    /**
     * @param from inclusive ISO date (YYYY-MM-DD)
     * @param to   inclusive ISO date (YYYY-MM-DD)
     */
    async summary(from: string, to: string): Promise<AiSpendSummary> {
        // `to` is inclusive, so extend to the end of that day.
        const start = new Date(`${from}T00:00:00.000Z`);
        const end = new Date(`${to}T23:59:59.999Z`);

        const rows = await AiCallUsage.findAll({
            where: { createdAt: { [Op.between]: [start, end] } },
            order: [['createdAt', 'ASC']],
        });

        // Resolve every pricing version referenced by the result set in one query, plus
        // the active one as the fallback for rows written before any card existed.
        const versionIds = rows.map((r) => Number(r.pricingVersionId)).filter((n) => Number.isFinite(n));
        const versions = await pricingService.getByIds(versionIds);
        const active = await pricingService.getActive();

        const tiersFor = (row: AiCallUsage): RateTiers | null => {
            const pinned: PricingModel | undefined = row.pricingVersionId
                ? versions.get(Number(row.pricingVersionId))
                : undefined;
            const card = pinned ?? active;
            return card ? ratesFor(row.model, card.rates) : null;
        };

        const totals = ZERO('total');
        const byCallSite = new Map<string, SpendBucket>();
        const byModel = new Map<string, SpendBucket>();
        const byDay = new Map<string, SpendBucket>();
        let unpriced = false;

        for (const row of rows) {
            const tiers = tiersFor(row);
            if (!tiers) unpriced = true;
            const cost = costOf(row, tiers);

            add(totals, row, cost);
            intoBucket(byCallSite, row.callSite, row, cost);
            intoBucket(byModel, row.model, row, cost);
            intoBucket(byDay, new Date(row.createdAt).toISOString().slice(0, 10), row, cost);
        }

        const desc = (a: SpendBucket, b: SpendBucket) => b.costUsd - a.costUsd;

        return {
            from,
            to,
            totals: round(totals),
            byCallSite: [...byCallSite.values()].map(round).sort(desc),
            byModel: [...byModel.values()].map(round).sort(desc),
            byDay: [...byDay.values()].map(round).sort((a, b) => a.key.localeCompare(b.key)),
            unpriced,
        };
    },
};
