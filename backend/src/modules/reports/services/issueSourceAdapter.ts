// Bridges report generation to either a live Jira board or an Excel import.
// Returns an object that matches the subset of JiraService API consumed by
// reportService.ts. Jira projects use the real JiraService (unchanged path).
// Excel projects use ExcelIssueSource, which shapes Excel rows into the same
// JiraIssue envelope so downstream code does not need to know the difference.

import { Project } from '../../../models/Project';
import { ProjectSprint } from '../../../models/ProjectSprint';
import { JiraService } from '../../jira/services/jiraService';
import type { LaneConfig } from '../../../common/laneDefaults';

import { loadLatestImport } from '../../datasource/excelImportService';
import { ExcelImportSource } from '../../datasource/excelAdapter';

/** One Jira changelog entry, narrowed to the fields the status rewind reads. */
export interface ChangeHistory {
    created: string;
    items?: Array<{ field?: string; fromString?: string; toString?: string }>;
}

interface JiraIssueShape {
    key: string;
    fields: {
        summary: string;
        status: { name: string };
        priority?: { name: string };
        assignee?: { displayName: string; accountId: string; emailAddress?: string };
        reporter?: { displayName: string; accountId: string; emailAddress?: string };
        creator?: { displayName: string; accountId: string; emailAddress?: string };
        updated: string;
        created: string;
        issuetype?: { name: string };
        parent?: { key: string };
        // Comment bodies are deliberately absent — see jiraFields.sanitizeIssue.
        // Only metadata is carried, which is all the daily-activity signal needs.
        comment?: { comments: Array<{ created?: string; author?: any }> };
        labels?: string[];
        [customField: string]: any;
    };
    changelog?: {
        histories: Array<{
            created: string;
            author?: { displayName: string; accountId: string; emailAddress?: string };
            items: Array<{ field: string; toString: string; fromString?: string }>;
        }>;
    };
}

interface SprintLike {
    id: string | number;
    name: string;
    state: 'active' | 'closed' | 'future';
    startDate?: string;
    endDate?: string;
}

interface BlockedTicket {
    key: string;
    summary: string;
    status: string;
    movedToBlockedToday: boolean;
    assignee: string;
    blockedSince?: string;
}

export interface ProjectIssueSource {
    getIssuesForBoard(boardId: number, fromDate?: Date): Promise<{ boardName: string; issues: JiraIssueShape[] }>;
    getActiveSprint(boardId: number): Promise<SprintLike | null>;
    getFieldIdByName(fieldName: string): Promise<string | undefined>;
    getFieldIdsByName(fieldName: string): Promise<string[]>;
    getClosedSprintIds(boardId: number): Promise<Set<number>>;
    getAllSprintIssues(sprintId: string | number): Promise<JiraIssueShape[]>;
    /** Changelogs by issue key. Used to rewind ticket status when rebuilding a past date. */
    getChangelogsForKeys(keys: string[]): Promise<Map<string, ChangeHistory[]>>;
    extractBlockedInfo(issues: JiraIssueShape[], blockedStatuses?: string[]): BlockedTicket[];
}

/** The project columns the Jira client needs; not all are on the Project type. */
interface ProjectJiraSettings {
    dataSourceType?: string;
    jiraEmail?: string;
    jiraApiToken?: string;
    hoursFieldName?: string | null;
    jiraLaneConfig?: LaneConfig | null;
}

export function getProjectIssueSource(project: Project): ProjectIssueSource {
    const settings = project as unknown as ProjectJiraSettings;
    const sourceType = settings.dataSourceType ?? 'jira';
    if (sourceType === 'excel') {
        return new ExcelIssueSource(project);
    }
    // Jira (default) — return the real service; identical to existing behavior.
    // forProject carries hoursFieldName and the lane config so the field allowlist can
    // resolve them. The lane config matters because it declares this project's owner
    // fields: omit it and a configured field is never requested from Jira, so every read
    // of it returns empty and the report looks like nobody owns anything.
    return JiraService.forProject({
        jiraBaseUrl: project.jiraBaseUrl,
        jiraEmail: settings.jiraEmail,
        jiraApiToken: settings.jiraApiToken,
        hoursFieldName: settings.hoursFieldName,
        jiraLaneConfig: settings.jiraLaneConfig,
    }) as unknown as ProjectIssueSource;
}

/**
 * Excel-backed implementation of the subset of JiraService used by
 * reportService.ts. Holds the project context and lazily loads the latest
 * applied import. All issues returned conform to the Jira JiraIssue envelope.
 */
