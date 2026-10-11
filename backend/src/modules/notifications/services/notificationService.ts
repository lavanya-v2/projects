import { Op } from 'sequelize';
import { logger } from '../../../common/utils';
import { config } from '../../../config';
import { NotificationRule } from '../../../models/NotificationRule';
import { NotificationPendingAggregate } from '../../../models/NotificationPendingAggregate';
import { notificationQueue, SendJobData, FlushJobData } from '../queues/notificationQueue';

interface RuleCacheEntry { rules: NotificationRule[]; loadedAt: number; }
const ruleCache = new Map<string, RuleCacheEntry>();
const CACHE_TTL_MS = 60_000;

async function getRulesForEvent(eventCode: string): Promise<NotificationRule[]> {
    const cached = ruleCache.get(eventCode);
    const now = Date.now();
    if (cached && now - cached.loadedAt < CACHE_TTL_MS) return cached.rules;
    const rules = await NotificationRule.findAll({ where: { eventCode, isActive: true } });
    ruleCache.set(eventCode, { rules, loadedAt: now });
    return rules;
}

export function invalidateRuleCache(): void {
    ruleCache.clear();
}

function ruleMatchesScope(rule: NotificationRule, scope: { projectId?: number | null; accountId?: number | null }): boolean {
    const sc = rule.scopeConfig;
    if (!sc) return true;
    if (sc.projectIds && sc.projectIds.length > 0) {
        if (!scope.projectId || !sc.projectIds.includes(scope.projectId)) return false;
    }
    if (sc.accountIds && sc.accountIds.length > 0) {
        if (!scope.accountId || !sc.accountIds.includes(scope.accountId)) return false;
    }
    return true;
}

function computeCoalesceKey(rule: NotificationRule, payload: Record<string, unknown>, scope: { projectId?: number | null; accountId?: number | null }): string {
    const keys = rule.coalesceKeyConfig ?? [];
    if (keys.length === 0) return 'global';
    const merged = { ...scope, ...payload } as Record<string, unknown>;
    return keys.map(k => `${k}=${String(merged[k] ?? 'null')}`).join('|');
}

/**
 * Fire-and-forget emit. Never throws.
 * @param eventCode string code (use EVENTS constant)
 * @param payload JSON-serializable payload for template rendering
 * @param scope Optional { projectId, accountId } for scope/recipient resolution
 */
export function emit(
    eventCode: string,
    payload: Record<string, unknown>,
    scope: { projectId?: number | null; accountId?: number | null } = {}
): void {
    if (!config.notifications.enabled) return;

    // Kick off async dispatch; do not await
    dispatch(eventCode, payload, scope).catch(err => {
        logger.error(`emit(${eventCode}) failed`, err, 'NotificationService');
    });
}

async function dispatch(
    eventCode: string,
    payload: Record<string, unknown>,
    scope: { projectId?: number | null; accountId?: number | null }
): Promise<void> {
    const rules = await getRulesForEvent(eventCode);
    if (rules.length === 0) return;

    for (const rule of rules) {
        if (!ruleMatchesScope(rule, scope)) continue;

        const window = rule.coalesceWindowSeconds ?? 0;
        if (!window || window <= 0) {
            const jobData: SendJobData = { ruleId: rule.id, payload, payloadScope: scope };
            await notificationQueue.add('sendNotification', jobData);
            continue;
        }

        await enqueueCoalesced(rule, payload, scope, window);
    }
}

async function enqueueCoalesced(
    rule: NotificationRule,
    payload: Record<string, unknown>,
    scope: { projectId?: number | null; accountId?: number | null },
    windowSeconds: number
): Promise<void> {
    const coalesceKey = computeCoalesceKey(rule, payload, scope);
    const eventEntry = { payload, scope, ts: new Date().toISOString() };

    // Try to attach to an existing PENDING bucket
    const existing = await NotificationPendingAggregate.findOne({
        where: { ruleId: rule.id, coalesceKey, status: 'PENDING' },
    });

    if (existing) {
        const events = Array.isArray(existing.events) ? existing.events : [];
        events.push(eventEntry as any);
        existing.events = events;
        existing.changed('events', true);
        await existing.save();
        return;
    }

    const flushAt = new Date(Date.now() + windowSeconds * 1000);
    const pending = await NotificationPendingAggregate.create({
        ruleId: rule.id,
        coalesceKey,
        events: [eventEntry],
        flushAt,
        status: 'PENDING',
    } as any);

    const flushData: FlushJobData = { pendingId: pending.id };
    const job = await notificationQueue.add('flushPendingAggregate', flushData, {
        delay: windowSeconds * 1000,
    });
    if (job.id) {
        await pending.update({ jobId: String(job.id) });
    }
}
