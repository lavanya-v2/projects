import { Op, Transaction } from 'sequelize';
import { IngestRateLimitSetting } from '../../../models/IngestRateLimitSetting';
import { UsageIngestToken } from '../../../models/UsageIngestToken';
import { ClaudeUsageDaily } from '../../../models/ClaudeUsageDaily';
import { User } from '../../../models/User';
import sequelize from '../../../config/connection';

/**
 * Server-side ingest rate limiting (ADDENDUM 11 Phase 1). This is the authoritative
 * control — client-side gating (the collector's own interval checks) is only an
 * optimization and can always be bypassed by a user with filesystem access to their
 * own machine; this cannot, since it's enforced here regardless of what the client
 * sends or how it was triggered.
 *
 * Resolution order: a token's own override, else the single global setting row,
 * else a hardcoded emergency fallback (once/day) if the settings row is ever missing.
 */
const FALLBACK_MINUTES = 1440;

export const ingestRateLimitService = {
    async getGlobalMinutes(): Promise<number> {
        const row = await IngestRateLimitSetting.findOne({ order: [['id', 'ASC']] });
        return row ? row.minIntervalMinutes : FALLBACK_MINUTES;
    },

    async setGlobalMinutes(minutes: number): Promise<number> {
        const clamped = Math.max(1, Math.round(minutes));
        const row = await IngestRateLimitSetting.findOne({ order: [['id', 'ASC']] });
        if (row) {
            await row.update({ minIntervalMinutes: clamped, updatedAt: new Date() });
        } else {
            await IngestRateLimitSetting.create({ minIntervalMinutes: clamped } as any);
        }
        return clamped;
    },

    async setTokenOverride(tokenId: number, minutes: number | null): Promise<boolean> {
        const row = await UsageIngestToken.findByPk(tokenId);
        if (!row) return false;
        // 0 is a valid, meaningful override ("no wait — for rapid local testing"), not an
        // error case — only floor negative input. A prior `Math.max(1, ...)` here silently
        // forced any attempted 0 up to 1 minute, defeating exactly the testing use case this
        // override exists for.
        const clamped = minutes == null ? null : Math.max(0, Math.round(minutes));
        await row.update({ minIntervalMinutesOverride: clamped });
        return true;
    },

    /** Active (non-revoked) tokens with basic user identity, for the admin screen. */
    async listActiveTokensWithUsers(): Promise<Array<{
        tokenId: number;
        userId: number;
        login: string;
        name: string;
        lastFour: string | null;
        minIntervalMinutesOverride: number | null;
        lastSeenAt: Date | null;
    }>> {
        const tokens = await UsageIngestToken.findAll({ where: { revokedAt: null as any } });
        const userIds = [...new Set(tokens.map((t) => t.userId))];
        const users = await User.findAll({ where: { id: { [Op.in]: userIds } } });
        const byId = new Map(users.map((u) => [u.id, u]));
        return tokens.map((t) => {
            const u = byId.get(t.userId);
            return {
                tokenId: t.id,
                userId: t.userId,
                login: u ? u.userId : `#${t.userId}`,
                name: u ? `${u.firstName} ${u.lastName}` : 'Unknown',
                lastFour: t.lastFour,
                minIntervalMinutesOverride: t.minIntervalMinutesOverride,
                lastSeenAt: t.lastSeenAt,
            };
        });
    },

    /**
     * Every token ever created — active AND revoked — with user identity (ADDENDUM 19).
     * "Who has installed the collector" reads as ever-had-a-token, not just
     * currently-active, so a revoked token still shows up (status derived by the
     * caller from `revokedAt`). Sorted most-recent-sync-first so a stale/never-synced
     * install is easy to spot; never-synced (`lastSeenAt: null`) sorts last.
     */
    async listAllTokensWithUsers(): Promise<Array<{
        tokenId: number;
        userId: number;
        login: string;
        name: string;
        lastFour: string | null;
        createdAt: Date;
        lastSeenAt: Date | null;
        revokedAt: Date | null;
        /** Collector version stamped on this user's most recent push — null if they've
         * never pushed, or their only pushes predate the version field. Lets a superuser
         * see who's still on an old collector after a fix ships (ADDENDUM 22). */
        collectorVersion: string | null;
    }>> {
        const tokens = await UsageIngestToken.findAll();
        const userIds = [...new Set(tokens.map((t) => t.userId))];
        const users = await User.findAll({ where: { id: { [Op.in]: userIds } } });
        const byId = new Map(users.map((u) => [u.id, u]));

        // Most recent collector version actually seen per user, from their latest daily
        // row — the version field a machine ACTUALLY ran, not what the server currently
        // serves (those can differ until the person re-runs the installer).
        const recentRows = userIds.length
            ? await ClaudeUsageDaily.findAll({
                  where: { userId: { [Op.in]: userIds } },
                  order: [['userId', 'ASC'], ['day', 'DESC']],
                  attributes: ['userId', 'day', 'collectorVersion'],
              })
            : [];
        const versionByUser = new Map<number, string | null>();
        for (const r of recentRows) {
            if (!versionByUser.has(r.userId)) versionByUser.set(r.userId, r.collectorVersion);
        }

        return tokens
            .map((t) => {
                const u = byId.get(t.userId);
                return {
                    tokenId: t.id,
                    userId: t.userId,
                    login: u ? u.userId : `#${t.userId}`,
                    name: u ? `${u.firstName} ${u.lastName}` : 'Unknown',
                    lastFour: t.lastFour,
                    createdAt: t.createdAt,
                    lastSeenAt: t.lastSeenAt,
                    revokedAt: t.revokedAt,
                    collectorVersion: versionByUser.get(t.userId) ?? null,
                };
            })
            .sort((a, b) => {
                const at = a.lastSeenAt ? a.lastSeenAt.getTime() : -1;
                const bt = b.lastSeenAt ? b.lastSeenAt.getTime() : -1;
                return bt - at;
            });
    },

    /** Effective interval for a given token, resolving override → global → fallback. */
    async effectiveMinutes(token: UsageIngestToken): Promise<{ minutes: number; source: 'token' | 'global' }> {
        if (token.minIntervalMinutesOverride != null) {
            return { minutes: token.minIntervalMinutesOverride, source: 'token' };
        }
        return { minutes: await this.getGlobalMinutes(), source: 'global' };
    },

    /**
     * ADDENDUM 25: serializes concurrent ingest attempts for the same (userId, day)
     * using a transaction-scoped Postgres advisory lock — auto-released on commit
     * OR rollback, so the caller never has to remember to unlock it. This closes a
     * real race: two near-simultaneous requests for a day that had NEVER been
     * accepted before (e.g. the OS scheduler and the session-end hook firing
     * within moments of each other) could both read "nothing accepted yet" in
     * checkAllowed before either had written back, and both get accepted —
     * producing two 'accepted' audit-log rows for the same push. The DB's unique
     * (user_id, day) index means the actual data never duplicated, but the rate
     * limit's own guarantee ("at most one accepted ingest per day per window") was
     * silently violated. The caller MUST call this before `checkAllowed` and use
     * the SAME transaction for `checkAllowed` and the eventual write.
     */
    async acquireDayLock(t: Transaction, userId: number, day: string): Promise<void> {
        await sequelize.query('SELECT pg_advisory_xact_lock(:userId, hashtext(:day))', {
            replacements: { userId, day },
            transaction: t,
        });
    },

    /**
     * Check whether `userId` may ingest `day` right now. Scoped to (userId, day) —
     * NOT globally per user — so a legitimate backlog of several distinct days can
     * all push through in one collector run (each day's own clock is independent),
     * while still blocking the actual abuse case this exists for: re-pushing the
     * SAME day over and over. An earlier global-per-user version meant only the
     * first day in any multi-day run could ever succeed, forcing an override-to-0
     * workaround just to catch up a backlog — this fixes that properly.
     *
     * `transaction` should be the same one `acquireDayLock` was called with, so
     * this read sees a consistent, lock-serialized view — otherwise two concurrent
     * callers can both read "not yet accepted" (ADDENDUM 25).
     */
    async checkAllowed(userId: number, day: string, token: UsageIngestToken, transaction?: Transaction): Promise<{
        allowed: boolean;
        retryAfterMinutes?: number;
        effectiveMinutes: number;
    }> {
        const { minutes } = await this.effectiveMinutes(token);
        const last = await ClaudeUsageDaily.findOne({
            where: { userId, day, receivedAt: { [Op.ne]: null as any } },
            transaction,
        });
        if (!last || !last.receivedAt) return { allowed: true, effectiveMinutes: minutes };

        const elapsedMinutes = (Date.now() - new Date(last.receivedAt).getTime()) / 60000;
        if (elapsedMinutes >= minutes) return { allowed: true, effectiveMinutes: minutes };

        return {
            allowed: false,
            retryAfterMinutes: Math.ceil(minutes - elapsedMinutes),
            effectiveMinutes: minutes,
        };
    },
};
