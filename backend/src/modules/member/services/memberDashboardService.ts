import { Op } from 'sequelize';
import { TeamMember } from '../../../models/TeamMember';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { Project } from '../../../models/Project';
import { PerfSprintSync } from '../../../models/PerfSprintSync';
import { PerfMemberScore } from '../../../models/PerfMemberScore';
import { buildV2Matcher } from '../../reports/services/perfAggregation';
import { JiraService } from '../../jira/services/jiraService';
import { JiraIssue } from '../../../common/types';

const SPRINT_LIMIT = 5;

type Category = 'developer' | 'qa';

interface SprintRef {
  syncId: number;
  sprintName: string;
  endDate: string;
  syncType: string;
}
interface TrendPoint {
  sprintName: string;
  value: number;
}
interface ContribSlice {
  name: string;
  value: number;
  isYou: boolean;
}
interface Contribution {
  sprintName: string;
  slices: ContribSlice[];
}

export interface MemberProjectDashboard {
  projectId: number;
  projectName: string;
  isKanban: boolean;
  category: Category | null;
  sprints: SprintRef[];
  // developer
  spDelivered?: TrendPoint[];
  avgSp?: number;
  reopens?: TrendPoint[];
  carryovers?: TrendPoint[];
  contribution?: Contribution | null;
  // qa
  bugsLogged?: { sprintName: string; bugs: number; subBugs: number }[];
  ticketsTested?: TrendPoint[];
  qaContribution?: Contribution | null;
}

export interface MemberDashboard {
  linked: boolean;
  memberName: string | null;
  jiraLoginId: string | null;
  projects: MemberProjectDashboard[];
}

export interface TechNotesGap {
  count: number;
  keys: Array<{ key: string; summary: string }>;
  unavailable?: boolean;
}

export interface AutomationLabelSummary {
  automated: number;
  pending: number; // NeedAutomation, not yet automated
  notRequired: number;
  unlabelled: number;
  total: number;
  unlabelledKeys: Array<{ key: string; summary: string }>;
  basis: 'assignee' | 'qaAssignee';
  unavailable?: boolean;
}

