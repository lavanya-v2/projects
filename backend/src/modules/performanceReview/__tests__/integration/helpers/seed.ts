import sequelize from '../../../../../config/connection';
import { Account } from '../../../../../models/Account';
import { Project } from '../../../../../models/Project';
import { TeamMember } from '../../../../../models/TeamMember';
import { AccountTeamMember } from '../../../../../models/AccountTeamMember';
import { User } from '../../../../../models/User';
import { Role } from '../../../../../models/Role';
import { UserRole } from '../../../../../models/UserRole';
import { UserPermission } from '../../../../../models/UserPermission';
import { PerfSprintSync } from '../../../../../models/PerfSprintSync';
import { PerfMemberScore } from '../../../../../models/PerfMemberScore';
import { PerfIdentityLink } from '../../../../../models/PerfIdentityLink';
import { ReviewCycleConfig } from '../../../../../models/ReviewCycleConfig';
import { ReviewCycle } from '../../../../../models/ReviewCycle';
import { ReviewCycleSource } from '../../../../../models/ReviewCycleSource';
import { ReviewCycleParticipant } from '../../../../../models/ReviewCycleParticipant';
import { ReviewMemberScore } from '../../../../../models/ReviewMemberScore';
import { ReviewStatusHistory } from '../../../../../models/ReviewStatusHistory';
import { CompetencyTemplate } from '../../../../../models/CompetencyTemplate';
import { CompetencyTemplateItem } from '../../../../../models/CompetencyTemplateItem';
import { ReviewProjectSettings } from '../../../../../models/ReviewProjectSettings';
import { LeadReview } from '../../../../../models/LeadReview';
import { LeadReviewRating } from '../../../../../models/LeadReviewRating';

/**
 * Fixture for the performance review integration suite.
 *
 * Built through the real models so the suite exercises the same constraints
 * production does — the CHECK on weights, the partial unique index on identity
 * links, the one-score-per-member-per-cycle index.
 *
 * The shape is chosen to cover the cases that actually break things:
 *   - ACROSS   works in A and B (both in scope) — must be scored ONCE, summed
 *   - SPLIT    works in B (in scope) and C (out of scope) — must be scored on B only
 *   - QA       carries the quality_rate = -1 sentinel in one sprint
 *   - TINY     below the story-point volume floor — must be "missing", never 0
 *   - GHOST    an identity with no roster match — must be rejectable, not blocking
 */

export const SPRINT_WINDOW = { start: '2026-10-01', end: '2026-10-31' };

export interface Fixture {
    account: Account;
    projectA: Project;
    projectB: Project;
    projectC: Project;
    members: {
        solo: TeamMember;
        across: TeamMember;
        split: TeamMember;
        qa: TeamMember;
        tiny: TeamMember;
    };
    users: {
        superuser: User;
        manager: User;
        leadA: User;
        leadOutside: User;
        member: User;
        executive: User;
    };
    syncs: { a: PerfSprintSync; b: PerfSprintSync; c: PerfSprintSync };
}

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Wipe everything this suite creates, child tables first.
 *
 * DELETE rather than TRUNCATE deliberately. TRUNCATE takes an ACCESS EXCLUSIVE
 * lock and blocks behind ANY open transaction on the table — and importing the
 * Express app starts Redis/queue machinery holding Postgres connections, so the
 * truncate would sit waiting until the 60s hook timeout fired. DELETE takes only
 * row locks and cannot deadlock against a reader.
 *
 * Ordered by dependency instead of relying on CASCADE, so a missing FK shows up
 * as a loud failure rather than silently wiping an unrelated table.
 */
const TABLES_CHILD_FIRST = [
    'review_project_settings',
    'lead_review_ratings',
    'lead_reviews',
    'competency_template_items',
    'competency_templates',
    'review_member_scores',
    'review_status_history',
    'review_cycle_participants',
    'review_cycle_sources',
    'review_cycles',
    'review_cycle_configs',
    'perf_identity_links',
    'perf_member_scores',
    'perf_sprint_syncs',
    'account_team_members',
    'team_members',
    'user_permissions',
    'user_roles',
    'users',
    'projects',
    'accounts',
];

