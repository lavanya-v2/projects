import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import sequelize from '../../../../config/connection';
import { seedFixture, passIdentityGate, seedTemplate, templateItemIds, addExtraSprint, Fixture } from './helpers/seed';
import { ReviewCycleConfig } from '../../../../models/ReviewCycleConfig';
import { ReviewCycle } from '../../../../models/ReviewCycle';
import { ReviewMemberScore } from '../../../../models/ReviewMemberScore';
import { LeadReview } from '../../../../models/LeadReview';
import { LeadReviewRating } from '../../../../models/LeadReviewRating';
import { CompetencyTemplate } from '../../../../models/CompetencyTemplate';
import { CompetencyTemplateItem } from '../../../../models/CompetencyTemplateItem';
import { PerfMemberScore } from '../../../../models/PerfMemberScore';
import { generateCycles } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';
import * as svc from '../../services/leadReviewService';

/**
 * Lead reviews, end to end.
 *
 * This output feeds an appraisal, so the tests here are about defensibility as
 * much as correctness: that a rating cannot reach a score without a written
 * justification, that the evidence behind it is frozen, that a published record
 * cannot be quietly altered, and that a draft never counts.
 */

let fx: Fixture;
let template: CompetencyTemplate;
let items: Record<string, number>;
let cycleId: number;

const GOOD = 'Consistently reviewed others PRs and caught two production issues pre-release.';
const SHORT = 'ok';

beforeAll(async () => {
    await sequelize.authenticate();
});

beforeEach(async () => {
    fx = await seedFixture();
    await passIdentityGate(fx.projectA.id, fx.users.superuser.id);
    await passIdentityGate(fx.projectB.id, fx.users.superuser.id);
    template = await seedTemplate(fx.account.id, fx.users.superuser.id);
    items = await templateItemIds(template.id);

    await ReviewCycleConfig.create({
        accountId: fx.account.id,
        scopeProjectIds: [fx.projectA.id, fx.projectB.id],
        cadence: 'monthly',
        anchorDate: '2026-10-01',
        reviewYearStartMonth: 4,
        weightSystem: 60,
        weightLead: 40,
        weightCustomer: 0,
        leadTemplateId: template.id,
        isEnabled: true,
        createdByUserId: fx.users.superuser.id,
    } as any);
    await generateCycles(fx.account.id, '2027-03-31');

    const cycle = await ReviewCycle.findOne({
        where: { accountId: fx.account.id, startDate: '2026-10-01' },
    });
    cycleId = cycle!.id;
    await cycleService.openCycle(cycleId, fx.users.superuser.id);
});

/** A complete, valid set of answers. */
const validAnswers = (quality = 4, ownership = 3) => ({
    strengths: 'Strong ownership of the payments migration.',
    improvements: 'Could bring design decisions to the team earlier.',
    overallComment: 'A solid period overall.',
    ratings: [
        { templateItemId: items.quality, rating: quality, comment: GOOD },
        { templateItemId: items.ownership, rating: ownership, comment: GOOD },
    ],
});

async function openDraft(teamMemberId = fx.members.solo.id): Promise<LeadReview> {
    return svc.getOrCreateDraft(cycleId, teamMemberId, fx.users.leadA.id);
}

async function submitValid(teamMemberId = fx.members.solo.id, quality = 4, ownership = 3) {
    const draft = await openDraft(teamMemberId);
    await svc.saveDraft(draft.id, validAnswers(quality, ownership));
    return svc.submitReview(draft.id, fx.users.leadA.id);
}

const scoreFor = async (teamMemberId: number) =>
    ReviewMemberScore.findOne({ where: { reviewCycleId: cycleId, teamMemberId } });

// ── Justification ───────────────────────────────────────────────────────────

