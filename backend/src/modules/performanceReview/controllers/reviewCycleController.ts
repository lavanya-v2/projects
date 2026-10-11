/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { ReviewCycle, ReviewCycleStatus } from '../../../models/ReviewCycle';
import { ReviewCycleConfig } from '../../../models/ReviewCycleConfig';
import { ReviewCycleSource } from '../../../models/ReviewCycleSource';
import { ReviewCycleParticipant } from '../../../models/ReviewCycleParticipant';
import { TeamMember } from '../../../models/TeamMember';
import { Project } from '../../../models/Project';
import { PerfSprintSync } from '../../../models/PerfSprintSync';
import * as cycleService from '../services/reviewCycleService';
import { resolveReviewPermissions, resolvePermittedProjectIds } from '../services/reviewPermissions';
import { resolveScopeProjectIds } from '../services/cycleGenerationService';

interface AuthRequest extends Request {
    user?: any;
}

const parseId = (raw: unknown): number | null => {
    const id = parseInt(raw as string);
    return Number.isFinite(id) && id > 0 ? id : null;
};

const VALID_STATUSES: ReviewCycleStatus[] = ['scheduled', 'open', 'locked', 'published', 'archived'];

/** Load a cycle and resolve what this user may do with it. */
async function loadWithPermissions(cycleId: number, user: any) {
    const cycle = await ReviewCycle.findByPk(cycleId);
    if (!cycle) return { cycle: null, perms: null };

    const scopeProjectIds = await resolveScopeProjectIds(cycle);
    const permitted = await resolvePermittedProjectIds(user.id);
    const perms = resolveReviewPermissions(
        { id: user.id, roleName: user.roleName ?? (user.role === 'SUPERUSER' ? 'superuser' : 'member') },
        { scopeProjectIds, cycleStatus: cycle.status },
        permitted,
    );
    return { cycle, perms };
}

function handleError(res: Response, error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback;
    if (error instanceof cycleService.FrozenCycleError) return res.status(409).json({ message });
    if (/not found/i.test(message)) return res.status(404).json({ message });
    if (/Cannot (open|move)|not enabled|must total/i.test(message)) return res.status(400).json({ message });
    console.error(`[reviewCycle] ${fallback}:`, error);
    return res.status(500).json({ message: fallback });
}

