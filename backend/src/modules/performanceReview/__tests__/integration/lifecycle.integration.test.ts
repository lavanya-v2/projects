import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import sequelize from '../../../../config/connection';
import { seedFixture, passIdentityGate, Fixture } from './helpers/seed';
import { ReviewCycleConfig } from '../../../../models/ReviewCycleConfig';
import { ReviewCycle } from '../../../../models/ReviewCycle';
import { ReviewCycleSource } from '../../../../models/ReviewCycleSource';
import { ReviewCycleParticipant } from '../../../../models/ReviewCycleParticipant';
import { ReviewMemberScore } from '../../../../models/ReviewMemberScore';
import { PerfMemberScore } from '../../../../models/PerfMemberScore';
import { getCoverage, getUnresolvedMembers } from '../../services/identityResolutionService';
import { generateCycles } from '../../services/cycleGenerationService';
import * as cycleService from '../../services/reviewCycleService';

/**
 * End-to-end lifecycle: identity gate → config → generate → open → score → lock →
 * publish, against a real database.
 *
 * The unit tests prove the formulas. This proves the feature: that rows actually
 * land in the right tables with the right numbers.
 */

let fx: Fixture;

const CONFIG = {
    cadence: 'monthly' as const,
    anchorDate: '2026-10-01',
    reviewYearStartMonth: 4,
    weightSystem: 60,
    weightLead: 40,
    weightCustomer: 0,
    isEnabled: true,
};

async function makeConfig(scopeProjectIds: number[]) {
    return ReviewCycleConfig.create({
        accountId: fx.account.id,
        scopeProjectIds,
        ...CONFIG,
        createdByUserId: fx.users.superuser.id,
    } as any);
}

/** The October cycle, which is the one the fixture's sprints fall into. */
async function octoberCycle(): Promise<ReviewCycle> {
    const cycle = await ReviewCycle.findOne({
        where: { accountId: fx.account.id, startDate: '2026-10-01' },
    });
    if (!cycle) throw new Error('October cycle was not generated');
    return cycle;
}

beforeAll(async () => {
    await sequelize.authenticate();
});

beforeEach(async () => {
    fx = await seedFixture();
});

describe('identity gate', () => {
    it('starts undecided and reaches 100% linked once every identity is judged', async () => {
        const before = await getCoverage(fx.projectA.id);
        expect(before.undecidedKeyCount).toBeGreaterThan(0);
        expect(before.linkedPct).toBe(0);

        await passIdentityGate(fx.projectA.id, fx.users.superuser.id);

        const after = await getCoverage(fx.projectA.id);
        expect(after.undecidedKeyCount).toBe(0);
        expect(after.linkedPct).toBe(100);
        // The unmatchable contractor is never a decision at all — just an
        // informational count, never rejected because it was never suggested.
        expect(after.rejectedKeyCount).toBe(0);
        expect(after.nonRosterRowCount).toBeGreaterThan(0);
    });

    it('writes team_member_id onto historical score rows', async () => {
        const [[before]]: any = await sequelize.query(
            `SELECT count(*)::int AS n FROM perf_member_scores WHERE project_id = ${fx.projectA.id} AND team_member_id IS NOT NULL`,
        );
        expect(before.n).toBe(0);

        await passIdentityGate(fx.projectA.id, fx.users.superuser.id);

        const [[after]]: any = await sequelize.query(
            `SELECT count(*)::int AS n FROM perf_member_scores WHERE project_id = ${fx.projectA.id} AND team_member_id IS NOT NULL`,
        );
        // Every row except the rejected 'Ghost Contractor' is now attributed.
        expect(after.n).toBe(3);
    });

    it('never surfaces a delivery identity with no roster counterpart as a decision', async () => {
        const { seedSuggestions } = await import('../../services/identityResolutionService');
        await seedSuggestions(fx.projectA.id);

        // "Ghost Contractor" has no roster counterpart — not a candidate for
        // anyone, not a row anyone is asked to judge.
        const unresolved = await getUnresolvedMembers(fx.projectA.id);
        const mentionsGhost = unresolved.some(u =>
            u.candidates.some(c => c.sourceDisplayName === 'Ghost Contractor'),
        );
        expect(mentionsGhost).toBe(false);

        // It still shows up, but only as an informational count.
        const coverage = await getCoverage(fx.projectA.id);
        expect(coverage.nonRosterRowCount).toBeGreaterThan(0);
    });
});

