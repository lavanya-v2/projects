import { Op } from 'sequelize';
import { createHash } from 'crypto';
import { ReviewCycle, ReviewCycleStatus, FROZEN_CYCLE_STATUSES } from '../../../models/ReviewCycle';
import { ReviewCycleConfig } from '../../../models/ReviewCycleConfig';
import { ReviewCycleSource } from '../../../models/ReviewCycleSource';
import { ReviewCycleParticipant, MemberCategory } from '../../../models/ReviewCycleParticipant';
import { ReviewMemberScore } from '../../../models/ReviewMemberScore';
import { ReviewStatusHistory } from '../../../models/ReviewStatusHistory';
import { Project } from '../../../models/Project';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { TeamMember } from '../../../models/TeamMember';
import { User } from '../../../models/User';
import { ReviewProjectSettings } from '../../../models/ReviewProjectSettings';
import { providerFor } from './factorProviders';
import type { SourceMemberMetrics } from './factorProviders/types';
import { computeSystemFactor } from './systemFactorService';
import { computeComposite, cumulativeFactor, computeTrend } from './compositeScoringService';
import { resolveScopeProjectIds } from './cycleGenerationService';
import { batchResolveUserRoles } from '../../risks/services/riskPermissions';
import { getUsersWithAccessToProjects } from '../../../common/projectAccess';
import { getLeadFactor } from './leadReviewService';

/**
 * Cycle orchestration — the service that turns the scoring engine into a workflow.
 *
 * There is no scheduler in v1: every transition here is triggered by a superuser
 * action or by a delivery sync completing. That is a deliberate simplification for
 * a one-or-two-project pilot, and it removes a whole class of silent misfire.
 */

/** Only these transitions are legal. `published` is never automatic. */
const ALLOWED_TRANSITIONS: Record<ReviewCycleStatus, ReviewCycleStatus[]> = {
    scheduled: ['open', 'archived'],
    open: ['locked', 'archived'],
    // Re-opening a locked cycle is permitted (a lead needs to fix something) but
    // publishing is the one-way door.
    locked: ['open', 'published', 'archived'],
    published: ['archived'],
    archived: [],
};

export class FrozenCycleError extends Error {
    constructor(cycleId: number, status: string) {
        super(`Review cycle ${cycleId} is ${status} and cannot be modified`);
        this.name = 'FrozenCycleError';
    }
}

async function loadCycle(cycleId: number): Promise<ReviewCycle> {
    const cycle = await ReviewCycle.findByPk(cycleId);
    if (!cycle) throw new Error(`Review cycle ${cycleId} not found`);
    return cycle;
}

const isFrozen = (cycle: ReviewCycle) => FROZEN_CYCLE_STATUSES.includes(cycle.status);

// ── Source attachment ───────────────────────────────────────────────────────

/**
 * Attach every completed delivery period whose END DATE falls inside the cycle
 * window, across all in-scope projects.
 *
 * End-date containment is the whole attachment rule: a sprint straddling two
 * cycles belongs to the one where it finished. Deterministic, never double
 * counted, and explainable to the person being reviewed.
 *
 * Idempotent — the unique index on (review_cycle_id, perf_sprint_sync_id) means
 * re-running only adds genuinely new sources.
 */
export async function attachSources(cycle: ReviewCycle): Promise<{ attached: number }> {
    const projectIds = await resolveScopeProjectIds(cycle);
    if (projectIds.length === 0) return { attached: 0 };

    const projects = await Project.findAll({ where: { id: { [Op.in]: projectIds } } });
    const window = { start: String(cycle.startDate).slice(0, 10), end: String(cycle.endDate).slice(0, 10) };

    const existing = await ReviewCycleSource.findAll({
        where: { reviewCycleId: cycle.id },
        attributes: ['perfSprintSyncId'],
    });
    const known = new Set(existing.map(s => s.perfSprintSyncId).filter(Boolean));

    let attached = 0;
    for (const project of projects) {
        const provider = providerFor(project);
        if (!provider) continue;

        const candidates = await provider.listSources(project.id, window);
        for (const c of candidates) {
            if (c.perfSprintSyncId !== null && known.has(c.perfSprintSyncId)) continue;
            await ReviewCycleSource.create({
                reviewCycleId: cycle.id,
                projectId: c.projectId,
                sourceType: c.sourceType,
                perfSprintSyncId: c.perfSprintSyncId,
                externalSourceId: c.externalSourceId,
                attachedBy: 'auto',
            });
            attached += 1;
        }
    }
    return { attached };
}

