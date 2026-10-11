import { Op } from 'sequelize';
import { ReviewCycle } from '../../../models/ReviewCycle';
import { ReviewCycleParticipant } from '../../../models/ReviewCycleParticipant';
import { ReviewMemberScore } from '../../../models/ReviewMemberScore';
import { LeadReview } from '../../../models/LeadReview';
import { LeadReviewRating } from '../../../models/LeadReviewRating';
import { TeamMember } from '../../../models/TeamMember';
import { User } from '../../../models/User';
import { resolvePermittedProjectIds } from './reviewPermissions';

/**
 * A lead's view of one team member across every review period they have ever
 * been part of — including periods before they joined this lead's team.
 *
 * The confidentiality boundary is the whole point of this file: a period
 * reviewed by a DIFFERENT lead exposes only the numbers (composite/system/lead
 * scores, coverage, trend) — never the narrative, per-competency ratings, or
 * comments that lead wrote. Own-authored periods are unredacted, exactly as the
 * worklist already shows. Managers and above see everything, unredacted, matching
 * their existing `canViewOthersReviews` standing elsewhere in this module.
 */

const PRIVILEGED_ROLES = new Set(['superuser', 'admin', 'manager']);

export class TeamMemberHistoryForbiddenError extends Error {
    constructor() {
        super('You may only view the history of people currently assigned to you');
        this.name = 'TeamMemberHistoryForbiddenError';
    }
}

export class TeamMemberNotFoundError extends Error {
    constructor(teamMemberId: number) {
        super(`Team member ${teamMemberId} not found`);
        this.name = 'TeamMemberNotFoundError';
    }
}

export interface HistoryScore {
    systemScore: number | null;
    leadScore: number | null;
    compositeScore: number | null;
    overallCoverage: number | null;
    isProvisional: boolean;
    trendDirection: string;
    trendDelta: number | null;
    systemPresent: boolean;
    leadPresent: boolean;
}

/** A review authored by someone other than the caller — numbers only, nothing written. */
export interface RedactedReview {
    redacted: true;
    reviewerName: string | null;
    status: string;
}

/** A review the caller may read in full — their own, or the caller outranks authorship entirely. */
export interface FullReview {
    redacted: false;
    reviewerName: string | null;
    status: string;
    normalizedScore: number | null;
    strengths: string | null;
    improvements: string | null;
    overallComment: string | null;
    ratings: Array<{
        templateItemId: number;
        rating: number | null;
        textValue: string | null;
        comment: string | null;
        na: boolean;
    }>;
}

export interface HistoryCycle {
    cycleId: number;
    periodLabel: string;
    startDate: string;
    endDate: string;
    status: string;
    contributingProjectIds: number[];
    score: HistoryScore | null;
    review: RedactedReview | FullReview | null;
}

export interface TeamMemberHistory {
    teamMember: { id: number; firstName: string; lastName: string };
    cycles: HistoryCycle[];
}

const scoreView = (s: ReviewMemberScore): HistoryScore => ({
    systemScore: s.systemScore === null ? null : Number(s.systemScore),
    leadScore: s.leadScore === null ? null : Number(s.leadScore),
    compositeScore: s.compositeScore === null ? null : Number(s.compositeScore),
    overallCoverage: s.overallCoverage === null ? null : Number(s.overallCoverage),
    isProvisional: s.isProvisional,
    trendDirection: s.trendDirection,
    trendDelta: s.trendDelta === null ? null : Number(s.trendDelta),
    systemPresent: s.systemPresent,
    leadPresent: s.leadPresent,
});

/**
 * Full history for one team member, authorized and redacted for `requestingUser`.
 *
 * Authorization for a lead is against the MOST RECENT cycle this person appears
 * in, anywhere — "my current team" is dynamic, not a static roster, so whoever a
 * lead is assigned to review right now is who they may open. Everything returned
 * beyond that gate is scoped to the SAME account as that most recent cycle: a
 * lead with access only in Account 1 must never reach this person's Account 2
 * history through this path, even if somehow assigned to them long ago.
 */
