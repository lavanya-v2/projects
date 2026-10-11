/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express';
import { Op } from 'sequelize';
import { LeadReview, MEMBER_VISIBLE_STATUS } from '../../../models/LeadReview';
import { LeadReviewRating } from '../../../models/LeadReviewRating';
import { CompetencyTemplate } from '../../../models/CompetencyTemplate';
import { CompetencyTemplateItem } from '../../../models/CompetencyTemplateItem';
import { ReviewCycle } from '../../../models/ReviewCycle';
import { ReviewCycleParticipant } from '../../../models/ReviewCycleParticipant';
import { ReviewMemberScore } from '../../../models/ReviewMemberScore';
import { TeamMember } from '../../../models/TeamMember';
import { User } from '../../../models/User';
import * as leadReviewService from '../services/leadReviewService';

interface AuthRequest extends Request {
    user?: any;
}

/**
 * The member's own view.
 *
 * Everything here is scoped to the caller's own team member record and to
 * PUBLISHED reviews only — a member must never reach another person's data, nor
 * see a review their lead is still drafting.
 */

/**
 * Resolve the caller to a roster row.
 *
 * Prefers the explicit `team_members.user_id` FK; falls back to the historical
 * case-insensitive email match for rows predating that column, mirroring
 * memberDashboardService.resolveMember().
 */
async function resolveTeamMember(user: any): Promise<TeamMember | null> {
    const byFk = await TeamMember.findOne({ where: { userId: user.id } });
    if (byFk) return byFk;

    const candidates = [user.userId, user.email].filter(Boolean).map((s: string) => s.toLowerCase());
    if (candidates.length === 0) return null;

    const all = await TeamMember.findAll();
    return (
        all.find(m => {
            const emails = [m.email, (m as any).partnerEmailId].filter(Boolean).map(s => String(s).toLowerCase());
            return emails.some(e => candidates.includes(e));
        }) ?? null
    );
}