describe('cycle generation', () => {
    beforeEach(async () => {
        await makeConfig([fx.projectA.id, fx.projectB.id]);
    });

    it('materialises a contiguous financial year and is idempotent', async () => {
        const first = await generateCycles(fx.account.id, '2027-03-31');
        expect(first.created).toBe(12);

        const cycles = await ReviewCycle.findAll({
            where: { accountId: fx.account.id },
            order: [['startDate', 'ASC']],
        });
        expect(cycles).toHaveLength(12);
        expect(String(cycles[0].startDate).slice(0, 10)).toBe('2026-04-01');
        expect(String(cycles[11].endDate).slice(0, 10)).toBe('2027-03-31');

        // No gaps: each cycle starts the day after the previous one ends.
        for (let i = 1; i < cycles.length; i++) {
            const prevEnd = new Date(`${String(cycles[i - 1].endDate).slice(0, 10)}T00:00:00Z`).getTime();
            const start = new Date(`${String(cycles[i].startDate).slice(0, 10)}T00:00:00Z`).getTime();
            expect(start - prevEnd).toBe(86_400_000);
        }

        const second = await generateCycles(fx.account.id, '2027-03-31');
        expect(second.created).toBe(0);
        expect(second.skipped).toBe(12);
    });
});

describe('opening a cycle', () => {
    beforeEach(async () => {
        await passIdentityGate(fx.projectA.id, fx.users.superuser.id);
        await passIdentityGate(fx.projectB.id, fx.users.superuser.id);
        await makeConfig([fx.projectA.id, fx.projectB.id]);
        await generateCycles(fx.account.id, '2027-03-31');
    });

    it('attaches only in-scope sprints, by end-date containment', async () => {
        const cycle = await octoberCycle();
        await cycleService.openCycle(cycle.id, fx.users.superuser.id);

        const sources = await ReviewCycleSource.findAll({ where: { reviewCycleId: cycle.id } });
        const projectIds = sources.map(s => s.projectId).sort();

        expect(projectIds).toEqual([fx.projectA.id, fx.projectB.id].sort());
        // Project C is out of scope and must contribute nothing.
        expect(projectIds).not.toContain(fx.projectC.id);
    });

    it('places each sprint in exactly one cycle', async () => {
        const cycle = await octoberCycle();
        await cycleService.openCycle(cycle.id, fx.users.superuser.id);

        const [rows]: any = await sequelize.query(`
            SELECT perf_sprint_sync_id, count(*)::int AS n
              FROM review_cycle_sources
             WHERE perf_sprint_sync_id IS NOT NULL
             GROUP BY perf_sprint_sync_id HAVING count(*) > 1
        `);
        expect(rows).toEqual([]);
    });

    it('is idempotent — re-opening does not duplicate sources or participants', async () => {
        const cycle = await octoberCycle();
        await cycleService.openCycle(cycle.id, fx.users.superuser.id);
        const s1 = await ReviewCycleSource.count({ where: { reviewCycleId: cycle.id } });
        const p1 = await ReviewCycleParticipant.count({ where: { reviewCycleId: cycle.id } });

        await cycleService.openCycle(cycle.id, fx.users.superuser.id);
        expect(await ReviewCycleSource.count({ where: { reviewCycleId: cycle.id } })).toBe(s1);
        expect(await ReviewCycleParticipant.count({ where: { reviewCycleId: cycle.id } })).toBe(p1);
    });

    it('freezes participants and assigns the one unambiguous lead', async () => {
        const cycle = await octoberCycle();
        await cycleService.openCycle(cycle.id, fx.users.superuser.id);

        const participants = await ReviewCycleParticipant.findAll({ where: { reviewCycleId: cycle.id } });
        const ids = participants.map(p => p.teamMemberId);
        expect(ids).toContain(fx.members.solo.id);
        expect(ids).toContain(fx.members.across.id);

        // leadA is the only 'lead' with access to A and B, so it resolves.
        const solo = participants.find(p => p.teamMemberId === fx.members.solo.id)!;
        expect(solo.reviewerUserId).toBe(fx.users.leadA.id);
    });
});

