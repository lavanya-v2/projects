import { Op } from 'sequelize';
import { Project } from '../../../models/Project';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { TeamMember } from '../../../models/TeamMember';
import { JiraService } from '../../jira/services/jiraService';
import { getLaneConfig } from '../../../common/laneDefaults';
import { logger } from '../../../common/utils';
import { findScopeAddedAt, resolvePrevSprintIds, buildDeveloperResolver, ResolvedDeveloper } from './performanceSyncService';
import { EstimateReader, makeEstimateReader } from './estimateExtraction';

export interface JiraSprintSummary {
    id: number;
    name: string;
    startDate: string;
    endDate: string;
    state: string;
}

export interface MemberBreakdown {
    todo: number;
    inProgress: number;
    inReview: number;
    inQa: number;
    inUat: number;
    blocked: number;
    done: number;
}

export interface MemberStat {
    jiraLoginId: string;
    displayName: string;
    storyPointsDone: number;
    storyPointsCarriedOver: number;
    reopenedCount: number;
    breakdown?: MemberBreakdown; // active sprint only
}

export interface LateQaMover {
    key: string;
    summary: string;
    assignee: string;
    currentStatus: string;
    movedToQaAt: string;
    movedToQaStatus: string;
}

export interface BacklogContribution {
    key: string;
    summary: string;
    memberId: string;
    displayName: string;
    sp: number;             // may be 0 if ticket has no estimation — still listed
    currentStatus: string;
    progressedFrom: string; // status before the first sprint-window transition
    progressedTo: string;   // status after the first sprint-window transition
    movedAt: string;        // ISO timestamp of that first transition
}

export interface ScopeCreepTicket {
    key: string;
    summary: string;
    assignee: string;
    isV2Member: boolean;    // true if assigned to a V2 team member
    sp: number;
    currentStatus: string;
    addedAt: string;        // ISO timestamp when ticket was added to the sprint
}

export interface TeamPerformanceResult {
    sprintName: string;
    sprintStartDate: string;
    sprintEndDate: string;
    isHistorical: boolean;
    memberStats: MemberStat[];
    overallSpPlanned: number;
    overallSpDone: number;
    overallDeliveryPct: number;
    v2SpPlanned: number;
    v2SpDone: number;
    v2DeliveryPct: number;
    totalSpilloverCount: number;
    totalSpilloverSp: number;
    v2SpilloverCount: number;
    v2SpilloverSp: number;
    inProgressSp: number;
    inReviewSp: number;
    inQaSp: number;
    inUatSp: number;
    blockedSp: number;
    todoSp: number;
    scopeChangeSp: number;
    scopeChangeCount: number;
    v2ScopeChangeSp: number;
    v2ScopeChangeCount: number;
    lateQaMovers: LateQaMover[];
    scopeCreepTickets: ScopeCreepTicket[];
    backlogContributions: BacklogContribution[];
}

export interface SprintMemberStat {
    sprintId: number;
    sprintName: string;
    sprintStartDate: string;
    sprintEndDate: string;
    spPlanned: number;
    spDone: number;
    deliveryPct: number;
    spilloverCount: number;
    spilloverSp: number;
    breakdown?: MemberBreakdown; // populated for current (active) sprint only
}

export interface DeveloperDashboardCard {
    jiraLoginId: string;
    displayName: string;
    completedSprints: SprintMemberStat[];
    averages: {
        spPlanned: number;
        spDone: number;
        deliveryPct: number;
        spilloverCount: number;
        spilloverSp: number;
    };
    currentSprint: SprintMemberStat | null;
}

/**
 * Status names that should be treated as "done" for delivery/spillover purposes,
 * even if Jira categorises them under "In Progress".
 * Add any project-specific terminal statuses here.
 */
const EFFECTIVE_DONE_STATUSES = new Set([
    'pending deployment',
    'ready for deployment',
    'ready for release',
    'deployed',
    'released',
    'done',
    'closed',
    'resolved',
    'complete',
    'completed',
    'accepted',
    'verified',
]);


/**
 * In "shared assignee" mode (assigneeMode === 'shared'), the same Jira assignee field
 * is used for both developer and QA. When a developer finishes a ticket they reassign it
 * to the QA person; the ticket then closes with QA as the final assignee.
 *
 * This function walks the changelog assignee changes in reverse to find the most recent
 * assignee who held a Developer role (role name contains "developer", case-insensitive).
 * If found, story points are attributed to that person instead of the final assignee.
 *
 * Returns null if:
 *   - The ticket never transitioned into a QA status
 *   - No one was assigned at the moment of the first QA transition
 *   - The assignee at that moment is not a V2 Developer-role team member
 *
 * Why "first QA transition" rather than "most recent developer"?
 * The developer who hands a ticket to QA is definitively the one who completed the work.
 * Walking backward through all assignees risks picking up brief triage assignments where
 * someone touched the ticket before passing it to a client developer who did the real work.
 */
