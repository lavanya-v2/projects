import Redis from 'ioredis';
import { Op } from 'sequelize';
import { config } from '../config';
import { UserSession } from '../models/UserSession';
import { UsageEvent, UsageEventType } from '../models/UsageEvent';

/** Minimum gap between heartbeat DB writes for a given session. */
const HEARTBEAT_THROTTLE_SECONDS = 120;

/** A JWT cannot outlive 24h, so any session older than this is definitively over. */
const SESSION_MAX_AGE_HOURS = 24;

/** Retention window for usage_events. */
const EVENT_RETENTION_DAYS = 180;

export interface StartSessionInput {
    userId: number;
    sessionId: string;
    roleName?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
}

export interface RecordEventInput {
    userId: number;
    sessionId?: string | null;
    roleName?: string | null;
    eventType: UsageEventType;
    feature?: string | null;
    method?: string | null;
    path?: string | null;
    statusCode?: number | null;
    durationMs?: number | null;
    projectId?: number | null;
}

/**
 * Single seam for all usage/session writes.
 *
 * Every public method swallows its own errors: usage tracking is observational
 * and must never fail or slow down a user request. Callers may safely `void`
 * these promises.
 */
class UsageTrackingService {
    private redis: Redis;

    constructor() {
        this.redis = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            // Keep tracking non-fatal if Redis is down — fail fast per command
            // rather than queueing forever.
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
        });

        this.redis.on('error', (err) => {
            // Logged at debug volume: a Redis outage degrades the heartbeat
            // throttle, it does not break anything.
            console.error('Redis error (usage tracking):', err.message);
        });
    }

    /** Records a login: opens a session row and writes a `login` event. */
    async startSession(input: StartSessionInput): Promise<void> {
        if (!input.sessionId || !input.userId) return;
        try {
            const now = new Date();
            await UserSession.create({
                sessionId: input.sessionId,
                userId: input.userId,
                roleName: input.roleName ?? null,
                ipAddress: this.truncate(input.ipAddress, 64),
                userAgent: this.truncate(input.userAgent, 512),
                startedAt: now,
                lastSeenAt: now,
                endedAt: null,
                endReason: null,
            });

            await this.recordEvent({
                userId: input.userId,
                sessionId: input.sessionId,
                roleName: input.roleName ?? null,
                eventType: 'login',
            });
        } catch (error: any) {
            console.error('usageTracking.startSession failed:', error?.message);
        }
    }

    /**
     * Heartbeat. Called on every authenticated request but throttled via Redis
     * so at most one DB write happens per session per HEARTBEAT_THROTTLE_SECONDS.
     *
     * If Redis is unavailable the throttle is skipped entirely (no write) rather
     * than falling through to an unthrottled write — a Redis outage must not
     * turn into one UPDATE per request.
     */
    async touchSession(sessionId?: string | null): Promise<void> {
        if (!sessionId) return;
        try {
            const key = `usage:hb:${sessionId}`;
            const acquired = await this.redis.set(key, '1', 'EX', HEARTBEAT_THROTTLE_SECONDS, 'NX');
            if (acquired !== 'OK') return; // throttled — a recent write already happened

            await UserSession.update(
                { lastSeenAt: new Date() },
                { where: { sessionId, endedAt: null } }
            );
        } catch (error: any) {
            console.error('usageTracking.touchSession failed:', error?.message);
        }
    }

    /** Closes a session (logout or natural token expiry) and logs the event. */
    async endSession(sessionId: string | null | undefined, reason: 'logout' | 'expired'): Promise<void> {
        if (!sessionId) return;
        try {
            const session = await UserSession.findOne({ where: { sessionId } });
            if (!session || session.endedAt) return; // unknown or already closed — idempotent

            const now = new Date();
            await session.update({
                endedAt: now,
                lastSeenAt: reason === 'logout' ? now : session.lastSeenAt,
                endReason: reason,
            });

            await this.recordEvent({
                userId: session.userId,
                sessionId,
                roleName: session.roleName,
                eventType: reason === 'logout' ? 'logout' : 'session_expired',
            });

            // Drop the heartbeat key so a re-used sid can't be throttled.
            await this.redis.del(`usage:hb:${sessionId}`).catch(() => undefined);
        } catch (error: any) {
            console.error('usageTracking.endSession failed:', error?.message);
        }
    }

    /** Appends a single usage_events row. */
    async recordEvent(input: RecordEventInput): Promise<void> {
        if (!input.userId || !input.eventType) return;
        try {
            await UsageEvent.create({
                userId: input.userId,
                sessionId: input.sessionId ?? null,
                roleName: input.roleName ?? null,
                eventType: input.eventType,
                feature: this.truncate(input.feature, 60),
                method: this.truncate(input.method, 10),
                path: this.truncate(input.path, 255),
                statusCode: input.statusCode ?? null,
                durationMs: input.durationMs ?? null,
                projectId: input.projectId ?? null,
                occurredAt: new Date(),
            });
        } catch (error: any) {
            console.error('usageTracking.recordEvent failed:', error?.message);
        }
    }

    /**
     * Closes sessions that were never explicitly ended (browser closed, tab
     * abandoned). Their real end is unknowable, so we attribute it to the last
     * heartbeat. Idempotent and cheap — called at the top of analytics queries
     * rather than on a cron.
     */
    async closeStaleSessions(): Promise<void> {
        try {
            const cutoff = new Date(Date.now() - SESSION_MAX_AGE_HOURS * 60 * 60 * 1000);
            const stale = await UserSession.findAll({
                where: { endedAt: null, startedAt: { [Op.lt]: cutoff } },
                limit: 5000,
            });
            for (const session of stale) {
                await session.update({ endedAt: session.lastSeenAt, endReason: 'stale' });
            }
        } catch (error: any) {
            console.error('usageTracking.closeStaleSessions failed:', error?.message);
        }
    }

    /** Retention: drop usage events older than EVENT_RETENTION_DAYS. */
    async pruneOldEvents(): Promise<number> {
        try {
            const cutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
            return await UsageEvent.destroy({ where: { occurredAt: { [Op.lt]: cutoff } } });
        } catch (error: any) {
            console.error('usageTracking.pruneOldEvents failed:', error?.message);
            return 0;
        }
    }

    private truncate(value: string | null | undefined, max: number): string | null {
        if (!value) return null;
        return value.length > max ? value.slice(0, max) : value;
    }

    // Helper to close connection if needed (e.g. tests)
    async quit() {
        await this.redis.quit();
    }
}

export const usageTrackingService = new UsageTrackingService();
