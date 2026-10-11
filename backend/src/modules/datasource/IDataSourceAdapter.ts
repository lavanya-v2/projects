import {
    ConnectionTestResult,
    DataSourceType,
    IssueQueryWindow,
    NormalizedIssue,
    NormalizedSprintRef,
    NormalizedUser,
} from './types';

export interface IDataSourceAdapter {
    readonly sourceType: DataSourceType;

    getIssues(window: IssueQueryWindow): Promise<NormalizedIssue[]>;

    getIssueHistory(extIds: string[]): Promise<Map<string, NormalizedIssue['statusHistory']>>;

    listSprints(limit?: number): Promise<NormalizedSprintRef[]>;

    resolveUser(emailOrExtId: string): Promise<NormalizedUser | null>;

    discoverStates(): Promise<string[]>;

    testConnection(): Promise<ConnectionTestResult>;
}