class ExcelIssueSource implements ProjectIssueSource {
    private cachedSource: ExcelImportSource | null | undefined = undefined;

    constructor(private readonly project: Project) {}

    private async source(): Promise<ExcelImportSource | null> {
        if (this.cachedSource !== undefined) return this.cachedSource;
        this.cachedSource = await loadLatestImport(this.project.id);
        return this.cachedSource;
    }

    async getIssuesForBoard(
        _boardId: number,
        fromDate?: Date,
    ): Promise<{ boardName: string; issues: JiraIssueShape[] }> {
        const src = await this.source();
        const boardName = this.project.name;
        if (!src) return { boardName, issues: [] };

        const cutoff = fromDate ? fromDate.getTime() : 0;
        const historyByExtId = groupHistoryByExtId(src.history);
        const activeSprint = await this.getActiveSprint(_boardId);
        const issues = src.rows
            .filter(r => !fromDate || r.updatedAt.getTime() >= cutoff)
            .map(r => excelRowToJiraIssue(r, src.history, historyByExtId, activeSprint?.name));
        return { boardName, issues };
    }

    async getActiveSprint(_boardId: number): Promise<SprintLike | null> {
        const todayStr = new Date().toISOString().split('T')[0];
        const sprints = await ProjectSprint.findAll({
            where: { projectId: this.project.id },
            order: [['startDate', 'DESC']],
        });
        if (sprints.length === 0) return null;
        // Prefer a sprint whose date range covers today; otherwise return the most recent.
        const covering = sprints.find(s =>
            s.startDate && s.endDate && s.startDate <= todayStr && s.endDate >= todayStr,
        );
        const chosen = covering ?? sprints[0];
        return {
            id: chosen.name,
            name: chosen.name,
            state: 'active',
            startDate: chosen.startDate,
            endDate: chosen.endDate,
        };
    }

    async getFieldIdByName(fieldName: string): Promise<string | undefined> {
        // Excel projects don't carry arbitrary Jira custom fields, but we shape sprint
        // membership onto `customfield_10020` so reportService's board-scope check
        // (which reads issue.fields[sprintFieldId]) can recognize the active sprint.
        if (fieldName?.toLowerCase() === 'sprint') return 'customfield_10020';
        return undefined;
    }

    /** Mirrors JiraService.getFieldIdsByName. Excel has no duplicate custom fields,
     *  so this is just the single-id lookup lifted into an array. */
    async getFieldIdsByName(fieldName: string): Promise<string[]> {
        const id = await this.getFieldIdByName(fieldName);
        return id ? [id] : [];
    }

    /** Excel imports carry no sprint-state history, so there are no closed sprints to
     *  report. Empty set = "no spillover detected", which is how the Jira path also
     *  fails open. */
    async getClosedSprintIds(_boardId: number): Promise<Set<number>> {
        return new Set<number>();
    }

    async getAllSprintIssues(sprintId: string | number): Promise<JiraIssueShape[]> {
        const src = await this.source();
        if (!src) return [];
        const sprintName = String(sprintId);
        const historyByExtId = groupHistoryByExtId(src.history);
        // Every row here belongs to the requested sprint, so it is the active one by definition.
        return src.rows
            .filter(r => r.sprintName === sprintName)
            .map(r => excelRowToJiraIssue(r, src.history, historyByExtId, sprintName));
    }

    /**
     * Excel imports already carry their status history inline on each issue (see
     * excelRowToJiraIssue), so there is nothing extra to fetch. Returning an empty map means
     * the historical status rewind simply does not apply to Excel-backed projects — their
     * burndown keeps using the imported status, which is the best available answer.
     */
    async getChangelogsForKeys(keys: string[]): Promise<Map<string, ChangeHistory[]>> {
        return new Map(keys.map(k => [k, [] as ChangeHistory[]]));
    }

    extractBlockedInfo(
        issues: JiraIssueShape[],
        blockedStatuses: string[] = ['blocked'],
    ): BlockedTicket[] {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const blockedLower = blockedStatuses.map(s => s.toLowerCase());
        const out: BlockedTicket[] = [];
        for (const issue of issues) {
            const currentStatus = issue.fields.status.name;
            let movedToBlockedToday = false;
            let blockedSince: string | undefined;
            const histories = issue.changelog?.histories ?? [];
            for (const h of histories) {
                const d = new Date(h.created);
                d.setHours(0, 0, 0, 0);
                for (const item of h.items) {
                    if (item.field !== 'status') continue;
                    if (!blockedLower.includes((item.toString || '').toLowerCase())) continue;
                    if (d.getTime() === today.getTime()) movedToBlockedToday = true;
                    if (!blockedSince || new Date(h.created) > new Date(blockedSince)) {
                        blockedSince = h.created;
                    }
                }
            }
            if (blockedLower.includes(currentStatus.toLowerCase()) || movedToBlockedToday) {
                out.push({
                    key: issue.key,
                    summary: issue.fields.summary,
                    status: currentStatus,
                    movedToBlockedToday,
                    assignee: issue.fields.assignee?.displayName ?? 'Unassigned',
                    blockedSince,
                });
            }
        }
        return out;
    }
}

