/**
 * Synthetic Jira sprint fixture exercising every data-selection rule used by
 * buildTicketFactsFromJiraData:
 *
 *   - 3 regular stories in GreenHopper `completedIssues`  → wasCompleted=true
 *   - 2 regular stories in `notCompletedIssues`           → wasCompleted=false
 *   - 1 sub-task that is NOT a bug                        → excluded from facts
 *   - 1 sub-task that IS a bug                            → included
 *   - 1 story punted, also returned by agile query        → wasPunted=true, wasCompleted=false
 *   - 1 story punted ONLY (not in agile query)            → appended as punted skeleton
 *   - 1 story with the story-points field unset           → storyPoints=0
 *
 * Hand-calculated productivity (non-punted, non-excluded facts):
 *     spDone    = 8 + 5 + 3                       = 16   (three completed stories)
 *     spPlanned = 8 + 5 + 3 + 5 + 2 + 2 + 0       = 25   (+ bug sub-task + unestimated story)
 *     productivity = round1(16 / 25 × 100)        = 64.0
 */

export const SYNTHETIC_SPRINT_ID = 999;
export const SYNTHETIC_SYNC_ID = 777;
export const SYNTHETIC_PROJECT_ID = 42;
export const SYNTHETIC_SPRINT_START = new Date('2026-04-01T00:00:00Z');
export const SYNTHETIC_SPRINT_END = new Date('2026-04-14T23:59:59Z');

const baseFields = {
    summary: 'Synthetic issue',
    priority: { name: 'Medium' },
    reporter: { accountId: 'acc-reporter', displayName: 'Fixture Reporter' },
    assignee: { accountId: 'acc-dev', displayName: 'Fixture Dev' },
    status: { name: 'Done' },
    labels: [] as string[],
};

function makeIssue(overrides: {
    key: string;
    issueType: string;
    storyPoints?: number | null;
    parentKey?: string;
    labels?: string[];
    status?: string;
}) {
    return {
        key: overrides.key,
        fields: {
            ...baseFields,
            issuetype: { name: overrides.issueType },
            status: { name: overrides.status ?? baseFields.status.name },
            labels: overrides.labels ?? [],
            parent: overrides.parentKey ? { key: overrides.parentKey } : undefined,
            story_points: overrides.storyPoints ?? undefined,
        },
        changelog: { histories: [] },
    };
}

// ─── Jira Agile API response (issues endpoint) ───────────────────────────────
export const syntheticAgileIssues = [
    makeIssue({ key: 'FIX-1', issueType: 'Story', storyPoints: 8 }),  // completed
    makeIssue({ key: 'FIX-2', issueType: 'Story', storyPoints: 5 }),  // completed
    makeIssue({ key: 'FIX-3', issueType: 'Story', storyPoints: 3 }),  // completed
    makeIssue({ key: 'FIX-4', issueType: 'Story', storyPoints: 5 }),  // not completed
    makeIssue({ key: 'FIX-5', issueType: 'Story', storyPoints: 2 }),  // not completed
    makeIssue({ key: 'FIX-SUB-TASK-6', issueType: 'Sub-task', storyPoints: 3, parentKey: 'FIX-1' }), // excluded: non-bug sub-task
    makeIssue({ key: 'FIX-SUB-BUG-7', issueType: 'Sub-bug', storyPoints: 2, parentKey: 'FIX-2' }),  // included: bug sub-task
    makeIssue({ key: 'FIX-PUNTED-8', issueType: 'Story', storyPoints: 13 }),                        // punted, also in agile
    makeIssue({ key: 'FIX-NO-SP-9', issueType: 'Story' }),                                          // no SP set → 0
];

// ─── GreenHopper sprint report response ──────────────────────────────────────
export const syntheticGhReport = {
    completedIssues: [
        { key: 'FIX-1', assigneeAccountId: 'acc-dev', assigneeName: 'Fixture Dev', storyPoints: 8, statusName: 'Done', done: true, typeName: 'Story' },
        { key: 'FIX-2', assigneeAccountId: 'acc-dev', assigneeName: 'Fixture Dev', storyPoints: 5, statusName: 'Done', done: true, typeName: 'Story' },
        { key: 'FIX-3', assigneeAccountId: 'acc-dev', assigneeName: 'Fixture Dev', storyPoints: 3, statusName: 'Done', done: true, typeName: 'Story' },
    ],
    notCompletedIssues: [
        { key: 'FIX-4', assigneeAccountId: 'acc-dev', assigneeName: 'Fixture Dev', storyPoints: 5, statusName: 'In Progress', done: false, typeName: 'Story' },
        { key: 'FIX-5', assigneeAccountId: 'acc-dev', assigneeName: 'Fixture Dev', storyPoints: 2, statusName: 'In Progress', done: false, typeName: 'Story' },
        { key: 'FIX-SUB-BUG-7', assigneeAccountId: 'acc-dev', assigneeName: 'Fixture Dev', storyPoints: 2, statusName: 'In Progress', done: false, typeName: 'Sub-bug' },
        { key: 'FIX-NO-SP-9', assigneeAccountId: 'acc-dev', assigneeName: 'Fixture Dev', storyPoints: 0, statusName: 'In Progress', done: false, typeName: 'Story' },
    ],
    puntedIssues: [
        { key: 'FIX-PUNTED-8', assigneeAccountId: 'acc-dev', assigneeName: 'Fixture Dev', storyPoints: 13, statusName: 'To Do', done: false, typeName: 'Story' },
        { key: 'FIX-PUNTED-ONLY-10', assigneeAccountId: 'acc-dev', assigneeName: 'Fixture Dev', storyPoints: 7, statusName: 'To Do', done: false, typeName: 'Story' },
    ],
};

// ─── Ground-truth expectations (hand-calculated) ─────────────────────────────
export const expected = {
    // Keys present in facts after subtask exclusion (9 issues - 1 non-bug subtask + 1 punted-only skeleton = 9)
    factKeys: [
        'FIX-1', 'FIX-2', 'FIX-3', 'FIX-4', 'FIX-5',
        'FIX-SUB-BUG-7', 'FIX-PUNTED-8', 'FIX-NO-SP-9',
        'FIX-PUNTED-ONLY-10',
    ],
    completedKeys: ['FIX-1', 'FIX-2', 'FIX-3'],
    puntedKeys: ['FIX-PUNTED-8', 'FIX-PUNTED-ONLY-10'],
    // After filtering out punted facts (the filter applied server-side in getProductivityOverview)
    nonPuntedSpDone: 16,
    nonPuntedSpPlanned: 25,
    productivity: 64.0,
};