describe('scoring', () => {
    beforeEach(async () => {
        await passIdentityGate(fx.projectA.id, fx.users.superuser.id);
        await passIdentityGate(fx.projectB.id, fx.users.superuser.id);
        await makeConfig([fx.projectA.id, fx.projectB.id]);
        await generateCycles(fx.account.id, '2027-03-31');
        const cycle = await octoberCycle();
        await cycleService.openCycle(cycle.id, fx.users.superuser.id);
    });

    const scoreFor = async (teamMemberId: number) => {
        const cycle = await octoberCycle();
        const s = await ReviewMemberScore.findOne({ where: { reviewCycleId: cycle.id, teamMemberId } });
        if (!s) throw new Error(`No score for team member ${teamMemberId}`);
        return s;
    };

    /**
     * The assertion that catches the highest-value bug. With customer parked at
     * weight 0 and no lead review, these numbers must be exact — if overallCoverage
     * reads 100, or a customer factor is scored, the module ships inflated scores.
     */
    it('scores an un-reviewed developer at 0.6·system + 40 with 60% coverage, provisional', async () => {
        const s = await scoreFor(fx.members.solo.id);

        // 20 planned / 16 done / 0 rework / 0 reopened
        // deliveryPct 80 → executionScore 84 → system 0.85*84 + 0.15*100 = 86.4
        expect(Number(s.systemScore)).toBeCloseTo(86.4, 1);
        expect(Number(s.systemCoverage)).toBe(100);

        expect(Number(s.leadScore)).toBe(100);
        expect(s.leadPresent).toBe(false);
        expect(Number(s.leadCoverage)).toBe(0);

        expect(Number(s.compositeScore)).toBeCloseTo(0.6 * 86.4 + 40, 1);
        expect(Number(s.overallCoverage)).toBe(60);
        expect(s.isProvisional).toBe(true);

        // Customer is out of scope at weight 0 — not scored at all.
        expect(s.customerScore).toBeNull();
        expect(s.customerCoverage).toBeNull();
        expect(s.customerPresent).toBe(false);
    });

    it('scores a cross-project member ONCE, from summed counters', async () => {
        const cycle = await octoberCycle();
        const rows = await ReviewMemberScore.findAll({
            where: { reviewCycleId: cycle.id, teamMemberId: fx.members.across.id },
        });
        expect(rows).toHaveLength(1);

        const s = rows[0];
        // A: 10/10, B: 10/5 → 20 planned, 15 done → deliveryPct 75
        expect(Number(s.breakdown.aggregates!.spPlanned)).toBe(20);
        expect(Number(s.breakdown.aggregates!.spDone)).toBe(15);
        expect(Number(s.breakdown.aggregates!.deliveryPct)).toBeCloseTo(75, 1);

        const participant = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycle.id, teamMemberId: fx.members.across.id },
        });
        expect(participant!.contributingProjectIds.sort()).toEqual([fx.projectA.id, fx.projectB.id].sort());
    });

    /** The rollout-bounding property: out-of-scope work must not leak in. */
    it('scores a split member on the IN-SCOPE project alone', async () => {
        const s = await scoreFor(fx.members.split.id);

        // B alone is 10/10. Project C's 100 planned / 0 done would crater this.
        expect(Number(s.breakdown.aggregates!.spPlanned)).toBe(10);
        expect(Number(s.breakdown.aggregates!.spDone)).toBe(10);
        expect(Number(s.systemScore)).toBe(100);

        const cycle = await octoberCycle();
        const participant = await ReviewCycleParticipant.findOne({
            where: { reviewCycleId: cycle.id, teamMemberId: fx.members.split.id },
        });
        expect(participant!.contributingProjectIds).toEqual([fx.projectB.id]);
    });

    it('treats a below-floor member as missing, never as zero', async () => {
        const s = await scoreFor(fx.members.tiny.id);

        // The distinction that matters: `present = false` records that there was no
        // usable data, while the stored score is the EFFECTIVE value the composite
        // was built from. Storing the default rather than null keeps the row
        // reproducible — composite must be re-derivable from the stored factors.
        expect(s.systemPresent).toBe(false);
        expect(Number(s.systemScore)).toBe(100);
        expect(Number(s.systemCoverage)).toBe(0);

        // 2 story points is below the floor, so this is "insufficient data", never
        // a 0 that would read as a poor performer.
        expect(Number(s.systemScore)).not.toBe(0);
        expect(Number(s.compositeScore)).toBe(100);
        expect(s.isProvisional).toBe(true);
    });

    /**
     * The exact QA formula, re-derived from summed raw counters rather than from
     * averaged per-sprint rates. This is the path that was silently dead until the
     * accumulator columns were actually declared and persisted — an `as any` cast
     * on a non-existent model field made every QA score fall back to the proxy.
     */
    it('derives the QA rate from summed raw counters, with no approximation', async () => {
        const s = await scoreFor(fx.members.qa.id);
        expect(s.memberCategory).toBe('qa');

        // passRate 0.9, inSprintCatch 0.8 → (1 - (0.7*0.9 + 0.3*0.8)) * 100 = 13
        expect(Number(s.breakdown.aggregates!.qualityRate)).toBeCloseTo(13, 1);
        // 0.75*(100-13) + 0.25*(100-0) = 90.25
        expect(Number(s.systemScore)).toBeCloseTo(90.25, 1);

        // The exact path ran, so nothing was approximated.
        expect(s.breakdown.approximations ?? []).toEqual([]);
    });

    it('falls back to the documented proxy, and says so, when accumulators are absent', async () => {
        // Blank the raw counters to simulate a row synced before the columns existed.
        await PerfMemberScore.update(
            { clearedSp: null, uatFailedSp: null, inSprintBugCount: null, inSprintEligibleCount: null },
            { where: { projectId: fx.projectB.id, teamMemberId: fx.members.qa.id } },
        );
        const cycle = await octoberCycle();
        await cycleService.recomputeCycle(cycle.id, 'manual');

        const s = await scoreFor(fx.members.qa.id);
        // Proxy uses the stored per-sync rate (20) instead of re-deriving.
        expect(Number(s.breakdown.aggregates!.qualityRate)).toBe(20);
        expect(s.breakdown.approximations!.join(' ')).toMatch(/approximated/);
    });
});