describe('justification is mandatory', () => {
    it('refuses a rating with no written justification', async () => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, {
            ...validAnswers(),
            ratings: [
                { templateItemId: items.quality, rating: 4, comment: null },
                { templateItemId: items.ownership, rating: 3, comment: GOOD },
            ],
        });

        const problems = await svc.validateForSubmit(draft.id);
        expect(problems.join(' ')).toMatch(/Code Quality.*justification/i);
        await expect(svc.submitReview(draft.id, fx.users.leadA.id)).rejects.toThrow(
            svc.ReviewValidationError,
        );
    });

    it('refuses a single keystroke as a justification', async () => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, {
            ...validAnswers(),
            ratings: [
                { templateItemId: items.quality, rating: 3, comment: '.' },
                { templateItemId: items.ownership, rating: 3, comment: GOOD },
            ],
        });
        expect((await svc.validateForSubmit(draft.id)).join(' ')).toMatch(/justification/i);
    });

    /**
     * The ratings that get challenged in an appraisal are the extremes, so a token
     * note is not enough for them even though it passes for a middling rating.
     */
    it.each([
        ['lowest', 1],
        ['highest', 5],
    ])('refuses a %s rating justified only briefly', async (_label, rating) => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, {
            ...validAnswers(),
            ratings: [
                { templateItemId: items.quality, rating, comment: 'was bad' },
                { templateItemId: items.ownership, rating: 3, comment: GOOD },
            ],
        });

        const problems = await svc.validateForSubmit(draft.id);
        expect(problems.join(' ')).toMatch(/extreme of the scale/i);
        expect(problems.join(' ')).toContain(String(svc.MIN_EXTREME_COMMENT_LENGTH));
    });

    it('accepts an extreme rating with a substantive justification', async () => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, {
            ...validAnswers(),
            ratings: [
                { templateItemId: items.quality, rating: 5, comment: GOOD },
                { templateItemId: items.ownership, rating: 3, comment: GOOD },
            ],
        });
        expect(await svc.validateForSubmit(draft.id)).toEqual([]);
    });

    it('accepts a brief but real justification on a middling rating', async () => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, {
            ...validAnswers(),
            ratings: [
                { templateItemId: items.quality, rating: 3, comment: 'steady' },
                { templateItemId: items.ownership, rating: 3, comment: GOOD },
            ],
        });
        expect(await svc.validateForSubmit(draft.id)).toEqual([]);
    });
});

// ── Completeness ────────────────────────────────────────────────────────────

describe('completeness', () => {
    it('refuses a review with a required competency unanswered', async () => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, {
            ...validAnswers(),
            ratings: [{ templateItemId: items.quality, rating: 4, comment: GOOD }],
        });
        expect((await svc.validateForSubmit(draft.id)).join(' ')).toMatch(/Ownership.*not been answered/i);
    });

    it.each([
        ['strengths', { strengths: '   ' }],
        ['improvements', { improvements: '' }],
    ])('refuses a review with %s left blank', async (label, override) => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, { ...validAnswers(), ...override });
        // saveDraft ignores nullish, so blank explicitly.
        await LeadReview.update(override as any, { where: { id: draft.id } });
        expect((await svc.validateForSubmit(draft.id)).join(' ').toLowerCase()).toContain(
            label === 'strengths' ? 'strengths' : 'improve',
        );
    });

    it('refuses a rating outside the template scale', async () => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, validAnswers());
        // Bypass the service to simulate a crafted payload reaching the DB.
        await LeadReviewRating.update(
            { rating: 9 },
            { where: { leadReviewId: draft.id, templateItemId: items.quality } },
        );
        expect((await svc.validateForSubmit(draft.id)).join(' ')).toMatch(/outside the 1-5 scale/i);
    });

    it('allows an item marked not-applicable and excludes it from the score', async () => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, {
            ...validAnswers(),
            ratings: [
                { templateItemId: items.quality, rating: 5, comment: GOOD },
                { templateItemId: items.ownership, na: true },
            ],
        });
        expect(await svc.validateForSubmit(draft.id)).toEqual([]);

        const submitted = await svc.submitReview(draft.id, fx.users.leadA.id);
        // Only 'quality' counted: 5 of 5 → 100.
        expect(Number(submitted.normalizedScore)).toBe(100);
    });

    it('rejects an answer against an item from a different template', async () => {
        const other = await seedTemplate(fx.account.id, fx.users.superuser.id);
        const otherItems = await templateItemIds(other.id);
        const draft = await openDraft();

        await expect(
            svc.saveDraft(draft.id, {
                ratings: [{ templateItemId: otherItems.quality, rating: 5, comment: GOOD }],
            }),
        ).rejects.toThrow(/does not belong/i);
    });
});