export async function resetTables(): Promise<void> {
    for (const table of TABLES_CHILD_FIRST) {
        await sequelize.query(`DELETE FROM "${table}"`);
    }
}

async function makeUser(userId: string, roleName: string, projectIds: number[], accountId: number): Promise<User> {
    const user = await User.create({
        userId,
        email: userId,
        firstName: roleName,
        lastName: 'Tester',
        password: 'test-password',
        role: roleName === 'superuser' ? 'SUPERUSER' : 'USER',
        isActive: true,
    } as any);

    const [role] = await Role.findOrCreate({
        where: { name: roleName },
        defaults: { name: roleName, description: roleName } as any,
    });
    await UserRole.create({ userId: user.id, roleId: role.id } as any);
    await UserPermission.create({ userId: user.id, accountId, projectIds } as any);
    return user;
}

async function makeMember(first: string, last: string, accountId: number, role: string): Promise<TeamMember> {
    const email = `${first}.${last}.${uniq()}@v2solutions.com`.toLowerCase();
    const member = await TeamMember.create({
        firstName: first,
        lastName: last,
        email,
        jiraLoginId: email,
        v2Member: true,
    } as any);
    await AccountTeamMember.create({ accountId, teamMemberId: member.id, role } as any);
    return member;
}

async function makeSync(projectId: number, label: string, start: string, end: string): Promise<PerfSprintSync> {
    return PerfSprintSync.create({
        projectId,
        sprintName: label,
        periodLabel: label,
        startDate: start,
        endDate: end,
        syncType: 'sprint',
        syncStatus: 'done',
    } as any);
}

/** Jira accountIds look nothing like emails — that mismatch is the point. */
const accountIdFor = (name: string) => `712020:${name}-${uniq()}`;

async function score(
    sync: PerfSprintSync,
    projectId: number,
    member: TeamMember | null,
    displayName: string,
    fields: Partial<PerfMemberScore>,
): Promise<PerfMemberScore> {
    return PerfMemberScore.create({
        syncId: sync.id,
        projectId,
        jiraLoginId: accountIdFor(displayName.replace(/\s+/g, '')),
        displayName,
        memberCategory: 'developer',
        // teamMemberId deliberately left null: the identity gate is what fills it.
        teamMemberId: null,
        spPlanned: 0, spDone: 0, spCarriedOver: 0, deliveredCount: 0,
        spillover_count: 0, reopenedCount: 0, spRework: 0,
        ticketsTestedCount: 0, bugsRaisedCount: 0, prodBugsEscaped: 0,
        qualityRate: 0, bugEscapeRatePct: 0,
        ...fields,
    } as any);
}

