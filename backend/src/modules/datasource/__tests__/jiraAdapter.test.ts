import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../common/utils', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { JiraAdapter } from '../jiraAdapter';
import { LaneConfig } from '../../../common/laneDefaults';

const laneConfig: LaneConfig = {
    todo: ['To Do'],
    in_progress: ['In Progress'],
    blocked: ['Blocked'],
    in_review: ['Code Review'],
    qa: ['In QA'],
    done: ['Done'],
};

function fakeJiraService(overrides: Partial<any> = {}) {
    return {
        getIssuesForBoard: vi.fn(async () => ({
            boardName: 'Demo',
            issues: [
                {
                    key: 'ABC-1',
                    fields: {
                        summary: 'First ticket',
                        issuetype: { name: 'Story' },
                        status: { name: 'In Progress' },
                        priority: { name: 'High' },
                        assignee: {
                            accountId: 'u1',
                            displayName: 'Alice',
                            emailAddress: 'alice@example.com',
                        },
                        created: '2026-04-01T10:00:00.000Z',
                        updated: '2026-04-10T10:00:00.000Z',
                        labels: ['backend'],
                        comment: { comments: [] },
                    },
                    changelog: {
                        histories: [
                            {
                                created: '2026-04-05T10:00:00.000Z',
                                author: { emailAddress: 'alice@example.com' },
                                items: [
                                    { field: 'status', fromString: 'To Do', toString: 'In Progress' },
                                ],
                            },
                        ],
                    },
                },
            ],
        })),
        getChangelogsForKeys: vi.fn(async (_keys: string[]) => new Map()),
        getBoardSprints: vi.fn(async () => [
            { id: 10, name: 'Sprint 10', startDate: '2026-03-01', endDate: '2026-03-15', state: 'closed' },
        ]),
        getUserAccountIdByEmail: vi.fn(async () => 'u1'),
        getBoardConfiguration: vi.fn(async () => ({ name: 'Demo' })),
        ...overrides,
    } as any;
}

describe('JiraAdapter', () => {
    let fake: any;
    let adapter: JiraAdapter;

    beforeEach(() => {
        fake = fakeJiraService();
        adapter = new JiraAdapter(
            {
                id: 1,
                name: 'Demo',
                jiraBoardId: 42,
                jiraBaseUrl: 'https://x.atlassian.net',
                jiraLaneConfig: laneConfig,
            },
            fake,
        );
    });

    it('reports sourceType = jira', () => {
        expect(adapter.sourceType).toBe('jira');
    });

    it('normalizes issues into NormalizedIssue shape', async () => {
        const issues = await adapter.getIssues({});
        expect(issues).toHaveLength(1);
        const issue = issues[0];
        expect(issue.extId).toBe('ABC-1');
        expect(issue.type).toBe('Story');
        expect(issue.state).toBe('In Progress');
        expect(issue.semanticLane).toBe('in_progress');
        expect(issue.assignee?.email).toBe('alice@example.com');
        expect(issue.statusHistory).toHaveLength(1);
        expect(issue.statusHistory[0]).toMatchObject({
            from: 'To Do',
            to: 'In Progress',
            byEmail: 'alice@example.com',
        });
        expect(issue.fidelity).toBe('full');
    });

    it('lists recent sprints as NormalizedSprintRef', async () => {
        const sprints = await adapter.listSprints(5);
        expect(sprints).toHaveLength(1);
        expect(sprints[0]).toMatchObject({ id: '10', name: 'Sprint 10', state: 'closed' });
        expect(sprints[0].startDate).toBeInstanceOf(Date);
    });

    it('discovers states from issues', async () => {
        const states = await adapter.discoverStates();
        expect(states).toEqual(['In Progress']);
    });

    it('resolves a user via getUserAccountIdByEmail', async () => {
        const user = await adapter.resolveUser('alice@example.com');
        expect(user).toEqual({ extId: 'u1', name: 'alice@example.com', email: 'alice@example.com' });
    });

    it('testConnection returns ok when board config loads', async () => {
        const r = await adapter.testConnection();
        expect(r.ok).toBe(true);
        expect(r.message).toContain('Demo');
    });

    it('testConnection returns not-ok on failure', async () => {
        const bad = fakeJiraService({
            getBoardConfiguration: vi.fn(async () => {
                throw new Error('boom');
            }),
        });
        const a = new JiraAdapter(
            {
                id: 1,
                name: 'Demo',
                jiraBoardId: 42,
                jiraBaseUrl: 'https://x.atlassian.net',
            },
            bad,
        );
        const r = await a.testConnection();
        expect(r.ok).toBe(false);
        expect(r.message).toContain('boom');
    });
});