function findDevAtFirstQaTransition(
    histories: any[],
    qaStatuses: Set<string>,
    developerJiraLoginIds: Set<string>,
    matchMember: (accountId: string | null | undefined, displayName: string) => string | null,
): { memberId: string; displayName: string } | null {

    // Sort histories chronologically (oldest first)
    const sorted = [...histories].sort(
        (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
    );

    // Track the current assignee as we walk forward through time
    let currentAssigneeId: string | null = null;
    let currentAssigneeName = '';

    for (const history of sorted) {
        const items: any[] = history.items ?? [];

        // Capture the assignee change item in this event (if any).
        // In Jira a single history can atomically change both status AND assignee
        // (e.g. dev assigns to QA and moves to "Ready to Test" in one action).
        // The item.from of that assignee change is who held it BEFORE this event.
        const assigneeItem = items.find((i: any) => i.field === 'assignee');

        // Check if this event contains a transition INTO a QA status
        const isQaTransition = items.some(
            (i: any) => i.field === 'status' && qaStatuses.has((i.toString ?? '').toLowerCase())
        );

        if (isQaTransition) {
            // Determine who was assigned just before this QA transition:
            //   - If the same event also reassigns (dev→QA person), use the assignee item's
            //     "from" field — that is the developer who triggered the handoff.
            //   - Otherwise use the tracked state from prior events.
            let candidateId: string | null;
            let candidateName: string;
            if (assigneeItem) {
                candidateId = assigneeItem.from ?? null;
                candidateName = assigneeItem.fromString ?? '';
            } else {
                candidateId = currentAssigneeId;
                candidateName = currentAssigneeName;
            }

            if (!candidateId && !candidateName) return null;

            const memberId = matchMember(candidateId, candidateName);
            if (memberId && developerJiraLoginIds.has(memberId)) {
                return { memberId, displayName: candidateName };
            }
            // First QA transition found but assignee is not a V2 developer — stop here.
            return null;
        }

        // Update tracked assignee for the next iteration
        if (assigneeItem) {
            currentAssigneeId = assigneeItem.to ?? null;
            currentAssigneeName = assigneeItem.toString ?? '';
        }
    }

    return null;
}

/**
 * Finds backlog tickets that V2 developers progressed during the sprint window.
 * "Backlog" here means tickets with no active sprint assigned — includes:
 *   - sprint is EMPTY (pure backlog, no sprint at all)
 *   - sprint in futureSprints() (queued for a future sprint not yet started)
 * Attribution uses history.author — who actually made the status transition — rather than the
 * current assignee (which may change after the sprint ends).
 * Tickets with 0 SP (no estimation) are included — the developer's work is still valid.
 */
async function fetchBacklogContributions(
    jira: JiraService,
    jiraName: string,
    sprintStart: Date,
    sprintEnd: Date,
    developerJiraLoginIds: Set<string>,
    matchMember: (accountId: string | null | undefined, displayName: string) => string | null,
    readEstimate: EstimateReader,
): Promise<BacklogContribution[]> {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const jql = `project = "${jiraName}" AND (sprint is EMPTY OR sprint in futureSprints()) AND updated >= "${fmt(sprintStart)}" AND updated <= "${fmt(sprintEnd)}" ORDER BY updated DESC`;

    let issues: any[];
    try {
        issues = await jira.getAllIssuesFromJql(jql);
    } catch (e: any) {
        logger.debug(`Backlog contributions JQL failed: ${e.message}`, 'TeamPerformanceService');
        return [];
    }
    if (issues.length === 0) return [];

    let changelogMap = new Map<string, any[]>();
    try {
        changelogMap = await jira.getChangelogsForKeys(issues.map((i: any) => i.key));
    } catch (e: any) {
        logger.debug(`Backlog contributions changelog fetch failed: ${e.message}`, 'TeamPerformanceService');
        return [];
    }

    const seen = new Set<string>();
    const contributions: BacklogContribution[] = [];

    for (const issue of issues) {
        const fields = issue.fields as any;
        // Include tickets even when sp === 0 (no estimation)
        const sp: number = readEstimate(fields);
        const currentStatus: string = fields.status?.name ?? '';
        const summary: string = fields.summary ?? issue.key;

        const histories: any[] = (changelogMap.get(issue.key) ?? [])
            .slice()
            .sort((a: any, b: any) => new Date(a.created).getTime() - new Date(b.created).getTime());

        for (const history of histories) {
            const created = new Date(history.created);
            if (created < sprintStart || created > sprintEnd) continue;

            const statusItem = history.items?.find((i: any) => i.field === 'status');
            if (!statusItem) continue;

            const authorAccountId: string | undefined = history.author?.accountId;
            const authorDisplayName: string = history.author?.displayName ?? '';
            const memberId = matchMember(authorAccountId, authorDisplayName);
            if (!memberId) continue;
            // If developer roles are configured, restrict to developer-role members only.
            // If no roles are configured (empty set), accept any matched V2 member — avoids
            // silently excluding everyone when AccountTeamMember roles haven't been set up.
            if (developerJiraLoginIds.size > 0 && !developerJiraLoginIds.has(memberId)) continue;

            const dedupKey = `${issue.key}::${memberId}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            contributions.push({
                key: issue.key,
                summary,
                memberId,
                displayName: authorDisplayName,
                sp,
                currentStatus,
                progressedFrom: statusItem.fromString ?? '',
                progressedTo: statusItem.toString ?? '',
                movedAt: history.created,
            });
            // Don't break — another team member may have worked on the same ticket
        }
    }

    return contributions;
}

class TeamPerformanceService {

    async listJiraSprints(projectId: number): Promise<JiraSprintSummary[]> {
        const project = await Project.findByPk(projectId);
        if (!project) throw new Error(`Project ${projectId} not found`);

        const jira = JiraService.forProject(project);
        const allSprints = await jira.listBoardSprints(project.jiraBoardId, 20);

        // Filter by project name prefix to avoid cross-project contamination on shared boards
        // (e.g. board 328 has both LOT and EXP sprints).
        // If no sprints match the prefix the board is project-dedicated — show all sprints.
        const prefix = project.jiraName.toLowerCase();
        const prefixFiltered = allSprints.filter(s =>
            typeof s.name === 'string' && s.name.toLowerCase().startsWith(prefix)
        );
        const sprints = prefixFiltered.length > 0 ? prefixFiltered : allSprints;

        return sprints.slice(0, 5).map(s => ({
            id: s.id,
            name: s.name,
            startDate: s.startDate ?? '',
            endDate: s.endDate ?? s.completeDate ?? '',
            state: s.state,
        }));
    }

    async generateReport(params: {
        projectId: number;
        sprintId: number;
        memberJiraIds: string[];
    }): Promise<TeamPerformanceResult> {
        const { projectId, sprintId, memberJiraIds } = params;

        const project = await Project.findByPk(projectId);
        if (!project) throw new Error(`Project ${projectId} not found`);

        const jira = JiraService.forProject(project);
        // Resolves a ticket's developer per the project's configured owner field(s)
        // (ownerFields.developer) instead of always reading raw fields.assignee —
        // same fix as performanceSyncService.ts's buildTicketFactsFromJiraData.
        const resolveDeveloper = await buildDeveloperResolver(jira, project as any);

        // Fetch sprint details
        const sprintResponse = await (jira as any).client.get(`/rest/agile/1.0/sprint/${sprintId}`);
        const sprint = sprintResponse.data;
        const sprintStartDate: string = sprint.startDate ?? '';
        const sprintEndDate: string = sprint.endDate ?? sprint.completeDate ?? '';
        const isHistorical = sprint.state === 'closed';

        const sprintStart = sprintStartDate ? new Date(sprintStartDate) : null;

        // Resolve the immediately-preceding sprint so scope-creep detection can
        // exclude carry-in (rolled forward at sprint kickoff). DB-first (synced
        // predecessor) with Jira fallback — same resolver the scorecard sync
        // uses, so the two paths produce matching counts.
        const prevSprintIds = await resolvePrevSprintIds({
            projectId: project.id,
            boardId: project.jiraBoardId,
            jiraName: project.jiraName,
            currentSprintId: sprintId,
            currentSprintStartDate: sprintStartDate,
            currentSprintEndDate: sprintEndDate,
            jira,
        });

        // For historical sprints, use completeDate as the replay target — Jira's endDate is set
        // to midnight (start of day), so tickets moved to Done during business hours on the end
        // day would be missed. completeDate is when the SM actually closed the sprint and
        // captures all transitions up to that moment.
        // Fall back: endDate + 23h59m (end of planned end day) to cover the full day.
        let sprintEnd: Date | null = null;
        if (sprintEndDate) {
            if (sprint.completeDate && isHistorical) {
                sprintEnd = new Date(sprint.completeDate);
            } else {
                const d = new Date(sprintEndDate);
                d.setHours(23, 59, 59, 999);
                sprintEnd = d;
            }
        }

        const lateQaThreshold = sprintEnd ? new Date(sprintEnd.getTime() - 2 * 24 * 60 * 60 * 1000) : null;

        // Pre-resolve each member email → Jira accountId
        const accountIdToMemberId = new Map<string, string>();
        // Fallback: displayName → jiraLoginId (Jira Cloud email privacy)
        const displayNameToMemberId = new Map<string, string>();
        await Promise.all(memberJiraIds.map(async (jiraId) => {
            let accountId: string | null = null;
            try {
                accountId = await jira.getUserAccountIdByEmail(jiraId);
            } catch (e) {
                logger.warn(`Could not resolve Jira accountId for ${jiraId}, falling back to display name match`, 'TeamPerformanceService');
            }
            if (accountId) {
                accountIdToMemberId.set(accountId, jiraId);
            } else {
                const localPart = jiraId.split('@')[0].replace(/_(ext|int|contractor)$/i, '');
                const derivedName = localPart.split('.').map(
                    (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
                ).join(' ');
                displayNameToMemberId.set(derivedName.toLowerCase(), jiraId);
            }
        }));

        // Pre-seed all selected members
        const memberStatsMap = new Map<string, MemberStat>();
        for (const jiraId of memberJiraIds) {
            memberStatsMap.set(jiraId, {
                jiraLoginId: jiraId,
                displayName: jiraId,
                storyPointsDone: 0,
                storyPointsCarriedOver: 0,
                reopenedCount: 0,
                // breakdown initialized for active sprints below
            });
        }
        if (!isHistorical) {
            for (const stat of memberStatsMap.values()) {
                stat.breakdown = { todo: 0, inProgress: 0, inReview: 0, inQa: 0, inUat: 0, blocked: 0, done: 0 };
            }
        }

        let overallSpPlanned = 0;
        let overallSpDone = 0;
        let v2SpPlanned = 0;
        let v2SpDone = 0;
        let totalSpilloverCount = 0;
        let totalSpilloverSp = 0;
        let v2SpilloverCount = 0;
        let v2SpilloverSp = 0;
        let inProgressSp = 0;
        let inReviewSp = 0;
        let inQaSp = 0;
        let inUatSp = 0;
        let blockedSp = 0;
        let todoSp = 0;
        let scopeChangeSp = 0;
        let scopeChangeCount = 0;
        let v2ScopeChangeSp = 0;
        let v2ScopeChangeCount = 0;
        const lateQaMovers: LateQaMover[] = [];
        const scopeCreepTickets: ScopeCreepTicket[] = [];
        let backlogContributions: BacklogContribution[] = [];

        const matchMember = (accountId: string | null | undefined, displayName: string): string | null => {
            if (accountId) {
                const m = accountIdToMemberId.get(accountId);
                if (m) return m;
            }
            if (displayName && displayNameToMemberId.size > 0) {
                return displayNameToMemberId.get(displayName.toLowerCase()) ?? null;
            }
            return null;
        };

        // ── Role-based attribution maps ──────────────────────────────────────────
        // Used when assigneeMode === 'shared': determine whether the final assignee
        // is QA (should not get credit) and who the developer was (should get credit).
        const qaJiraLoginIds = new Set<string>();
        const developerJiraLoginIds = new Set<string>();
        try {
            const associations = await AccountTeamMember.findAll({
                where: {
                    accountId: project.accountId,
                    [Op.or]: [
                        { projectId },
                        { projectId: null },
                    ],
                },
                include: [{ model: TeamMember, as: 'teamMember' }],
            });
            for (const assoc of associations) {
                const jiraLoginId = (assoc as any).teamMember?.jiraLoginId;
                const role: string = assoc.role ?? '';
                if (!jiraLoginId || !memberJiraIds.includes(jiraLoginId)) continue;
                if (role.toLowerCase() === 'qa') qaJiraLoginIds.add(jiraLoginId);
                if (role.toLowerCase().includes('developer')) developerJiraLoginIds.add(jiraLoginId);
            }
            logger.debug(
                `Attribution roles — QA: [${[...qaJiraLoginIds].join(', ')}]  Dev: [${[...developerJiraLoginIds].join(', ')}]`,
                'TeamPerformanceService'
            );
        } catch (e: any) {
            logger.debug(`Could not load member roles for attribution: ${e.message}`, 'TeamPerformanceService');
        }

        const accumulate = (sp: number, isDone: boolean, matchedMemberId: string | null, displayName: string) => {
            overallSpPlanned += sp;
            if (isDone) overallSpDone += sp;
            else { totalSpilloverCount++; totalSpilloverSp += sp; }

            if (matchedMemberId) {
                v2SpPlanned += sp;
                if (isDone) v2SpDone += sp;
                else { v2SpilloverCount++; v2SpilloverSp += sp; }
                const stat = memberStatsMap.get(matchedMemberId)!;
                if (displayName) stat.displayName = displayName;
                if (isDone) stat.storyPointsDone += sp;
                else stat.storyPointsCarriedOver += sp;
            }
        };

        // Lane config is needed by both the historical and active sprint paths
        // (historical needs it to build the QA/UAT status sets for changelog lookup).
        const laneConfig = getLaneConfig(project as any);
        const assigneeMode: string = laneConfig.assigneeMode ?? 'separate';
        const uatStatuses = new Set<string>(
            [...(laneConfig.uat ?? []), 'PO REVIEW', 'UAT', 'Acceptance Testing', 'User Acceptance Testing', 'UAT Testing', 'In UAT']
                .map(s => s.toLowerCase())
        );
        const qaStatuses = new Set<string>(
            [...(laneConfig.qa ?? []), 'In QA', 'QA Review', 'QA Testing', 'In Testing', 'Ready for QA', 'QA']
                .map(s => s.toLowerCase())
        );

        // Resolve the estimate reader (story points, or hours for hours-based projects)
        // — needed by both historical and active paths.
        const readEstimate = await makeEstimateReader(project as any, jira);

        if (isHistorical) {
            // ── HISTORICAL SPRINT ────────────────────────────────────────────────────
            // Use the GreenHopper sprint report API which gives us the exact state at
            // sprint end — completedIssues (done during sprint) vs
            // issuesNotCompletedInCurrentSprint (spillover at sprint end).
            // This is the same data source Jira's own Sprint Retrospective report uses.
            const sprintReport = await jira.getSprintReport(project.jiraBoardId, sprintId);
            logger.debug(
                `GreenHopper: ${sprintReport.completedIssues.length} completed, ` +
                `${sprintReport.notCompletedIssues.length} not-completed`,
                'TeamPerformanceService'
            );

            // GreenHopper doesn't include changelogs. Fetch changelogs via the dedicated
            // per-issue endpoint (/rest/api/3/issue/{key}/changelog) in parallel batches.
            // NOTE: POST /rest/api/3/search/jql?expand=changelog does NOT embed changelogs —
            // the changelog key is absent from the response entirely. Individual fetches are required.
            const allSprintKeys = [
                ...sprintReport.completedIssues.map((i: any) => i.key),
                ...sprintReport.notCompletedIssues.map((i: any) => i.key),
            ];
            // Build a display-data map from GreenHopper for late QA movers output
            const ghDisplayMap = new Map<string, { assigneeName: string; statusName: string }>();
            for (const i of [...sprintReport.completedIssues, ...sprintReport.notCompletedIssues]) {
                ghDisplayMap.set(i.key, { assigneeName: i.assigneeName ?? 'Unassigned', statusName: i.statusName ?? '' });
            }

            let changelogMap = new Map<string, any[]>();
            if (allSprintKeys.length > 0 && (assigneeMode === 'shared' || lateQaThreshold || !!sprintStart)) {
                try {
                    changelogMap = await jira.getChangelogsForKeys(allSprintKeys);
                    logger.debug(`Fetched changelogs for ${changelogMap.size} sprint issues`, 'TeamPerformanceService');
                } catch (e: any) {
                    logger.debug(`Could not fetch changelogs for historical sprint: ${e.message}`, 'TeamPerformanceService');
                }
            }

            // Fetch issue fields (summary + assignee) for late QA display and scope creep detection
            const issueFieldsMap = new Map<string, any>();
            if ((lateQaThreshold || !!sprintStart) && allSprintKeys.length > 0) {
                try {
                    const fullIssues = await jira.getAllIssuesFromJql(
                        `key in (${allSprintKeys.join(',')}) ORDER BY key ASC`
                    );
                    for (const i of fullIssues) issueFieldsMap.set(i.key, i.fields);
                } catch (e: any) {
                    logger.debug(`Could not fetch issue fields for late QA display: ${e.message}`, 'TeamPerformanceService');
                }
            }

            for (const issue of sprintReport.completedIssues) {
                let effectiveMemberId = matchMember(issue.assigneeAccountId, issue.assigneeName);
                let effectiveDisplayName: string = issue.assigneeName;

                if (assigneeMode === 'shared' && (!effectiveMemberId || qaJiraLoginIds.has(effectiveMemberId))) {
                    const histories = changelogMap.get(issue.key) ?? [];
                    const dev = findDevAtFirstQaTransition(histories, qaStatuses, developerJiraLoginIds, matchMember);
                    if (dev) {
                        effectiveMemberId = dev.memberId;
                        effectiveDisplayName = dev.displayName;
                    }
                }

                accumulate(issue.storyPoints, true, effectiveMemberId, effectiveDisplayName);
            }
            for (const issue of sprintReport.notCompletedIssues) {
                const matchedMemberId = matchMember(issue.assigneeAccountId, issue.assigneeName);
                accumulate(issue.storyPoints, false, matchedMemberId, issue.assigneeName);
            }

            // Late QA movers — historical sprints
            if (lateQaThreshold && changelogMap.size > 0) {
                for (const key of allSprintKeys) {
                    const histories = changelogMap.get(key) ?? [];
                    const display = ghDisplayMap.get(key) ?? { assigneeName: 'Unassigned', statusName: '' };
                    const fields = issueFieldsMap.get(key);
                    for (const history of histories) {
                        if (new Date(history.created) >= lateQaThreshold) {
                            for (const item of history.items) {
                                if (item.field === 'status' && qaStatuses.has((item.toString ?? '').toLowerCase())) {
                                    lateQaMovers.push({
                                        key,
                                        summary: fields?.summary ?? key,
                                        assignee: fields?.assignee?.displayName ?? display.assigneeName,
                                        currentStatus: fields?.status?.name ?? display.statusName,
                                        movedToQaAt: history.created,
                                        movedToQaStatus: item.toString ?? '',
                                    });
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Scope creep — historical sprints. findScopeAddedAt excludes carry-in
            // from the immediately-preceding sprint and returns the timestamp of the
            // post-start Sprint-add event (or null when not real creep).
            if (sprintStart && changelogMap.size > 0) {
                for (const key of allSprintKeys) {
                    const histories = changelogMap.get(key) ?? [];
                    const display = ghDisplayMap.get(key) ?? { assigneeName: 'Unassigned', statusName: '' };
                    const fields = issueFieldsMap.get(key);
                    const addedAt = findScopeAddedAt(histories, sprintId, sprintStart, prevSprintIds);
                    if (!addedAt) continue;
                    const ghIssue = [...sprintReport.completedIssues, ...sprintReport.notCompletedIssues]
                        .find((i: any) => i.key === key);
                    const sp: number = ghIssue?.storyPoints ?? 0;
                    const dev: ResolvedDeveloper = fields ? resolveDeveloper(fields) : { accountId: null, displayName: null };
                    const assigneeName = dev.displayName ?? display.assigneeName;
                    const assigneeAccountId = dev.accountId ?? undefined;
                    const memberId = matchMember(assigneeAccountId, assigneeName);
                    scopeChangeCount++;
                    scopeChangeSp += sp;
                    if (memberId) {
                        v2ScopeChangeCount++;
                        v2ScopeChangeSp += sp;
                    }
                    scopeCreepTickets.push({
                        key,
                        summary: fields?.summary ?? key,
                        assignee: memberId
                            ? (memberStatsMap.get(memberId)?.displayName ?? assigneeName)
                            : assigneeName,
                        isV2Member: !!memberId,
                        sp,
                        currentStatus: fields?.status?.name ?? display.statusName,
                        addedAt,
                    });
                }
            }

            // Backlog contributions — historical sprints
            if (sprintStart && sprintEnd && project.jiraName) {
                try {
                    backlogContributions = await fetchBacklogContributions(
                        jira, project.jiraName, sprintStart, sprintEnd,
                        developerJiraLoginIds, matchMember, readEstimate,
                    );
                } catch (e: any) {
                    logger.debug(`Backlog contributions fetch failed: ${e.message}`, 'TeamPerformanceService');
                }
            }
        } else {
            // ── ACTIVE SPRINT ────────────────────────────────────────────────────────
            // Use JQL + current status. Sprint is live so current status IS the truth.
            // spFieldId already resolved above (shared with historical path)

            const blockedStatuses = new Set<string>(
                [...(laneConfig.blocked ?? []), 'Blocked', 'Impediment', 'On Hold']
                    .map(s => s.toLowerCase())
            );
            const inReviewStatuses = new Set<string>(
                [...(laneConfig.in_review ?? []), 'DEV COMPLETE', 'Dev Complete', 'PR REVIEW', 'Code Review', 'In Review', 'Ready for Review']
                    .map(s => s.toLowerCase())
            );
            const inProgressStatuses = new Set<string>(
                [...(laneConfig.in_progress ?? []), 'In Progress', 'In Development']
                    .map(s => s.toLowerCase())
            );

            const issues = await jira.getAllIssuesFromJql(`sprint = ${sprintId} ORDER BY created ASC`);
            logger.debug(`Fetched ${issues.length} issues for active sprint ${sprintId}`, 'TeamPerformanceService');

            // Log all distinct statuses to help diagnose classification
            const distinctStatuses = new Set(issues.map((i: any) => i.fields?.status?.name ?? 'unknown'));
            logger.info(`Active sprint statuses: ${[...distinctStatuses].join(', ')}`, 'TeamPerformanceService');

            // Pre-fetch changelogs for all sprint issues when needed:
            // - shared assignee mode (to find developer at QA transition for done tickets)
            // - lateQaThreshold set (to detect late QA movers)
            // - always needed for scope change detection (sprint membership changes after sprint start)
            // NOTE: JQL search/jql does NOT embed changelogs — must fetch per-issue separately.
            let activeChangelogMap = new Map<string, any[]>();
            const allSprintIssueKeys = issues.map((i: any) => i.key as string);
            if (allSprintIssueKeys.length > 0) {
                try {
                    activeChangelogMap = await jira.getChangelogsForKeys(allSprintIssueKeys);
                    logger.debug(`Fetched changelogs for ${activeChangelogMap.size} active-sprint issues`, 'TeamPerformanceService');
                } catch (e: any) {
                    logger.debug(`Could not fetch changelogs for active sprint: ${e.message}`, 'TeamPerformanceService');
                }
            }

            for (const issue of issues) {
                const fields = issue.fields as any;
                const sp: number = readEstimate(fields);
                const currentStatusName: string = fields.status?.name ?? '';
                const isDone: boolean = (fields.status?.statusCategory?.key ?? '') === 'done'
                    || EFFECTIVE_DONE_STATUSES.has(currentStatusName.toLowerCase());

                const dev = resolveDeveloper(fields);
                const assigneeAccountId: string | undefined = dev.accountId ?? undefined;
                const assigneeName: string = dev.displayName ?? 'Unassigned';
                const matchedMemberId = matchMember(assigneeAccountId, assigneeName);

                // In 'shared' mode: if the final assignee is QA, find the developer in changelog
                let effectiveMemberId = matchedMemberId;
                let effectiveDisplayName = assigneeName;
                if (isDone && assigneeMode === 'shared' && (!effectiveMemberId || qaJiraLoginIds.has(effectiveMemberId))) {
                    const histories = activeChangelogMap.get(issue.key) ?? [];
                    const dev = findDevAtFirstQaTransition(histories, qaStatuses, developerJiraLoginIds, matchMember);
                    if (dev) {
                        effectiveMemberId = dev.memberId;
                        effectiveDisplayName = dev.displayName;
                    }
                }

                accumulate(sp, isDone, effectiveMemberId, effectiveDisplayName);

                // Classify by pipeline stage for progress indicator and member breakdown
                const statusLower = currentStatusName.toLowerCase();
                const statusCategory = fields.status?.statusCategory?.key ?? '';
                let stageBucket: keyof MemberBreakdown;
                if (isDone) {
                    stageBucket = 'done';
                } else if (blockedStatuses.has(statusLower)) {
                    stageBucket = 'blocked';
                    blockedSp += sp;
                } else if (uatStatuses.has(statusLower)) {
                    stageBucket = 'inUat';
                    inUatSp += sp;
                } else if (qaStatuses.has(statusLower)) {
                    stageBucket = 'inQa';
                    inQaSp += sp;
                } else if (inReviewStatuses.has(statusLower)) {
                    stageBucket = 'inReview';
                    inReviewSp += sp;
                } else if (inProgressStatuses.has(statusLower) || statusCategory === 'indeterminate') {
                    stageBucket = 'inProgress';
                    inProgressSp += sp;
                } else {
                    stageBucket = 'todo';
                    todoSp += sp;
                }

                // Update per-member breakdown — use effectiveMemberId so done credit goes to developer
                if (effectiveMemberId) {
                    const stat = memberStatsMap.get(effectiveMemberId)!;
                    if (stat?.breakdown) stat.breakdown[stageBucket] += sp;
                }

                // Detect scope changes: tickets added post-start that aren't carry-in
                // from the immediately-preceding sprint.
                if (sprintStart) {
                    const histories = activeChangelogMap.get(issue.key) ?? [];
                    const addedAtTimestamp = findScopeAddedAt(histories, sprintId, sprintStart, prevSprintIds);
                    if (addedAtTimestamp) {
                        scopeChangeCount++;
                        scopeChangeSp += sp;
                        if (effectiveMemberId) {
                            v2ScopeChangeCount++;
                            v2ScopeChangeSp += sp;
                        }
                        scopeCreepTickets.push({
                            key: issue.key,
                            summary: fields.summary ?? issue.key,
                            assignee: effectiveMemberId
                                ? (memberStatsMap.get(effectiveMemberId)?.displayName ?? assigneeName)
                                : assigneeName,
                            isV2Member: !!effectiveMemberId,
                            sp,
                            currentStatus: currentStatusName,
                            addedAt: addedAtTimestamp,
                        });
                    }
                }

                // Late QA movers — use pre-fetched changelog (JQL search does not embed changelogs)
                if (lateQaThreshold) {
                    const histories = activeChangelogMap.get(issue.key) ?? [];
                    for (const history of histories) {
                        if (new Date(history.created) >= lateQaThreshold) {
                            for (const item of history.items) {
                                if (item.field === 'status' && qaStatuses.has(item.toString?.toLowerCase() ?? '')) {
                                    lateQaMovers.push({
                                        key: issue.key,
                                        summary: fields.summary ?? '',
                                        assignee: assigneeName,
                                        currentStatus: fields.status?.name ?? '',
                                        movedToQaAt: history.created,
                                        movedToQaStatus: item.toString,
                                    });
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Backlog contributions — active sprints
            if (sprintStart && sprintEnd && project.jiraName) {
                try {
                    backlogContributions = await fetchBacklogContributions(
                        jira, project.jiraName, sprintStart, sprintEnd,
                        developerJiraLoginIds, matchMember, readEstimate,
                    );
                } catch (e: any) {
                    logger.debug(`Backlog contributions fetch failed: ${e.message}`, 'TeamPerformanceService');
                }
            }
        }

        const memberStats = Array.from(memberStatsMap.values())
            .sort((a, b) => b.storyPointsDone - a.storyPointsDone);

        const overallDeliveryPct = overallSpPlanned > 0
            ? Math.round((overallSpDone / overallSpPlanned) * 1000) / 10 : 0;
        const v2DeliveryPct = v2SpPlanned > 0
            ? Math.round((v2SpDone / v2SpPlanned) * 1000) / 10 : 0;

        const seenKeys = new Set<string>();
        const dedupedLateQa = lateQaMovers.filter(m => {
            if (seenKeys.has(m.key)) return false;
            seenKeys.add(m.key);
            return true;
        });

        return {
            sprintName: sprint.name,
            sprintStartDate,
            sprintEndDate,
            isHistorical,
            memberStats,
            overallSpPlanned,
            overallSpDone,
            overallDeliveryPct,
            v2SpPlanned,
            v2SpDone,
            v2DeliveryPct,
            totalSpilloverCount,
            totalSpilloverSp,
            v2SpilloverCount,
            v2SpilloverSp,
            inProgressSp,
            inReviewSp,
            inQaSp,
            inUatSp,
            blockedSp,
            todoSp,
            scopeChangeSp,
            scopeChangeCount,
            v2ScopeChangeSp,
            v2ScopeChangeCount,
            lateQaMovers: dedupedLateQa,
            scopeCreepTickets,
            backlogContributions,
        };
    }

    /**
     * Returns selected completed sprints + averages + current sprint for a single team member.
     * sprintIds: explicitly chosen closed sprint IDs from the frontend multi-select.
     * Completed sprints use GreenHopper (exact state at close); current sprint uses live JQL.
     */
    async generateMemberDeliveryMatrix(params: {
        projectId: number;
        memberJiraId: string;
        sprintIds: number[];
    }): Promise<MemberDeliveryMatrix> {
        const { projectId, memberJiraId, sprintIds } = params;

        const project = await Project.findByPk(projectId);
        if (!project) throw new Error(`Project ${projectId} not found`);

        const jira = JiraService.forProject(project);
        const resolveDeveloper = await buildDeveloperResolver(jira, project as any);

        // Fetch sprint list only to find active sprint (for currentSprint section)
        const allSprints = await jira.listBoardSprints(project.jiraBoardId, 20);
        const prefix = project.jiraName.toLowerCase();
        const prefixFiltered = allSprints.filter((s: any) =>
            typeof s.name === 'string' && s.name.toLowerCase().startsWith(prefix)
        );
        const sprints: any[] = prefixFiltered.length > 0 ? prefixFiltered : allSprints;
        const activeSprint = sprints.find((s: any) => s.state === 'active') ?? null;

        // Resolve member Jira accountId (falls back to displayName matching)
        let accountId: string | null = null;
        try {
            accountId = await jira.getUserAccountIdByEmail(memberJiraId);
        } catch (e) {
            logger.warn(`Could not resolve Jira accountId for ${memberJiraId}, falling back to display name match`, 'TeamPerformanceService');
        }
        let memberName = memberJiraId;
        let displayNameFallback: string | null = null;
        if (!accountId) {
            const localPart = memberJiraId.split('@')[0].replace(/_(ext|int|contractor)$/i, '');
            displayNameFallback = localPart.split('.').map(
                (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
            ).join(' ');
        }

        const matchesMember = (aId: string | null | undefined, aName: string): boolean => {
            if (accountId && aId === accountId) return true;
            if (displayNameFallback && aName.toLowerCase() === displayNameFallback.toLowerCase()) return true;
            return false;
        };

        const captureName = (name: string) => {
            if (name && name !== 'Unassigned') memberName = name;
        };

        // ── Selected closed sprints via GreenHopper ──────────────────────────────
        const completedSprints: SprintDeliveryRow[] = [];
        for (const spId of sprintIds) {
            // Fetch sprint metadata (name, dates) from Jira agile API
            const sprintResp = await (jira as any).client.get(`/rest/agile/1.0/sprint/${spId}`);
            const sprintMeta = sprintResp.data;
            const report = await jira.getSprintReport(project.jiraBoardId, spId);
            let spPlanned = 0, spDone = 0, spilloverCount = 0, spilloverSp = 0;

            for (const issue of report.completedIssues) {
                if (!matchesMember(issue.assigneeAccountId, issue.assigneeName)) continue;
                const sp = issue.storyPoints ?? 0;
                spPlanned += sp;
                spDone += sp;
                captureName(issue.assigneeName);
            }
            for (const issue of report.notCompletedIssues) {
                if (!matchesMember(issue.assigneeAccountId, issue.assigneeName)) continue;
                const sp = issue.storyPoints ?? 0;
                spPlanned += sp;
                spilloverCount++;
                spilloverSp += sp;
                captureName(issue.assigneeName);
            }

            const deliveryPct = spPlanned > 0 ? Math.round((spDone / spPlanned) * 1000) / 10 : 0;
            completedSprints.push({
                sprintId: spId,
                sprintName: sprintMeta.name,
                sprintStartDate: sprintMeta.startDate ?? '',
                sprintEndDate: sprintMeta.endDate ?? sprintMeta.completeDate ?? '',
                spPlanned,
                spDone,
                deliveryPct,
                spilloverCount,
                spilloverSp,
            });
        }

        // ── Averages ─────────────────────────────────────────────────────────────
        const n = completedSprints.length;
        const avg = (vals: number[]) =>
            n > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / n * 10) / 10 : 0;
        const averages = {
            spPlanned:      avg(completedSprints.map(s => s.spPlanned)),
            spDone:         avg(completedSprints.map(s => s.spDone)),
            deliveryPct:    avg(completedSprints.map(s => s.deliveryPct)),
            spilloverCount: avg(completedSprints.map(s => s.spilloverCount)),
            spilloverSp:    avg(completedSprints.map(s => s.spilloverSp)),
        };

        // ── Active sprint via JQL ─────────────────────────────────────────────────
        let currentSprint: SprintDeliveryRow | null = null;
        if (activeSprint) {
            const readEstimate = await makeEstimateReader(project as any, jira);

            const laneConfig = getLaneConfig(project as any);
            const blockedStatuses = new Set(
                [...(laneConfig.blocked ?? []), 'Blocked', 'Impediment', 'On Hold'].map((s: string) => s.toLowerCase())
            );
            const uatStatuses = new Set(
                [...(laneConfig.uat ?? []), 'PO REVIEW', 'UAT', 'Acceptance Testing',
                    'User Acceptance Testing', 'UAT Testing', 'In UAT'].map((s: string) => s.toLowerCase())
            );
            const qaStatuses = new Set(
                [...(laneConfig.qa ?? []), 'In QA', 'QA Review', 'QA Testing',
                    'In Testing', 'Ready for QA', 'QA'].map((s: string) => s.toLowerCase())
            );
            const inReviewStatuses = new Set(
                [...(laneConfig.in_review ?? []), 'DEV COMPLETE', 'Dev Complete', 'PR REVIEW',
                    'Code Review', 'In Review', 'Ready for Review'].map((s: string) => s.toLowerCase())
            );
            const inProgressStatuses = new Set(
                [...(laneConfig.in_progress ?? []), 'In Progress', 'In Development'].map((s: string) => s.toLowerCase())
            );

            const issues = await jira.getAllIssuesFromJql(`sprint = ${activeSprint.id} ORDER BY created ASC`);
            const breakdown: MemberBreakdown = { todo: 0, inProgress: 0, inReview: 0, inQa: 0, inUat: 0, blocked: 0, done: 0 };
            let spPlanned = 0, spDone = 0;

            for (const issue of issues) {
                const fields = (issue as any).fields;
                const dev = resolveDeveloper(fields);
                const aId: string | undefined = dev.accountId ?? undefined;
                const aName: string = dev.displayName ?? 'Unassigned';
                if (!matchesMember(aId, aName)) continue;
                captureName(aName);

                const sp: number = readEstimate(fields);
                spPlanned += sp;
                const statusName: string = fields.status?.name ?? '';
                const statusLower = statusName.toLowerCase();
                const isDone = (fields.status?.statusCategory?.key ?? '') === 'done'
                    || EFFECTIVE_DONE_STATUSES.has(statusLower);

                if (isDone) { spDone += sp; breakdown.done += sp; }
                else if (blockedStatuses.has(statusLower)) breakdown.blocked += sp;
                else if (uatStatuses.has(statusLower)) breakdown.inUat += sp;
                else if (qaStatuses.has(statusLower)) breakdown.inQa += sp;
                else if (inReviewStatuses.has(statusLower)) breakdown.inReview += sp;
                else if (inProgressStatuses.has(statusLower)) breakdown.inProgress += sp;
                else breakdown.todo += sp;
            }

            const deliveryPct = spPlanned > 0 ? Math.round((spDone / spPlanned) * 1000) / 10 : 0;
            currentSprint = {
                sprintId: activeSprint.id,
                sprintName: activeSprint.name,
                sprintStartDate: activeSprint.startDate ?? '',
                sprintEndDate: activeSprint.endDate ?? '',
                spPlanned,
                spDone,
                deliveryPct,
                spilloverCount: 0,
                spilloverSp: 0,
                breakdown,
            };
        }

        return { memberJiraId, memberName, completedSprints, averages, currentSprint };
    }

    /**
     * Returns a dashboard card for each requested member showing last 3 closed sprints + current sprint.
     * Makes only 4 Jira calls total (3 GreenHopper + 1 JQL) regardless of team size.
     */
    async generateTeamDashboard(params: {
        projectId: number;
        memberJiraIds: string[];
    }): Promise<DeveloperDashboardCard[]> {
        const { projectId, memberJiraIds } = params;

        const project = await Project.findByPk(projectId);
        if (!project) throw new Error(`Project ${projectId} not found`);

        const jira = JiraService.forProject(project);
        const resolveDeveloper = await buildDeveloperResolver(jira, project as any);

        // Sprint list — find last 3 closed + active
        const allSprints = await jira.listBoardSprints(project.jiraBoardId, 20);
        const prefix = project.jiraName.toLowerCase();
        const prefixFiltered = allSprints.filter((s: any) =>
            typeof s.name === 'string' && s.name.toLowerCase().startsWith(prefix)
        );
        const sprints: any[] = prefixFiltered.length > 0 ? prefixFiltered : allSprints;
        const activeSprint = sprints.find((s: any) => s.state === 'active') ?? null;
        const closedSprints = sprints.filter((s: any) => s.state === 'closed').slice(0, 3);

        // Resolve all member emails → accountIds in parallel
        const accountIdToJiraId = new Map<string, string>();
        const displayNameToJiraId = new Map<string, string>();
        await Promise.all(memberJiraIds.map(async (jiraId) => {
            let accountId: string | null = null;
            try {
                accountId = await jira.getUserAccountIdByEmail(jiraId);
            } catch (e) {
                logger.warn(`Could not resolve Jira accountId for ${jiraId}, falling back to display name match`, 'TeamPerformanceService');
            }
            if (accountId) {
                accountIdToJiraId.set(accountId, jiraId);
            } else {
                const localPart = jiraId.split('@')[0].replace(/_(ext|int|contractor)$/i, '');
                const name = localPart.split('.').map(
                    (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
                ).join(' ');
                displayNameToJiraId.set(name.toLowerCase(), jiraId);
            }
        }));

        const matchMember = (aId: string | null | undefined, aName: string): string | null => {
            if (aId) {
                const m = accountIdToJiraId.get(aId);
                if (m) return m;
            }
            if (aName && displayNameToJiraId.size > 0) {
                return displayNameToJiraId.get(aName.toLowerCase()) ?? null;
            }
            return null;
        };

        // Per-sprint accumulator for each member
        type SprintAcc = { sprintId: number; sprintName: string; sprintStartDate: string; sprintEndDate: string; spPlanned: number; spDone: number; spilloverCount: number; spilloverSp: number; };
        type CardAcc = { jiraLoginId: string; displayName: string; sprintStats: Map<number, SprintAcc>; currentSprint: (SprintMemberStat & { breakdown: MemberBreakdown }) | null; };

        const cards = new Map<string, CardAcc>();
        for (const jiraId of memberJiraIds) {
            cards.set(jiraId, { jiraLoginId: jiraId, displayName: jiraId, sprintStats: new Map(), currentSprint: null });
        }

        // ── Closed sprints via GreenHopper ────────────────────────────────────────
        for (const sprint of closedSprints) {
            const report = await jira.getSprintReport(project.jiraBoardId, sprint.id);

            // Seed zero-stats for every member for this sprint
            for (const card of cards.values()) {
                card.sprintStats.set(sprint.id, {
                    sprintId: sprint.id, sprintName: sprint.name,
                    sprintStartDate: sprint.startDate ?? '', sprintEndDate: sprint.endDate ?? sprint.completeDate ?? '',
                    spPlanned: 0, spDone: 0, spilloverCount: 0, spilloverSp: 0,
                });
            }

            for (const issue of report.completedIssues) {
                const memberId = matchMember(issue.assigneeAccountId, issue.assigneeName);
                if (!memberId) continue;
                const card = cards.get(memberId)!;
                if (issue.assigneeName) card.displayName = issue.assigneeName;
                const stat = card.sprintStats.get(sprint.id)!;
                const sp = issue.storyPoints ?? 0;
                stat.spPlanned += sp; stat.spDone += sp;
            }
            for (const issue of report.notCompletedIssues) {
                const memberId = matchMember(issue.assigneeAccountId, issue.assigneeName);
                if (!memberId) continue;
                const card = cards.get(memberId)!;
                if (issue.assigneeName) card.displayName = issue.assigneeName;
                const stat = card.sprintStats.get(sprint.id)!;
                const sp = issue.storyPoints ?? 0;
                stat.spPlanned += sp; stat.spilloverCount++; stat.spilloverSp += sp;
            }
        }

        // ── Active sprint via JQL ─────────────────────────────────────────────────
        if (activeSprint) {
            const readEstimate = await makeEstimateReader(project as any, jira);

            const laneConfig = getLaneConfig(project as any);
            const blockedSt = new Set([...(laneConfig.blocked ?? []), 'Blocked', 'Impediment', 'On Hold'].map((s: string) => s.toLowerCase()));
            const uatSt = new Set([...(laneConfig.uat ?? []), 'PO REVIEW', 'UAT', 'Acceptance Testing', 'User Acceptance Testing', 'UAT Testing', 'In UAT'].map((s: string) => s.toLowerCase()));
            const qaSt = new Set([...(laneConfig.qa ?? []), 'In QA', 'QA Review', 'QA Testing', 'In Testing', 'Ready for QA', 'QA'].map((s: string) => s.toLowerCase()));
            const reviewSt = new Set([...(laneConfig.in_review ?? []), 'DEV COMPLETE', 'Dev Complete', 'PR REVIEW', 'Code Review', 'In Review', 'Ready for Review'].map((s: string) => s.toLowerCase()));
            const inProgressSt = new Set([...(laneConfig.in_progress ?? []), 'In Progress', 'In Development'].map((s: string) => s.toLowerCase()));

            // Seed current sprint for all members
            for (const card of cards.values()) {
                card.currentSprint = {
                    sprintId: activeSprint.id, sprintName: activeSprint.name,
                    sprintStartDate: activeSprint.startDate ?? '', sprintEndDate: activeSprint.endDate ?? '',
                    spPlanned: 0, spDone: 0, deliveryPct: 0, spilloverCount: 0, spilloverSp: 0,
                    breakdown: { todo: 0, inProgress: 0, inReview: 0, inQa: 0, inUat: 0, blocked: 0, done: 0 },
                };
            }

            const issues = await jira.getAllIssuesFromJql(`sprint = ${activeSprint.id} ORDER BY created ASC`);
            for (const issue of issues) {
                const fields = (issue as any).fields;
                const dev = resolveDeveloper(fields);
                const aId: string | undefined = dev.accountId ?? undefined;
                const aName: string = dev.displayName ?? 'Unassigned';
                const memberId = matchMember(aId, aName);
                if (!memberId) continue;
                const card = cards.get(memberId)!;
                if (aName !== 'Unassigned') card.displayName = aName;

                const sp: number = readEstimate(fields);
                const statusLower = (fields.status?.name ?? '').toLowerCase();
                const isDone = (fields.status?.statusCategory?.key ?? '') === 'done' || EFFECTIVE_DONE_STATUSES.has(statusLower);

                card.currentSprint!.spPlanned += sp;
                if (isDone) { card.currentSprint!.spDone += sp; card.currentSprint!.breakdown!.done += sp; }
                else if (blockedSt.has(statusLower)) card.currentSprint!.breakdown!.blocked += sp;
                else if (uatSt.has(statusLower)) card.currentSprint!.breakdown!.inUat += sp;
                else if (qaSt.has(statusLower)) card.currentSprint!.breakdown!.inQa += sp;
                else if (reviewSt.has(statusLower)) card.currentSprint!.breakdown!.inReview += sp;
                else if (inProgressSt.has(statusLower)) card.currentSprint!.breakdown!.inProgress += sp;
                else card.currentSprint!.breakdown!.todo += sp;
            }
            for (const card of cards.values()) {
                if (card.currentSprint) {
                    card.currentSprint.deliveryPct = card.currentSprint.spPlanned > 0
                        ? Math.round((card.currentSprint.spDone / card.currentSprint.spPlanned) * 1000) / 10 : 0;
                }
            }
        }

        // ── Build result sorted by displayName ────────────────────────────────────
        const calcAvg = (vals: number[]) =>
            vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : 0;

        return Array.from(cards.values())
            .map(card => {
                const completedSprints: SprintMemberStat[] = Array.from(card.sprintStats.values()).map(s => ({
                    ...s,
                    deliveryPct: s.spPlanned > 0 ? Math.round((s.spDone / s.spPlanned) * 1000) / 10 : 0,
                }));
                return {
                    jiraLoginId: card.jiraLoginId,
                    displayName: card.displayName,
                    completedSprints,
                    averages: {
                        spPlanned:      calcAvg(completedSprints.map(s => s.spPlanned)),
                        spDone:         calcAvg(completedSprints.map(s => s.spDone)),
                        deliveryPct:    calcAvg(completedSprints.map(s => s.deliveryPct)),
                        spilloverCount: calcAvg(completedSprints.map(s => s.spilloverCount)),
                        spilloverSp:    calcAvg(completedSprints.map(s => s.spilloverSp)),
                    },
                    currentSprint: card.currentSprint,
                };
            })
            .sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

}

export interface SprintDeliveryRow {
    sprintId: number;
    sprintName: string;
    sprintStartDate: string;
    sprintEndDate: string;
    spPlanned: number;
    spDone: number;
    deliveryPct: number;
    spilloverCount: number;
    spilloverSp: number;
    breakdown?: MemberBreakdown; // populated for current (active) sprint only
}

export interface MemberDeliveryMatrix {
    memberJiraId: string;
    memberName: string;
    completedSprints: SprintDeliveryRow[]; // last 3 closed sprints, newest first
    averages: {
        spPlanned: number;
        spDone: number;
        deliveryPct: number;
        spilloverCount: number;
        spilloverSp: number;
    };
    currentSprint: SprintDeliveryRow | null; // active sprint, or null if none
}

export const teamPerformanceService = new TeamPerformanceService();