export async function seedFixture(): Promise<Fixture> {
    await resetTables();

    const account = await Account.create({ name: `Acct-${uniq()}`, code: `AC${uniq()}` } as any);

    const mkProject = (name: string) =>
        Project.create({
            name,
            code: `PC${uniq()}`,
            jiraName: name,
            accountId: account.id,
            dataSourceType: 'jira',
            isKanbanProject: false,
            isActive: true,
        } as any);

    const projectA = await mkProject(`ProjA-${uniq()}`);
    const projectB = await mkProject(`ProjB-${uniq()}`);
    const projectC = await mkProject(`ProjC-${uniq()}`);

    const members = {
        solo: await makeMember('Solo', 'Dev', account.id, 'Developer'),
        across: await makeMember('Across', 'Projects', account.id, 'Developer'),
        split: await makeMember('Split', 'Scope', account.id, 'Developer'),
        qa: await makeMember('Quality', 'Tester', account.id, 'QA'),
        tiny: await makeMember('Tiny', 'Volume', account.id, 'Developer'),
    };

    const users = {
        superuser: await makeUser(`su-${uniq()}@v2solutions.com`, 'superuser', [], account.id),
        manager: await makeUser(`mgr-${uniq()}@v2solutions.com`, 'manager', [projectA.id, projectB.id], account.id),
        leadA: await makeUser(`lead-${uniq()}@v2solutions.com`, 'lead', [projectA.id, projectB.id], account.id),
        // Access to project C only — must not see a cycle scoped to A and B.
        leadOutside: await makeUser(`leadout-${uniq()}@v2solutions.com`, 'lead', [projectC.id], account.id),
        member: await makeUser(`mem-${uniq()}@v2solutions.com`, 'member', [projectA.id], account.id),
        executive: await makeUser(`exec-${uniq()}@v2solutions.com`, 'executive', [projectA.id], account.id),
    };

    const syncs = {
        a: await makeSync(projectA.id, 'A-Sprint-1', SPRINT_WINDOW.start, '2026-10-15'),
        b: await makeSync(projectB.id, 'B-Sprint-1', '2026-10-10', '2026-10-24'),
        c: await makeSync(projectC.id, 'C-Sprint-1', '2026-10-05', '2026-10-20'),
    };

    // ── Project A ────────────────────────────────────────────────────────────
    // solo: 20 planned / 16 done / 0 rework / 10 delivered / 0 reopened
    //   deliveryPct 80, executionScore 0.8*80 + 0.2*100 = 84
    //   systemScore 0.85*84 + 0.15*100 = 86.4
    await score(syncs.a, projectA.id, members.solo, 'Solo Dev', {
        spPlanned: 20, spDone: 16, deliveredCount: 10, reopenedCount: 0, spRework: 0,
    });
    // across, part 1: 10 planned / 10 done
    await score(syncs.a, projectA.id, members.across, 'Across Projects', {
        spPlanned: 10, spDone: 10, deliveredCount: 5, reopenedCount: 0, spRework: 0,
    });
    // below the volume floor: must be missing, not zero
    await score(syncs.a, projectA.id, members.tiny, 'Tiny Volume', {
        spPlanned: 2, spDone: 0, deliveredCount: 1, reopenedCount: 0, spRework: 0,
    });
    // an identity nobody can match — must be rejectable
    await score(syncs.a, projectA.id, null, 'Ghost Contractor', {
        spPlanned: 8, spDone: 8, deliveredCount: 4,
    });

    // ── Project B ────────────────────────────────────────────────────────────
    // across, part 2: 10 planned / 5 done  → summed with A: 20 planned / 15 done
    await score(syncs.b, projectB.id, members.across, 'Across Projects', {
        spPlanned: 10, spDone: 5, deliveredCount: 5, reopenedCount: 0, spRework: 0,
    });
    // split, in-scope half: 10 planned / 10 done
    await score(syncs.b, projectB.id, members.split, 'Split Scope', {
        spPlanned: 10, spDone: 10, deliveredCount: 5, reopenedCount: 0, spRework: 0,
    });
    // QA with the RAW accumulators persisted, so the exact formula runs rather
    // than the tickets-weighted proxy.
    //   passRate      = 1 - 10/100          = 0.9
    //   inSprintCatch = 8/10               = 0.8
    //   qualityRate   = (1 - (0.7*0.9 + 0.3*0.8)) * 100 = 13
    await score(syncs.b, projectB.id, members.qa, 'Quality Tester', {
        memberCategory: 'qa', ticketsTestedCount: 20, qualityRate: 20, bugEscapeRatePct: 0,
        clearedSp: 100, uatFailedSp: 10, inSprintBugCount: 8, inSprintEligibleCount: 10,
    });

    // ── Project C (OUT OF SCOPE) ─────────────────────────────────────────────
    // split, out-of-scope half. If this leaks into a score, rollout is not bounded.
    await score(syncs.c, projectC.id, members.split, 'Split Scope', {
        spPlanned: 100, spDone: 0, deliveredCount: 50, reopenedCount: 40, spRework: 50,
    });
    // QA sentinel row: tested < 5, so quality_rate is -1. Must be EXCLUDED from
    // any mean, not treated as a perfect score.
    await score(syncs.c, projectC.id, members.qa, 'Quality Tester', {
        memberCategory: 'qa', ticketsTestedCount: 3, qualityRate: -1,
    });

    return { account, projectA, projectB, projectC, members, users, syncs };
}

/**
 * An active competency template on a 1-5 scale.
 *
 * Two weighted rating items plus a free-text one, so tests can exercise weighted
 * scoring, NA handling and the "text items carry narrative, not score" rule.
 */