/** Index history by ext_id once, rather than rescanning the whole array for every row. */
function groupHistoryByExtId(
    allHistory: ExcelImportSource['history'],
): Map<string, ExcelImportSource['history']> {
    const byExtId = new Map<string, ExcelImportSource['history']>();

    for (const h of allHistory) {
        const bucket = byExtId.get(h.extId) ?? [];
        bucket.push(h);
        byExtId.set(h.extId, bucket);
    }

    for (const bucket of byExtId.values()) {
        bucket.sort((a, b) => a.changedOn.getTime() - b.changedOn.getTime());
    }

    return byExtId;
}

function excelRowToJiraIssue(
    r: ExcelImportSource['rows'][number],
    allHistory: ExcelImportSource['history'],
    historyByExtId?: Map<string, ExcelImportSource['history']>,
    activeSprintName?: string | null,
): JiraIssueShape {
    const assignee = r.assigneeEmail
        ? {
              displayName: r.assigneeEmail,
              accountId: r.assigneeEmail,
              emailAddress: r.assigneeEmail,
          }
        : undefined;

    // History entries must carry `author` — reportService.identifyDailyActivity
    // gates "today's activity" on isTeamMember(history.author). Without it, every
    // status change is ignored and the AI prompt receives an empty active-tickets list.
    const authorFor = (email?: string) =>
        email
            ? { displayName: email, accountId: email, emailAddress: email }
            : assignee;

    const histories = (historyByExtId ? (historyByExtId.get(r.extId) ?? []) : allHistory.filter(h => h.extId === r.extId))
        .map(h => ({
            created: h.changedOn.toISOString(),
            author: authorFor(h.changedByEmail),
            items: [
                {
                    field: 'status',
                    toString: h.toStatus,
                    fromString: h.fromStatus,
                },
            ],
        }));

    // If no explicit history rows but the sheet recorded a single status-changed-on
    // timestamp, synthesize one transition so blocked-today detection works.
    if (histories.length === 0 && r.statusChangedOn) {
        histories.push({
            created: r.statusChangedOn.toISOString(),
            author: assignee,
            items: [{ field: 'status', toString: r.status, fromString: '' }],
        });
    }

    const fields: JiraIssueShape['fields'] = {
        summary: r.title,
        status: { name: r.status },
        priority: r.priority ? { name: r.priority } : undefined,
        assignee,
        reporter: assignee,
        creator: assignee,
        updated: r.updatedAt.toISOString(),
        created: r.createdAt.toISOString(),
        issuetype: r.type ? { name: r.type } : undefined,
        parent: r.parentExtId ? { key: r.parentExtId } : undefined,
        labels: r.labels,
    };

    // Story points — Jira's common custom field id is 10016.
    if (typeof r.storyPoints === 'number') {
        fields['customfield_10016'] = r.storyPoints;
    }

    // Sprint membership — mirror Jira's customfield_10020 shape so the board-scope
    // check in reportService recognises Excel tickets as belonging to the active sprint.
    //
    // `state` was previously hardcoded to 'active' for every ticket, which permanently defeated
    // both sprint-scope gates in reportService: the done-ticket filter and isInBoardScope both ask
    // "is this ticket in an active sprint?" and always got yes. Finished work from long-closed
    // sprints therefore stayed in daily reports. Compare against the resolved active sprint instead.
    if (r.sprintName) {
        const isActive =
            !activeSprintName || r.sprintName.trim().toLowerCase() === activeSprintName.trim().toLowerCase();

        fields['customfield_10020'] = [
            {
                id: r.sprintName,
                name: r.sprintName,
                state: isActive ? 'active' : 'closed',
                startDate: r.sprintStart?.toISOString(),
                endDate: r.sprintEnd?.toISOString(),
            },
        ];
    }

    return {
        key: r.extId,
        fields,
        changelog: { histories },
    };
}
