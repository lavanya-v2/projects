/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import fs from 'fs';
import archiver from 'archiver';
import { Request, Response } from 'express';
import { config } from '../../../config';
import { collectorAuthService } from '../services/collectorAuthService';
import { claudeUsageReportService, resolveVisibleUserIds } from '../services/claudeUsageReportService';
import { User } from '../../../models/User';
import { enqueueCoaching } from '../queues/coachingQueue';
import { pilotService } from '../services/pilotService';
import { FEATURE_CLAUDE_USAGE } from '../../../models/FeaturePilot';
import { ClaudeUsageCoaching } from '../../../models/ClaudeUsageCoaching';

interface AuthRequest extends Request {
    user?: any;
}

// Minimum days between real AI coaching regenerations for one user (ADDENDUM 11
// Phase 2). Matches the 14-day rolling window coaching is derived from — no point
// regenerating more often than the underlying signals meaningfully shift, and this
// is the only endpoint that can trigger a real Anthropic API call on demand.
const COACHING_COOLDOWN_DAYS = 7;

const strParam = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;

export const memberUsageController = {
    // ---- access probe (drives whether the UI shows the feature at all) ----
    async getAccess(req: AuthRequest, res: Response) {
        try {
            const role = req.user?.role;
            const roleName = req.user?.roleName;
            const privileged = role === 'SUPERUSER' || roleName === 'admin';
            const enabled = privileged || (await pilotService.isEnabled(req.user.id, FEATURE_CLAUDE_USAGE));
            res.json({ success: true, data: { enabled } });
        } catch (error) {
            console.error('Error checking claude-usage access:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    // ---- report ----
    async getMyReport(req: AuthRequest, res: Response) {
        try {
            const data = await claudeUsageReportService.getMyReport(
                req.user,
                strParam(req.query.from),
                strParam(req.query.to),
            );
            res.json({ success: true, data });
        } catch (error) {
            console.error('Error building prompt report:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    // ---- ingest token ----
    async getToken(req: AuthRequest, res: Response) {
        try {
            const status = await collectorAuthService.tokenStatus(req.user.id);
            res.json({ success: true, data: status });
        } catch (error) {
            console.error('Error reading collector token:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async generateToken(req: AuthRequest, res: Response) {
        try {
            const { plaintext, lastFour } = await collectorAuthService.generateToken(req.user.id);
            res.json({ success: true, data: { token: plaintext, lastFour } });
        } catch (error) {
            console.error('Error generating collector token:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    // ---- consent ----
    async getConsent(req: AuthRequest, res: Response) {
        try {
            const status = await collectorAuthService.consentStatus(req.user.id);
            res.json({ success: true, data: status });
        } catch (error) {
            console.error('Error reading consent:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async recordConsent(req: AuthRequest, res: Response) {
        try {
            const text = strParam(req.body?.consentText);
            const hash = text ? crypto.createHash('sha256').update(text).digest('hex') : undefined;
            await collectorAuthService.recordConsent(req.user.id, hash);
            const status = await collectorAuthService.consentStatus(req.user.id);
            res.json({ success: true, data: status });
        } catch (error) {
            console.error('Error recording consent:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async revokeConsent(req: AuthRequest, res: Response) {
        try {
            await collectorAuthService.revokeConsent(req.user.id);
            res.json({ success: true });
        } catch (error) {
            console.error('Error revoking consent:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    // ---- opt-out: disable (revoke token + consent) ----
    async disable(req: AuthRequest, res: Response) {
        try {
            await Promise.all([
                collectorAuthService.revokeTokens(req.user.id),
                collectorAuthService.revokeConsent(req.user.id),
            ]);
            res.json({ success: true });
        } catch (error) {
            console.error('Error disabling collector:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async purge(req: AuthRequest, res: Response) {
        try {
            const deleted = await collectorAuthService.purgeUserData(req.user.id);
            res.json({ success: true, data: { deleted } });
        } catch (error) {
            console.error('Error purging collector data:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async refreshCoaching(req: AuthRequest, res: Response) {
        try {
            const existing = await ClaudeUsageCoaching.findOne({ where: { userId: req.user.id } });
            if (existing) {
                const cooldownMs = COACHING_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
                const elapsedMs = Date.now() - new Date(existing.generatedAt).getTime();
                if (elapsedMs < cooldownMs) {
                    const nextAvailableAt = new Date(new Date(existing.generatedAt).getTime() + cooldownMs);
                    return res.json({
                        success: true,
                        skipped: true,
                        message: 'Coaching is already up to date',
                        nextAvailableAt: nextAvailableAt.toISOString(),
                    });
                }
            }
            await enqueueCoaching(req.user.id);
            res.json({ success: true, message: 'Coaching refresh queued' });
        } catch (error) {
            console.error('Error queuing coaching refresh:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    // ---- download the collector as a zip ----
    async downloadCollector(_req: AuthRequest, res: Response) {
        const dir = config.collector.sourceDir;
        if (!fs.existsSync(dir)) {
            return res.status(404).json({ error: 'Collector package not found on server' });
        }
        res.attachment('claude-usage-collector.zip');
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => {
            console.error('collector zip error:', err);
            if (!res.headersSent) res.status(500).end();
        });
        archive.pipe(res);
        // Ship the source + installers, but never a machine's own config/outputs.
        archive.glob('**/*', {
            cwd: dir,
            ignore: ['config.json', 'outbox.json', 'dashboard.html', '.last-run', '.DS_Store', 'node_modules/**'],
            dot: false,
        });
        await archive.finalize();
    },

    // ---- meta (consent version, install hints) ----
    async getMeta(_req: AuthRequest, res: Response) {
        res.json({
            success: true,
            data: {
                consentVersion: config.collector.consentVersion,
            },
        });
    },
};

const intParam = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? parseInt(v, 10) : undefined;
    return n != null && Number.isFinite(n) ? n : undefined;
};

export const teamUsageController = {
    /**
     * A lead's click-through to ONE team member's usage detail (ADDENDUM 24).
     * Access is the exact same roster the Team members table itself is built
     * from — `resolveVisibleUserIds` — so a lead can never reach a member
     * outside their own project/account scope via a crafted URL.
     */
    async getMemberDetail(req: AuthRequest, res: Response) {
        try {
            const targetUserId = parseInt(req.params.userId as string, 10);
            if (!Number.isFinite(targetUserId)) {
                return res.status(400).json({ error: 'Invalid userId' });
            }

            const visibleIds = await resolveVisibleUserIds(req.user);
            if (!visibleIds.includes(targetUserId)) {
                return res.status(403).json({ error: 'not-visible', message: 'This member is outside your team.' });
            }

            const target = await User.findByPk(targetUserId);
            if (!target) return res.status(404).json({ error: 'Member not found' });

            const member = {
                name: `${target.firstName ?? ''} ${target.lastName ?? ''}`.trim() || target.userId,
                login: target.userId,
            };
            const data = await claudeUsageReportService.getMemberDetailForLead(
                targetUserId,
                member,
                strParam(req.query.from),
                strParam(req.query.to),
            );
            res.json({ success: true, data });
        } catch (error) {
            console.error('Error building member detail report:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },

    async getTeamReport(req: AuthRequest, res: Response) {
        try {
            const userIds = await resolveVisibleUserIds(req.user);
            const data = await claudeUsageReportService.getTeamReport(
                userIds,
                strParam(req.query.from),
                strParam(req.query.to),
                {
                    search: strParam(req.query.search),
                    page: intParam(req.query.page),
                    pageSize: intParam(req.query.pageSize),
                },
            );
            res.json({ success: true, data });
        } catch (error) {
            console.error('Error building team prompt report:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    },
};
