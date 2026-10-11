import { Op } from 'sequelize';
import { PerfIdentityLink, IdentitySource, IdentityMatchMethod } from '../../../models/PerfIdentityLink';
import { PerfMemberScore } from '../../../models/PerfMemberScore';
import { TeamMember } from '../../../models/TeamMember';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { Project } from '../../../models/Project';
import { normalizeName, compactName, levenshtein } from '../../reports/services/perfAggregation';

/**
 * Identity resolution — the foundation the whole performance review module sits on.
 *
 * The three data sources share no key: perf_member_scores.jira_login_id is a Jira
 * accountId, team_members.jira_login_id is an email-style login, and users bridge
 * to team_members by email. Everything downstream of this service works in terms
 * of team_member_id and never sees a jira_login_id.
 *
 * ROSTER-DRIVEN, NOT JIRA-DRIVEN. account_team_members already states exactly who
 * a project's reviewable team members are. This service resolves FROM the roster
 * OUTWARD to the delivery identity that belongs to each of them — never the other
 * way around. A delivery identity with no roster counterpart (overwhelmingly the
 * customer's own staff, in a shared Jira instance) is simply never looked at: no
 * suggestion, no reject action, no effect on coverage. It shows up only as an
 * informational row count, never as a decision.
 *
 * Matching is pure database comparison against already-synced perf_member_scores
 * display names — no live Jira call. A synced sprint already carries everything
 * needed to tell "this row is Priya Nair" from a name on the roster; nothing here
 * needs to ask Jira anything in real time.
 *
 * The fuzzy matching is retained here ONLY to propose `suggested` links. Nothing
 * fuzzy is ever trusted for scoring: a link must be `confirmed` by a superuser
 * before it attributes delivery data to a person.
 */

/** A link must be confirmed before it can attribute delivery data to a person. */
const TRUSTED_STATUS = 'confirmed' as const;

/** Below this, a suggestion is recorded but flagged as needing a careful look. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

export interface IdentityCandidate {
    sourceKey: string;
    sourceDisplayName: string | null;
    /** 1.0 exact Jira login · 0.95 email · 0.9 exact name · 0.75 substring · 0.6 spelling */
    confidence: number;
    method: IdentityMatchMethod;
    /** Human-readable justification, shown in the confirmation UI. */
    rationale: string;
    /** How many score rows carry this identity. */
    scoreRowCount: number;
}

export interface UnresolvedMember {
    teamMemberId: number;
    teamMemberName: string;
    email: string;
    /** Set when the seeder has already proposed a specific identity for this person. */
    linkId: number | null;
    /** Ranked delivery identities that could plausibly be this person, best first. */
    candidates: IdentityCandidate[];
}

export interface IdentityCoverage {
    projectId: number;
    /** Roster members this project's delivery data actually has something to say about. */
    totalRosterMembers: number;
    resolvedMembers: number;
    /** resolvedMembers / totalRosterMembers. THE GATE — must reach 100. */
    linkedPct: number;
    /** Roster members with no confirmed identity yet. THE BLOCKER. */
    undecidedKeyCount: number;
    /** Suggestions a human has dismissed as the wrong identity for that person. */
    rejectedKeyCount: number;
    /** Confirmed links that no longer match any perf row — usually a leaver. */
    staleLinkCount: number;
    suggestedPendingCount: number;
    /**
     * Score rows belonging to a delivery identity with no roster counterpart at
     * all — overwhelmingly client-side staff in the customer's own Jira. A
     * sanity check only: never a gate, never a list to act on.
     */
    nonRosterRowCount: number;
    totalScoreRows: number;
}