export async function getTeamMemberHistory(
    teamMemberId: number,
    requestingUser: { id: number; roleName: string },
): Promise<TeamMemberHistory> {
    const teamMember = await TeamMember.findByPk(teamMemberId);
    if (!teamMember) throw new TeamMemberNotFoundError(teamMemberId);

    const empty: TeamMemberHistory = {
        teamMember: { id: teamMember.id, firstName: teamMember.firstName, lastName: teamMember.lastName },
        cycles: [],
    };

    const allParticipations = await ReviewCycleParticipant.findAll({
        where: { teamMemberId },
        include: [{ model: ReviewCycle, required: true }],
    });
    if (allParticipations.length === 0) {
        // Never part of any review cycle anywhere. A privileged caller gets an
        // honestly empty result — there is genuinely nothing to show. A lead does
        // NOT: "never reviewed by anyone" also means "not currently assigned to
        // me", so the authorization check must still apply. Without this, a lead
        // could enumerate arbitrary team member ids and get 200-with-nothing
        // instead of a 403, which leaks "this id exists and has no history" to
        // someone who was never granted any standing over this person at all.
        if (!PRIVILEGED_ROLES.has(requestingUser.roleName)) throw new TeamMemberHistoryForbiddenError();
        return empty;
    }

    const byRecency = [...allParticipations].sort(
        (a, b) => String((b as any).cycle.startDate).localeCompare(String((a as any).cycle.startDate)),
    );
    const latest = byRecency[0];
    const currentCycle = (latest as any).cycle as ReviewCycle;
    const accountId = currentCycle.accountId;

    const privileged = PRIVILEGED_ROLES.has(requestingUser.roleName);
    if (!privileged) {
        if (requestingUser.roleName !== 'lead') throw new TeamMemberHistoryForbiddenError();

        const permitted = await resolvePermittedProjectIds(requestingUser.id);
        const scope = currentCycle.scopeProjectIds ?? [];
        const hasOverlap = scope.length === 0 || scope.some(id => permitted.includes(id));
        const isCurrentReviewer = latest.reviewerUserId === requestingUser.id;

        if (!hasOverlap || !isCurrentReviewer) throw new TeamMemberHistoryForbiddenError();
    }

    // Everything below is scoped to accountId — the cross-account boundary.
    const cycles = await ReviewCycle.findAll({ where: { accountId }, order: [['startDate', 'ASC']] });
    const cycleIds = cycles.map(c => c.id);
    if (cycleIds.length === 0) return empty;

    const [participants, scores, reviews] = await Promise.all([
        ReviewCycleParticipant.findAll({
            where: { teamMemberId, reviewCycleId: { [Op.in]: cycleIds } },
        }),
        ReviewMemberScore.findAll({
            where: { teamMemberId, reviewCycleId: { [Op.in]: cycleIds } },
        }),
        LeadReview.findAll({
            where: { teamMemberId, reviewCycleId: { [Op.in]: cycleIds }, status: { [Op.ne]: 'superseded' } },
            include: [LeadReviewRating],
        }),
    ]);

    const participantByCycle = new Map(participants.map(p => [p.reviewCycleId, p]));
    const scoreByCycle = new Map(scores.map(s => [s.reviewCycleId, s]));
    const reviewByCycle = new Map(reviews.map(r => [r.reviewCycleId, r]));

    const reviewerIds = [...new Set(reviews.map(r => r.reviewerUserId))];
    const reviewers = reviewerIds.length
        ? await User.findAll({ where: { id: { [Op.in]: reviewerIds } }, attributes: ['id', 'firstName', 'lastName'] })
        : [];
    const reviewerNameById = new Map(reviewers.map(u => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

    const historyCycles: HistoryCycle[] = [];
    for (const cycle of cycles) {
        const participant = participantByCycle.get(cycle.id);
        // This person wasn't part of the roster in this particular cycle — e.g. a
        // period before they joined any project in this account. Skip it rather
        // than show a hole; it was never theirs to have a score in.
        if (!participant) continue;

        const score = scoreByCycle.get(cycle.id);
        const review = reviewByCycle.get(cycle.id);

        let reviewPayload: RedactedReview | FullReview | null = null;
        if (review) {
            const reviewerName = reviewerNameById.get(review.reviewerUserId) ?? null;
            const mayReadInFull = privileged || review.reviewerUserId === requestingUser.id;

            reviewPayload = mayReadInFull
                ? {
                      redacted: false,
                      reviewerName,
                      status: review.status,
                      normalizedScore: review.normalizedScore === null ? null : Number(review.normalizedScore),
                      strengths: review.strengths,
                      improvements: review.improvements,
                      overallComment: review.overallComment,
                      ratings: (review.ratings ?? []).map(r => ({
                          templateItemId: r.templateItemId,
                          rating: r.rating,
                          textValue: r.textValue,
                          comment: r.comment,
                          na: r.na,
                      })),
                  }
                : // Deliberately nothing else on this object — a redacted field must
                  // never leave the server, not merely be hidden by the client.
                  { redacted: true, reviewerName, status: review.status };
        }

        historyCycles.push({
            cycleId: cycle.id,
            periodLabel: cycle.periodLabel,
            startDate: String(cycle.startDate).slice(0, 10),
            endDate: String(cycle.endDate).slice(0, 10),
            status: cycle.status,
            contributingProjectIds: participant.contributingProjectIds,
            score: score ? scoreView(score) : null,
            review: reviewPayload,
        });
    }

    return {
        teamMember: { id: teamMember.id, firstName: teamMember.firstName, lastName: teamMember.lastName },
        cycles: historyCycles,
    };
}
