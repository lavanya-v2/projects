import { describe, it, expect } from 'vitest';
import {
    BASE_ISSUE_FIELDS,
    FALLBACK_CUSTOM_FIELDS,
    buildIssueFieldList,
    sanitizeIssue,
} from '../jiraFields';

const FAKE_JIRA_FIELDS = [
    { id: 'customfield_10016', name: 'Story Points' },
    { id: 'customfield_10020', name: 'Sprint' },
    { id: 'customfield_19999', name: 'Dev Hours' },
];

const stubJira = (fields: any[] = FAKE_JIRA_FIELDS) => ({
    getFields: async () => fields,
});

describe('buildIssueFieldList', () => {
    it('never requests the wildcard', async () => {
        const list = await buildIssueFieldList(stubJira());
        expect(list).not.toContain('*all');
        expect(list.join(',')).not.toContain('*');
    });

    it('never requests description', async () => {
        const list = await buildIssueFieldList(stubJira());
        expect(list).not.toContain('description');
    });

    it('keeps comment so the daily-activity signal still works', async () => {
        const list = await buildIssueFieldList(stubJira());
        expect(list).toContain('comment');
        expect(list).toContain('summary');
        expect(list).toContain('status');
    });

    // Regression: an hours+custom_field project whose field is missing from the
    // allowlist reads 0 hours for every ticket, silently and without an error.
    it("resolves a project's hours custom field by display name", async () => {
        const list = await buildIssueFieldList(stubJira(), { hoursFieldName: 'Dev Hours' });
        expect(list).toContain('customfield_19999');
    });

    it('omits the hours field when the project does not configure one', async () => {
        const list = await buildIssueFieldList(stubJira());
        expect(list).not.toContain('customfield_19999');
    });

    it('fails CLOSED to the static lists, never to the wildcard', async () => {
        const exploding = { getFields: async () => { throw new Error('Jira down'); } };
        const list = await buildIssueFieldList(exploding);
        expect(list).not.toContain('*all');
        expect(list).toEqual(expect.arrayContaining([...BASE_ISSUE_FIELDS]));
        expect(list).toEqual(expect.arrayContaining([...FALLBACK_CUSTOM_FIELDS]));
    });
});

describe('sanitizeIssue', () => {
    it('strips description and comment bodies but keeps comment metadata', () => {
        const issue = {
            key: 'ABC-1',
            fields: {
                summary: 'Fix login',
                description: 'Customer Jane Doe, 555-867-5309',
                environment: 'prod',
                comment: {
                    comments: [
                        { id: '1', created: '2026-07-30T10:00:00Z', author: { displayName: 'Dev' }, body: 'secret' },
                    ],
                },
            },
        };

        sanitizeIssue(issue);

        expect((issue.fields as any).description).toBeUndefined();
        expect((issue.fields as any).environment).toBeUndefined();
        const c: any = issue.fields.comment.comments[0];
        expect(c.body).toBeUndefined();
        expect(c.created).toBe('2026-07-30T10:00:00Z');
        expect(c.author.displayName).toBe('Dev');
        expect(issue.fields.summary).toBe('Fix login');
    });

    it('strips the parent issue description too', () => {
        const issue = {
            fields: { parent: { key: 'ABC-9', fields: { summary: 'Epic', description: 'PII here' } } },
        };
        sanitizeIssue(issue);
        expect((issue.fields.parent.fields as any).description).toBeUndefined();
        expect(issue.fields.parent.fields.summary).toBe('Epic');
    });

    it('tolerates issues with no fields or no comments', () => {
        expect(() => sanitizeIssue({} as any)).not.toThrow();
        expect(() => sanitizeIssue({ fields: {} } as any)).not.toThrow();
    });
});