describe('lead override validation', () => {
    beforeEach(async () => {
        await passIdentityGate(fx.projectA.id, fx.users.superuser.id);
        await passIdentityGate(fx.projectB.id, fx.users.superuser.id);
        await makeConfig([fx.projectA.id, fx.projectB.id]);
        await generateCycles(fx.account.id, '2027-03-31');
        const cycle = await octoberCycle();
        await cycleService.openCycle(cycle.id, fx.users.superuser.id);
    });

    const recompute = async () => {
        const cycle = await octoberCycle();
        await cycleService.recomputeCycle(cycle.id, 'manual');
        return ReviewMemberScore.findOne({
            where: { reviewCycleId: cycle.id, teamMemberId: fx.members.solo.id },
        });
    };

    it('applies an override inside its plausible range', async () => {
        await PerfMemberScore.update(
            { isOverridden: true, overriddenMetrics: { spDone: 20 } },
            { where: { projectId: fx.projectA.id, teamMemberId: fx.members.solo.id } },
        );
        const s = await recompute();

        // 16 done becomes 20 of 20 planned → full delivery.
        expect(Number(s!.breakdown.aggregates!.spDone)).toBe(20);
        expect(s!.breakdown.overridesApplied).toContain('spDone');
    });

    /**
     * `overridden_metrics` is free-form JSONB writable from the Team Performance
     * UI and flows straight into a published HR score, so a nonsense value must be
     * refused rather than applied.
     */
    it('refuses an out-of-range override and records the rejection', async () => {
        await PerfMemberScore.update(
            { isOverridden: true, overriddenMetrics: { spDone: -500 } },
            { where: { projectId: fx.projectA.id, teamMemberId: fx.members.solo.id } },
        );
        const s = await recompute();

        // Falls back to the computed 16 rather than poisoning the score.
        expect(Number(s!.breakdown.aggregates!.spDone)).toBe(16);
        expect(s!.breakdown.overridesApplied ?? []).not.toContain('spDone');
        expect((s!.breakdown as any).overridesRejected).toContain('spDone');
    });

    it('refuses an override on a metric that is not overridable', async () => {
        await PerfMemberScore.update(
            { isOverridden: true, overriddenMetrics: { compositeScore: 100, notAMetric: 5 } as any },
            { where: { projectId: fx.projectA.id, teamMemberId: fx.members.solo.id } },
        );
        const s = await recompute();

        // The real computation stands: 20 planned / 16 done.
        expect(Number(s!.breakdown.aggregates!.spDone)).toBe(16);
        expect(Number(s!.systemScore)).toBeCloseTo(86.4, 1);
    });

    it('refuses a non-numeric override', async () => {
        await PerfMemberScore.update(
            { isOverridden: true, overriddenMetrics: { spDone: 'all of them' } as any },
            { where: { projectId: fx.projectA.id, teamMemberId: fx.members.solo.id } },
        );
        const s = await recompute();
        expect(Number(s!.breakdown.aggregates!.spDone)).toBe(16);
        expect((s!.breakdown as any).overridesRejected).toContain('spDone');
    });
});