export async function seedTemplate(accountId: number, userId: number): Promise<CompetencyTemplate> {
    const template = await CompetencyTemplate.create({
        name: `Template-${uniq()}`,
        scope: 'account',
        accountId,
        version: 1,
        status: 'active',
        ratingScaleMin: 1,
        ratingScaleMax: 5,
        ratingScaleLabels: { 1: 'Needs support', 3: 'Meets', 5: 'Role model' },
        createdByUserId: userId,
    } as any);

    await CompetencyTemplateItem.bulkCreate([
        {
            templateId: template.id, section: 'Delivery', key: 'quality', label: 'Code Quality',
            inputType: 'rating', weight: 3, isRequired: true, requiresComment: true, sortOrder: 1,
        },
        {
            templateId: template.id, section: 'Delivery', key: 'ownership', label: 'Ownership',
            inputType: 'rating', weight: 1, isRequired: true, requiresComment: true, sortOrder: 2,
        },
        {
            templateId: template.id, section: 'Notes', key: 'context', label: 'Context',
            inputType: 'text', weight: 0, isRequired: false, requiresComment: false, sortOrder: 3,
        },
    ] as any);

    return CompetencyTemplate.findByPk(template.id, { include: [CompetencyTemplateItem] }) as Promise<CompetencyTemplate>;
}

/** Item ids by their stable key, for building rating payloads in tests. */
export async function templateItemIds(templateId: number): Promise<Record<string, number>> {
    const items = await CompetencyTemplateItem.findAll({ where: { templateId } });
    return Object.fromEntries(items.map(i => [i.key, i.id]));
}

/**
 * Confirm every roster member in a project, the way the gate flow does.
 *
 * Roster-driven: seeding only ever proposes identities for people on the
 * roster, so a non-roster identity (like the fixture's "Ghost Contractor")
 * never needs rejecting — it was never suggested in the first place.
 */
export async function passIdentityGate(projectId: number, userId: number): Promise<void> {
    const { seedSuggestions, bulkConfirm } = await import(
        '../../../services/identityResolutionService'
    );
    await seedSuggestions(projectId);
    await bulkConfirm(projectId, userId);
}

/**
 * A second, already-linked sprint for an existing member in a project they
 * already have data in — for proving two sprints from the same project produce
 * two DISTINGUISHABLE rows in the evidence drill-down, not just two matching
 * ones. `teamMemberId` is set directly rather than through the identity gate:
 * that resolution path is exercised elsewhere, and re-running it here would only
 * add noise to a test about sprint labelling.
 */
export async function addExtraSprint(
    projectId: number,
    teamMemberId: number,
    label: string,
    start: string,
    end: string,
    fields: Partial<PerfMemberScore>,
): Promise<void> {
    const sync = await makeSync(projectId, label, start, end);
    await PerfMemberScore.create({
        syncId: sync.id,
        projectId,
        jiraLoginId: accountIdFor(label),
        displayName: label,
        memberCategory: 'developer',
        teamMemberId,
        spPlanned: 0, spDone: 0, spCarriedOver: 0, deliveredCount: 0,
        spillover_count: 0, reopenedCount: 0, spRework: 0,
        ticketsTestedCount: 0, bugsRaisedCount: 0, prodBugsEscaped: 0,
        qualityRate: 0, bugEscapeRatePct: 0,
        ...fields,
    } as any);
}

/**
 * Link a roster row to an app login, the way a real onboarded member would be.
 *
 * memberReviewController.resolveTeamMember() prefers this FK and falls back to a
 * case-insensitive email match only for rows that predate it — tests exercise the
 * FK path explicitly rather than relying on the fallback by accident.
 */
export async function linkMemberToUser(teamMemberId: number, userId: number): Promise<void> {
    await TeamMember.update({ userId }, { where: { id: teamMemberId } });
}

export {
    PerfIdentityLink, ReviewCycleConfig, ReviewCycle, ReviewCycleSource,
    ReviewCycleParticipant, ReviewMemberScore, ReviewStatusHistory,
    CompetencyTemplate, CompetencyTemplateItem, ReviewProjectSettings, LeadReview, LeadReviewRating,
};
