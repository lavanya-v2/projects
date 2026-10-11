import { JiraService } from '../jira/services/jiraService';
import { LaneConfig } from '../../common/laneDefaults';
import { IDataSourceAdapter } from './IDataSourceAdapter';
import { resolveSemanticLane } from './laneResolver';
import {
    ConnectionTestResult,
    DataSourceType,
    IssueQueryWindow,
    NormalizedIssue,
    NormalizedSprintRef,
    NormalizedStatusChange,
    NormalizedUser,
} from './types';

export interface JiraAdapterProject {
    id: number;
    name: string;
    jiraBoardId: number;
    jiraBaseUrl: string;
    jiraEmail?: string;
    jiraApiToken?: string;
    jiraLaneConfig?: LaneConfig | null;
}

export class JiraAdapter implements IDataSourceAdapter {
    readonly sourceType: DataSourceType = 'jira';
    private readonly jira: JiraService;
    private readonly project: JiraAdapterProject;

    constructor(project: JiraAdapterProject, jiraService?: JiraService) {
        this.project = project;
        this.jira =
            jiraService ??
            new JiraService(project.jiraBaseUrl, project.jiraEmail, project.jiraApiToken);
    }

    async getIssues(window: IssueQueryWindow): Promise<NormalizedIssue[]> {
        const board = await this.jira.getIssuesForBoard(
            this.project.jiraBoardId,
            window.fromDate,
        );
        const laneConfig = this.project.jiraLaneConfig ?? undefined;
        return board.issues.map(issue => this.toNormalizedIssue(issue, laneConfig));
    }

    async getIssueHistory(
        extIds: string[],
    ): Promise<Map<string, NormalizedStatusChange[]>> {
        const raw = await this.jira.getChangelogsForKeys(extIds);
        const out = new Map<string, NormalizedStatusChange[]>();
        for (const [key, histories] of raw.entries()) {
            out.set(key, extractStatusChanges(histories));
        }
        return out;
    }

    async listSprints(limit = 10): Promise<NormalizedSprintRef[]> {
        const sprints = await this.jira.getBoardSprints(this.project.jiraBoardId);
        return sprints.slice(0, limit).map(s => ({
            id: String(s.id),
            name: s.name,
            startDate: s.startDate ? new Date(s.startDate) : undefined,
            endDate: s.endDate ? new Date(s.endDate) : undefined,
            state: s.state,
        }));
    }

    async resolveUser(email: string): Promise<NormalizedUser | null> {
        const accountId = await this.jira.getUserAccountIdByEmail(email);
        if (!accountId) return null;
        return { extId: accountId, name: email, email };
    }

    async discoverStates(): Promise<string[]> {
        const board = await this.jira.getIssuesForBoard(this.project.jiraBoardId);
        const states = new Set<string>();
        for (const issue of board.issues) {
            const name = issue?.fields?.status?.name;
            if (name) states.add(name);
        }
        return Array.from(states).sort();
    }

    async testConnection(): Promise<ConnectionTestResult> {
        try {
            const cfg = await this.jira.getBoardConfiguration(this.project.jiraBoardId);
            return { ok: true, message: `Connected to board ${cfg?.name ?? this.project.jiraBoardId}` };
        } catch (e: any) {
            return { ok: false, message: e?.message ?? 'Jira connection failed' };
        }
    }

    private toNormalizedIssue(issue: any, laneConfig?: LaneConfig): NormalizedIssue {
        const f = issue.fields ?? {};
        const statusName = f.status?.name ?? '';
        const statusHistory = extractStatusChanges(issue.changelog?.histories ?? []);
        return {
            extId: issue.key,
            title: f.summary ?? '',
            type: f.issuetype?.name ?? 'Unknown',
            state: statusName,
            semanticLane: laneConfig ? resolveSemanticLane(statusName, laneConfig) : undefined,
            priority: f.priority?.name,
            assignee: f.assignee
                ? {
                      extId: f.assignee.accountId ?? '',
                      name: f.assignee.displayName ?? '',
                      email: f.assignee.emailAddress,
                  }
                : undefined,
            parentExtId: f.parent?.key,
            storyPoints: typeof f.customfield_10016 === 'number' ? f.customfield_10016 : undefined,
            sprintRef: undefined,
            createdAt: f.created ? new Date(f.created) : new Date(0),
            updatedAt: f.updated ? new Date(f.updated) : new Date(0),
            dueDate: f.duedate ? new Date(f.duedate) : undefined,
            labels: Array.isArray(f.labels) ? f.labels : undefined,
            statusHistory,
            // Metadata only — comment bodies are stripped at the fetch boundary.
            comments: Array.isArray(f.comment?.comments)
                ? f.comment.comments.map((c: any) => ({
                      at: c.created ? new Date(c.created) : new Date(0),
                      author: c.author?.displayName ?? 'Unknown',
                  }))
                : undefined,
            fidelity: 'full',
        };
    }
}

function extractStatusChanges(histories: any[]): NormalizedStatusChange[] {
    const changes: NormalizedStatusChange[] = [];
    for (const h of histories ?? []) {
        const at = h.created ? new Date(h.created) : new Date(0);
        const byEmail = h.author?.emailAddress;
        for (const item of h.items ?? []) {
            if (item.field === 'status') {
                changes.push({
                    from: item.fromString ?? '',
                    to: item.toString ?? '',
                    at,
                    byEmail,
                });
            }
        }
    }
    return changes.sort((a, b) => a.at.getTime() - b.at.getTime());
}
