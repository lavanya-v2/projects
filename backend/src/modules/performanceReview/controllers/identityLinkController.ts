/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import * as identityService from '../services/identityResolutionService';
import { IdentitySource } from '../../../models/PerfIdentityLink';

// authMiddleware keeps AuthRequest local, so controllers declare their own —
// matching riskController and the other self-guarded modules.
interface AuthRequest extends Request {
    user?: any;
}

const VALID_SOURCES: IdentitySource[] = ['jira', 'excel', 'azure'];

function parseSource(raw: unknown): IdentitySource {
    const value = String(raw || 'jira');
    return (VALID_SOURCES as string[]).includes(value) ? (value as IdentitySource) : 'jira';
}

function parseProjectId(raw: unknown): number | null {
    const id = parseInt(raw as string);
    return Number.isFinite(id) && id > 0 ? id : null;
}

export const identityLinkController = {
    /** Unresolved roster members with ranked candidate identities, weakest match first. */
    async listUnresolved(req: AuthRequest, res: Response) {
        const projectId = parseProjectId(req.params.projectId);
        if (!projectId) return res.status(400).json({ message: 'Invalid projectId' });

        try {
            const source = parseSource(req.query.source);
            const [unresolved, coverage, availableIdentities] = await Promise.all([
                identityService.getUnresolvedMembers(projectId, source),
                identityService.getCoverage(projectId),
                identityService.listProjectIdentities(projectId, source),
            ]);
            return res.json({ coverage, unresolved, availableIdentities });
        } catch (error) {
            console.error('[identityLink] listUnresolved failed:', error);
            return res.status(500).json({ message: 'Failed to load identity links' });
        }
    },

    /** The go/no-go gate before a project's review cycles can be enabled. */
    async getCoverage(req: AuthRequest, res: Response) {
        const projectId = parseProjectId(req.params.projectId);
        if (!projectId) return res.status(400).json({ message: 'Invalid projectId' });

        try {
            return res.json(await identityService.getCoverage(projectId));
        } catch (error) {
            console.error('[identityLink] getCoverage failed:', error);
            return res.status(500).json({ message: 'Failed to compute identity coverage' });
        }
    },

    /** Re-run the matcher to propose links. Idempotent; never overwrites a decision. */
    async seed(req: AuthRequest, res: Response) {
        const projectId = parseProjectId(req.params.projectId);
        if (!projectId) return res.status(400).json({ message: 'Invalid projectId' });

        try {
            const source = parseSource(req.body?.source);
            const result = await identityService.seedSuggestions(projectId, source);
            return res.json({ ...result, coverage: await identityService.getCoverage(projectId) });
        } catch (error) {
            console.error('[identityLink] seed failed:', error);
            return res.status(500).json({ message: 'Failed to seed identity suggestions' });
        }
    },

    /** Confirm or reject a suggestion, optionally repointing it to another member. */
    async decide(req: AuthRequest, res: Response) {
        const linkId = parseInt(req.params.id as string);
        if (!Number.isFinite(linkId)) return res.status(400).json({ message: 'Invalid link id' });

        const decision = req.body?.decision;
        if (decision !== 'confirm' && decision !== 'reject') {
            return res.status(400).json({ message: "decision must be 'confirm' or 'reject'" });
        }

        try {
            const result = await identityService.decideLink(
                linkId,
                decision,
                req.user!.id,
                req.body?.teamMemberId ? parseInt(req.body.teamMemberId) : undefined,
            );
            return res.json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update identity link';
            const status = message.includes('not found') ? 404 : 500;
            if (status === 500) console.error('[identityLink] decide failed:', error);
            return res.status(status).json({ message });
        }
    },

    /** Link an identity the matcher could not resolve at all. */
    async createManual(req: AuthRequest, res: Response) {
        const projectId = parseProjectId(req.body?.projectId);
        const teamMemberId = parseInt(req.body?.teamMemberId);
        const sourceKey = String(req.body?.sourceKey || '').trim();

        if (!projectId || !Number.isFinite(teamMemberId) || !sourceKey) {
            return res.status(400).json({ message: 'projectId, teamMemberId and sourceKey are required' });
        }

        try {
            const result = await identityService.createManualLink(
                projectId,
                teamMemberId,
                parseSource(req.body?.source),
                sourceKey,
                req.body?.sourceDisplayName || null,
                req.user!.id,
            );
            return res.status(201).json(result);
        } catch (error) {
            console.error('[identityLink] createManual failed:', error);
            return res.status(500).json({ message: 'Failed to create identity link' });
        }
    },

    /** Mark an identity as not a reviewable team member (client staff, service accounts). */
    async reject(req: AuthRequest, res: Response) {
        const projectId = parseProjectId(req.body?.projectId);
        const sourceKey = String(req.body?.sourceKey || '').trim();
        if (!projectId || !sourceKey) {
            return res.status(400).json({ message: 'projectId and sourceKey are required' });
        }

        try {
            const link = await identityService.rejectIdentity(
                projectId,
                parseSource(req.body?.source),
                sourceKey,
                req.body?.sourceDisplayName || null,
                req.user!.id,
            );
            return res.json({ link, coverage: await identityService.getCoverage(projectId) });
        } catch (error) {
            console.error('[identityLink] reject failed:', error);
            return res.status(500).json({ message: 'Failed to reject identity' });
        }
    },

    /** Confirm all unambiguous suggestions at once, so review goes to the uncertain ones. */
    async bulkConfirm(req: AuthRequest, res: Response) {
        const projectId = parseProjectId(req.params.projectId);
        if (!projectId) return res.status(400).json({ message: 'Invalid projectId' });

        try {
            const minConfidence =
                req.body?.minConfidence !== undefined ? Number(req.body.minConfidence) : undefined;
            if (minConfidence !== undefined && !Number.isFinite(minConfidence)) {
                return res.status(400).json({ message: 'minConfidence must be a number' });
            }

            const result = await identityService.bulkConfirm(projectId, req.user!.id, minConfidence);
            return res.json({ ...result, coverage: await identityService.getCoverage(projectId) });
        } catch (error) {
            console.error('[identityLink] bulkConfirm failed:', error);
            return res.status(500).json({ message: 'Failed to bulk-confirm identity links' });
        }
    },

    /** Re-apply confirmed links to historical perf rows. Idempotent. */
    async backfill(req: AuthRequest, res: Response) {
        const projectId = parseProjectId(req.params.projectId);
        if (!projectId) return res.status(400).json({ message: 'Invalid projectId' });

        try {
            const result = await identityService.backfillProject(projectId);
            return res.json({ ...result, coverage: await identityService.getCoverage(projectId) });
        } catch (error) {
            console.error('[identityLink] backfill failed:', error);
            return res.status(500).json({ message: 'Failed to backfill identity links' });
        }
    },
};
