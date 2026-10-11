import axios, { AxiosInstance } from 'axios';
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

export interface AzureDevOpsAdapterProject {
    id: number;
    name: string;
    azureOrgUrl: string;
    azureProject: string;
    azureTeam?: string;
    azurePat: string;
    laneConfig?: LaneConfig | null;
}

const API_VERSION = '7.1';

export class AzureDevOpsAdapter implements IDataSourceAdapter {
    readonly sourceType: DataSourceType = 'azure_devops';
    private readonly client: AxiosInstance;
    private readonly project: AzureDevOpsAdapterProject;

    constructor(project: AzureDevOpsAdapterProject, client?: AxiosInstance) {
        this.project = project;
        this.client =
            client ??
            axios.create({
                baseURL: `${stripTrailingSlash(project.azureOrgUrl)}/${encodeURIComponent(
                    project.azureProject,
                )}`,
                headers: {
                    Authorization: `Basic ${Buffer.from(`:${project.azurePat}`).toString('base64')}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
            });
    }

    async getIssues(window: IssueQueryWindow): Promise<NormalizedIssue[]> {
        const clauses: string[] = [
            `[System.TeamProject] = @project`,
        ];
        if (window.fromDate) {
            clauses.push(`[System.ChangedDate] >= '${toAdoDate(window.fromDate)}'`);
        }
        if (typeof window.sprintRef === 'string' || typeof window.sprintRef === 'number') {
            clauses.push(`[System.IterationPath] = '${String(window.sprintRef)}'`);
        }
        const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')}`;

        const wiqlRes = await this.client.post(`/_apis/wit/wiql?api-version=${API_VERSION}`, {
            query: wiql,
        });
        const ids: number[] = (wiqlRes.data?.workItems ?? []).map((w: any) => w.id);
        if (ids.length === 0) return [];

        const items = await this.fetchWorkItemsBatched(ids);
        const updatesById = await this.fetchAllUpdates(ids);

        const laneConfig = this.project.laneConfig ?? undefined;
        return items.map(it => this.toNormalizedIssue(it, updatesById.get(it.id) ?? [], laneConfig));
    }

    async getIssueHistory(
        extIds: string[],
    ): Promise<Map<string, NormalizedStatusChange[]>> {
        const numeric = extIds.map(id => Number(id)).filter(n => !isNaN(n));
        const updatesById = await this.fetchAllUpdates(numeric);
        const out = new Map<string, NormalizedStatusChange[]>();
        for (const [id, updates] of updatesById.entries()) {
            out.set(String(id), extractStatusChanges(updates));
        }
        return out;
    }

    async listSprints(limit = 10): Promise<NormalizedSprintRef[]> {
        if (!this.project.azureTeam) return [];
        const url = `/${encodeURIComponent(
            this.project.azureTeam,
        )}/_apis/work/teamsettings/iterations?api-version=${API_VERSION}`;
        const res = await this.client.get(url);
        const values: any[] = res.data?.value ?? [];
        return values.slice(0, limit).map(v => ({
            id: v.id,
            name: v.name,
            startDate: v.attributes?.startDate ? new Date(v.attributes.startDate) : undefined,
            endDate: v.attributes?.finishDate ? new Date(v.attributes.finishDate) : undefined,
            state:
                v.attributes?.timeFrame === 'current'
                    ? 'active'
                    : v.attributes?.timeFrame === 'past'
                      ? 'closed'
                      : 'future',
        }));
    }

    async resolveUser(email: string): Promise<NormalizedUser | null> {
        try {
            const res = await this.client.get(
                `/_apis/graph/users?api-version=${API_VERSION}-preview.1`,
            );
            const user = (res.data?.value ?? []).find(
                (u: any) =>
                    (u.mailAddress ?? u.principalName ?? '').toLowerCase() === email.toLowerCase(),
            );
            if (!user) return null;
            return {
                extId: user.descriptor ?? user.principalName ?? email,
                name: user.displayName ?? email,
                email,
            };
        } catch {
            return null;
        }
    }

    async discoverStates(): Promise<string[]> {
        const wiql = `SELECT [System.Id], [System.State] FROM WorkItems WHERE [System.TeamProject] = @project`;
        const wiqlRes = await this.client.post(`/_apis/wit/wiql?api-version=${API_VERSION}`, {
            query: wiql,
        });
        const ids: number[] = (wiqlRes.data?.workItems ?? []).slice(0, 200).map((w: any) => w.id);
        if (ids.length === 0) return [];
        const items = await this.fetchWorkItemsBatched(ids);
        const set = new Set<string>();
        for (const it of items) {
            const s = it.fields?.['System.State'];
            if (s) set.add(String(s));
        }
        return Array.from(set).sort();
    }

    async testConnection(): Promise<ConnectionTestResult> {
        try {
            const wiqlRes = await this.client.post(`/_apis/wit/wiql?api-version=${API_VERSION}`, {
                query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project`,
            });
            const count = (wiqlRes.data?.workItems ?? []).length;
            const states = await this.discoverStates().catch(() => []);
            return {
                ok: true,
                message: `Azure DevOps reachable (${count} work items, ${states.length} states discovered)`,
                discoveredStates: states,
            };
        } catch (e: any) {
            return {
                ok: false,
                message: e?.message ?? 'Azure DevOps connection failed',
            };
        }
    }

    private async fetchWorkItemsBatched(ids: number[]): Promise<any[]> {
        const out: any[] = [];
        for (let i = 0; i < ids.length; i += 200) {
            const batch = ids.slice(i, i + 200);
            const res = await this.client.get(
                `/_apis/wit/workitems?ids=${batch.join(',')}&$expand=all&api-version=${API_VERSION}`,
            );
            out.push(...(res.data?.value ?? []));
        }
        return out;
    }

    private async fetchAllUpdates(ids: number[]): Promise<Map<number, any[]>> {
        const out = new Map<number, any[]>();
        for (const id of ids) {
            try {
                const res = await this.client.get(
                    `/_apis/wit/workitems/${id}/updates?api-version=${API_VERSION}`,
                );
                out.set(id, res.data?.value ?? []);
            } catch {
                out.set(id, []);
            }
        }
        return out;
    }

    private toNormalizedIssue(
        item: any,
        updates: any[],
        laneConfig?: LaneConfig,
    ): NormalizedIssue {
        const f = item.fields ?? {};
        const state: string = f['System.State'] ?? '';
        const assignedTo = f['System.AssignedTo'];
        const statusHistory = extractStatusChanges(updates);
        return {
            extId: String(item.id),
            title: f['System.Title'] ?? '',
            type: f['System.WorkItemType'] ?? 'Unknown',
            state,
            semanticLane: laneConfig ? resolveSemanticLane(state, laneConfig) : undefined,
            priority: f['Microsoft.VSTS.Common.Priority']
                ? String(f['Microsoft.VSTS.Common.Priority'])
                : undefined,
            assignee: assignedTo
                ? {
                      extId: assignedTo.descriptor ?? assignedTo.uniqueName ?? '',
                      name: assignedTo.displayName ?? '',
                      email: assignedTo.uniqueName,
                  }
                : undefined,
            parentExtId: f['System.Parent'] ? String(f['System.Parent']) : undefined,
            storyPoints:
                typeof f['Microsoft.VSTS.Scheduling.StoryPoints'] === 'number'
                    ? f['Microsoft.VSTS.Scheduling.StoryPoints']
                    : undefined,
            sprintRef: f['System.IterationPath']
                ? { id: f['System.IterationPath'], name: f['System.IterationPath'] }
                : undefined,
            createdAt: f['System.CreatedDate'] ? new Date(f['System.CreatedDate']) : new Date(0),
            updatedAt: f['System.ChangedDate'] ? new Date(f['System.ChangedDate']) : new Date(0),
            dueDate: f['Microsoft.VSTS.Scheduling.DueDate']
                ? new Date(f['Microsoft.VSTS.Scheduling.DueDate'])
                : undefined,
            labels: typeof f['System.Tags'] === 'string'
                ? f['System.Tags'].split(';').map((t: string) => t.trim()).filter(Boolean)
                : undefined,
            statusHistory,
            comments: undefined,
            fidelity: 'full',
        };
    }
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

function toAdoDate(d: Date): string {
    return d.toISOString().split('T')[0];
}

function extractStatusChanges(updates: any[]): NormalizedStatusChange[] {
    const out: NormalizedStatusChange[] = [];
    for (const u of updates ?? []) {
        const stateChange = u.fields?.['System.State'];
        if (!stateChange) continue;
        const from = stateChange.oldValue ?? '';
        const to = stateChange.newValue ?? '';
        if (!from && !to) continue;
        const at = u.revisedDate ?? u.fields?.['System.ChangedDate']?.newValue;
        out.push({
            from: String(from),
            to: String(to),
            at: at ? new Date(at) : new Date(0),
            byEmail: u.revisedBy?.uniqueName ?? u.fields?.['System.ChangedBy']?.newValue?.uniqueName,
        });
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}
