import { Op } from 'sequelize';
import { LeadReview, LeadReviewStatus, EvidenceSnapshot, SCORING_REVIEW_STATUSES } from '../../../models/LeadReview';
import { LeadReviewRating } from '../../../models/LeadReviewRating';
import { CompetencyTemplate } from '../../../models/CompetencyTemplate';
import { CompetencyTemplateItem } from '../../../models/CompetencyTemplateItem';
import { ReviewProjectSettings } from '../../../models/ReviewProjectSettings';
import { ReviewCycle } from '../../../models/ReviewCycle';
import { ReviewCycleParticipant } from '../../../models/ReviewCycleParticipant';
import { ReviewMemberScore } from '../../../models/ReviewMemberScore';
import { ReviewStatusHistory } from '../../../models/ReviewStatusHistory';

/**
 * Lead reviews — authoring, validation, publication and correction.
 *
 * This output reaches an appraisal, so the rules here are deliberately strict:
 *
 *  - Every rating carries a written justification. A bare number cannot be
 *    defended in a conversation with the person being rated.
 *  - Ratings at the extremes of the scale need a SUBSTANTIVE justification, not a
 *    character typed to satisfy a validator. Those are the ratings that get
 *    challenged.
 *  - Submitting freezes the delivery figures the lead was shown, so what the
 *    rating was made against stays provable after the next re-sync.
 *  - A published review is immutable. A correction supersedes it and both are
 *    retained.
 */

/** A justification on an extreme rating must say something. */
export const MIN_EXTREME_COMMENT_LENGTH = 20;

/** A justification on any rating must be more than a keystroke. */
export const MIN_COMMENT_LENGTH = 3;

export class ReviewValidationError extends Error {
    readonly problems: string[];
    constructor(problems: string[]) {
        super(`Review is not ready to submit: ${problems.join('; ')}`);
        this.name = 'ReviewValidationError';
        this.problems = problems;
    }
}