interface RequestUser {
  userId?: unknown;
  email?: unknown;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Resolve the logged-in user to their TeamMember row by email.
 * users.userId IS the V2 email; users.email is a secondary match; team_members
 * may also be keyed by partner_email_id (contractors whose login differs).
 */

async function resolveMember(reqUser: RequestUser): Promise<TeamMember | null> {
  const candidates = [reqUser?.userId, reqUser?.email]
    .filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
    .map(s => s.trim());
  if (!candidates.length) return null;

  const or: Array<Record<string, unknown>> = [];
  for (const c of candidates) {
    or.push({ email: { [Op.iLike]: c } });
    or.push({ partnerEmailId: { [Op.iLike]: c } });
  }
  return TeamMember.findOne({ where: { [Op.or]: or } });
}

/** Whether the team member is assigned to the given project (directly or account-wide). */
function belongsToProject(assocs: AccountTeamMember[], project: Project): boolean {
  return assocs.some(a => a.projectId === project.id || (a.projectId == null && a.accountId === project.accountId));
}

/**
 * The member's raw project role string (e.g. "Backend Developer", "CSS Developer").
 * A project-specific assignment always wins over an account-wide (projectId = null) one,
 * which a plain `.find(a => a.projectId === id || a.projectId == null)` would not guarantee.
 */
function projectRoleFor(assocs: AccountTeamMember[], project: Project): string {
  const specific = assocs.find(a => a.projectId === project.id);
  const accountWide = assocs.find(a => a.projectId == null && a.accountId === project.accountId);
  return (specific ?? accountWide)?.role ?? '';
}

/** Projects the member belongs to: explicit project assignments + account-wide ones. */
async function getMemberProjects(assocs: AccountTeamMember[]): Promise<Project[]> {
  const projectIds = new Set<number>();
  const accountIds = new Set<number>();
  for (const a of assocs) {
    if (a.projectId) projectIds.add(a.projectId);
    else accountIds.add(a.accountId);
  }
  const or: Array<Record<string, unknown>> = [];
  if (projectIds.size) or.push({ id: { [Op.in]: [...projectIds] } });
  if (accountIds.size) or.push({ accountId: { [Op.in]: [...accountIds] } });
  if (!or.length) return [];
  const projects = await Project.findAll({ where: { [Op.or]: or }, order: [['name', 'ASC']] });
  // De-dup by id (a project could match both an explicit row and its account-wide row).
  const seen = new Set<number>();
  return projects.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

/**
 * perf_member_scores.jira_login_id is a Jira accountId, while team_members.jira_login_id
 * is an email-style login — they never match directly. The whole app bridges the two
 * via the name-aware V2 matcher, so we identify "this member" the same way.
 */
function buildContribution(
  sync: PerfSprintSync,
  syncScores: PerfMemberScore[],
  memberMatcher: ReturnType<typeof buildV2Matcher>,
  categoryFilter: (s: PerfMemberScore) => boolean,
  metric: (s: PerfMemberScore) => number
): Contribution | null {
  // Include EVERY peer in the same role that sprint (not just V2 members) so
  // "your share" reflects the real cross-team split. Filtering to V2-only used
  // to inflate the percentage to 100% when a member's only same-role peers in
  // a sprint were client/non-V2 testers.
  const slices: ContribSlice[] = syncScores
    .filter(categoryFilter)
    .map(s => ({
      name: s.displayName,
      value: round1(metric(s)),
      isYou: memberMatcher.matches(s.jiraLoginId, s.displayName),
    }))
    .filter(s => s.value > 0);
  if (!slices.length || !slices.some(s => s.isYou)) return null;
  return { sprintName: sync.sprintName, slices };
}

/** Choose the single best perf row for a member within one sync if the matcher hits several. */
function pickBestRow(rows: PerfMemberScore[]): PerfMemberScore {
  return rows.reduce((best, r) => {
    const score = (x: PerfMemberScore) => x.spDone + x.spPlanned + x.ticketsTestedCount + x.bugsRaisedCount;
    return score(r) > score(best) ? r : best;
  });
}

/**
 * The member's role on one project, resolved the same way getDashboard does:
 * the latest matched perf row wins, falling back to the assignment role string.
 */
async function resolveCategoryForProject(
  project: Project,
  member: TeamMember,
  assocs: AccountTeamMember[]
): Promise<Category | null> {
  const recent = await PerfSprintSync.findAll({
    where: { projectId: project.id, syncStatus: 'done', syncType: 'sprint' },
    order: [['endDate', 'DESC']],
    limit: SPRINT_LIMIT,
  });
  if (recent.length) {
    const memberMatcher = buildV2Matcher([member]);
    const scores = await PerfMemberScore.findAll({
      where: { syncId: { [Op.in]: recent.map(s => s.id) } },
    });
    // recent is endDate DESC, so the first sync with a matched row is the latest one.
    for (const sync of recent) {
      const matched = scores.filter(s => s.syncId === sync.id && memberMatcher.matches(s.jiraLoginId, s.displayName));
      if (matched.length) {
        return pickBestRow(matched).memberCategory === 'qa' ? 'qa' : 'developer';
      }
    }
  }
  const role = projectRoleFor(assocs, project);
  if (role) return role.toLowerCase().includes('qa') ? 'qa' : 'developer';
  return null;
}

// Automation labels, matched case-insensitively. Precedence when a ticket carries
// several: automated > NeedAutomation > automation-na. The lifecycle is
// NeedAutomation -> automated and the old label is never removed, so a ticket that
// reached `automated` counts as automated even while it still carries NeedAutomation.
// Automation labels only apply to API and front-end UI work. They are meaningless for
// CSS-only, database, infra or RPA work, so those disciplines never see the card —
// otherwise every one of their tickets lands in the highlighted "no label" bucket.
// Matched EXACTLY against the normalised role (never by substring: "CSS Developer"
// contains "Developer"). Deny-list rather than allow-list on purpose — AccountTeamMember.role
// holds a mix of the PROJECT_ROLES strings and legacy lowercase 'developer'/'qa' values, and an
// unrecognised or blank role should keep showing the card rather than silently hiding it.
const AUTOMATION_OUT_OF_SCOPE_ROLES = new Set([
  'css developer',
  'database',
  'database engineer', // present in the data though absent from PROJECT_ROLES
  'devops',
  'data engineer',
  'rpa',
]);

const isAutomationOutOfScope = (role: string) => AUTOMATION_OUT_OF_SCOPE_ROLES.has(role.trim().toLowerCase());

const AUTOMATED_LABEL = 'automated';
const NEED_AUTOMATION_LABEL = 'needautomation';
const AUTOMATION_NA_LABEL = 'automation-na';

type AutomationBucket = 'automated' | 'pending' | 'notRequired' | 'unlabelled';

function bucketByAutomationLabel(labels: unknown): AutomationBucket {
  const lower = (Array.isArray(labels) ? labels : [])
    .filter((l): l is string => typeof l === 'string')
    .map(l => l.trim().toLowerCase());
  if (lower.includes(AUTOMATED_LABEL)) return 'automated';
  if (lower.includes(NEED_AUTOMATION_LABEL)) return 'pending';
  if (lower.includes(AUTOMATION_NA_LABEL)) return 'notRequired';
  return 'unlabelled';
}

/** JQL string literals are double-quoted; escape any embedded quote/backslash. */
const jqlEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * Keep "is this ticket mine?" OUT of the JQL and do it in code.
 *
 * `assignee = "<team_members.jira_login_id>"` looks right but silently matches
 * NOTHING: the stored login is an email on one domain (…@myccmortgage.com) while
 * the Jira account carries another (…@ccm.com), and Jira Cloud keys users by
 * accountId regardless. JQL returns an empty result rather than an error, so the
 * bug is invisible — it reads as "you have no tickets".
 *
 * The rest of the app bridges the two via the name-aware V2 matcher; do the same
 * here. Cost is one unfiltered fetch of the open sprint (tens of issues).
 */
function isMine(
  user: { accountId?: string; emailAddress?: string; displayName?: string } | null | undefined,
  matcher: ReturnType<typeof buildV2Matcher>
): boolean {
  if (!user) return false;
  return matcher.matches(user.accountId ?? user.emailAddress ?? '', user.displayName ?? '');
}

export const memberDashboardService = {
  async getDashboard(reqUser: RequestUser): Promise<MemberDashboard> {
    const member = await resolveMember(reqUser);
    if (!member) {
      return { linked: false, memberName: null, jiraLoginId: null, projects: [] };
    }

    const assocs = await AccountTeamMember.findAll({ where: { teamMemberId: member.id } });
    const projects = await getMemberProjects(assocs);

    const memberMatcher = buildV2Matcher([member]);

    const memberName = `${member.firstName} ${member.lastName}`.trim();
    const out: MemberProjectDashboard[] = [];

    for (const project of projects) {
      // Last <=5 completed syncs, blended across Scrum + Kanban and ordered
      // by recency -- a project that switches delivery model mid-history
      // (e.g. Scrum -> Kanban) keeps showing a member's charts continuously
      // instead of going blank the moment the flag flips. Mirrors the same
      // blending fix already shipped for Team Performance Trends
      // (performanceSyncService.ts getProductivityOverview).
      const recent = await PerfSprintSync.findAll({
        where: { projectId: project.id, syncStatus: 'done', syncType: { [Op.in]: ['sprint', 'kanban'] } },
        order: [['endDate', 'DESC']],
        limit: SPRINT_LIMIT,
      });
      const syncs = [...recent].reverse();
      const sprints: SprintRef[] = syncs.map(s => ({
        syncId: s.id,
        sprintName: s.sprintName,
        endDate: s.endDate,
        syncType: s.syncType,
      }));

      if (syncs.length === 0) {
        out.push({
          projectId: project.id,
          projectName: project.name,
          isKanban: !!project.isKanbanProject,
          category: null,
          sprints: [],
        });
        continue;
      }

      // All scores across the window (one query), then identify the member's
      // row(s) per sync via the name-aware matcher (ids never match directly).
      const allScores = syncs.length
        ? await PerfMemberScore.findAll({ where: { syncId: { [Op.in]: syncs.map(s => s.id) } } })
        : [];
      const scoresBySync = new Map<number, PerfMemberScore[]>();
      for (const s of allScores) {
        const arr = scoresBySync.get(s.syncId) ?? [];
        arr.push(s);
        scoresBySync.set(s.syncId, arr);
      }

      const rowBySync = new Map<number, PerfMemberScore>();
      for (const sprint of sprints) {
        const matched = (scoresBySync.get(sprint.syncId) ?? []).filter(s =>
          memberMatcher.matches(s.jiraLoginId, s.displayName)
        );
        if (matched.length) rowBySync.set(sprint.syncId, pickBestRow(matched));
      }
      const memberRows = [...rowBySync.values()];

      // Category: latest matched perf row wins; fall back to the assignment role.
      let category: Category | null = null;
      if (rowBySync.size) {
        const latest = memberRows.sort((a, b) => b.syncId - a.syncId)[0];
        category = latest.memberCategory === 'qa' ? 'qa' : 'developer';
      } else {
        const role = projectRoleFor(assocs, project);
        if (role) category = role.toLowerCase().includes('qa') ? 'qa' : 'developer';
      }

      // Most recent sprint where the member actually has a row (for the contribution pie).
      const latestSync = [...sprints].reverse().find(s => rowBySync.has(s.syncId));
      const latestSyncObj = latestSync ? syncs.find(s => s.id === latestSync.syncId) : undefined;
      const latestSyncScores = latestSync ? (scoresBySync.get(latestSync.syncId) ?? []) : [];

      const base: MemberProjectDashboard = {
        projectId: project.id,
        projectName: project.name,
        isKanban: !!project.isKanbanProject,
        category,
        sprints,
      };

      if (category === 'qa') {
        base.bugsLogged = sprints.map(s => {
          const r = rowBySync.get(s.syncId);
          // bugsRaisedCount is the TOTAL of all bug-type issues (standalone Bugs +
          // Sub-bugs); subBugsRaisedCount is the Sub-bug subset. Split into disjoint
          // categories so the two bars don't overlap (a Sub-bug is filed under an
          // existing ticket; a standalone Bug is not).
          // offboard_* add bugs the member logged in-window that were never
          // attached to the sprint on the board (else they'd be undercounted).
          const total = (r?.bugsRaisedCount ?? 0) + (r?.offboardBugsRaisedCount ?? 0);
          const sub = (r?.subBugsRaisedCount ?? 0) + (r?.offboardSubBugsRaisedCount ?? 0);
          return { sprintName: s.sprintName, bugs: Math.max(total - sub, 0), subBugs: sub };
        });
        base.ticketsTested = sprints.map(s => ({
          sprintName: s.sprintName,
          value: rowBySync.get(s.syncId)?.ticketsTestedCount ?? 0,
        }));
        base.qaContribution = latestSyncObj
          ? buildContribution(
              latestSyncObj,
              latestSyncScores,
              memberMatcher,
              s => s.memberCategory === 'qa',
              s => s.ticketsTestedCount
            )
          : null;
      } else {
        // developer (default for non-qa / unknown)
        base.spDelivered = sprints.map(s => ({
          sprintName: s.sprintName,
          value: round1(rowBySync.get(s.syncId)?.spDone ?? 0),
        }));
        const participated = sprints.map(s => rowBySync.get(s.syncId)).filter(Boolean) as PerfMemberScore[];
        base.avgSp = participated.length
          ? round1(participated.reduce((a, r) => a + r.spDone, 0) / participated.length)
          : 0;
        base.reopens = sprints.map(s => ({
          sprintName: s.sprintName,
          value: rowBySync.get(s.syncId)?.reopenedCount ?? 0,
        }));
        base.carryovers = sprints.map(s => ({
          sprintName: s.sprintName,
          value: rowBySync.get(s.syncId)?.spilloverCount ?? 0,
        }));
        base.contribution = latestSyncObj
          ? buildContribution(
              latestSyncObj,
              latestSyncScores,
              memberMatcher,
              s => s.memberCategory !== 'qa',
              s => s.spDone
            )
          : null;
      }

      out.push(base);
    }

    return { linked: true, memberName, jiraLoginId: member.jiraLoginId, projects: out };
  },

  async getTechNotesGap(reqUser: RequestUser, projectId: number): Promise<TechNotesGap> {
    const member = await resolveMember(reqUser);
    if (!member) return { count: 0, keys: [], unavailable: true };

    const project = await Project.findByPk(projectId);
    if (!project || project.isKanbanProject) return { count: 0, keys: [], unavailable: true };

    const assocs = await AccountTeamMember.findAll({ where: { teamMemberId: member.id } });
    if (!belongsToProject(assocs, project)) return { count: 0, keys: [], unavailable: true };

    if (!project.jiraBaseUrl || !project.jiraEmail || !project.jiraApiToken) {
      return { count: 0, keys: [], unavailable: true };
    }

    // Assignee is filtered in code, not JQL — see isMine(). Previously this
    // carried `AND assignee = "<jiraLoginId>"`, which always matched zero and
    // so rendered a false "you're all caught up" to every member.
    const jql =
      `sprint in openSprints() AND project = "${jqlEscape(project.jiraName)}" ` +
      `AND "Story Points[Number]" >= 2 ` +
      `AND type not in (Sub-bug, Sub-task, Task) ` +
      `AND status in (Backlog, "In Progress", "Dev Complete") ` +
      `AND "Technical Notes[Paragraph]" is EMPTY ` +
      `ORDER BY key ASC`;

    try {
      const jira = new JiraService(project.jiraBaseUrl, project.jiraEmail, project.jiraApiToken);
      const matcher = buildV2Matcher([member]);
      const issues = (await jira.getAllIssuesFromJql(jql)).filter((i: JiraIssue) =>
        isMine(i.fields?.assignee, matcher)
      );
      return {
        count: issues.length,
        keys: issues.map((i: JiraIssue) => ({ key: i.key, summary: i.fields?.summary ?? '' })),
      };
    } catch (e) {
      console.error('[memberDashboard] tech-notes-gap Jira query failed:', (e as Error)?.message);
      return { count: 0, keys: [], unavailable: true };
    }
  },

  /**
   * Live-Jira automation-label breakdown for the member's CURRENT OPEN SPRINT.
   * Deliberately a different window from the rest of the dashboard (which is the
   * last 5 completed sprints) — the point is to surface untriaged tickets while
   * they can still be labelled.
   */
  async getAutomationLabels(reqUser: RequestUser, projectId: number): Promise<AutomationLabelSummary> {
    const empty = (basis: AutomationLabelSummary['basis']): AutomationLabelSummary => ({
      automated: 0,
      pending: 0,
      notRequired: 0,
      unlabelled: 0,
      total: 0,
      unlabelledKeys: [],
      basis,
      unavailable: true,
    });

    const member = await resolveMember(reqUser);
    if (!member) return empty('assignee');

    const project = await Project.findByPk(projectId);
    if (!project || project.isKanbanProject) return empty('assignee');

    const assocs = await AccountTeamMember.findAll({ where: { teamMemberId: member.id } });
    if (!belongsToProject(assocs, project)) return empty('assignee');

    // Discipline gate — read the RAW role, not the flattened qa/developer category
    // (resolveCategoryForProject collapses "CSS Developer" to 'developer'). Checked
    // before the JiraService is built so the live call is skipped entirely.
    if (isAutomationOutOfScope(projectRoleFor(assocs, project))) return empty('assignee');

    if (!project.jiraBaseUrl || !project.jiraEmail || !project.jiraApiToken) {
      return empty('assignee');
    }
    if (!member.jiraLoginId) return empty('assignee');

    const category = await resolveCategoryForProject(project, member, assocs);
    const basis: AutomationLabelSummary['basis'] = category === 'qa' ? 'qaAssignee' : 'assignee';

    try {
      const jira = new JiraService(project.jiraBaseUrl, project.jiraEmail, project.jiraApiToken);

      // Which field carries "this ticket is mine". Ids differ per Jira instance,
      // so the QA field is resolved by name off the cached field list — on CCMH it
      // is "Assigned QA" / customfield_10204, not "QA Assignee".
      let ownerField = 'assignee';
      if (basis === 'qaAssignee') {
        const fields = await jira.getFields();
        const jiraFields = fields as Array<{ id: string; name?: string }>;
        const qaField = ['QA Assignee', 'Assigned QA', 'QA']
          .map(n => jiraFields.find(f => String(f.name ?? '').toLowerCase() === n.toLowerCase()))
          .find(Boolean);
        // No QA-assignee field on this instance: show nothing rather than
        // silently falling back to the main assignee.
        if (!qaField) return empty('qaAssignee');
        ownerField = qaField.id;
      }

      // Sub-tasks and sub-bugs are excluded — they are not independently
      // automated and would inflate the unlabelled bucket with noise.
      // Ownership is NOT in the JQL; it is matched in code by isMine().
      const jql =
        `sprint in openSprints() AND project = "${jqlEscape(project.jiraName)}" ` +
        `AND type not in (Sub-task, Sub-bug) ` +
        `ORDER BY key ASC`;

      const matcher = buildV2Matcher([member]);
      const issues = (await jira.getAllIssuesFromJql(jql)).filter((i: JiraIssue) =>
        isMine(i.fields[ownerField as keyof JiraIssue['fields']], matcher)
      );

      const summary: AutomationLabelSummary = {
        automated: 0,
        pending: 0,
        notRequired: 0,
        unlabelled: 0,
        total: issues.length,
        unlabelledKeys: [],
        basis,
      };
      for (const issue of issues) {
        const labels = (issue.fields as JiraIssue['fields'] & { labels?: string[] })?.labels;
        const bucket = bucketByAutomationLabel(labels);
        summary[bucket] += 1;
        if (bucket === 'unlabelled') {
          summary.unlabelledKeys.push({
            key: issue.key,
            summary: (issue as JiraIssue)?.fields?.summary ?? '',
          });
        }
      }
      return summary;
    } catch (e) {
      console.error('[memberDashboard] automation-labels Jira query failed:', (e as Error)?.message);
      return empty(basis);
    }
  },
};