describe('source exclusion', () => {
    beforeEach(async () => {
        await passIdentityGate(fx.projectA.id, fx.users.superuser.id);
        await passIdentityGate(fx.projectB.id, fx.users.superuser.id);
        await makeConfig([fx.projectA.id, fx.projectB.id]);
        await generateCycles(fx.account.id, '2027-03-31');
        const cycle = await octoberCycle();
        await cycleService.openCycle(cycle.id, fx.users.superuser.id);
    });

    it('drops an excluded sprint from the score and shrinks coverage', async () => {
        const cycle = await octoberCycle();
        const before = await ReviewMemberScore.findOne({
            where: { reviewCycleId: cycle.id, teamMemberId: fx.members.across.id },
        });
        expect(Number(before!.breakdown.aggregates!.spPlanned)).toBe(20);

        const sourceB = await ReviewCycleSource.findOne({
            where: { reviewCycleId: cycle.id, projectId: fx.projectB.id },
        });
        await sourceB!.update({
            excluded: true,
            exclusionReason: 'Sprint cancelled mid-flight',
            excludedByUserId: fx.users.superuser.id,
        });
        await cycleService.recomputeCycle(cycle.id, 'manual');

        const after = await ReviewMemberScore.findOne({
            where: { reviewCycleId: cycle.id, teamMemberId: fx.members.across.id },
        });
        // Only project A's 10/10 remains.
        expect(Number(after!.breakdown.aggregates!.spPlanned)).toBe(10);
        expect(Number(after!.breakdown.aggregates!.spDone)).toBe(10);
    });
});

describe('lifecycle and freezing', () => {
    beforeEach(async () => {
        await passIdentityGate(fx.projectA.id, fx.users.superuser.id);
        await passIdentityGate(fx.projectB.id, fx.users.superuser.id);
        await makeConfig([fx.projectA.id, fx.projectB.id]);
        await generateCycles(fx.account.id, '2027-03-31');
        const cycle = await octoberCycle();
        await cycleService.openCycle(cycle.id, fx.users.superuser.id);
    });

    it('refuses to recompute a locked cycle', async () => {
        const cycle = await octoberCycle();
        await cycleService.transitionCycle(cycle.id, 'locked', 'done', fx.users.superuser.id);

        await expect(cycleService.recomputeCycle(cycle.id, 'manual')).rejects.toThrow(
            cycleService.FrozenCycleError,
        );
    });

    /**
     * The property the whole snapshot design exists for: a re-synced sprint must
     * not rewrite an artefact of record.
     */
    it('leaves a locked cycle byte-identical when its source data changes underneath', async () => {
        const cycle = await octoberCycle();
        await cycleService.transitionCycle(cycle.id, 'locked', 'done', fx.users.superuser.id);

        const before = await ReviewMemberScore.findOne({
            where: { reviewCycleId: cycle.id, teamMemberId: fx.members.solo.id },
        });
        const snapshot = {
            system: before!.systemScore,
            composite: before!.compositeScore,
            hash: before!.inputHash,
        };

        // Simulate a re-sync that changes the underlying delivery data.
        await PerfMemberScore.update(
            { spDone: 1 },
            { where: { projectId: fx.projectA.id, teamMemberId: fx.members.solo.id } },
        );
        await expect(cycleService.recomputeCycle(cycle.id, 'auto')).rejects.toThrow();

        const after = await ReviewMemberScore.findOne({
            where: { reviewCycleId: cycle.id, teamMemberId: fx.members.solo.id },
        });
        expect(after!.systemScore).toBe(snapshot.system);
        expect(after!.compositeScore).toBe(snapshot.composite);
        expect(after!.inputHash).toBe(snapshot.hash);
    });

    it('publishes every score in the cycle', async () => {
        const cycle = await octoberCycle();
        await cycleService.transitionCycle(cycle.id, 'locked', null, fx.users.superuser.id);
        await cycleService.transitionCycle(cycle.id, 'published', null, fx.users.superuser.id);

        const scores = await ReviewMemberScore.findAll({ where: { reviewCycleId: cycle.id } });
        expect(scores.length).toBeGreaterThan(0);
        expect(scores.every(s => s.isPublished)).toBe(true);

        const reloaded = await octoberCycle();
        expect(reloaded.status).toBe('published');
        expect(reloaded.publishedByUserId).toBe(fx.users.superuser.id);
    });

    it('rejects an illegal transition', async () => {
        const cycle = await octoberCycle();
        await expect(
            cycleService.transitionCycle(cycle.id, 'published', null, fx.users.superuser.id),
        ).rejects.toThrow(/Cannot move/);
    });
});