/**
 * Attach a newly-completed sync to any OPEN cycle whose window claims it.
 *
 * Called from performanceSyncService once a sync finishes. Deliberately ignores
 * locked and published cycles: a re-sync must never rewrite an artefact of record.
 */
export async function attachSyncToOpenCycles(
    projectId: number,
    syncId: number,
    endDate: string,
    syncType: string,
): Promise<number[]> {
    const project = await Project.findByPk(projectId, { attributes: ['id', 'accountId'] });
    if (!project) return [];

    const day = String(endDate).slice(0, 10);
    const cycles = await ReviewCycle.findAll({
        where: {
            accountId: (project as any).accountId,
            status: 'open',
            startDate: { [Op.lte]: day },
            endDate: { [Op.gte]: day },
        },
    });

    const touched: number[] = [];
    for (const cycle of cycles) {
        const scope = await resolveScopeProjectIds(cycle);
        if (!scope.includes(projectId)) continue;

        const [, created] = await ReviewCycleSource.findOrCreate({
            where: { reviewCycleId: cycle.id, perfSprintSyncId: syncId },
            defaults: {
                reviewCycleId: cycle.id,
                projectId,
                sourceType: syncType === 'kanban' ? 'kanban' : 'sprint',
                perfSprintSyncId: syncId,
                externalSourceId: null,
                attachedBy: 'auto',
            } as any,
        });
        if (created) touched.push(cycle.id);
    }
    return touched;
}

// ── Participants ────────────────────────────────────────────────────────────

/**
 * Default reviewer: a lead who can access the project the person contributed most
 * to.
 *
 * There is no projects.lead_id in this codebase, so "the lead of a project" has to
 * be derived from user_permissions overlap. When that is ambiguous — several leads
 * with access, or none — the reviewer is left NULL for a superuser to assign
 * rather than guessed at. An HR artefact should not record an accountable person
 * chosen by coin flip.
 */
async function resolveDefaultReviewer(projectId: number): Promise<number | null> {
    // getUsersWithAccessToProjects, not a raw Op.contains check — a raw check
    // only matches an EXPLICIT project id in the array, silently missing anyone
    // with full-account access (empty projectIds, the normal shape for an
    // account-wide grant) or program-scoped access. That gap is exactly what
    // made a real Thrive manager with full-account access invisible here.
    const accessByUser = await getUsersWithAccessToProjects([projectId]);
    const candidateIds = [...accessByUser.keys()];
    if (candidateIds.length === 0) return null;

    const roles = await batchResolveUserRoles(candidateIds);
    const leads = candidateIds.filter(id => roles.get(id) === 'lead');

    return leads.length === 1 ? leads[0] : null;
}

/** Roles a person can be manually assigned to review from — broader than
 * resolveDefaultReviewer's stricter "exactly one lead" auto-pick criterion. */
const REVIEWER_ROLES = new Set(['lead', 'manager', 'admin', 'superuser']);

/**
 * For every participant in a cycle, who could plausibly review them — active
 * lead/manager/admin/superuser users with permission on at least one project
 * that person actually contributed to.
 *
 * Exists because ParticipantAssignmentPage's reviewer picker used to list every
 * reviewer-eligible user in the whole account regardless of project — on CCM
 * that is 50+ names to search for the 2-3 who are actually relevant to one
 * person. This is the same candidate pool resolveDefaultReviewer already draws
 * auto-assignment from, just not narrowed to the unambiguous case.
 */