function fullName(m: TeamMember): string {
    return `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim();
}

/**
 * Score one delivery identity against one roster member.
 *
 * Confidence tiers, always graded rather than boolean so weaker matches can be
 * sorted to the top for review:
 *   1.00  exact jira_login_id           — canonical, no ambiguity
 *   0.95  exact email                   — canonical
 *   0.90  exact normalized display name — the common case
 *   0.75  compact substring             — compound first names
 *   0.60  Levenshtein <= 2 on compact   — spelling drift; always needs a human
 *
 * Returns null when nothing lines up — a correct outcome, not a failure; it means
 * this person needs a manual link.
 */
function scoreIdentityForMember(
    member: TeamMember,
    sourceKey: string,
    sourceDisplayName: string | null,
): { confidence: number; method: IdentityMatchMethod; rationale: string } | null {
    const keyLower = sourceKey.trim().toLowerCase();
    const memberNorm = normalizeName(fullName(member));
    const memberCompact = compactName(fullName(member));
    const memberTokens = memberNorm.split(/\s+/).filter(Boolean).length;
    const candNorm = normalizeName(sourceDisplayName);
    const candCompact = compactName(sourceDisplayName);
    const candTokens = candNorm.split(/\s+/).filter(Boolean).length;

    if (member.jiraLoginId && member.jiraLoginId.trim().toLowerCase() === keyLower) {
        return { confidence: 1.0, method: 'auto_email', rationale: 'Exact Jira login match' };
    }
    if (member.email && member.email.trim().toLowerCase() === keyLower) {
        return { confidence: 0.95, method: 'auto_email', rationale: 'Exact email match' };
    }
    if (memberNorm && memberNorm === candNorm) {
        return { confidence: 0.9, method: 'auto_fuzzy', rationale: `Delivery data shows "${sourceDisplayName}"` };
    }
    if (memberCompact && candCompact) {
        // Compact substring: the shorter side must be >= 6 chars or carry >= 2
        // tokens, so "anu" does not match "anuradha".
        const memberIsShorter = memberCompact.length <= candCompact.length;
        const shorterCompact = memberIsShorter ? memberCompact : candCompact;
        const shorterTokens = memberIsShorter ? memberTokens : candTokens;
        const longerCompact = memberIsShorter ? candCompact : memberCompact;

        if (
            shorterCompact.length > 0 &&
            longerCompact.includes(shorterCompact) &&
            (shorterCompact.length >= 6 || shorterTokens >= 2)
        ) {
            return {
                confidence: 0.75,
                method: 'auto_fuzzy',
                rationale: `Delivery data shows "${sourceDisplayName}" — contains your name`,
            };
        }
        if (
            memberCompact.length >= 6 &&
            candCompact.length >= 6 &&
            Math.abs(memberCompact.length - candCompact.length) <= 2 &&
            levenshtein(memberCompact, candCompact) <= 2
        ) {
            return {
                confidence: 0.6,
                method: 'auto_fuzzy',
                rationale: `Spelling close to "${sourceDisplayName}" — verify before confirming`,
            };
        }
    }
    return null;
}

/**
 * Rank a project's raw delivery identities against one roster member.
 *
 * `byKey` reflects the current state of every active link on this project — an
 * identity already confirmed or suggested to someone else, or already dismissed
 * as wrong for this exact person, is not offered again. A `suggested` link that
 * already points at this member passes through, so re-seeding refreshes it
 * instead of creating a duplicate.
 */
function rankIdentitiesForMember(
    member: TeamMember,
    identities: Array<{ sourceKey: string; displayName: string | null; count: number }>,
    byKey: Map<string, PerfIdentityLink>,
): IdentityCandidate[] {
    const out: IdentityCandidate[] = [];
    for (const identity of identities) {
        const existing = byKey.get(identity.sourceKey);
        if (existing && !(existing.status === 'suggested' && existing.teamMemberId === member.id)) continue;

        const scored = scoreIdentityForMember(member, identity.sourceKey, identity.displayName);
        if (!scored) continue;
        out.push({
            sourceKey: identity.sourceKey,
            sourceDisplayName: identity.displayName,
            confidence: scored.confidence,
            method: scored.method,
            rationale: scored.rationale,
            scoreRowCount: identity.count,
        });
    }
    out.sort((a, b) => b.confidence - a.confidence || b.scoreRowCount - a.scoreRowCount);
    return out;
}

/**
 * The candidate pool: team members on the project's account who are either
 * explicitly assigned to this project or carry no project-specific assignment
 * at all (an account-wide role). Scoped by project — NOT the whole account's
 * roster — so a 20-project account does not turn one project's screen into a
 * 100-person lineup.
 */
async function loadRosterForProject(projectId: number): Promise<TeamMember[]> {
    const project = await Project.findByPk(projectId, { attributes: ['id', 'accountId'] });
    if (!project) return [];

    const associations = await AccountTeamMember.findAll({
        where: {
            accountId: (project as any).accountId,
            [Op.or]: [{ projectId }, { projectId: null }],
        },
        attributes: ['teamMemberId'],
    });
    const ids = [...new Set(associations.map(a => (a as any).teamMemberId as number))];
    if (ids.length === 0) return [];

    return TeamMember.findAll({ where: { id: { [Op.in]: ids } } });
}

/** Distinct (sourceKey, displayName) identities appearing in a project's perf data. */
async function loadJiraIdentities(
    projectId: number,
): Promise<Array<{ sourceKey: string; displayName: string | null; count: number }>> {
    const rows = await PerfMemberScore.findAll({
        where: { projectId },
        attributes: ['jiraLoginId', 'displayName'],
        raw: true,
    });

    const byKey = new Map<string, { sourceKey: string; displayName: string | null; count: number }>();
    for (const row of rows as unknown as Array<{ jiraLoginId: string; displayName: string }>) {
        if (!row.jiraLoginId) continue;
        const existing = byKey.get(row.jiraLoginId);
        if (existing) {
            existing.count += 1;
            // Keep the most recently seen non-empty display name.
            if (row.displayName) existing.displayName = row.displayName;
        } else {
            byKey.set(row.jiraLoginId, {
                sourceKey: row.jiraLoginId,
                displayName: row.displayName || null,
                count: 1,
            });
        }
    }
    return [...byKey.values()];
}

/**
 * Every raw delivery identity seen in a project, for the manual-link picker —
 * the fallback when a roster member has no automatic candidate at all.
 */
export async function listProjectIdentities(
    projectId: number,
    source: IdentitySource = 'jira',
): Promise<Array<{ sourceKey: string; sourceDisplayName: string | null; scoreRowCount: number }>> {
    const identities = source === 'jira' ? await loadJiraIdentities(projectId) : [];
    return identities
        .map(i => ({ sourceKey: i.sourceKey, sourceDisplayName: i.displayName, scoreRowCount: i.count }))
        .sort((a, b) => (a.sourceDisplayName ?? '').localeCompare(b.sourceDisplayName ?? ''));
}

/**
 * Propose links for every roster member not yet resolved in a project.
 *
 * For each member, ranks the project's raw delivery identities against them and
 * proposes the best one, if any. A member with no plausible identity at all is
 * counted as `unmatched` and needs a manual link — a correct outcome, not a
 * failure. Delivery identities with no roster counterpart are never looked at:
 * nothing is proposed for them, nothing is created, nothing is rejected.
 *
 * Idempotent and non-destructive: never touches a `confirmed` row, and refreshes
 * an existing `suggested` row rather than duplicating it. Safe to re-run as new
 * sprints sync in.
 */
export async function seedSuggestions(
    projectId: number,
    source: IdentitySource = 'jira',
): Promise<{ created: number; refreshed: number; unmatched: number }> {
    const [roster, identities, existingLinks] = await Promise.all([
        loadRosterForProject(projectId),
        source === 'jira' ? loadJiraIdentities(projectId) : Promise.resolve([]),
        PerfIdentityLink.findAll({ where: { projectId, source, isActive: true } }),
    ]);

    const byKey = new Map(existingLinks.map(l => [l.sourceKey, l]));
    const confirmedMemberIds = new Set(
        existingLinks
            .filter(l => l.status === TRUSTED_STATUS && l.teamMemberId !== null)
            .map(l => l.teamMemberId as number),
    );

    let created = 0;
    let refreshed = 0;
    let unmatched = 0;

    for (const member of roster) {
        // A human has already ruled on this person. Leave it alone.
        if (confirmedMemberIds.has(member.id)) continue;

        const best = rankIdentitiesForMember(member, identities, byKey)[0];
        if (!best) {
            unmatched += 1;
            continue;
        }

        const existing = byKey.get(best.sourceKey);
        if (existing) {
            await existing.update({
                sourceDisplayName: best.sourceDisplayName,
                matchMethod: best.method,
                matchConfidence: best.confidence,
            });
            refreshed += 1;
        } else {
            // Retire any stale suggestion this member holds under a different
            // key before proposing this one, so a person never carries two
            // pending suggestions at once.
            await PerfIdentityLink.update(
                { isActive: false },
                { where: { projectId, source, teamMemberId: member.id, status: 'suggested', isActive: true } },
            );

            const link = await PerfIdentityLink.create({
                projectId,
                teamMemberId: member.id,
                source,
                sourceKey: best.sourceKey,
                sourceDisplayName: best.sourceDisplayName,
                matchMethod: best.method,
                matchConfidence: best.confidence,
                status: 'suggested',
            });
            byKey.set(best.sourceKey, link);
            created += 1;
        }
    }

    return { created, refreshed, unmatched };
}

/**
 * Every roster member not yet confirmed, with their ranked candidate identities.
 *
 * A member with nothing plausible in this project's delivery data AND no
 * suggestion already on record is simply not this project's problem — excluded
 * entirely, not shown as "no match". That is what keeps this screen to the
 * handful of people who actually need a decision, instead of the whole account.
 */
export async function getUnresolvedMembers(
    projectId: number,
    source: IdentitySource = 'jira',
): Promise<UnresolvedMember[]> {
    const [roster, identities, links] = await Promise.all([
        loadRosterForProject(projectId),
        source === 'jira' ? loadJiraIdentities(projectId) : Promise.resolve([]),
        PerfIdentityLink.findAll({ where: { projectId, source, isActive: true } }),
    ]);

    const byKey = new Map(links.map(l => [l.sourceKey, l]));
    const confirmedMemberIds = new Set(
        links.filter(l => l.status === TRUSTED_STATUS && l.teamMemberId !== null).map(l => l.teamMemberId as number),
    );

    const result: UnresolvedMember[] = [];
    for (const member of roster) {
        if (confirmedMemberIds.has(member.id)) continue;

        const candidates = rankIdentitiesForMember(member, identities, byKey);
        const ownSuggestion = links.find(l => l.status === 'suggested' && l.teamMemberId === member.id);
        if (candidates.length === 0 && !ownSuggestion) continue;

        result.push({
            teamMemberId: member.id,
            teamMemberName: fullName(member),
            email: member.email,
            linkId: ownSuggestion?.id ?? null,
            candidates: candidates.slice(0, 5),
        });
    }

    // Weakest best-candidate first: those need the most human attention.
    result.sort((a, b) => (a.candidates[0]?.confidence ?? 0) - (b.candidates[0]?.confidence ?? 0));

    return result;
}

/**
 * The go/no-go gate for enabling review cycles on a project.
 *
 * The denominator is roster members this project's delivery data actually has
 * something to say about — someone already confirmed, someone with a plausible
 * candidate identity, or someone carrying a suggestion already on record. A
 * roster member with literally no presence in this project's data is not this
 * project's gap and is excluded rather than blocking the project forever.
 *
 * `nonRosterRowCount` is informational only: score rows whose identity has no
 * roster counterpart at all. Measured against real CCM data this is roughly
 * half of an account's delivery rows — client-side staff working in the
 * customer's own Jira. It is a sanity check, never a gate.
 */
export async function getCoverage(projectId: number, source: IdentitySource = 'jira'): Promise<IdentityCoverage> {
    const [roster, identities, links, totalScoreRows] = await Promise.all([
        loadRosterForProject(projectId),
        source === 'jira' ? loadJiraIdentities(projectId) : Promise.resolve([]),
        PerfIdentityLink.findAll({ where: { projectId, source, isActive: true } }),
        PerfMemberScore.count({ where: { projectId } }),
    ]);

    const byKey = new Map(links.map(l => [l.sourceKey, l]));
    const confirmedMemberIds = new Set(
        links.filter(l => l.status === TRUSTED_STATUS && l.teamMemberId !== null).map(l => l.teamMemberId as number),
    );
    const memberHasOwnLink = new Set(links.filter(l => l.teamMemberId !== null).map(l => l.teamMemberId as number));

    let totalRosterMembers = 0;
    let resolvedMembers = 0;
    for (const member of roster) {
        const isConfirmed = confirmedMemberIds.has(member.id);
        const isRelevant =
            isConfirmed ||
            memberHasOwnLink.has(member.id) ||
            rankIdentitiesForMember(member, identities, byKey).length > 0;
        if (!isRelevant) continue;

        totalRosterMembers += 1;
        if (isConfirmed) resolvedMembers += 1;
    }

    const confirmedKeys = new Set(links.filter(l => l.status === TRUSTED_STATUS).map(l => l.sourceKey));
    const liveKeys = new Set(identities.map(i => i.sourceKey));
    const attributedRows = identities
        .filter(i => confirmedKeys.has(i.sourceKey))
        .reduce((sum, i) => sum + i.count, 0);

    return {
        projectId,
        totalRosterMembers,
        resolvedMembers,
        linkedPct:
            totalRosterMembers === 0 ? 0 : Math.round((resolvedMembers / totalRosterMembers) * 1000) / 10,
        undecidedKeyCount: totalRosterMembers - resolvedMembers,
        rejectedKeyCount: links.filter(l => l.status === 'rejected').length,
        staleLinkCount: [...confirmedKeys].filter(k => !liveKeys.has(k)).length,
        suggestedPendingCount: links.filter(l => l.status === 'suggested').length,
        nonRosterRowCount: Math.max(0, totalScoreRows - attributedRows),
        totalScoreRows,
    };
}

/** Confirm, reject, or repoint a link. Confirmation is always attributed. */
export async function decideLink(
    linkId: number,
    decision: 'confirm' | 'reject',
    userId: number,
    teamMemberId?: number,
): Promise<{ link: PerfIdentityLink; propagatedToProjects: number }> {
    const link = await PerfIdentityLink.findByPk(linkId);
    if (!link) throw new Error(`Identity link ${linkId} not found`);

    if (decision === 'reject') {
        await link.update({ status: 'rejected', confirmedByUserId: userId, confirmedAt: new Date() });
        return { link, propagatedToProjects: 0 };
    }

    await link.update({
        // Repointing to a different member makes this a manual decision, whatever
        // the seeder originally proposed.
        ...(teamMemberId && teamMemberId !== link.teamMemberId
            ? { teamMemberId, matchMethod: 'manual' as IdentityMatchMethod, matchConfidence: 1 }
            : {}),
        status: TRUSTED_STATUS,
        confirmedByUserId: userId,
        confirmedAt: new Date(),
    });

    // A newly confirmed link should attribute the history it explains, not just
    // future syncs — otherwise the first cycle silently under-reports.
    await applyLinkToScores(link);
    const propagatedToProjects = await propagateAcrossAccount(link, userId);
    return { link, propagatedToProjects };
}

/**
 * Mark a specific proposed identity as wrong for a specific person.
 *
 * The narrower case that survives from the old design: the seeder's best guess
 * for a roster member was a fuzzy false positive, and a human needs to say so
 * without it being re-suggested. Does not touch anything for anyone else.
 */
export async function rejectIdentity(
    projectId: number,
    source: IdentitySource,
    sourceKey: string,
    sourceDisplayName: string | null,
    userId: number,
): Promise<PerfIdentityLink> {
    const existing = await PerfIdentityLink.findOne({
        where: { projectId, source, sourceKey, isActive: true },
    });

    if (existing) {
        await existing.update({
            status: 'rejected',
            confirmedByUserId: userId,
            confirmedAt: new Date(),
        });
        // Strip any attribution a previous confirmation had written.
        await PerfMemberScore.update(
            { teamMemberId: null },
            { where: { projectId, jiraLoginId: sourceKey } },
        );
        return existing;
    }

    return PerfIdentityLink.create({
        projectId,
        teamMemberId: null,
        source,
        sourceKey,
        sourceDisplayName,
        matchMethod: 'manual',
        matchConfidence: null,
        status: 'rejected',
        confirmedByUserId: userId,
        confirmedAt: new Date(),
    });
}

/** Create a link by hand, for a roster member the seeder could not match at all. */
export async function createManualLink(
    projectId: number,
    teamMemberId: number,
    source: IdentitySource,
    sourceKey: string,
    sourceDisplayName: string | null,
    userId: number,
): Promise<{ link: PerfIdentityLink; propagatedToProjects: number }> {
    // Supersede rather than collide with any existing active link on this key:
    // the partial unique index covers is_active rows only.
    await PerfIdentityLink.update(
        { isActive: false },
        { where: { projectId, source, sourceKey, isActive: true } },
    );

    const link = await PerfIdentityLink.create({
        projectId,
        teamMemberId,
        source,
        sourceKey,
        sourceDisplayName,
        matchMethod: 'manual',
        matchConfidence: 1,
        status: TRUSTED_STATUS,
        confirmedByUserId: userId,
        confirmedAt: new Date(),
    });

    await applyLinkToScores(link);
    const propagatedToProjects = await propagateAcrossAccount(link, userId);
    return { link, propagatedToProjects };
}

/**
 * Propagate a confirmed Jira link to every other project in the same account.
 *
 * A Jira accountId is unique across the whole Jira instance, so the same person
 * appearing in 8 of an account's projects would otherwise need 8 identical human
 * confirmations — measured at ~426 decisions for CCM instead of 216. Confirming
 * once resolves the identity everywhere it occurs in that account.
 *
 * Excel links never propagate: a display name means nothing outside the project
 * it came from, so the same name in a sibling project may be a different person.
 *
 * Returns the number of sibling projects newly resolved.
 */
async function propagateAcrossAccount(link: PerfIdentityLink, userId: number): Promise<number> {
    if (link.source !== 'jira' || link.status !== TRUSTED_STATUS) return 0;

    const project = await Project.findByPk(link.projectId, { attributes: ['id', 'accountId'] });
    const accountId = (project as any)?.accountId;
    if (!accountId) return 0;

    const siblings = await Project.findAll({
        where: { accountId, id: { [Op.ne]: link.projectId } },
        attributes: ['id'],
    });
    if (siblings.length === 0) return 0;
    const siblingIds = siblings.map(p => p.id);

    // Only projects where this identity actually appears in delivery data.
    const present = await PerfMemberScore.findAll({
        where: { projectId: { [Op.in]: siblingIds }, jiraLoginId: link.sourceKey },
        attributes: ['projectId'],
        group: ['project_id'],
        raw: true,
    });
    const targetProjectIds = [...new Set((present as unknown as Array<{ projectId: number }>).map(r => r.projectId))];
    if (targetProjectIds.length === 0) return 0;

    const existing = await PerfIdentityLink.findAll({
        where: {
            projectId: { [Op.in]: targetProjectIds },
            source: 'jira',
            sourceKey: link.sourceKey,
            isActive: true,
        },
    });
    const byProject = new Map(existing.map(l => [l.projectId, l]));

    let resolved = 0;
    for (const projectId of targetProjectIds) {
        const current = byProject.get(projectId);

        // Never overturn a human's explicit decision in another project — a
        // rejection there may be deliberate.
        if (current?.status === 'rejected') continue;
        if (current?.status === TRUSTED_STATUS && current.teamMemberId === link.teamMemberId) continue;

        if (current) {
            await current.update({
                teamMemberId: link.teamMemberId,
                matchMethod: 'manual',
                matchConfidence: 1,
                status: TRUSTED_STATUS,
                confirmedByUserId: userId,
                confirmedAt: new Date(),
            });
            await applyLinkToScores(current);
        } else {
            const created = await PerfIdentityLink.create({
                projectId,
                teamMemberId: link.teamMemberId,
                source: 'jira',
                sourceKey: link.sourceKey,
                sourceDisplayName: link.sourceDisplayName,
                matchMethod: 'manual',
                matchConfidence: 1,
                status: TRUSTED_STATUS,
                confirmedByUserId: userId,
                confirmedAt: new Date(),
            });
            await applyLinkToScores(created);
        }
        resolved += 1;
    }

    return resolved;
}

/** Write one confirmed link's team_member_id onto the perf rows it explains. */
async function applyLinkToScores(link: PerfIdentityLink): Promise<number> {
    if (link.status !== TRUSTED_STATUS || link.source !== 'jira') return 0;
    const [affected] = await PerfMemberScore.update(
        { teamMemberId: link.teamMemberId },
        { where: { projectId: link.projectId, jiraLoginId: link.sourceKey } },
    );
    return affected;
}

/**
 * Confirm every `suggested` link in a project at or above a confidence floor.
 *
 * The floor is mandatory and cannot be set below LOW_CONFIDENCE_THRESHOLD: the
 * point of bulk confirmation is to clear the unambiguous matches (exact Jira
 * login, exact email, exact name) so a human's attention goes to the genuinely
 * uncertain ones. Levenshtein matches are never bulk-confirmed.
 */
export async function bulkConfirm(
    projectId: number,
    userId: number,
    minConfidence = 0.9,
): Promise<{ confirmed: number; propagatedToProjects: number; skipped: number }> {
    const floor = Math.max(minConfidence, LOW_CONFIDENCE_THRESHOLD);

    const pending = await PerfIdentityLink.findAll({
        where: { projectId, source: 'jira', status: 'suggested', isActive: true },
    });

    let confirmed = 0;
    let propagatedToProjects = 0;
    let skipped = 0;

    for (const link of pending) {
        if ((link.matchConfidence ?? 0) < floor) {
            skipped += 1;
            continue;
        }
        const result = await decideLink(link.id, 'confirm', userId);
        propagatedToProjects += result.propagatedToProjects;
        confirmed += 1;
    }

    return { confirmed, propagatedToProjects, skipped };
}

/** Re-apply every confirmed link across a project. Idempotent; safe to re-run. */
export async function backfillProject(projectId: number): Promise<{ updatedRows: number }> {
    const links = await PerfIdentityLink.findAll({
        where: { projectId, source: 'jira', status: TRUSTED_STATUS, isActive: true },
    });

    let updatedRows = 0;
    for (const link of links) {
        updatedRows += await applyLinkToScores(link);
    }
    return { updatedRows };
}

/**
 * Resolve source keys to team member ids for a project.
 *
 * The single read path every factor provider uses. Only confirmed, active links
 * resolve — an unconfirmed identity is deliberately absent from the map so the
 * caller reports zero coverage rather than silently guessing.
 */
export async function resolveSourceKeys(
    projectId: number,
    source: IdentitySource = 'jira',
): Promise<Map<string, number>> {
    const links = await PerfIdentityLink.findAll({
        where: { projectId, source, status: TRUSTED_STATUS, isActive: true },
        attributes: ['sourceKey', 'teamMemberId'],
    });
    // The DB CHECK guarantees a confirmed link has a team member, but narrow it
    // here rather than asserting — a null would silently un-attribute a score.
    return new Map(
        links
            .filter((l): l is PerfIdentityLink & { teamMemberId: number } => l.teamMemberId !== null)
            .map(l => [l.sourceKey, l.teamMemberId]),
    );
}
