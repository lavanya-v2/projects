/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request } from 'express';
import { Op } from 'sequelize';
import { ClaudeIngestAuditLog } from '../../../models/ClaudeIngestAuditLog';
import { User } from '../../../models/User';
import { resolveAuditVisibleUserIds } from './claudeUsageReportService';

export type IngestOutcome =
    | 'accepted'
    | 'rejected-auth'
    | 'rejected-consent'
    | 'rejected-rate-limit'
    | 'rejected-payload'
    | 'rejected-integrity'
    | 'rejected-org-required'
    | 'rejected-org-not-monitored'
    | 'rejected-outdated-collector';

/** Best-effort string extraction for the pre-validation rejection paths, where the
 * body hasn't passed validatePayload yet — never trusted for anything but display,
 * so a generous but bounded truncation is enough (defends the STRING column width,
 * not a security boundary). */
const safeStr = (v: unknown, maxLen: number): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, maxLen) : null;

/**
 * Writes one append-only row per ingest attempt (ADDENDUM 11 Phase 3) — accepted or
 * rejected, at whatever stage the request landed. Never throws: a logging failure
 * must never break the actual ingest response.
 */
export const ingestAuditLogService = {
    async record(
        req: Request,
        opts: {
            userId: number | null;
            tokenId: number | null;
            outcome: IngestOutcome;
            httpStatus: number;
            day?: string | null;
            orgUuid?: string | null;
            collectorVersion?: string | null;
            payload?: Record<string, unknown> | null;
            /** VPN gate Stage 2 — only known once validatePayload has succeeded; leave
             * unset for rows rejected before that (e.g. rejected-payload, rejected-auth). */
            vpnGate?: string | null;
        },
    ): Promise<void> {
        try {
            await ClaudeIngestAuditLog.create({
                userId: opts.userId,
                tokenId: opts.tokenId,
                day: opts.day ?? safeStr((req.body as any)?.day, 10),
                userAgent: safeStr(req.headers['user-agent'], 255),
                collectorVersion: opts.collectorVersion ?? safeStr((req.body as any)?.collectorVersion, 20),
                orgUuid: opts.orgUuid ?? safeStr((req.body as any)?.orgUuid, 64),
                outcome: opts.outcome,
                httpStatus: opts.httpStatus,
                payload: opts.payload ?? null,
                vpnGate: opts.vpnGate ?? null,
            } as any);
        } catch (err) {
            console.error('ingestAuditLogService.record failed (non-fatal):', err);
        }
    },

    /**
     * Admin "Audit Log" view (ADDENDUM 11 Phase 3) — superuser-only, but even a
     * superuser only sees rows for users tagged to projects THEY personally have
     * access grants for (resolveAuditVisibleUserIds never applies the usual
     * superuser "everyone" bypass). Newest first, capped at `limit`.
     *
     * `includeRateLimited` (ADDENDUM 17 item 5): defaults to false — 429s are
     * mostly IDE-restart/session-hook noise (someone closing/reopening their editor
     * repeatedly), not something worth an admin's attention by default. Pass true
     * to see everything, same pattern as Data Quality's "Flagged only / All rows".
     */
    async list(reqUser: any, opts: { includeRateLimited?: boolean } = {}, limit = 200): Promise<Array<{
        id: number;
        userId: number | null;
        login: string | null;
        name: string | null;
        tokenId: number | null;
        day: string | null;
        userAgent: string | null;
        collectorVersion: string | null;
        orgUuid: string | null;
        outcome: string;
        httpStatus: number;
        payload: Record<string, unknown> | null;
        vpnGate: string | null;
        receivedAt: Date;
    }>> {
        const visibleUserIds = await resolveAuditVisibleUserIds(reqUser);
        if (!visibleUserIds.length) return [];

        const userClause = {
            [Op.or]: [
                { userId: { [Op.in]: visibleUserIds } },
                // Failed-auth rows (bad/missing token) never resolved a userId — still
                // shown, since they're part of the audit trail and carry no user's data.
                { userId: null },
            ],
        };
        const where = opts.includeRateLimited
            ? userClause
            : { [Op.and]: [userClause, { outcome: { [Op.ne]: 'rejected-rate-limit' } }] };

        const rows = await ClaudeIngestAuditLog.findAll({
            where,
            order: [['receivedAt', 'DESC']],
            limit,
        });

        const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is number => typeof x === 'number'))];
        const users = userIds.length ? await User.findAll({ where: { id: { [Op.in]: userIds } } }) : [];
        const byId = new Map(users.map((u) => [u.id, u]));

        return rows.map((r) => {
            const u = r.userId != null ? byId.get(r.userId) : undefined;
            return {
                id: r.id,
                userId: r.userId,
                login: u ? u.userId : null,
                name: u ? `${u.firstName} ${u.lastName}` : null,
                tokenId: r.tokenId,
                day: r.day,
                userAgent: r.userAgent,
                collectorVersion: r.collectorVersion,
                orgUuid: r.orgUuid,
                outcome: r.outcome,
                httpStatus: r.httpStatus,
                payload: r.payload,
                vpnGate: r.vpnGate,
                receivedAt: r.receivedAt,
            };
        });
    },
};