export async function getEligibleReviewers(
    cycleId: number,
): Promise<Record<number, Array<{ id: number; firstName: string; lastName: string; roleName: string }>>> {
    const participants = await ReviewCycleParticipant.findAll({ where: { reviewCycleId: cycleId } });
    if (participants.length === 0) return {};

    const allProjectIds = [...new Set(participants.flatMap(p => p.contributingProjectIds ?? []))];
    if (allProjectIds.length === 0) return {};

    // One query covering every contributing project across the whole cycle,
    // rather than one per participant — expanded through the same
    // full-account/program-scoped rules as resolveDefaultReviewer, not a raw
    // Op.overlap that only matches explicit project ids.
    const projectsByUser = await getUsersWithAccessToProjects(allProjectIds);

    const candidateIds = [...projectsByUser.keys()];
    const [roles, users] = await Promise.all([
        batchResolveUserRoles(candidateIds),
        User.findAll({ where: { id: { [Op.in]: candidateIds } }, attributes: ['id', 'firstName', 'lastName', 'isActive'] }),
    ]);
    const userById = new Map(users.map(u => [u.id, u]));

    const pool = candidateIds
        .filter(id => userById.get(id)?.isActive && REVIEWER_ROLES.has(roles.get(id) ?? ''))
        .map(id => ({
            id,
            firstName: userById.get(id)!.firstName,
            lastName: userById.get(id)!.lastName,
            roleName: roles.get(id)!,
            projectIds: projectsByUser.get(id)!,
        }))
        .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));

    const result: Record<number, Array<{ id: number; firstName: string; lastName: string; roleName: string }>> = {};
    for (const participant of participants) {
        const contributing = participant.contributingProjectIds ?? [];
        result[participant.teamMemberId] = pool
            .filter(r => contributing.some(pid => r.projectIds.has(pid)))
            .map(({ id, firstName, lastName, roleName }) => ({ id, firstName, lastName, roleName }));
    }
    return result;
}

/**
 * Reviewer-eligible users for a single project, directly — no cycle or
 * participants required. Exists for the setup wizard, where a default
 * reviewer is chosen before any cycle exists to derive it from. Same
 * candidate pool and role check as `getEligibleReviewers`, just keyed by
 * project id instead of by an existing cycle's participants.
 */
export async function getEligibleReviewersForProject(
    projectId: number,
): Promise<Array<{ id: number; firstName: string; lastName: string; roleName: string }>> {
    const accessByUser = await getUsersWithAccessToProjects([projectId]);
    const candidateIds = [...accessByUser.keys()];
    if (candidateIds.length === 0) return [];

    const [roles, users] = await Promise.all([
        batchResolveUserRoles(candidateIds),
        User.findAll({ where: { id: { [Op.in]: candidateIds } }, attributes: ['id', 'firstName', 'lastName', 'isActive'] }),
    ]);
    const userById = new Map(users.map(u => [u.id, u]));

    return candidateIds
        .filter(id => userById.get(id)?.isActive && REVIEWER_ROLES.has(roles.get(id) ?? ''))
        .map(id => ({
            id,
            firstName: userById.get(id)!.firstName,
            lastName: userById.get(id)!.lastName,
            roleName: roles.get(id)!,
        }))
        .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
}

/**
 * Freeze the participant roster.
 *
 * Participants are the people with delivery data in scope during the window,
 * resolved through CONFIRMED identity links — the provider already drops rows with
 * no resolved team member, so an unconfirmed identity simply never becomes a
 * participant rather than silently becoming an unattributed one.
 *
 * Preserves any reviewer a superuser has already assigned.
 */
