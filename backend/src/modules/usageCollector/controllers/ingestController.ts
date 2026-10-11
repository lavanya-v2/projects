/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { config } from '../../../config';
import { ClaudeUsageDaily } from '../../../models/ClaudeUsageDaily';
import {
    validatePayload,
    deriveScalars,
    PayloadError,
    checkIntegrity,
    detectAnomalies,
    totalTokens,
    avgScore as dayAvgScore,
    type HistoryPoint,
    type VpnGateState,
} from '../services/promptQualityService';
import { Op } from 'sequelize';
import { pricingService } from '../services/pricingService';
import { monitoredOrgService } from '../services/monitoredOrgService';
import { ingestRateLimitService } from '../services/ingestRateLimitService';
import { collectorVersionPolicyService } from '../services/collectorVersionPolicyService';
import { ingestAuditLogService } from '../services/ingestAuditLogService';
import { UsageIngestToken } from '../../../models/UsageIngestToken';
import sequelize from '../../../config/connection';

interface IngestRequest extends Request {
    ingestUserId?: number;
    ingestTokenId?: number;
}

export const ingestController = {
    /**
     * POST /api/ingest/claude-usage
     * Auth: ingest token (authenticateIngestToken). Body: one content-free day.
     * Idempotent upsert on (user_id, day) — the collector may re-send a day.
     */
    async ingest(req: IngestRequest, res: Response) {
        const userId = req.ingestUserId;
        const tokenId = req.ingestTokenId;
        if (!userId || !tokenId) return res.status(401).json({ error: 'Unauthenticated' });

        const tokenRow = await UsageIngestToken.findByPk(tokenId);
        if (!tokenRow) return res.status(401).json({ error: 'Unauthenticated' });

        let day: string;
        let metrics;
        let orgUuid: string | null;
        let orgName: string | null;
        let triggerTier: string | null;
        let vpnDeferrals: number | null;
        let vpnGate: VpnGateState | null;
        try {
            ({ day, orgUuid, orgName, triggerTier, vpnDeferrals, vpnGate, metrics } = validatePayload(req.body));
        } catch (e) {
            if (e instanceof PayloadError) {
                void ingestAuditLogService.record(req, { userId, tokenId, outcome: 'rejected-payload', httpStatus: 400 });
                return res.status(400).json({ error: 'Invalid payload', detail: e.message });
            }
            throw e;
        }

        // ADDENDUM 22: fleet-wide minimum collector version, checked before anything
        // else needs a DB transaction — this depends only on the global policy, not
        // on (userId, day) state, and there is no reason to hold the day-lock for a
        // request that's about to be rejected. A no-op unless an admin has BOTH set
        // a floor AND an effective date that has already passed (the grace window
        // for a rollout to reach everyone before enforcement begins). Root-fixes
        // 'ungated-collector': that flag is a pure version fact, and flag-forever
        // only works if people choose to update — this makes staying on an old
        // collector eventually stop working, once the fleet has had time to move.
        const versionCheck = await collectorVersionPolicyService.shouldReject(metrics.collectorVersion);
        if (versionCheck.reject) {
            void ingestAuditLogService.record(req, {
                userId, tokenId, outcome: 'rejected-outdated-collector', httpStatus: 426,
                day, orgUuid, collectorVersion: metrics.collectorVersion, vpnGate,
            });
            return res.status(426).json({
                error: 'collector-outdated',
                message: `Your collector (${metrics.collectorVersion}) is below the required version `
                    + `(${versionCheck.minEnforcedVersion}). Re-run the installer to update — see Lens > `
                    + `My Claude Report > How it works & consent.`,
                minEnforcedVersion: versionCheck.minEnforcedVersion,
            });
        }

        // ADDENDUM 25: acquire a transaction-scoped advisory lock for THIS (userId, day)
        // before even checking the rate limit — serializes two near-simultaneous requests
        // for the same day (e.g. the scheduler and the session-end hook firing together)
        // so the second one waits here and then correctly sees "already accepted" instead
        // of both reading "not yet accepted" and both getting through. Auto-released on
        // commit or rollback below, whichever exit path is taken — never leaked.
        const t = await sequelize.transaction();
        let settled = false; // guards the catch-block rollback below from double-finishing `t`
        try {
            await ingestRateLimitService.acquireDayLock(t, userId, day);

            // Server-side rate limit (ADDENDUM 11 Phase 1, per-day since ADDENDUM 16) — the
            // authoritative gate. Client-side interval checks are only an optimization the
            // collector can always be edited to skip; this cannot be bypassed regardless of
            // what the client sends or how the request was constructed. Scoped to THIS day
            // (not globally per user) so a legitimate multi-day backlog can all push through
            // in one run, while still blocking repeated pushes of the SAME day. Reads inside
            // the same lock-holding transaction, so this check is now race-free.
            const rate = await ingestRateLimitService.checkAllowed(userId, day, tokenRow, t);
            if (!rate.allowed) {
                settled = true;
                await t.rollback();
                void ingestAuditLogService.record(req, {
                    userId, tokenId, outcome: 'rejected-rate-limit', httpStatus: 429,
                    day, orgUuid, collectorVersion: metrics.collectorVersion, vpnGate,
                });
                res.setHeader('Retry-After', String((rate.retryAfterMinutes || 1) * 60));
                return res.status(429).json({
                    error: 'rate-limited',
                    message: `Too soon since the last accepted ingest for this day (minimum ${rate.effectiveMinutes} minutes).`,
                    retryAfterMinutes: rate.retryAfterMinutes,
                });
            }

            // Integrity — hard arithmetic identities. A violation is impossible for honest
            // data, so reject the row and store nothing (detect + deter, ADDENDUM 5).
            const hardErrors = checkIntegrity(metrics, day);
            if (hardErrors.length) {
                settled = true;
                await t.rollback();
                void ingestAuditLogService.record(req, {
                    userId, tokenId, outcome: 'rejected-integrity', httpStatus: 400,
                    day, orgUuid, collectorVersion: metrics.collectorVersion, payload: metrics as any, vpnGate,
                });
                return res.status(400).json({
                    error: 'integrity-violation',
                    message: 'Payload failed integrity checks (impossible values).',
                    detail: hardErrors,
                });
            }

            // Multi-customer scoping: only accept data from an ENABLED monitored org.
            // Unseen orgs are recorded as pending (disabled) for an admin to review.
            if (config.collector.requireOrg) {
                if (!orgUuid) {
                    settled = true;
                    await t.rollback();
                    void ingestAuditLogService.record(req, {
                        userId, tokenId, outcome: 'rejected-org-required', httpStatus: 403,
                        day, collectorVersion: metrics.collectorVersion, payload: metrics as any, vpnGate,
                    });
                    return res.status(403).json({
                        error: 'org-required',
                        message: 'No Claude organization on this machine — cannot attribute to a monitored customer license.',
                    });
                }
                await monitoredOrgService.upsertSeen(orgUuid, orgName);
                if (!(await monitoredOrgService.isEnabled(orgUuid))) {
                    settled = true;
                    await t.rollback();
                    void ingestAuditLogService.record(req, {
                        userId, tokenId, outcome: 'rejected-org-not-monitored', httpStatus: 403,
                        day, orgUuid, collectorVersion: metrics.collectorVersion, payload: metrics as any, vpnGate,
                    });
                    return res.status(403).json({
                        error: 'org-not-monitored',
                        message: 'This Claude organization is not enabled for monitoring.',
                    });
                }
            } else if (orgUuid) {
                await monitoredOrgService.upsertSeen(orgUuid, orgName);
            }

            const scalars = deriveScalars(metrics);
            const active = await pricingService.getActive();
            const activeVersionId = active ? Number(active.id) : null;

            // Anomaly flags (plausibility) — FLAG only, never block. Compare against the
            // user's trailing window of prior days to catch regime shifts.
            const priorRows = await ClaudeUsageDaily.findAll({
                where: { userId, day: { [Op.lt]: day } },
                order: [['day', 'DESC']],
                limit: 14,
            });
            const history: HistoryPoint[] = priorRows.map((r) => ({
                avgScore: dayAvgScore(r.metrics),
                totalTokens: totalTokens(r.metrics),
                totalPrompts: r.metrics.prompts.total,
            }));
            const flags = detectAnomalies(metrics, history, vpnGate);
            const integrityStatus = flags.length ? 'flagged' : 'ok';
            const receivedAt = new Date();

            const existing = await ClaudeUsageDaily.findOne({ where: { userId, day }, transaction: t });
            if (existing) {
                // Keep the pricing version stamped at first ingest — cost stays frozen.
                // Only fill it in if a legacy row never had one.
                await existing.update({
                    metrics,
                    collectorVersion: metrics.collectorVersion,
                    pricingVersionId: existing.pricingVersionId ?? activeVersionId,
                    orgUuid: orgUuid ?? existing.orgUuid,
                    integrityStatus,
                    integrityFlags: flags,
                    // Keep the last known tier if this payload predates the field.
                    triggerTier: triggerTier ?? existing.triggerTier,
                    vpnDeferrals: vpnDeferrals ?? existing.vpnDeferrals,
                    receivedAt,
                    ...scalars,
                }, { transaction: t });
            } else {
                await ClaudeUsageDaily.create({
                    userId,
                    day,
                    metrics,
                    collectorVersion: metrics.collectorVersion,
                    pricingVersionId: activeVersionId,
                    orgUuid,
                    integrityStatus,
                    integrityFlags: flags,
                    triggerTier,
                    vpnDeferrals,
                    receivedAt,
                    ...scalars,
                } as any, { transaction: t });
            }

            settled = true;
            await t.commit();

            void ingestAuditLogService.record(req, {
                userId, tokenId, outcome: 'accepted', httpStatus: 200,
                day, orgUuid, collectorVersion: metrics.collectorVersion, payload: metrics as any, vpnGate,
            });
            return res.status(200).json({ success: true, day, integrityStatus, flags: flags.length });
        } catch (err) {
            if (!settled) await t.rollback();
            throw err;
        }
    },
};