// ── Scoring ─────────────────────────────────────────────────────────────────

describe('scoring', () => {
    it('weights competencies as configured', async () => {
        // quality weight 3 @ 5/5 → 100; ownership weight 1 @ 1/5 → 0
        // (3*100 + 1*0) / 4 = 75
        const review = await submitValid(fx.members.solo.id, 5, 1);
        expect(Number(review.normalizedScore)).toBe(75);
    });

    it('maps the bottom of the scale to 0 and the top to 100', async () => {
        const low = await submitValid(fx.members.solo.id, 1, 1);
        expect(Number(low.normalizedScore)).toBe(0);

        await LeadReview.destroy({ where: { reviewCycleId: cycleId } });
        const high = await submitValid(fx.members.solo.id, 5, 5);
        expect(Number(high.normalizedScore)).toBe(100);
    });

    /** A half-written review must never move someone's appraisal number. */
    it('does NOT count a draft toward the composite', async () => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, validAnswers(5, 5));
        await cycleService.recomputeCycle(cycleId, 'manual');

        const s = await scoreFor(fx.members.solo.id);
        expect(s!.leadPresent).toBe(false);
        expect(Number(s!.leadScore)).toBe(100); // the missing-factor default
        expect(Number(s!.overallCoverage)).toBe(60);
        expect(s!.isProvisional).toBe(true);
    });

    it('counts a submitted review and clears Provisional', async () => {
        await submitValid(fx.members.solo.id, 5, 1); // lead score 75
        await cycleService.recomputeCycle(cycleId, 'manual');

        const s = await scoreFor(fx.members.solo.id);
        expect(s!.leadPresent).toBe(true);
        expect(Number(s!.leadScore)).toBe(75);
        expect(Number(s!.leadCoverage)).toBe(100);

        // 0.6 * 86.4 + 0.4 * 75 = 81.84
        expect(Number(s!.systemScore)).toBeCloseTo(86.4, 1);
        expect(Number(s!.compositeScore)).toBeCloseTo(0.6 * 86.4 + 0.4 * 75, 1);
        expect(Number(s!.overallCoverage)).toBe(100);
        expect(s!.isProvisional).toBe(false);
    });

    it('reports partial coverage when only some competencies are answered', async () => {
        const draft = await openDraft();
        await svc.saveDraft(draft.id, {
            ...validAnswers(),
            ratings: [
                { templateItemId: items.quality, rating: 4, comment: GOOD },
                { templateItemId: items.ownership, na: true },
            ],
        });
        await svc.submitReview(draft.id, fx.users.leadA.id);

        const factor = await svc.getLeadFactor(cycleId, fx.members.solo.id);
        expect(factor.present).toBe(true);
        // quality weight 3 of total weight 4 answered.
        expect(factor.coverage).toBe(75);
    });
});

// ── Evidence ────────────────────────────────────────────────────────────────

