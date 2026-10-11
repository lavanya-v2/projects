/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { LeadReview } from '../../../models/LeadReview';
import { LeadReviewRating } from '../../../models/LeadReviewRating';
import { CompetencyTemplate } from '../../../models/CompetencyTemplate';
import { CompetencyTemplateItem } from '../../../models/CompetencyTemplateItem';
import { ReviewCycle } from '../../../models/ReviewCycle';
import { ReviewCycleParticipant } from '../../../models/ReviewCycleParticipant';
import { ReviewStatusHistory } from '../../../models/ReviewStatusHistory';
import { TeamMember } from '../../../models/TeamMember';
import * as leadReviewService from '../services/leadReviewService';
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

const roleOf = (user: any): string =>
    user?.roleName ?? (user?.role === 'SUPERUSER' ? 'superuser' : 'member');

/** Resolve what this user may do with a specific review. */
async function permissionsFor(review: LeadReview, user: any) {
    const cycle = await ReviewCycle.findByPk(review.reviewCycleId);
    if (!cycle) return null;

    const scopeProjectIds = await resolveScopeProjectIds(cycle);
    const permitted = await resolvePermittedProjectIds(user.id);
    return resolveReviewPermissions(
        { id: user.id, roleName: roleOf(user) },
        {
            scopeProjectIds,
            cycleStatus: cycle.status,
            reviewerUserId: review.reviewerUserId,
            reviewStatus: review.status,
        },
        permitted,
    );
}

function handleError(res: Response, error: unknown, fallback: string) {
    if (error instanceof leadReviewService.ReviewValidationError) {
        return res.status(422).json({ message: error.message, problems: error.problems });
    }
    if (error instanceof leadReviewService.ImmutableReviewError) {
        return res.status(409).json({ message: error.message });
    }
    const message = error instanceof Error ? error.message : fallback;
    if (/not found|no longer exists/i.test(message)) return res.status(404).json({ message });
    if (/Only a|Only the|must state|does not belong|not a participant|No active competency/i.test(message)) {
        return res.status(400).json({ message });
    }
    console.error(`[leadReview] ${fallback}:`, error);
    return res.status(500).json({ message: fallback });
}