export const reviewCycleController = {
    async list(req: AuthRequest, res: Response) {
        const accountId = parseId(req.query.accountId);
        if (!accountId) return res.status(400).json({ message: 'accountId is required' });

        try {
            const where: any = { accountId };
            if (req.query.year) where.reviewYear = String(req.query.year);

            // Forward-only by default (Phase 12c): an account with a `setupDate`
            // hides periods that had already CLOSED before it, unless explicitly
            // asked to include them. Filtering on `endDate` rather than
            // `startDate` matters: setup rarely happens exactly on a period
            // boundary, so the period actually in progress on the day of setup
            // has a `startDate` before `setupDate` by definition — filtering on
            // `startDate` would hide the very period being set up in. `endDate
            // >= setupDate` is the honest test for "still relevant", covering
            // both the in-progress period and everything forward. Accounts with
            // no `setupDate` (set up before this existed) are unaffected.
            const includeHistorical = req.query.includeHistorical === 'true';
            if (!includeHistorical) {
                const config = await ReviewCycleConfig.findOne({ where: { accountId }, attributes: ['setupDate'] });
                if (config?.setupDate) {
                    where.endDate = { [Op.gte]: config.setupDate };
                }
            }

            const cycles = await ReviewCycle.findAll({
                where,
                order: [['startDate', 'DESC']],
            });

            // Scope the list to cycles the caller can actually see.
            const permitted = await resolvePermittedProjectIds(req.user!.id);
            const roleName = req.user!.roleName ?? (req.user!.role === 'SUPERUSER' ? 'superuser' : 'member');
            const visible = [];
            for (const c of cycles) {
                const scopeProjectIds = await resolveScopeProjectIds(c);
                const perms = resolveReviewPermissions(
                    { id: req.user!.id, roleName },
                    { scopeProjectIds, cycleStatus: c.status },
                    permitted,
                );
                if (perms.canViewCycle) visible.push(c);
            }
            return res.json(visible);
        } catch (error) {
            return handleError(res, error, 'Failed to list review cycles');
        }
    },

    async get(req: AuthRequest, res: Response) {
        const cycleId = parseId(req.params.cycleId);
        if (!cycleId) return res.status(400).json({ message: 'Invalid cycleId' });

        try {
            const { cycle, perms } = await loadWithPermissions(cycleId, req.user);
            if (!cycle) return res.status(404).json({ message: 'Review cycle not found' });
            if (!perms!.canViewCycle) return res.status(403).json({ message: 'Forbidden' });
            return res.json({ cycle, permissions: perms });
        } catch (error) {
            return handleError(res, error, 'Failed to load review cycle');
        }
    },

    async transition(req: AuthRequest, res: Response) {
        const cycleId = parseId(req.params.cycleId);
        if (!cycleId) return res.status(400).json({ message: 'Invalid cycleId' });

        const toStatus = req.body?.toStatus as ReviewCycleStatus;
        if (!VALID_STATUSES.includes(toStatus)) {
            return res.status(400).json({ message: `toStatus must be one of ${VALID_STATUSES.join(', ')}` });
        }

        try {
            const { cycle, perms } = await loadWithPermissions(cycleId, req.user);
            if (!cycle) return res.status(404).json({ message: 'Review cycle not found' });

            const roleName = req.user!.roleName ?? (req.user!.role === 'SUPERUSER' ? 'superuser' : 'member');
            // Publishing is the one-way door that makes scores visible to members,
            // so it stays superuser-only regardless of the general transition right.
            if (toStatus === 'published' && roleName !== 'superuser') {
                return res.status(403).json({ message: 'Only a superuser may publish a review cycle' });
            }
            // Cancelling a never-opened period is the same tier of decision as
            // generating one in the first place.
            if (toStatus === 'archived' && cycle.status === 'scheduled' && roleName !== 'superuser') {
                return res.status(403).json({ message: 'Only a superuser may cancel a scheduled review period' });
            }
            if (!perms!.canTransitionCycle && roleName !== 'superuser') {
                return res.status(403).json({ message: 'Forbidden' });
            }

            const updated = await cycleService.transitionCycle(
                cycleId,
                toStatus,
                req.body?.note ?? null,
                req.user!.id,
            );
            return res.json(updated);
        } catch (error) {
            return handleError(res, error, 'Failed to transition review cycle');
        }
    },

    async recompute(req: AuthRequest, res: Response) {
        const cycleId = parseId(req.params.cycleId);
        if (!cycleId) return res.status(400).json({ message: 'Invalid cycleId' });

        try {
            const { cycle, perms } = await loadWithPermissions(cycleId, req.user);
            if (!cycle) return res.status(404).json({ message: 'Review cycle not found' });
            if (!perms!.canRecompute) return res.status(403).json({ message: 'Forbidden' });

            const result = await cycleService.recomputeCycle(cycleId, 'manual');
            return res.json(result);
        } catch (error) {
            return handleError(res, error, 'Failed to recompute review cycle');
        }
    },

    async listSources(req: AuthRequest, res: Response) {
        const cycleId = parseId(req.params.cycleId);
        if (!cycleId) return res.status(400).json({ message: 'Invalid cycleId' });

        try {
            const { cycle, perms } = await loadWithPermissions(cycleId, req.user);
            if (!cycle) return res.status(404).json({ message: 'Review cycle not found' });
            if (!perms!.canViewCycle) return res.status(403).json({ message: 'Forbidden' });

            const sources = await ReviewCycleSource.findAll({
                where: { reviewCycleId: cycleId },
                include: [
                    { model: Project, attributes: ['id', 'name'] },
                    { model: PerfSprintSync, attributes: ['id', 'sprintName', 'periodLabel', 'startDate', 'endDate'] },
                ],
                order: [['projectId', 'ASC'], ['id', 'ASC']],
            });
            return res.json(sources);
        } catch (error) {
            return handleError(res, error, 'Failed to list cycle sources');
        }
    },

    /** Include or exclude one attached source, with a recorded reason. */
    async updateSource(req: AuthRequest, res: Response) {
        const cycleId = parseId(req.params.cycleId);
        const sourceId = parseId(req.params.sourceId);
        if (!cycleId || !sourceId) return res.status(400).json({ message: 'Invalid ids' });

        try {
            const { cycle, perms } = await loadWithPermissions(cycleId, req.user);
            if (!cycle) return res.status(404).json({ message: 'Review cycle not found' });
            if (!perms!.canManageSources) return res.status(403).json({ message: 'Forbidden' });

            const source = await ReviewCycleSource.findOne({
                where: { id: sourceId, reviewCycleId: cycleId },
            });
            if (!source) return res.status(404).json({ message: 'Source not found on this cycle' });

            const excluded = !!req.body?.excluded;
            // Excluding a sprint changes an HR score, so the reason is required.
            if (excluded && !String(req.body?.reason || '').trim()) {
                return res.status(400).json({ message: 'A reason is required when excluding a source' });
            }

            await source.update({
                excluded,
                exclusionReason: excluded ? String(req.body.reason).trim() : null,
                excludedByUserId: excluded ? req.user!.id : null,
            });

            await cycleService.recomputeCycle(cycleId, 'manual');
            return res.json(source);
        } catch (error) {
            return handleError(res, error, 'Failed to update cycle source');
        }
    },

    async listParticipants(req: AuthRequest, res: Response) {
        const cycleId = parseId(req.params.cycleId);
        if (!cycleId) return res.status(400).json({ message: 'Invalid cycleId' });

        try {
            const { cycle, perms } = await loadWithPermissions(cycleId, req.user);
            if (!cycle) return res.status(404).json({ message: 'Review cycle not found' });
            if (!perms!.canViewCycle) return res.status(403).json({ message: 'Forbidden' });

            const participants = await ReviewCycleParticipant.findAll({
                where: { reviewCycleId: cycleId },
                include: [{ model: TeamMember, attributes: ['id', 'firstName', 'lastName', 'email'] }],
            });
            return res.json(participants);
        } catch (error) {
            return handleError(res, error, 'Failed to list participants');
        }
    },

    /** Who could plausibly review each participant, scoped to their contributing projects. */
    async eligibleReviewers(req: AuthRequest, res: Response) {
        const cycleId = parseId(req.params.cycleId);
        if (!cycleId) return res.status(400).json({ message: 'Invalid cycleId' });

        try {
            const { cycle, perms } = await loadWithPermissions(cycleId, req.user);
            if (!cycle) return res.status(404).json({ message: 'Review cycle not found' });
            if (!perms!.canViewCycle) return res.status(403).json({ message: 'Forbidden' });

            return res.json(await cycleService.getEligibleReviewers(cycleId));
        } catch (error) {
            return handleError(res, error, 'Failed to resolve eligible reviewers');
        }
    },

    /** Assign a reviewer, or exclude someone from the cycle. */
    async updateParticipant(req: AuthRequest, res: Response) {
        const participantId = parseId(req.params.participantId);
        if (!participantId) return res.status(400).json({ message: 'Invalid participantId' });

        try {
            const participant = await ReviewCycleParticipant.findByPk(participantId);
            if (!participant) return res.status(404).json({ message: 'Participant not found' });

            const { cycle, perms } = await loadWithPermissions(participant.reviewCycleId, req.user);
            if (!cycle) return res.status(404).json({ message: 'Review cycle not found' });
            if (!perms!.canAssignReviewers) return res.status(403).json({ message: 'Forbidden' });

            const patch: any = {};
            if ('reviewerUserId' in (req.body ?? {})) {
                patch.reviewerUserId = req.body.reviewerUserId === null ? null : parseId(req.body.reviewerUserId);
            }
            if ('isExcluded' in (req.body ?? {})) {
                patch.isExcluded = !!req.body.isExcluded;
                patch.exclusionReason = patch.isExcluded ? (req.body.exclusionReason ?? null) : null;
            }

            const updated = await cycleService.updateParticipant(participantId, patch);
            return res.json(updated);
        } catch (error) {
            return handleError(res, error, 'Failed to update participant');
        }
    },

    async scores(req: AuthRequest, res: Response) {
        const cycleId = parseId(req.params.cycleId);
        if (!cycleId) return res.status(400).json({ message: 'Invalid cycleId' });

        try {
            const { cycle, perms } = await loadWithPermissions(cycleId, req.user);
            if (!cycle) return res.status(404).json({ message: 'Review cycle not found' });
            // Deliberately gated on canViewCycle, not canViewMemberScore: a member
            // reaches their own score through /me/reviews, never through the roster.
            if (!perms!.canViewCycle) return res.status(403).json({ message: 'Forbidden' });

            return res.json(await cycleService.getCycleScores(cycleId));
        } catch (error) {
            return handleError(res, error, 'Failed to load cycle scores');
        }
    },
};