export async function freezeParticipants(
    cycle: ReviewCycle,
    metricsByMember: Map<number, SourceMemberMetrics[]>,
): Promise<{ participants: number }> {
    const existing = await ReviewCycleParticipant.findAll({ where: { reviewCycleId: cycle.id } });
    const byMember = new Map(existing.map(p => [p.teamMemberId, p]));

    const memberIds = [...metricsByMember.keys()];
    const rosterRows = memberIds.length
        ? await AccountTeamMember.findAll({
              where: { accountId: cycle.accountId, teamMemberId: { [Op.in]: memberIds } },
          })
        : [];
    const rosterByMember = new Map<number, any>();
    for (const r of rosterRows) rosterByMember.set((r as any).teamMemberId, r);

    // A reviewer who is also the person being reviewed — e.g. a project's default
    // reviewer happens to be one of its own participants — must never be assigned
    // automatically. Loaded once per freeze rather than per member.
    const teamMembers = memberIds.length
        ? await TeamMember.findAll({ where: { id: { [Op.in]: memberIds } }, attributes: ['id', 'userId'] })
        : [];
    const loginByMember = new Map(teamMembers.map(t => [t.id, (t as any).userId as number | null]));

    // Cache reviewer lookups: many members share a dominant project.
    const reviewerCache = new Map<number, number | null>();
    const projectSettingsCache = new Map<number, number | null>();

    for (const [teamMemberId, rows] of metricsByMember) {
        const factor = computeSystemFactor(rows, 1); // category + projects only
        const contributing = factor.contributingProjectIds;

        // Dominant project by volume — the one whose lead reviews this person.
        const volumeByProject = new Map<number, number>();
        for (const r of rows) {
            const v = (r.spDone ?? 0) + (r.ticketsTested ?? 0) + (r.deliveredCount ?? 0);
            volumeByProject.set(r.projectId, (volumeByProject.get(r.projectId) ?? 0) + Math.max(v, 0.001));
        }
        const dominantProject = [...volumeByProject.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

        let reviewerUserId: number | null = null;
        if (dominantProject !== undefined) {
            // An explicit default reviewer set for the dominant project (Setup
            // Wizard, Phase 10) wins over the single-unambiguous-lead auto-pick —
            // it's a deliberate human choice, not a guess.
            if (!projectSettingsCache.has(dominantProject)) {
                const settings = await ReviewProjectSettings.findOne({ where: { projectId: dominantProject } });
                projectSettingsCache.set(dominantProject, settings?.defaultReviewerUserId ?? null);
            }
            const explicitDefault = projectSettingsCache.get(dominantProject) ?? null;

            if (explicitDefault !== null) {
                reviewerUserId = explicitDefault;
            } else {
                if (!reviewerCache.has(dominantProject)) {
                    reviewerCache.set(dominantProject, await resolveDefaultReviewer(dominantProject));
                }
                reviewerUserId = reviewerCache.get(dominantProject) ?? null;
            }
        }

        // Never auto-assign someone to review their own record — whether picked
        // via an explicit project default or the single-unambiguous-lead
        // heuristic, both apply uniformly to a project's people and have no way
        // to know one of them is also the subject. Left null, same as any other
        // ambiguous case, for a superuser to assign by hand.
        if (reviewerUserId !== null && reviewerUserId === loginByMember.get(teamMemberId)) {
            reviewerUserId = null;
        }

        const roster = rosterByMember.get(teamMemberId);
        const snapshot = {
            rosterRole: roster?.role ?? null,
            dominantProjectId: dominantProject ?? null,
            frozenAt: new Date().toISOString(),
        };

        const found = byMember.get(teamMemberId);
        if (found) {
            await found.update({
                memberCategory: factor.category,
                contributingProjectIds: contributing,
                // Never overwrite a reviewer a human has chosen.
                reviewerUserId: found.reviewerUserId ?? reviewerUserId,
                rosterSnapshot: snapshot,
            });
        } else {
            await ReviewCycleParticipant.create({
                reviewCycleId: cycle.id,
                teamMemberId,
                memberCategory: factor.category as MemberCategory,
                reviewerUserId,
                contributingProjectIds: contributing,
                rosterSnapshot: snapshot,
            });
        }
    }

    return { participants: metricsByMember.size };
}

// ── Metrics gathering ───────────────────────────────────────────────────────

/**
 * Coverage denominator for one member.
 *
 * Counts only the sources in the projects that member actually worked in — NOT
 * every source on the cycle. Because a cycle spans projects, a developer working
 * solely on project A would otherwise be scored against project B's sprints too
 * and capped at 50% coverage forever, for work that was never theirs to do.
 * Coverage must mean "how much of the evidence that could exist for this person do
 * we have", so a missed sprint in their OWN project still reduces it.
 */
function coverageDenominator(
    rows: SourceMemberMetrics[],
    sourcesByProject: Map<number, number>,
): number {
    const projects = new Set(rows.map(r => r.projectId));
    let total = 0;
    for (const projectId of projects) total += sourcesByProject.get(projectId) ?? 0;
    return total;
}

/** Load per-member metrics for a cycle's non-excluded sources, grouped by member. */
async function gatherMetrics(cycleId: number): Promise<{
    byMember: Map<number, SourceMemberMetrics[]>;
    sourceCount: number;
    sourcesByProject: Map<number, number>;
    /** Resolved once here so the breakdown can label a source by project NAME, not id. */
    projectNames: Map<number, string>;
}> {
    const sources = await ReviewCycleSource.findAll({
        where: { reviewCycleId: cycleId, excluded: false },
    });
    if (sources.length === 0) {
        return { byMember: new Map(), sourceCount: 0, sourcesByProject: new Map(), projectNames: new Map() };
    }

    const sourcesByProject = new Map<number, number>();
    for (const s of sources) {
        sourcesByProject.set(s.projectId, (sourcesByProject.get(s.projectId) ?? 0) + 1);
    }

    const projects = await Project.findAll({
        where: { id: { [Op.in]: [...new Set(sources.map(s => s.projectId))] } },
    });
    const projectById = new Map(projects.map(p => [p.id, p]));

    // Group by provider so each is queried once rather than per source.
    const byProvider = new Map<string, { provider: ReturnType<typeof providerFor>; sources: any[] }>();
    for (const s of sources) {
        const project = projectById.get(s.projectId);
        if (!project) continue;
        const provider = providerFor(project);
        if (!provider) continue;
        const entry = byProvider.get(provider.id) ?? { provider, sources: [] };
        entry.sources.push({
            sourceId: s.id,
            projectId: s.projectId,
            perfSprintSyncId: s.perfSprintSyncId,
            externalSourceId: s.externalSourceId,
        });
        byProvider.set(provider.id, entry);
    }

    const byMember = new Map<number, SourceMemberMetrics[]>();
    for (const { provider, sources: list } of byProvider.values()) {
        if (!provider) continue;
        const metrics = await provider.getMemberMetrics(list);
        for (const m of metrics) {
            const arr = byMember.get(m.teamMemberId) ?? [];
            arr.push(m);
            byMember.set(m.teamMemberId, arr);
        }
    }

    const projectNames = new Map(projects.map(p => [p.id, (p as any).name as string]));
    return { byMember, sourceCount: sources.length, sourcesByProject, projectNames };
}

/**
 * The lead factor for a member in a cycle.
 *
 * Absent until a review is submitted, which by the missing-factor rule scores 100
 * at zero coverage and flags the composite Provisional — the correct pre-review
 * state. A draft never counts.
 */
async function loadLeadFactor(
    cycleId: number,
    teamMemberId: number,
): Promise<{ score: number | null; present: boolean; coverage: number }> {
    const { score, present, coverage } = await getLeadFactor(cycleId, teamMemberId);
    return { score, present, coverage };
}

function hashInputs(rows: SourceMemberMetrics[]): string {
    const canonical = rows
        .map(r => `${r.sourceId}:${r.spPlanned}:${r.spDone}:${r.spRework}:${r.deliveredCount}:${r.reopenedCount}:${r.ticketsTested}:${r.qualityRate}`)
        .sort()
        .join('|');
    return createHash('sha256').update(canonical).digest('hex').slice(0, 64);
}

// ── Recompute ───────────────────────────────────────────────────────────────

/**
 * Recompute and persist every participant's score for a cycle.
 *
 * Refuses on a frozen cycle. This is the guard that stops a re-synced sprint from
 * silently rewriting a published HR score months later — the reason scores are
 * snapshotted rather than computed on read.
 */
export async function recomputeCycle(
    cycleId: number,
    computedBy: 'auto' | 'manual' = 'auto',
): Promise<{ scored: number }> {
    const cycle = await loadCycle(cycleId);
    if (isFrozen(cycle)) throw new FrozenCycleError(cycleId, cycle.status);

    const { byMember, sourcesByProject, projectNames } = await gatherMetrics(cycleId);

    // Someone confirmed via Identity Resolution after this cycle opened has no
    // participant row yet — freezeParticipants is idempotent (keys off
    // teamMemberId, preserves any reviewer already assigned) so re-running it
    // here is exactly how a newly-resolved person joins an already-open cycle,
    // without redoing anything else. Guarded by the isFrozen check above, same
    // as everything else in this function.
    await freezeParticipants(cycle, byMember);

    const participants = await ReviewCycleParticipant.findAll({
        where: { reviewCycleId: cycleId, isExcluded: false },
    });

    // Prior cycles in the same review year, for cumulative and trend. A
    // catch-up cycle (Phase 12d) is reserved outside the normal 1..N sequence
    // (sequenceNo 0) specifically so it never participates in period-over-
    // period trend or YTD cumulative math — excluded explicitly here rather
    // than relying on the reserved sequence number alone, since `Op.lt` would
    // otherwise still pick it up as "prior" to the review year's first real
    // cycle.
    const priorCycles = await ReviewCycle.findAll({
        where: {
            accountId: cycle.accountId,
            reviewYear: cycle.reviewYear,
            sequenceNo: { [Op.lt]: cycle.sequenceNo },
            isCatchUp: false,
        },
        order: [['sequenceNo', 'ASC']],
    });
    const priorScores = priorCycles.length
        ? await ReviewMemberScore.findAll({
              where: { reviewCycleId: { [Op.in]: priorCycles.map(c => c.id) } },
          })
        : [];
    const priorByMember = new Map<number, ReviewMemberScore[]>();
    for (const s of priorScores) {
        const arr = priorByMember.get(s.teamMemberId) ?? [];
        arr.push(s);
        priorByMember.set(s.teamMemberId, arr);
    }

    // Cumulative system is re-derived from summed RAW counters across the year,
    // not averaged from period scores — averaging percentages with different
    // denominators is wrong.
    const priorMetrics = new Map<number, SourceMemberMetrics[]>();
    const cumulativeSourcesByProject = new Map(sourcesByProject);
    for (const pc of priorCycles) {
        const g = await gatherMetrics(pc.id);
        for (const [projectId, n] of g.sourcesByProject) {
            cumulativeSourcesByProject.set(projectId, (cumulativeSourcesByProject.get(projectId) ?? 0) + n);
        }
        for (const [memberId, rows] of g.byMember) {
            priorMetrics.set(memberId, [...(priorMetrics.get(memberId) ?? []), ...rows]);
        }
    }

    // A published score is a record a member has already been shown, individually,
    // when their lead published their review (see leadReviewService.publishReview).
    // A cycle-wide recompute — triggered by someone else's review, or a re-sync —
    // must not silently move a number someone has already read. Loaded once, up
    // front, so the skip is a plain lookup rather than a query per participant.
    const alreadyPublished = new Set(
        (
            await ReviewMemberScore.findAll({
                where: { reviewCycleId: cycleId, isPublished: true },
                attributes: ['teamMemberId'],
            })
        ).map(s => s.teamMemberId),
    );

    let scored = 0;
    for (const p of participants) {
        if (alreadyPublished.has(p.teamMemberId)) continue;

        const rows = byMember.get(p.teamMemberId) ?? [];
        const system = computeSystemFactor(rows, coverageDenominator(rows, sourcesByProject));
        const lead = await loadLeadFactor(cycleId, p.teamMemberId);

        const result = computeComposite({
            system: {
                weight: Number(cycle.weightSystem),
                score: system.score,
                present: system.present,
                coverage: system.coverage,
            },
            lead: { weight: Number(cycle.weightLead), ...lead },
            customer: { weight: Number(cycle.weightCustomer), score: null, present: false, coverage: 0 },
        });

        // Cumulative
        const allRows = [...(priorMetrics.get(p.teamMemberId) ?? []), ...rows];
        const cumSystem = computeSystemFactor(
            allRows,
            coverageDenominator(allRows, cumulativeSourcesByProject),
        );
        const history = priorByMember.get(p.teamMemberId) ?? [];
        const cumLead = cumulativeFactor([
            ...history.map(h => ({
                score: h.leadScore === null ? null : Number(h.leadScore),
                coverage: Number(h.leadCoverage ?? 0),
                present: h.leadPresent,
            })),
            { score: lead.score, coverage: lead.coverage, present: lead.present },
        ]);

        const ordered = [...history].sort((a, b) => a.reviewCycleId - b.reviewCycleId);
        const previous = ordered.length > 0 ? ordered[ordered.length - 1] : undefined;
        const trend = computeTrend(
            result.composite,
            previous?.compositeScore === null || previous?.compositeScore === undefined
                ? null
                : Number(previous.compositeScore),
        );

        const values = {
            reviewCycleId: cycleId,
            teamMemberId: p.teamMemberId,
            memberCategory: p.memberCategory,
            weightSystem: Number(cycle.weightSystem),
            weightLead: Number(cycle.weightLead),
            weightCustomer: Number(cycle.weightCustomer),

            systemScore: result.factors.system.inScope ? result.factors.system.score : null,
            leadScore: result.factors.lead.inScope ? result.factors.lead.score : null,
            customerScore: result.factors.customer.inScope ? result.factors.customer.score : null,
            compositeScore: result.composite,

            systemPresent: system.present,
            leadPresent: lead.present,
            customerPresent: false,

            systemCoverage: result.factors.system.inScope ? result.factors.system.coverage : null,
            leadCoverage: result.factors.lead.inScope ? result.factors.lead.coverage : null,
            customerCoverage: result.factors.customer.inScope ? result.factors.customer.coverage : null,
            overallCoverage: result.overallCoverage,
            isProvisional: result.isProvisional,

            cumSystemScore: cumSystem.score,
            cumLeadScore: cumLead.score,
            cumCustomerScore: null,
            cumCompositeScore: computeComposite({
                system: {
                    weight: Number(cycle.weightSystem),
                    score: cumSystem.score,
                    present: cumSystem.present,
                    coverage: cumSystem.coverage,
                },
                lead: {
                    weight: Number(cycle.weightLead),
                    score: cumLead.score,
                    present: cumLead.cyclesCounted > 0,
                    coverage: cumLead.coverage,
                },
                customer: { weight: Number(cycle.weightCustomer), score: null, present: false, coverage: 0 },
            }).composite,
            cumCoverage: cumSystem.coverage,
            cumCyclesCount: priorCycles.length + 1,

            trendDirection: trend.direction,
            trendDelta: trend.delta,

            breakdown: {
                sources: rows.map(r => ({
                    sourceId: r.sourceId,
                    projectId: r.projectId,
                    projectName: projectNames.get(r.projectId) ?? null,
                    // The sprint's own identity — without this, two sprints from the
                    // same project are indistinguishable in the evidence drill-down:
                    // same projectId, no way to tell which row is which.
                    periodLabel: r.periodLabel ?? null,
                    startDate: r.startDate ?? null,
                    endDate: r.endDate ?? null,
                    spPlanned: r.spPlanned,
                    spDone: r.spDone,
                    qualityRate: r.qualityRate,
                })),
                aggregates: system.aggregates,
                unavailableMetrics: system.unavailableMetrics,
                approximations: system.approximations,
                overridesApplied: system.overridesApplied,
                overridesRejected: system.overridesRejected,
                categoryFlips: system.categoryFlips,
                effectiveWeights: result.effectiveWeights,
            },
            computedAt: new Date(),
            computedBy,
            engineVersion: 'v1',
            inputHash: hashInputs(rows),
        };

        const existing = await ReviewMemberScore.findOne({
            where: { reviewCycleId: cycleId, teamMemberId: p.teamMemberId },
        });
        if (existing) await existing.update(values);
        else await ReviewMemberScore.create(values as any);

        // Keep the participant's category and contributing projects in step.
        await p.update({
            memberCategory: system.category as MemberCategory,
            contributingProjectIds: system.contributingProjectIds,
        });
        scored += 1;
    }

    return { scored };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Open a cycle: snapshot config, attach sources, freeze participants, score.
 *
 * Config is snapshotted HERE rather than at generation, because cycles are
 * materialised months ahead and the weights that matter are the ones in force
 * when the period actually opens.
 */
export async function openCycle(cycleId: number, userId: number): Promise<{
    attached: number;
    participants: number;
    scored: number;
}> {
    const cycle = await loadCycle(cycleId);
    if (cycle.status !== 'scheduled' && cycle.status !== 'open') {
        throw new Error(`Cannot open a cycle in status '${cycle.status}'`);
    }

    const config = await ReviewCycleConfig.findByPk(cycle.configId);
    if (!config) throw new Error(`Config ${cycle.configId} not found`);
    if (!config.isEnabled) throw new Error('Review cycles are not enabled for this account');

    if (cycle.status === 'scheduled') {
        await cycle.update({
            weightSystem: config.weightSystem,
            weightLead: config.weightLead,
            weightCustomer: config.weightCustomer,
            leadTemplateId: config.leadTemplateId,
            scopeProjectIds: config.scopeProjectIds ?? [],
            status: 'open',
            openedAt: new Date(),
        });
        await recordTransition(cycleId, 'scheduled', 'open', 'Cycle opened', userId);
    }

    const { attached } = await attachSources(cycle);
    const { byMember } = await gatherMetrics(cycleId);
    const { participants } = await freezeParticipants(cycle, byMember);
    const { scored } = await recomputeCycle(cycleId, 'auto');

    return { attached, participants, scored };
}

/** Validate and apply a status transition, recording it. */
export async function transitionCycle(
    cycleId: number,
    toStatus: ReviewCycleStatus,
    note: string | null,
    userId: number,
): Promise<ReviewCycle> {
    const cycle = await loadCycle(cycleId);
    const allowed = ALLOWED_TRANSITIONS[cycle.status] ?? [];
    if (!allowed.includes(toStatus)) {
        throw new Error(`Cannot move a cycle from '${cycle.status}' to '${toStatus}'`);
    }

    if (toStatus === 'open' && cycle.status === 'scheduled') {
        await openCycle(cycleId, userId);
        return loadCycle(cycleId);
    }

    const patch: Record<string, unknown> = { status: toStatus };
    if (toStatus === 'locked') {
        // Final recompute BEFORE freezing, so the artefact reflects the latest data.
        await recomputeCycle(cycleId, 'auto');
        patch.lockedAt = new Date();
    }
    if (toStatus === 'published') {
        patch.publishedAt = new Date();
        patch.publishedByUserId = userId;
        // Publication is what makes a score visible to the member being reviewed.
        // Scoped to rows NOT already published: leadReviewService.publishReview may
        // have already published one person's score at the moment their individual
        // review was published, and that publishedAt is the timestamp they were
        // actually shown their number — a cycle-wide publish must not overwrite it.
        await ReviewMemberScore.update(
            { isPublished: true, publishedAt: new Date() },
            { where: { reviewCycleId: cycleId, isPublished: false } },
        );
    }
    if (toStatus === 'open' && cycle.status === 'locked') {
        patch.lockedAt = null;
    }

    const from = cycle.status;
    await cycle.update(patch);
    await recordTransition(cycleId, from, toStatus, note, userId);
    return cycle;
}

async function recordTransition(
    cycleId: number,
    from: string | null,
    to: string,
    note: string | null,
    userId: number,
): Promise<void> {
    await ReviewStatusHistory.create({
        entityType: 'cycle',
        entityId: cycleId,
        fromStatus: from,
        toStatus: to,
        note,
        changedByUserId: userId,
    });
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Postgres/Sequelize hand back DECIMAL columns as strings; every other read path
 * in this module (teamMemberHistoryService, memberReviewController) coerces
 * explicitly for exactly this reason — arithmetic on the raw value silently does
 * string concatenation instead of addition. */
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getCycleScores(cycleId: number) {
    const scores = await ReviewMemberScore.findAll({
        where: { reviewCycleId: cycleId },
        include: [{ model: TeamMember, attributes: ['id', 'firstName', 'lastName', 'email'] }],
    });
    const participants = await ReviewCycleParticipant.findAll({ where: { reviewCycleId: cycleId } });
    const byMember = new Map(participants.map(p => [p.teamMemberId, p]));

    return scores.map(s => ({
        ...s.toJSON(),
        weightSystem: numOrNull(s.weightSystem),
        weightLead: numOrNull(s.weightLead),
        weightCustomer: numOrNull(s.weightCustomer),
        systemScore: numOrNull(s.systemScore),
        leadScore: numOrNull(s.leadScore),
        customerScore: numOrNull(s.customerScore),
        compositeScore: numOrNull(s.compositeScore),
        systemCoverage: numOrNull(s.systemCoverage),
        leadCoverage: numOrNull(s.leadCoverage),
        customerCoverage: numOrNull(s.customerCoverage),
        overallCoverage: numOrNull(s.overallCoverage),
        cumSystemScore: numOrNull(s.cumSystemScore),
        cumLeadScore: numOrNull(s.cumLeadScore),
        cumCustomerScore: numOrNull(s.cumCustomerScore),
        cumCompositeScore: numOrNull(s.cumCompositeScore),
        cumCoverage: numOrNull(s.cumCoverage),
        trendDelta: numOrNull(s.trendDelta),
        contributingProjectIds: byMember.get(s.teamMemberId)?.contributingProjectIds ?? [],
        reviewerUserId: byMember.get(s.teamMemberId)?.reviewerUserId ?? null,
    }));
}

/** Assign or clear a participant's reviewer, or exclude them from the cycle. */
export async function updateParticipant(
    participantId: number,
    patch: { reviewerUserId?: number | null; isExcluded?: boolean; exclusionReason?: string | null },
): Promise<ReviewCycleParticipant> {
    const participant = await ReviewCycleParticipant.findByPk(participantId);
    if (!participant) throw new Error(`Participant ${participantId} not found`);

    const cycle = await loadCycle(participant.reviewCycleId);
    if (isFrozen(cycle)) throw new FrozenCycleError(cycle.id, cycle.status);

    await participant.update(patch);
    return participant;
}