export const memberReviewController = {
    /** Every published review for the caller, oldest first, with the score series. */
    async listMine(req: AuthRequest, res: Response) {
        try {
            const member = await resolveTeamMember(req.user);
            if (!member) {
                return res.json({ teamMember: null, reviews: [], trend: [] });
            }

            const reviews = await LeadReview.findAll({
                where: { teamMemberId: member.id, status: MEMBER_VISIBLE_STATUS },
                order: [['publishedAt', 'ASC']],
            });

            const cycleIds = [...new Set(reviews.map(r => r.reviewCycleId))];
            const cycles = cycleIds.length
                ? await ReviewCycle.findAll({ where: { id: { [Op.in]: cycleIds } } })
                : [];
            const cycleById = new Map(cycles.map(c => [c.id, c]));

            // Only scores from cycles that were actually published — an unpublished
            // cycle's numbers are not the member's to see.
            const scores = cycleIds.length
                ? await ReviewMemberScore.findAll({
                      where: {
                          teamMemberId: member.id,
                          reviewCycleId: { [Op.in]: cycleIds },
                          isPublished: true,
                      },
                  })
                : [];
            const scoreByCycle = new Map(scores.map(s => [s.reviewCycleId, s]));

            const trend = reviews.map(r => {
                const cycle = cycleById.get(r.reviewCycleId);
                const score = scoreByCycle.get(r.reviewCycleId);
                return {
                    reviewId: r.id,
                    cycleId: r.reviewCycleId,
                    periodLabel: cycle?.periodLabel ?? null,
                    startDate: cycle ? String(cycle.startDate).slice(0, 10) : null,
                    endDate: cycle ? String(cycle.endDate).slice(0, 10) : null,
                    composite: score?.compositeScore === null || score?.compositeScore === undefined
                        ? null
                        : Number(score.compositeScore),
                    systemScore: score?.systemScore === null || score?.systemScore === undefined
                        ? null
                        : Number(score.systemScore),
                    leadScore: score?.leadScore === null || score?.leadScore === undefined
                        ? null
                        : Number(score.leadScore),
                    overallCoverage: score?.overallCoverage === null || score?.overallCoverage === undefined
                        ? null
                        : Number(score.overallCoverage),
                    isProvisional: score?.isProvisional ?? true,
                    trendDirection: score?.trendDirection ?? 'na',
                    trendDelta: score?.trendDelta === null || score?.trendDelta === undefined
                        ? null
                        : Number(score.trendDelta),
                    acknowledgedAt: r.acknowledgedAt,
                };
            });

            return res.json({
                teamMember: { id: member.id, firstName: member.firstName, lastName: member.lastName },
                reviews,
                trend,
            });
        } catch (error) {
            console.error('[memberReview] listMine failed:', error);
            return res.status(500).json({ message: 'Failed to load your reviews' });
        }
    },

    /** One published review in full, including the evidence behind the score. */
    async getMine(req: AuthRequest, res: Response) {
        const cycleId = parseInt(req.params.cycleId as string);
        if (!Number.isFinite(cycleId)) return res.status(400).json({ message: 'Invalid cycleId' });

        try {
            const member = await resolveTeamMember(req.user);
            if (!member) return res.status(404).json({ message: 'No team member record found for you' });

            const review = await LeadReview.findOne({
                where: {
                    reviewCycleId: cycleId,
                    teamMemberId: member.id,
                    status: MEMBER_VISIBLE_STATUS,
                },
                include: [LeadReviewRating],
            });
            // 404 rather than 403 on an unpublished review: whether their lead has
            // started drafting is not the member's business either way.
            if (!review) return res.status(404).json({ message: 'No published review for that cycle' });

            const template = await CompetencyTemplate.findByPk(review.templateId, {
                include: [CompetencyTemplateItem],
            });
            const score = await ReviewMemberScore.findOne({
                where: { reviewCycleId: cycleId, teamMemberId: member.id, isPublished: true },
            });
            const reviewer = await User.findByPk(review.reviewerUserId, {
                attributes: ['id', 'firstName', 'lastName', 'userId'],
            });

            return res.json({
                review,
                reviewer,
                template: template
                    ? {
                          id: template.id,
                          name: template.name,
                          version: template.version,
                          ratingScaleMin: template.ratingScaleMin,
                          ratingScaleMax: template.ratingScaleMax,
                          ratingScaleLabels: template.ratingScaleLabels,
                          items: (template.items ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
                      }
                    : null,
                ratings: review.ratings ?? [],
                score,
                // The full drill-down: the delivery figures the lead rated against.
                evidence: review.evidenceSnapshot,
            });
        } catch (error) {
            console.error('[memberReview] getMine failed:', error);
            return res.status(500).json({ message: 'Failed to load the review' });
        }
    },

    /**
     * A small, dashboard-sized summary: the caller's latest published rating,
     * whether their own review is still pending for the current open cycle,
     * and — when they're also a reviewer — how many of their assigned reviews
     * are still unstarted. Reuses the exact participant+LeadReview join
     * `leadReviewController.listForCycle` already does, just narrowed to a
     * count/flag instead of a full worklist, so a dashboard card never has to
     * re-derive "pending" from scratch.
     */
    async pendingStatus(req: AuthRequest, res: Response) {
        try {
            const member = await resolveTeamMember(req.user);

            let memberStatus: any = null;
            if (member) {
                const openParticipant = await ReviewCycleParticipant.findOne({
                    where: { teamMemberId: member.id, isExcluded: false },
                    include: [{ model: ReviewCycle, as: 'cycle', where: { status: 'open' }, required: true }],
                });

                const latestReview = await LeadReview.findOne({
                    where: { teamMemberId: member.id, status: MEMBER_VISIBLE_STATUS },
                    order: [['publishedAt', 'DESC']],
                });
                const latestScore = latestReview
                    ? await ReviewMemberScore.findOne({
                          where: { teamMemberId: member.id, reviewCycleId: latestReview.reviewCycleId, isPublished: true },
                      })
                    : null;

                let hasPendingReview = false;
                let pendingCycle: { id: number; periodLabel: string } | null = null;
                if (openParticipant) {
                    const cycle = (openParticipant as any).cycle as ReviewCycle;
                    const publishedThisCycle = await LeadReview.findOne({
                        where: { teamMemberId: member.id, reviewCycleId: cycle.id, status: MEMBER_VISIBLE_STATUS },
                    });
                    if (!publishedThisCycle) {
                        hasPendingReview = true;
                        pendingCycle = { id: cycle.id, periodLabel: cycle.periodLabel };
                    }
                }

                memberStatus = {
                    hasPendingReview,
                    pendingCycle,
                    latestPublished: latestScore
                        ? {
                              periodLabel: (await ReviewCycle.findByPk(latestReview!.reviewCycleId))?.periodLabel ?? null,
                              compositeScore: latestScore.compositeScore === null ? null : Number(latestScore.compositeScore),
                          }
                        : null,
                };
            }

            // Lead-facing: how many currently-assigned reviews (this account's open
            // cycles) are still draft/unstarted. Never blocks anything — purely a
            // dashboard nudge, same "inform, don't gate" pattern as the rest of the
            // module.
            const assigned = await ReviewCycleParticipant.findAll({
                where: { reviewerUserId: req.user!.id, isExcluded: false },
                include: [{ model: ReviewCycle, as: 'cycle', where: { status: 'open' }, required: true }],
            });

            let leadStatus: any = null;
            if (assigned.length > 0) {
                const reviews = await LeadReview.findAll({
                    where: {
                        reviewerUserId: req.user!.id,
                        reviewCycleId: { [Op.in]: assigned.map(a => (a as any).reviewCycleId) },
                    },
                });
                const doneTeamMemberIds = new Set(
                    reviews.filter(r => r.status !== 'draft').map(r => `${r.reviewCycleId}:${r.teamMemberId}`),
                );
                const pendingCount = assigned.filter(
                    a => !doneTeamMemberIds.has(`${(a as any).reviewCycleId}:${a.teamMemberId}`),
                ).length;

                leadStatus = pendingCount > 0
                    ? { pendingCount, cycle: { id: (assigned[0] as any).cycle.id, periodLabel: (assigned[0] as any).cycle.periodLabel } }
                    : { pendingCount: 0, cycle: null };
            }

            return res.json({ member: memberStatus, lead: leadStatus });
        } catch (error) {
            console.error('[memberReview] pendingStatus failed:', error);
            return res.status(500).json({ message: 'Failed to load pending-review status' });
        }
    },

    /** Record that the member has seen their review. */
    async acknowledge(req: AuthRequest, res: Response) {
        const reviewId = parseInt(req.params.reviewId as string);
        if (!Number.isFinite(reviewId)) return res.status(400).json({ message: 'Invalid reviewId' });

        try {
            const member = await resolveTeamMember(req.user);
            if (!member) return res.status(404).json({ message: 'No team member record found for you' });

            const review = await leadReviewService.acknowledgeReview(
                reviewId,
                member.id,
                req.body?.comment ?? null,
            );
            return res.json(review);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to acknowledge';
            if (/Only the person/i.test(message)) return res.status(403).json({ message });
            if (/Only a published/i.test(message)) return res.status(400).json({ message });
            if (/not found/i.test(message)) return res.status(404).json({ message });
            console.error('[memberReview] acknowledge failed:', error);
            return res.status(500).json({ message: 'Failed to acknowledge the review' });
        }
    },
};
