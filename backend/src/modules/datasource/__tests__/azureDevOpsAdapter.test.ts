import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AzureDevOpsAdapter } from '../azureDevOpsAdapter';
import { LaneConfig } from '../../../common/laneDefaults';

const laneConfig: LaneConfig = {
    todo: ['New'],
    in_progress: ['Active'],
    qa: ['Resolved'],
    done: ['Closed'],
};

function fakeAxiosClient() {
    return {
        post: vi.fn(async (url: string) => {
            if (url.includes('/_apis/wit/wiql')) {
                return { data: { workItems: [{ id: 101 }, { id: 102 }] } };
            }
            return { data: {} };
        }),
        get: vi.fn(async (url: string) => {
            if (url.includes('/_apis/wit/workitems?ids=')) {
                return {
                    data: {
                        value: [
                            {
                                id: 101,
                                fields: {
                                    'System.Title': 'Alpha',
                                    'System.WorkItemType': 'User Story',
                                    'System.State': 'Active',
                                    'System.AssignedTo': {
                                        displayName: 'Bob',
                                        uniqueName: 'bob@example.com',
                                        descriptor: 'aad.bob',
                                    },
                                    'System.CreatedDate': '2026-04-01T09:00:00Z',
                                    'System.ChangedDate': '2026-04-10T09:00:00Z',
                                    'Microsoft.VSTS.Scheduling.StoryPoints': 5,
                                    'System.Tags': 'frontend; urgent',
                                },
                            },
                            {
                                id: 102,
                                fields: {
                                    'System.Title': 'Beta',
                                    'System.WorkItemType': 'Bug',
                                    'System.State': 'Closed',
                                    'System.CreatedDate': '2026-04-02T09:00:00Z',
                                    'System.ChangedDate': '2026-04-11T09:00:00Z',
                                },
                            },
                        ],
                    },
                };
            }
            if (url.match(/\/workitems\/\d+\/updates/)) {
                const id = Number(url.match(/workitems\/(\d+)\//)![1]);
                if (id === 101) {
                    return {
                        data: {
                            value: [
                                {
                                    revisedDate: '2026-04-03T09:00:00Z',
                                    revisedBy: { uniqueName: 'bob@example.com' },
                                    fields: { 'System.State': { oldValue: 'New', newValue: 'Active' } },
                                },
                            ],
                        },
                    };
                }
                return { data: { value: [] } };
            }
            if (url.includes('/_apis/work/teamsettings/iterations')) {
                return {
                    data: {
                        value: [
                            {
                                id: 'iter-1',
                                name: 'Sprint 1',
                                attributes: {
                                    startDate: '2026-04-01',
                                    finishDate: '2026-04-14',
                                    timeFrame: 'current',
                                },
                            },
                        ],
                    },
                };
            }
            if (url.includes('/_apis/graph/users')) {
                return {
                    data: {
                        value: [
                            {
                                displayName: 'Bob',
                                mailAddress: 'bob@example.com',
                                descriptor: 'aad.bob',
                            },
                        ],
                    },
                };
            }
            return { data: {} };
        }),
    } as any;
}

describe('AzureDevOpsAdapter', () => {
    let client: any;
    let adapter: AzureDevOpsAdapter;

    beforeEach(() => {
        client = fakeAxiosClient();
        adapter = new AzureDevOpsAdapter(
            {
                id: 1,
                name: 'Demo',
                azureOrgUrl: 'https://dev.azure.com/org',
                azureProject: 'MyProj',
                azureTeam: 'MyTeam',
                azurePat: 'pat',
                laneConfig,
            },
            client,
        );
    });

    it('reports sourceType = azure_devops', () => {
        expect(adapter.sourceType).toBe('azure_devops');
    });

    it('runs WIQL + fetches work items + extracts statusHistory', async () => {
        const issues = await adapter.getIssues({ fromDate: new Date('2026-04-01') });
        expect(issues).toHaveLength(2);
        const alpha = issues.find(i => i.extId === '101')!;
        expect(alpha.title).toBe('Alpha');
        expect(alpha.state).toBe('Active');
        expect(alpha.semanticLane).toBe('in_progress');
        expect(alpha.assignee?.email).toBe('bob@example.com');
        expect(alpha.storyPoints).toBe(5);
        expect(alpha.labels).toEqual(['frontend', 'urgent']);
        expect(alpha.statusHistory).toHaveLength(1);
        expect(alpha.statusHistory[0]).toMatchObject({ from: 'New', to: 'Active' });

        const beta = issues.find(i => i.extId === '102')!;
        expect(beta.semanticLane).toBe('done');
    });

    it('lists iterations as sprints', async () => {
        const sprints = await adapter.listSprints();
        expect(sprints).toHaveLength(1);
        expect(sprints[0]).toMatchObject({ id: 'iter-1', name: 'Sprint 1', state: 'active' });
    });

    it('resolveUser matches on mailAddress', async () => {
        const u = await adapter.resolveUser('bob@example.com');
        expect(u?.name).toBe('Bob');
    });

    it('testConnection returns ok with discovered states', async () => {
        const r = await adapter.testConnection();
        expect(r.ok).toBe(true);
        expect(r.discoveredStates).toContain('Active');
        expect(r.discoveredStates).toContain('Closed');
    });
});