describe('evidence snapshot', () => {
    it('captures the figures the lead was shown at submit', async () => {
        const review = await submitValid();
        const e = review.evidenceSnapshot;

        expect(e.capturedAt).toBeTruthy();
        expect(e.systemScore).toBeCloseTo(86.4, 1);
        expect(e.systemPresent).toBe(true);
        expect(e.cycle?.periodLabel).toBe('2026-10');
        expect(e.contributingProjectIds).toContain(fx.projectA.id);
        expect(e.aggregates?.spPlanned).toBe(20);
        expect(e.aggregates?.spDone).toBe(16);
        // The template as answered, so a later reword cannot change what was asked.
        expect(e.template?.id).toBe(template.id);
        expect(e.template?.items?.map(i => i.key).sort()).toEqual(['context', 'ownership', 'quality']);
    });

    /**
     * The whole point: delivery data is re-synced constantly and perf rows are
     * replaced wholesale. What the lead rated against must remain provable.
     */
    it('survives a re-sync that changes the underlying delivery data', async () => {
        const review = await submitValid();
        const before = JSON.parse(JSON.stringify(review.evidenceSnapshot));

        await PerfMemberScore.update(
            { spDone: 1, spPlanned: 50 },
            { where: { projectId: fx.projectA.id, teamMemberId: fx.members.solo.id } },
        );
        await cycleService.recomputeCycle(cycleId, 'manual');

        const after = await LeadReview.findByPk(review.id);
        expect(after!.evidenceSnapshot).toEqual(before);
        expect(after!.evidenceSnapshot.aggregates?.spDone).toBe(16);

        // The live score moved; the frozen evidence did not.
        const s = await scoreFor(fx.members.solo.id);
        expect(Number(s!.systemScore)).not.toBeCloseTo(86.4, 1);
    });

    it('records approximations and refused overrides in force at the time', async () => {
        await PerfMemberScore.update(
            { isOverridden: true, overriddenMetrics: { spDone: -5 } },
            { where: { projectId: fx.projectA.id, teamMemberId: fx.members.solo.id } },
        );
        await cycleService.recomputeCycle(cycleId, 'manual');

        const review = await submitValid();
        expect(review.evidenceSnapshot.overridesRejected).toContain('spDone');
    });

    /**
     * The gap a manual walkthrough surfaced: sprint identity (name, dates) was
     * being dropped between the provider and the evidence panel, so two sprints
     * from the same project rendered as two identical, unlabelled rows. This pins
     * the fix at the data layer — the frontend table only renders what's here.
     */
    it('identifies two sprints from the SAME project as two distinguishable rows', async () => {
        // A second October sprint for solo, in project A, alongside the one the
        // fixture already seeded there.
        await addExtraSprint(fx.projectA.id, fx.members.solo.id, 'A-Sprint-2', '2026-10-16', '2026-10-30', {
            spPlanned: 5, spDone: 5, deliveredCount: 2,
        });
        await cycleService.openCycle(cycleId, fx.users.superuser.id);
        await cycleService.recomputeCycle(cycleId, 'manual');

        const review = await submitValid();
        const sources = review.evidenceSnapshot.sources ?? [];
        const inProjectA = sources.filter(s => s.projectId === fx.projectA.id);

        expect(inProjectA).toHaveLength(2);
        // Distinguishable identity, not just distinguishable id.
        const labels = inProjectA.map(s => s.periodLabel);
        expect(new Set(labels).size).toBe(2);
        expect(labels).toContain('A-Sprint-1');
        expect(labels).toContain('A-Sprint-2');
        // Every row also carries a resolvable project name, not just a bare id.
        expect(inProjectA.every(s => !!s.projectName)).toBe(true);
        expect(inProjectA.every(s => !!s.startDate && !!s.endDate)).toBe(true);
    });
});

// ── Immutability and revision ───────────────────────────────────────────────