export const leadReviewController = {
    /** The reviewer's worklist for a cycle. Managers and above see everyone's. */
    async listForCycle(req: AuthRequest, res: Response) {
        const cycleId = parseId(req.params.cycleId);
        if (!cycleId) return res.status(400).json({ message: 'Invalid cycleId' });

        try {
            const cycle = await ReviewCycle.findByPk(cycleId);
            if (!cycle) return res.status(404).json({ message: 'Review cycle not found' });

            const scopeProjectIds = await resolveScopeProjectIds(cycle);
            const permitted = await resolvePermittedProjectIds(req.user!.id);
            const perms = resolveReviewPermissions(
                { id: req.user!.id, roleName: roleOf(req.user) },
                { scopeProjectIds, cycleStatus: cycle.status },
                permitted,
            );
            if (!perms.canViewCycle) return res.status(403).json({ message: 'Forbidden' });

            const participants = await ReviewCycleParticipant.findAll({
                where: {
                    reviewCycleId: cycleId,
                    isExcluded: false,
                    // A lead drafts privately, so they see only their own assignees.
                    ...(perms.canViewOthersReviews ? {} : { reviewerUserId: req.user!.id }),
                },
                include: [{ model: TeamMember, attributes: ['id', 'firstName', 'lastName', 'email'] }],
            });

            const reviews = await LeadReview.findAll({
                where: {
                    reviewCycleId: cycleId,
                    teamMemberId: { [Op.in]: participants.map(p => p.teamMemberId) },
                    status: { [Op.ne]: 'superseded' },
                },
            });
            const byMember = new Map(reviews.map(r => [r.teamMemberId, r]));

            return res.json(
                participants.map(p => ({
                    participantId: p.id,
                    teamMemberId: p.teamMemberId,
                    teamMember: (p as any).teamMember,
                    memberCategory: p.memberCategory,
                    reviewerUserId: p.reviewerUserId,
                    contributingProjectIds: p.contributingProjectIds,
                    review: byMember.get(p.teamMemberId) ?? null,
                })),
            );
        } catch (error) {
            return handleError(res, error, 'Failed to list lead reviews');
        }
    },

    /** Open (or lazily create) the draft for one participant. */
    async open(req: AuthRequest, res: Response) {
        const cycleId = parseId(req.params.cycleId);
        const teamMemberId = parseId(req.params.teamMemberId);
        if (!cycleId || !teamMemberId) return res.status(400).json({ message: 'Invalid ids' });

        try {
            const participant = await ReviewCycleParticipant.findOne({
                where: { reviewCycleId: cycleId, teamMemberId },
            });
            if (!participant) return res.status(404).json({ message: 'Participant not found in this cycle' });

            const cycle = await ReviewCycle.findByPk(cycleId);
            const scopeProjectIds = await resolveScopeProjectIds(cycle!);
            const permitted = await resolvePermittedProjectIds(req.user!.id);
            const perms = resolveReviewPermissions(
                { id: req.user!.id, roleName: roleOf(req.user) },
                {
                    scopeProjectIds,
                    cycleStatus: cycle!.status,
                    reviewerUserId: participant.reviewerUserId,
                },
                permitted,
            );
            if (!perms.canDraftReview && !perms.canViewOthersReviews) {
                return res.status(403).json({ message: 'Forbidden' });
            }
            if (!participant.reviewerUserId) {
                return res.status(400).json({
                    message: 'No reviewer has been assigned to this person yet',
                });
            }

            const review = await leadReviewService.getOrCreateDraft(
                cycleId,
                teamMemberId,
                participant.reviewerUserId,
            );
            return res.json(await hydrate(review.id));
        } catch (error) {
            return handleError(res, error, 'Failed to open the review');
        }
    },

    async get(req: AuthRequest, res: Response) {
        const reviewId = parseId(req.params.reviewId);
        if (!reviewId) return res.status(400).json({ message: 'Invalid reviewId' });

        try {
            const review = await LeadReview.findByPk(reviewId);
            if (!review) return res.status(404).json({ message: 'Review not found' });

            const perms = await permissionsFor(review, req.user);
            const isOwnReview = review.reviewerUserId === req.user!.id;
            if (!perms || (!isOwnReview && !perms.canViewOthersReviews)) {
                return res.status(403).json({ message: 'Forbidden' });
            }
            return res.json(await hydrate(reviewId));
        } catch (error) {
            return handleError(res, error, 'Failed to load the review');
        }
    },

    /** Autosave. */
    async save(req: AuthRequest, res: Response) {
        const reviewId = parseId(req.params.reviewId);
        if (!reviewId) return res.status(400).json({ message: 'Invalid reviewId' });

        try {
            const review = await LeadReview.findByPk(reviewId);
            if (!review) return res.status(404).json({ message: 'Review not found' });

            const perms = await permissionsFor(review, req.user);
            if (!perms?.canDraftReview) return res.status(403).json({ message: 'Forbidden' });

            await leadReviewService.saveDraft(reviewId, req.body ?? {});
            return res.json(await hydrate(reviewId));
        } catch (error) {
            return handleError(res, error, 'Failed to save the review');
        }
    },

    /** What still blocks submission. Lets the form show problems before trying. */
    async validate(req: AuthRequest, res: Response) {
        const reviewId = parseId(req.params.reviewId);
        if (!reviewId) return res.status(400).json({ message: 'Invalid reviewId' });

        try {
            const review = await LeadReview.findByPk(reviewId);
            if (!review) return res.status(404).json({ message: 'Review not found' });

            const perms = await permissionsFor(review, req.user);
            if (!perms?.canDraftReview && !perms?.canViewOthersReviews) {
                return res.status(403).json({ message: 'Forbidden' });
            }
            const problems = await leadReviewService.validateForSubmit(reviewId);
            return res.json({ ready: problems.length === 0, problems });
        } catch (error) {
            return handleError(res, error, 'Failed to validate the review');
        }
    },

    async submit(req: AuthRequest, res: Response) {
        const reviewId = parseId(req.params.reviewId);
        if (!reviewId) return res.status(400).json({ message: 'Invalid reviewId' });

        try {
            const review = await LeadReview.findByPk(reviewId);
            if (!review) return res.status(404).json({ message: 'Review not found' });

            const perms = await permissionsFor(review, req.user);
            if (!perms?.canSubmitReview) return res.status(403).json({ message: 'Forbidden' });

            await leadReviewService.submitReview(reviewId, req.user!.id);
            // A submitted review changes the composite, so the cycle is re-scored.
            await cycleService.recomputeCycle(review.reviewCycleId, 'manual').catch(() => undefined);
            return res.json(await hydrate(reviewId));
        } catch (error) {
            return handleError(res, error, 'Failed to submit the review');
        }
    },

    async publish(req: AuthRequest, res: Response) {
        const reviewId = parseId(req.params.reviewId);
        if (!reviewId) return res.status(400).json({ message: 'Invalid reviewId' });

        try {
            const review = await LeadReview.findByPk(reviewId);
            if (!review) return res.status(404).json({ message: 'Review not found' });

            const perms = await permissionsFor(review, req.user);
            if (!perms?.canPublishReview) return res.status(403).json({ message: 'Forbidden' });

            await leadReviewService.publishReview(reviewId, req.user!.id);
            return res.json(await hydrate(reviewId));
        } catch (error) {
            return handleError(res, error, 'Failed to publish the review');
        }
    },

    /** Correct a published review by superseding it. Reason required. */
    async revise(req: AuthRequest, res: Response) {
        const reviewId = parseId(req.params.reviewId);
        if (!reviewId) return res.status(400).json({ message: 'Invalid reviewId' });

        try {
            const review = await LeadReview.findByPk(reviewId);
            if (!review) return res.status(404).json({ message: 'Review not found' });

            const perms = await permissionsFor(review, req.user);
            // Correcting a record the member has already seen is a heavier act than
            // authoring one, so it takes publish rights rather than draft rights.
            if (!perms?.canPublishReview) return res.status(403).json({ message: 'Forbidden' });

            const revision = await leadReviewService.reviseReview(
                reviewId,
                String(req.body?.reason ?? ''),
                req.user!.id,
            );
            return res.status(201).json(await hydrate(revision.id));
        } catch (error) {
            return handleError(res, error, 'Failed to revise the review');
        }
    },

    /** Full audit trail for one review. */
    async history(req: AuthRequest, res: Response) {
        const reviewId = parseId(req.params.reviewId);
        if (!reviewId) return res.status(400).json({ message: 'Invalid reviewId' });

        try {
            const review = await LeadReview.findByPk(reviewId);
            if (!review) return res.status(404).json({ message: 'Review not found' });

            const perms = await permissionsFor(review, req.user);
            const isOwnReview = review.reviewerUserId === req.user!.id;
            if (!perms || (!isOwnReview && !perms.canViewOthersReviews)) {
                return res.status(403).json({ message: 'Forbidden' });
            }

            // Include the whole supersede chain, so a corrected review can always be
            // traced back to what the member originally saw.
            const chain: number[] = [reviewId];
            let cursor: LeadReview | null = review;
            while (cursor?.supersedesReviewId) {
                chain.push(cursor.supersedesReviewId);
                cursor = await LeadReview.findByPk(cursor.supersedesReviewId);
            }

            const history = await ReviewStatusHistory.findAll({
                where: { entityType: 'lead_review', entityId: { [Op.in]: chain } },
                order: [['changedAt', 'ASC']],
            });
            return res.json({ chain, history });
        } catch (error) {
            return handleError(res, error, 'Failed to load review history');
        }
    },
};

/** A review with its template, answers and validation state. */
async function hydrate(reviewId: number) {
    const review = await LeadReview.findByPk(reviewId, { include: [LeadReviewRating] });
    if (!review) throw new Error('Review not found');

    const template = await CompetencyTemplate.findByPk(review.templateId, {
        include: [CompetencyTemplateItem],
    });
    const items = (template?.items ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const problems = await leadReviewService.validateForSubmit(reviewId);

    return {
        review,
        template: template
            ? {
                  id: template.id,
                  name: template.name,
                  version: template.version,
                  ratingScaleMin: template.ratingScaleMin,
                  ratingScaleMax: template.ratingScaleMax,
                  ratingScaleLabels: template.ratingScaleLabels,
                  items,
              }
            : null,
        ratings: review.ratings ?? [],
        validation: { ready: problems.length === 0, problems },
    };
}
