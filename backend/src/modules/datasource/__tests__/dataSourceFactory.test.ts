import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../common/utils', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { forProject } from '../dataSourceFactory';

describe('dataSourceFactory.forProject', () => {
    it('defaults to Jira when dataSourceType is absent', () => {
        const a = forProject({
            id: 1,
            name: 'P',
            jiraBoardId: 10,
            jiraBaseUrl: 'https://x.atlassian.net',
        });
        expect(a.sourceType).toBe('jira');
    });

    it('returns AzureDevOpsAdapter when dataSourceType = azure_devops', () => {
        const a = forProject({
            id: 1,
            name: 'P',
            dataSourceType: 'azure_devops',
            azureOrgUrl: 'https://dev.azure.com/org',
            azureProject: 'P',
            azurePat: 'pat',
        });
        expect(a.sourceType).toBe('azure_devops');
    });

    it('returns ExcelAdapter when dataSourceType = excel with loader', () => {
        const a = forProject(
            { id: 1, name: 'P', dataSourceType: 'excel' },
            { excelLoader: async () => null },
        );
        expect(a.sourceType).toBe('excel');
    });

    it('throws when jira required fields missing', () => {
        expect(() =>
            forProject({ id: 1, name: 'P', dataSourceType: 'jira' }),
        ).toThrow(/jiraBoardId/);
    });

    it('throws when azure required fields missing', () => {
        expect(() =>
            forProject({ id: 1, name: 'P', dataSourceType: 'azure_devops' }),
        ).toThrow(/azureOrgUrl/);
    });

    it('throws when excel loader not provided', () => {
        expect(() => forProject({ id: 1, name: 'P', dataSourceType: 'excel' })).toThrow(
            /excelLoader/,
        );
    });
});