describe('a published review is a record', () => {
    const publish = async () => {
        const submitted = await submitValid();
        return svc.publishReview(submitted.id, fx.users.superuser.id);
    };

    it('refuses to edit a published review', async () => {
        const published = await publish();
        await expect(svc.saveDraft(published.id, { strengths: 'rewritten' })).rejects.toThrow(
            svc.ImmutableReviewError,
        );
        await expect(svc.submitReview(published.id, fx.users.leadA.id)).rejects.toThrow(
            svc.ImmutableReviewError,
        );
    });

    it('refuses to publish anything that was not submitted', async () => {
        const draft = await openDraft();
        await expect(svc.publishReview(draft.id, fx.users.superuser.id)).rejects.toThrow(
            /Only a submitted review/i,
        );
    });

    it('supersedes rather than overwrites, keeping both versions', async () => {
        const published = await publish();
        const revision = await svc.reviseReview(
            published.id,
            'Rating corrected after moderation with the delivery manager.',
            fx.users.superuser.id,
        );

        expect(revision.version).toBe(2);
        expect(revision.supersedesReviewId).toBe(published.id);
        expect(revision.status).toBe('draft');

        // The original survives untouched, exactly as the member saw it.
        const original = await LeadReview.findByPk(published.id);
        expect(original!.status).toBe('superseded');
        expect(original!.strengths).toBe(published.strengths);
        expect(original!.normalizedScore).toBe(published.normalizedScore);
    });

    it('carries the previous answers into the revision', async () => {
        const published = await publish();
        const revision = await svc.reviseReview(published.id, 'Correcting an error.', fx.users.superuser.id);

        const ratings = await LeadReviewRating.findAll({ where: { leadReviewId: revision.id } });
        expect(ratings).toHaveLength(2);
        expect(ratings.every(r => (r.comment ?? '').length > 0)).toBe(true);
    });

    it('requires a stated reason for a revision', async () => {
        const published = await publish();
        await expect(svc.reviseReview(published.id, '', fx.users.superuser.id)).rejects.toThrow(
            /state why/i,
        );
    });

    it('refuses to revise something that was never published', async () => {
        const draft = await openDraft();
        await expect(svc.reviseReview(draft.id, 'because', fx.users.superuser.id)).rejects.toThrow(
            /Only a published review/i,
        );
    });

    it('keeps exactly one live review per person per cycle', async () => {
        const published = await publish();
        await svc.reviseReview(published.id, 'Correcting an error.', fx.users.superuser.id);

        const live = await LeadReview.findAll({
            where: { reviewCycleId: cycleId, teamMemberId: fx.members.solo.id },
        });
        expect(live).toHaveLength(2);
        expect(live.filter(r => r.status !== 'superseded')).toHaveLength(1);
    });

    it('writes an audit trail for every transition', async () => {
        const published = await publish();
        await svc.reviseReview(published.id, 'Correcting an error.', fx.users.superuser.id);

        const [rows]: any = await sequelize.query(
            `SELECT to_status FROM review_status_history WHERE entity_type = 'lead_review' ORDER BY id`,
        );
        const statuses = rows.map((r: any) => r.to_status);
        expect(statuses).toContain('submitted');
        expect(statuses).toContain('published');
        expect(statuses).toContain('superseded');
    });
});

// ── Acknowledgement ─────────────────────────────────────────────────────────

describe('member acknowledgement', () => {
    const publish = async () => {
        const submitted = await submitValid();
        return svc.publishReview(submitted.id, fx.users.superuser.id);
    };

    it('records that the member saw it', async () => {
        const published = await publish();
        const acked = await svc.acknowledgeReview(published.id, fx.members.solo.id, 'Discussed on 12 Oct.');

        expect(acked.acknowledgedAt).toBeTruthy();
        expect(acked.acknowledgementComment).toBe('Discussed on 12 Oct.');
    });

    it('refuses acknowledgement from anyone but the subject', async () => {
        const published = await publish();
        await expect(
            svc.acknowledgeReview(published.id, fx.members.across.id, null),
        ).rejects.toThrow(/Only the person reviewed/i);
    });

    it('refuses acknowledgement of an unpublished review', async () => {
        const submitted = await submitValid();
        await expect(
            svc.acknowledgeReview(submitted.id, fx.members.solo.id, null),
        ).rejects.toThrow(/Only a published review/i);
    });

    it('never overwrites the first acknowledgement', async () => {
        const published = await publish();
        const first = await svc.acknowledgeReview(published.id, fx.members.solo.id, 'first');
        const second = await svc.acknowledgeReview(published.id, fx.members.solo.id, 'second');

        expect(second.acknowledgedAt).toEqual(first.acknowledgedAt);
        expect(second.acknowledgementComment).toBe('first');
    });
});

// ── Template versioning ─────────────────────────────────────────────────────

describe('template pinning', () => {
    it('answers the version pinned on the cycle, not the newest', async () => {
        const draft = await openDraft();
        expect(draft.templateId).toBe(template.id);

        // A newer active template appearing mid-cycle must not change what this
        // cycle's reviewers are answering.
        await seedTemplate(fx.account.id, fx.users.superuser.id);
        const again = await svc.getOrCreateDraft(cycleId, fx.members.across.id, fx.users.leadA.id);
        expect(again.templateId).toBe(template.id);
    });

    it('refuses to start a review when no template is configured', async () => {
        await CompetencyTemplateItem.destroy({ where: {} });
        await LeadReview.destroy({ where: {} });
        await CompetencyTemplate.destroy({ where: {} });
        await ReviewCycle.update({ leadTemplateId: null }, { where: { id: cycleId } });

        await expect(
            svc.getOrCreateDraft(cycleId, fx.members.solo.id, fx.users.leadA.id),
        ).rejects.toThrow(/No active competency template/i);
    });
});
