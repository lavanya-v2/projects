import { AiCallUsage } from '../../../models/AiCallUsage';
import { pricingService } from '../../usageCollector/services/pricingService';

/**
 * Records what each Anthropic call cost us.
 *
 * Every `messages.create` response carries a `usage` object that this application
 * previously threw away, so its Claude spend could only be modelled. This writes one
 * row per call so the spend can actually be measured, attributed to a report type,
 * and used to prove whether a cost optimisation worked.
 *
 * Two properties are load-bearing:
 *
 * 1. **It can never fail a report.** Instrumentation that can break report generation
 *    is worse than no instrumentation. Every path here swallows its own errors and the
 *    write is not awaited by callers.
 * 2. **It stores tokens, not dollars.** Cost is derived at read time from the
 *    `pricing_version_id` stamped on the row, so correcting the rate card later fixes
 *    future reads without silently rewriting history.
 */

/** Call-site labels. Kept as a union so a typo is a compile error, not a silent bad row. */
export type AiCallSite =
    | 'daily-dsr'
    | 'weekly-summary'
    | 'account-weekly-summary'
    | 'program-daily-summary'
    | 'monthly-summary'
    | 'shared-team-consolidation'
    | 'collate-weekly-insights'
    | 'collate-account-insights'
    | 'prompt-coaching'
    | 'portfolio-exec-summary'
    | 'refresh-exec-summary'
    | 'monthly-account-summary'
    | 'insights-health-check'
    | 'portfolio-mom'
    | 'column-mapping'
    | 'risk-summary'
    | 'range-project-summary'
    | 'range-account-briefing'
    | 'custom-range-achievements';

export interface AiUsageContext {
    projectId?: number | null;
    accountId?: number | null;
    programId?: number | null;
}

/**
 * The active pricing version, cached briefly.
 *
 * Without this every AI call would add a DB round-trip purely for instrumentation.
 * The rate card changes at most a few times a year, so a stale read for a minute is
 * harmless — and a wrong-by-one-version stamp is far cheaper than slowing the hot path.
 */
let cachedPricingVersionId: number | null = null;
let cachedPricingAt = 0;
const PRICING_CACHE_MS = 60_000;

async function activePricingVersionId(): Promise<number | null> {
    const now = Date.now();
    if (cachedPricingVersionId !== null && now - cachedPricingAt < PRICING_CACHE_MS) {
        return cachedPricingVersionId;
    }
    try {
        const active = await pricingService.getActive();
        cachedPricingVersionId = active ? Number(active.id) : null;
        cachedPricingAt = now;
        return cachedPricingVersionId;
    } catch {
        // No pricing row, or the table is unreachable. The usage row is still worth
        // writing — token counts are useful on their own and cost can be back-filled.
        return null;
    }
}

/**
 * Fire-and-forget. Deliberately returns void rather than a promise so a caller cannot
 * accidentally `await` it into the critical path of a report.
 */
export function recordAiUsage(
    callSite: AiCallSite,
    model: string,
    usage: unknown,
    ctx: AiUsageContext = {}
): void {
    void (async () => {
        try {
            const u = (usage ?? {}) as Record<string, unknown>;
            const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

            await AiCallUsage.create({
                callSite,
                model,
                inputTokens: num(u.input_tokens),
                outputTokens: num(u.output_tokens),
                cacheReadTokens: num(u.cache_read_input_tokens),
                cacheCreationTokens: num(u.cache_creation_input_tokens),
                projectId: ctx.projectId ?? null,
                accountId: ctx.accountId ?? null,
                programId: ctx.programId ?? null,
                pricingVersionId: await activePricingVersionId(),
            } as any);
        } catch (err) {
            // Never surface. A dropped usage row costs a gap in a chart; a thrown error
            // here would cost a report.
            console.error(
                `[AiUsageRecorder] Failed to record usage for ${callSite}:`,
                err instanceof Error ? err.message : err
            );
        }
    })();
}