export class ImmutableReviewError extends Error {
    constructor(id: number, status: string) {
        super(`Review ${id} is ${status} and cannot be modified. Create a revision instead.`);
        this.name = 'ImmutableReviewError';
    }
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const trimmed = (s: string | null | undefined) => (s ?? '').trim();

// ── Template resolution ─────────────────────────────────────────────────────

/**
 * The active template for a cycle, for one participant.
 *
 * Priority: a per-project override (`review_project_settings`, set under Project
 * Setup) beats everything else — a superuser who deliberately pointed a project
 * at a specific template meant that project to use it, not the account's
 * pinned default. Falls back to the version pinned on the cycle at open (so a
 * mid-cycle account-wide template change cannot alter what the rest of the
 * cycle's reviewers are answering), then the most specific active template —
 * account, then global.
 *
 * `contributingProjectIds` comes from the participant row. Checked in array
 * order; a cross-project person with overrides set on more than one of their
 * projects is a rare enough edge case that "first one wins" is an acceptable,
 * simple tie-break rather than something worth a "dominant project" computation
 * here too.
 */
export async function resolveTemplateForCycle(
    cycle: ReviewCycle,
    memberCategory?: string | null,
    contributingProjectIds?: number[],
): Promise<CompetencyTemplate | null> {
    if (contributingProjectIds && contributingProjectIds.length > 0) {
        const overrides = await ReviewProjectSettings.findAll({
            where: { projectId: { [Op.in]: contributingProjectIds }, templateId: { [Op.ne]: null } },
        });
        const overrideByProject = new Map(overrides.map(o => [o.projectId, o.templateId as number]));
        for (const projectId of contributingProjectIds) {
            const templateId = overrideByProject.get(projectId);
            if (!templateId) continue;
            const overridden = await CompetencyTemplate.findOne({
                where: { id: templateId, status: 'active' },
                include: [CompetencyTemplateItem],
            });
            if (overridden) return overridden;
        }
    }

    if (cycle.leadTemplateId) {
        const pinned = await CompetencyTemplate.findByPk(cycle.leadTemplateId, {
            include: [CompetencyTemplateItem],
        });
        if (pinned) return pinned;
    }

    const candidates = await CompetencyTemplate.findAll({
        where: {
            status: 'active',
            [Op.or]: [
                { scope: 'account', accountId: cycle.accountId },
                { scope: 'global' },
            ],
        },
        include: [CompetencyTemplateItem],
        order: [['version', 'DESC']],
    });

    // Category-specific beats the catch-all; account scope beats global.
    const byFit = candidates.sort((a, b) => {
        const cat = (t: CompetencyTemplate) =>
            t.appliesToCategory && t.appliesToCategory === memberCategory ? 0 : t.appliesToCategory ? 2 : 1;
        const scope = (t: CompetencyTemplate) => (t.scope === 'account' ? 0 : 1);
        return cat(a) - cat(b) || scope(a) - scope(b) || b.version - a.version;
    });
    return byFit[0] ?? null;
}

// ── Draft lifecycle ─────────────────────────────────────────────────────────

/**
 * Get or create the draft for one participant.
 *
 * Created lazily on first open rather than en masse at cycle open, so an unopened
 * review is genuinely absent instead of an empty row that looks started.
 */
export async function getOrCreateDraft(
    cycleId: number,
    teamMemberId: number,
    reviewerUserId: number,
): Promise<LeadReview> {
    const existing = await LeadReview.findOne({
        where: { reviewCycleId: cycleId, teamMemberId, status: { [Op.ne]: 'superseded' } },
        include: [LeadReviewRating],
    });
    if (existing) return existing;

    const cycle = await ReviewCycle.findByPk(cycleId);
    if (!cycle) throw new Error(`Review cycle ${cycleId} not found`);

    const participant = await ReviewCycleParticipant.findOne({
        where: { reviewCycleId: cycleId, teamMemberId },
    });
    if (!participant) throw new Error(`${teamMemberId} is not a participant in cycle ${cycleId}`);

    const template = await resolveTemplateForCycle(cycle, participant.memberCategory, participant.contributingProjectIds);
    if (!template) {
        throw new Error('No active competency template is configured for this account');
    }

    return LeadReview.create({
        reviewCycleId: cycleId,
        teamMemberId,
        accountId: cycle.accountId,
        reviewerUserId,
        templateId: template.id,
        status: 'draft',
    } as any);
}

/** Autosave a draft. Refuses once the review is a record. */
export async function saveDraft(
    reviewId: number,
    patch: {
        overallComment?: string | null;
        strengths?: string | null;
        improvements?: string | null;
        ratings?: Array<{
            templateItemId: number;
            rating?: number | null;
            textValue?: string | null;
            booleanValue?: boolean | null;
            comment?: string | null;
            na?: boolean;
        }>;
    },
): Promise<LeadReview> {
    const review = await loadReview(reviewId);
    if (review.isImmutable) throw new ImmutableReviewError(review.id, review.status);

    await review.update({
        overallComment: patch.overallComment ?? review.overallComment,
        strengths: patch.strengths ?? review.strengths,
        improvements: patch.improvements ?? review.improvements,
        // Re-opening a submitted review for edits returns it to draft, so a
        // half-edited review never counts toward a score.
        status: review.status === 'submitted' ? 'draft' : review.status,
    });

    for (const r of patch.ratings ?? []) {
        const item = await CompetencyTemplateItem.findOne({
            where: { id: r.templateItemId, templateId: review.templateId },
        });
        // Silently ignoring a foreign item would let a crafted payload write
        // answers against another template's questions.
        if (!item) throw new Error(`Item ${r.templateItemId} does not belong to this review's template`);

        const values = {
            leadReviewId: review.id,
            templateItemId: r.templateItemId,
            rating: r.na ? null : r.rating ?? null,
            textValue: r.textValue ?? null,
            booleanValue: r.booleanValue ?? null,
            comment: r.comment ?? null,
            na: !!r.na,
        };

        const found = await LeadReviewRating.findOne({
            where: { leadReviewId: review.id, templateItemId: r.templateItemId },
        });
        if (found) await found.update(values);
        else await LeadReviewRating.create(values as any);
    }

    return loadReview(reviewId);
}

async function loadReview(reviewId: number): Promise<LeadReview> {
    const review = await LeadReview.findByPk(reviewId, { include: [LeadReviewRating] });
    if (!review) throw new Error(`Lead review ${reviewId} not found`);
    return review;
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Everything that must hold before a review can be submitted.
 *
 * Returns every problem at once rather than failing on the first, so a lead fixes
 * the form in one pass instead of discovering issues one at a time.
 */
export async function validateForSubmit(reviewId: number): Promise<string[]> {
    const review = await loadReview(reviewId);
    const template = await CompetencyTemplate.findByPk(review.templateId, {
        include: [CompetencyTemplateItem],
    });
    if (!template) return ['The template for this review no longer exists'];

    const items = (template.items ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const byItem = new Map((review.ratings ?? []).map(r => [r.templateItemId, r]));
    const problems: string[] = [];

    for (const item of items) {
        const answer = byItem.get(item.id);

        if (!answer || (answer.rating === null && !answer.na && !trimmed(answer.textValue) && answer.booleanValue === null)) {
            if (item.isRequired) problems.push(`"${item.label}" has not been answered`);
            continue;
        }

        if (answer.na) continue; // Explicitly not applicable; nothing more to check.

        if (item.inputType === 'rating') {
            if (answer.rating === null) {
                if (item.isRequired) problems.push(`"${item.label}" has no rating`);
                continue;
            }
            if (answer.rating < template.ratingScaleMin || answer.rating > template.ratingScaleMax) {
                problems.push(
                    `"${item.label}" is rated ${answer.rating}, outside the ${template.ratingScaleMin}-${template.ratingScaleMax} scale`,
                );
                continue;
            }

            // A rating always needs a justification — this is what makes it
            // defensible when the person asks why.
            const comment = trimmed(answer.comment);
            if (comment.length < MIN_COMMENT_LENGTH) {
                problems.push(`"${item.label}" needs a written justification`);
                continue;
            }

            // Extremes get challenged, so they need more than a token note.
            const isExtreme =
                answer.rating === template.ratingScaleMin || answer.rating === template.ratingScaleMax;
            if (isExtreme && comment.length < MIN_EXTREME_COMMENT_LENGTH) {
                problems.push(
                    `"${item.label}" is rated at the extreme of the scale (${answer.rating}) and needs a specific justification of at least ${MIN_EXTREME_COMMENT_LENGTH} characters`,
                );
            }
            continue;
        }

        if (item.inputType === 'text' && item.isRequired && !trimmed(answer.textValue)) {
            problems.push(`"${item.label}" has not been filled in`);
        }
    }

    // The narrative is the part the member actually reads.
    if (!trimmed(review.strengths)) problems.push('Strengths have not been written');
    if (!trimmed(review.improvements)) problems.push('Areas to improve have not been written');

    return problems;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Normalise the ratings to 0-100.
 *
 * Weighted across non-NA rating items only, scaled so the bottom of the scale is 0
 * and the top is 100. Text and boolean answers carry narrative, not score.
 */
export function computeNormalizedScore(
    template: CompetencyTemplate,
    items: CompetencyTemplateItem[],
    ratings: LeadReviewRating[],
): { score: number | null; answeredWeight: number; totalWeight: number } {
    const byItem = new Map(ratings.map(r => [r.templateItemId, r]));
    const span = template.ratingScaleMax - template.ratingScaleMin;
    if (span <= 0) return { score: null, answeredWeight: 0, totalWeight: 0 };

    let acc = 0;
    let answeredWeight = 0;
    let totalWeight = 0;

    for (const item of items) {
        if (item.inputType !== 'rating') continue;
        const weight = Number(item.weight) || 0;
        totalWeight += weight;

        const answer = byItem.get(item.id);
        if (!answer || answer.na || answer.rating === null) continue;

        acc += ((answer.rating - template.ratingScaleMin) / span) * 100 * weight;
        answeredWeight += weight;
    }

    return {
        score: answeredWeight === 0 ? null : round1(acc / answeredWeight),
        answeredWeight,
        totalWeight,
    };
}

// ── Evidence ────────────────────────────────────────────────────────────────

/**
 * Freeze what the lead was shown.
 *
 * Captured at submit, from the score row as it stands then. This is the record that
 * answers "what numbers was this rating made against?" after the underlying sprint
 * data has been re-synced several times.
 */
async function captureEvidence(review: LeadReview): Promise<EvidenceSnapshot> {
    const cycle = await ReviewCycle.findByPk(review.reviewCycleId);
    const score = await ReviewMemberScore.findOne({
        where: { reviewCycleId: review.reviewCycleId, teamMemberId: review.teamMemberId },
    });
    const participant = await ReviewCycleParticipant.findOne({
        where: { reviewCycleId: review.reviewCycleId, teamMemberId: review.teamMemberId },
    });
    const template = await CompetencyTemplate.findByPk(review.templateId, {
        include: [CompetencyTemplateItem],
    });

    const breakdown = (score?.breakdown ?? {}) as Record<string, any>;

    return {
        capturedAt: new Date().toISOString(),
        systemScore: score?.systemScore === null || score?.systemScore === undefined ? null : Number(score.systemScore),
        systemCoverage:
            score?.systemCoverage === null || score?.systemCoverage === undefined ? null : Number(score.systemCoverage),
        systemPresent: score?.systemPresent ?? false,
        compositeAtSubmit:
            score?.compositeScore === null || score?.compositeScore === undefined ? null : Number(score.compositeScore),
        memberCategory: participant?.memberCategory,
        cycle: cycle
            ? {
                  id: cycle.id,
                  periodLabel: cycle.periodLabel,
                  startDate: String(cycle.startDate).slice(0, 10),
                  endDate: String(cycle.endDate).slice(0, 10),
              }
            : undefined,
        contributingProjectIds: participant?.contributingProjectIds ?? [],
        sources: breakdown.sources ?? [],
        aggregates: breakdown.aggregates ?? {},
        approximations: breakdown.approximations ?? [],
        overridesApplied: breakdown.overridesApplied ?? [],
        overridesRejected: breakdown.overridesRejected ?? [],
        template: template
            ? {
                  id: template.id,
                  name: template.name,
                  version: template.version,
                  ratingScaleMin: template.ratingScaleMin,
                  ratingScaleMax: template.ratingScaleMax,
                  items: (template.items ?? []).map(i => ({
                      id: i.id,
                      key: i.key,
                      label: i.label,
                      weight: Number(i.weight),
                      inputType: i.inputType,
                  })),
              }
            : undefined,
    };
}

// ── Transitions ─────────────────────────────────────────────────────────────

async function record(
    reviewId: number,
    from: string | null,
    to: string,
    note: string | null,
    userId: number,
): Promise<void> {
    await ReviewStatusHistory.create({
        entityType: 'lead_review',
        entityId: reviewId,
        fromStatus: from,
        toStatus: to,
        note,
        changedByUserId: userId,
    } as any);
}

/** Submit a completed review: validate, score, freeze the evidence. */
export async function submitReview(reviewId: number, userId: number): Promise<LeadReview> {
    const review = await loadReview(reviewId);
    if (review.isImmutable) throw new ImmutableReviewError(review.id, review.status);

    const problems = await validateForSubmit(reviewId);
    if (problems.length > 0) throw new ReviewValidationError(problems);

    const template = await CompetencyTemplate.findByPk(review.templateId, {
        include: [CompetencyTemplateItem],
    });
    const { score } = computeNormalizedScore(template!, template!.items ?? [], review.ratings ?? []);

    const from = review.status;
    await review.update({
        status: 'submitted',
        normalizedScore: score,
        submittedAt: new Date(),
        evidenceSnapshot: await captureEvidence(review),
    });
    await record(reviewId, from, 'submitted', null, userId);
    return loadReview(reviewId);
}

/**
 * Publish: the review becomes visible to the member and immutable.
 *
 * Also marks THIS PERSON's composite score row as published. This closes a real
 * gap: `status` is documented everywhere as "the visibility rule", but the score
 * itself was only ever marked visible by the whole-cycle `published` transition —
 * so a member could read a published narrative and rating while the composite
 * number behind it stayed invisible with no explanation, and worse, the
 * still-unpublished score could keep changing under a later recompute even after
 * the narrative was shown. Marking it here makes review and score become visible
 * together, and `recomputeCycle` skips a score once it is published (see there),
 * so what the member reads never moves again.
 */
export async function publishReview(reviewId: number, userId: number): Promise<LeadReview> {
    const review = await loadReview(reviewId);
    if (review.isImmutable) throw new ImmutableReviewError(review.id, review.status);
    if (review.status !== 'submitted') {
        throw new Error(`Only a submitted review can be published (this one is ${review.status})`);
    }

    const publishedAt = new Date();
    await review.update({
        status: 'published',
        publishedAt,
        publishedByUserId: userId,
    });

    await ReviewMemberScore.update(
        { isPublished: true, publishedAt },
        { where: { reviewCycleId: review.reviewCycleId, teamMemberId: review.teamMemberId } },
    );

    await record(reviewId, 'submitted', 'published', null, userId);
    return loadReview(reviewId);
}

/**
 * Correct a published review by superseding it.
 *
 * The published record is never edited: it is marked `superseded` and retained,
 * and a new draft is created carrying the same answers forward plus a stated
 * reason. Both versions survive, so the record the member acknowledged can always
 * be produced.
 */
export async function reviseReview(
    reviewId: number,
    reason: string,
    userId: number,
): Promise<LeadReview> {
    const original = await loadReview(reviewId);
    if (original.status !== 'published') {
        throw new Error('Only a published review needs a revision — edit the draft directly');
    }
    if (trimmed(reason).length < MIN_COMMENT_LENGTH) {
        throw new Error('A revision must state why the published review is being corrected');
    }

    // One transaction, and the original is retired FIRST.
    //
    // The partial unique index permits a single non-superseded review per person
    // per cycle, so inserting the successor while the original is still published
    // violates it. Retiring first satisfies the index; doing both in a transaction
    // means a failure rolls back and the published record survives intact rather
    // than being left retired with no successor.
    const revision = await LeadReview.sequelize!.transaction(async transaction => {
        await original.update({ status: 'superseded' }, { transaction });

        const created = await LeadReview.create(
            {
                reviewCycleId: original.reviewCycleId,
                teamMemberId: original.teamMemberId,
                accountId: original.accountId,
                reviewerUserId: original.reviewerUserId,
                templateId: original.templateId,
                status: 'draft',
                overallComment: original.overallComment,
                strengths: original.strengths,
                improvements: original.improvements,
                version: original.version + 1,
                supersedesReviewId: original.id,
                revisionReason: trimmed(reason),
            } as any,
            { transaction },
        );

        // Carry the answers forward so a correction starts from what was said,
        // not from a blank form the lead has to reconstruct.
        for (const r of original.ratings ?? []) {
            await LeadReviewRating.create(
                {
                    leadReviewId: created.id,
                    templateItemId: r.templateItemId,
                    rating: r.rating,
                    textValue: r.textValue,
                    booleanValue: r.booleanValue,
                    comment: r.comment,
                    na: r.na,
                } as any,
                { transaction },
            );
        }

        return created;
    });

    await record(original.id, 'published', 'superseded', trimmed(reason), userId);
    await record(revision.id, null, 'draft', `Revision of review ${original.id}`, userId);

    return loadReview(revision.id);
}

/** The member records that they have seen their review. */
export async function acknowledgeReview(
    reviewId: number,
    teamMemberId: number,
    comment: string | null,
): Promise<LeadReview> {
    const review = await loadReview(reviewId);

    // Acknowledgement is personal: only the subject can give it, and only for
    // something actually published to them.
    if (review.teamMemberId !== teamMemberId) {
        throw new Error('Only the person reviewed can acknowledge their review');
    }
    if (review.status !== 'published') {
        throw new Error('Only a published review can be acknowledged');
    }
    if (review.acknowledgedAt) return review; // Idempotent; never overwrite the first.

    await review.update({
        acknowledgedAt: new Date(),
        acknowledgementComment: trimmed(comment) || null,
    });
    return loadReview(reviewId);
}

// ── The lead factor ─────────────────────────────────────────────────────────

/**
 * The lead factor for the composite score.
 *
 * Present only for a `submitted` or `published` review with at least one real
 * rating: a draft must never move someone's score, or a half-written review would
 * quietly start counting.
 *
 * Coverage is the share of required rating weight actually answered, so a review
 * completed in part is visibly partial rather than passing as whole.
 */
export async function getLeadFactor(
    cycleId: number,
    teamMemberId: number,
): Promise<{ score: number | null; present: boolean; coverage: number; reviewId: number | null }> {
    const review = await LeadReview.findOne({
        where: {
            reviewCycleId: cycleId,
            teamMemberId,
            status: { [Op.in]: SCORING_REVIEW_STATUSES },
        },
        include: [LeadReviewRating],
    });
    if (!review) return { score: null, present: false, coverage: 0, reviewId: null };

    const template = await CompetencyTemplate.findByPk(review.templateId, {
        include: [CompetencyTemplateItem],
    });
    if (!template) return { score: null, present: false, coverage: 0, reviewId: review.id };

    const { score, answeredWeight, totalWeight } = computeNormalizedScore(
        template,
        template.items ?? [],
        review.ratings ?? [],
    );
    if (score === null) return { score: null, present: false, coverage: 0, reviewId: review.id };

    return {
        score,
        present: true,
        coverage: totalWeight === 0 ? 0 : round1((answeredWeight / totalWeight) * 100),
        reviewId: review.id,
    };
}
