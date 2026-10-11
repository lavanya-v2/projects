import { describe, it, expect, vi } from 'vitest';

// Mocks must precede imports — performanceSyncService pulls in Sequelize models
// whose decorators cannot resolve at unit-test time without a live DB connection.
vi.mock('../../../models/Project', () => ({ Project: { findAll: vi.fn(), findByPk: vi.fn() } }));
vi.mock('../../../models/Account', () => ({ Account: { findByPk: vi.fn() } }));
vi.mock('../../../models/AccountTeamMember', () => ({ AccountTeamMember: { findAll: vi.fn() } }));
vi.mock('../../../models/TeamMember', () => ({ TeamMember: { findAll: vi.fn() } }));
vi.mock('../../../models/DailyBoardSnapshot', () => ({ DailyBoardSnapshot: { findAll: vi.fn() } }));
vi.mock('../../../models/PerfSprintSync', () => ({ PerfSprintSync: { findOne: vi.fn(), findAll: vi.fn(), create: vi.fn() } }));
vi.mock('../../../models/PerfTicketFact', () => ({ PerfTicketFact: { findAll: vi.fn(), bulkCreate: vi.fn(), destroy: vi.fn() } }));
vi.mock('../../../models/PerfMemberScore', () => ({ PerfMemberScore: { findAll: vi.fn(), destroy: vi.fn() } }));
vi.mock('../../jira/services/jiraService', () => ({ JiraService: vi.fn() }));
vi.mock('../../../common/laneDefaults', () => ({ getLaneConfig: vi.fn(() => ({})) }));
vi.mock('../../../common/utils', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}));

import {
    buildTicketFactsFromJiraData, findScopeAddedAt, wasScopeChange, wasMovedBackToDev, EFFECTIVE_DONE,
    resolveEffectiveDoneStatuses, jqlEndOfDay, istStartOfDayUtc, istEndOfDayUtc, buildStatusChangedDuringJql,
    shouldIncludeKanbanTicket, isReopenExclusionLabel, detectInvalidBug, findQaTester, findQaClearing, wasUatRejected, wasUatRejectedAfterClearing, isInCycleCatchEligible,
} from './performanceSyncService';
import { computeSprintProductivity } from './productivityMath';
import {
    syntheticAgileIssues,
    syntheticGhReport,
    expected,
    SYNTHETIC_SPRINT_ID,
    SYNTHETIC_SYNC_ID,
    SYNTHETIC_PROJECT_ID,
    SYNTHETIC_SPRINT_START,
    SYNTHETIC_SPRINT_END,
} from './__fixtures__/jira-sprint-fixture';

function runBuild() {
    return buildTicketFactsFromJiraData({
        issues: syntheticAgileIssues,
        ghReport: syntheticGhReport,
        laneConfig: {},
        spFieldId: 'story_points',
        prodBugKeys: new Set(),
        sprintStartTs: SYNTHETIC_SPRINT_START,
        sprintEndTs: SYNTHETIC_SPRINT_END,
        jiraSprintId: SYNTHETIC_SPRINT_ID,
        syncId: SYNTHETIC_SYNC_ID,
        projectId: SYNTHETIC_PROJECT_ID,
    });
}

describe('buildTicketFactsFromJiraData — data-selection rules', () => {
    it('produces exactly the expected set of ticket facts', () => {
        const facts = runBuild();
        const keys = facts.map(f => f.jiraKey).sort();
        expect(keys).toEqual([...expected.factKeys].sort());
    });

    it('excludes non-bug sub-tasks', () => {
        const facts = runBuild();
        expect(facts.find(f => f.jiraKey === 'FIX-SUB-TASK-6')).toBeUndefined();
    });

    it('includes bug sub-tasks', () => {
        const facts = runBuild();
        expect(facts.find(f => f.jiraKey === 'FIX-SUB-BUG-7')).toBeDefined();
    });

    it('marks wasCompleted=true iff the issue is in GreenHopper completedIssues', () => {
        const facts = runBuild();
        for (const f of facts) {
            const shouldBeCompleted = expected.completedKeys.includes(f.jiraKey!);
            expect(f.wasCompleted).toBe(shouldBeCompleted);
        }
    });

    it('marks wasPunted=true iff the issue is in GreenHopper puntedIssues, and forces wasCompleted=false on punted', () => {
        const facts = runBuild();
        for (const f of facts) {
            const shouldBePunted = expected.puntedKeys.includes(f.jiraKey!);
            expect(f.wasPunted === true).toBe(shouldBePunted);
            if (shouldBePunted) expect(f.wasCompleted).toBe(false);
        }
    });

    it('appends a skeleton fact for a punted issue that is NOT in the agile response', () => {
        const facts = runBuild();
        const puntedOnly = facts.find(f => f.jiraKey === 'FIX-PUNTED-ONLY-10');
        expect(puntedOnly).toBeDefined();
        expect(puntedOnly?.wasPunted).toBe(true);
        expect(puntedOnly?.wasCompleted).toBe(false);
        expect(puntedOnly?.storyPoints).toBe(7);
        expect(puntedOnly?.summary).toBeNull();
    });

    it('reads storyPoints from the resolved spFieldId and defaults to 0 when unset', () => {
        const facts = runBuild();
        expect(facts.find(f => f.jiraKey === 'FIX-1')?.storyPoints).toBe(8);
        expect(facts.find(f => f.jiraKey === 'FIX-NO-SP-9')?.storyPoints).toBe(0);
    });

    it('stamps syncId and projectId on every fact', () => {
        const facts = runBuild();
        expect(facts.length).toBeGreaterThan(0);
        for (const f of facts) {
            expect(f.syncId).toBe(SYNTHETIC_SYNC_ID);
            expect(f.projectId).toBe(SYNTHETIC_PROJECT_ID);
        }
    });
});

describe('productivity end-to-end — fixture built facts → computeSprintProductivity', () => {
    it('reconciles to hand-calculated ground-truth productivity', () => {
        const facts = runBuild();
        const nonPunted = facts.filter(f => !f.wasPunted);
        const result = computeSprintProductivity(
            nonPunted.map(f => ({
                storyPoints: f.storyPoints ?? 0,
                wasCompleted: !!f.wasCompleted,
            })),
        );
        expect(result.spDone).toBe(expected.nonPuntedSpDone);
        expect(result.spPlanned).toBe(expected.nonPuntedSpPlanned);
        expect(result.productivity).toBe(expected.productivity);
    });

    it('matches the arithmetic: spDone / spPlanned × 100, rounded to 1dp', () => {
        const { nonPuntedSpDone: done, nonPuntedSpPlanned: planned, productivity } = expected;
        expect(Math.round((done / planned) * 1000) / 10).toBe(productivity);
    });
});

describe('wasScopeChange — carry-in vs real creep', () => {
    const SPRINT_ID = 200;
    const PREV_SPRINT_ID = 100;
    const SPRINT_START = new Date('2026-04-16T00:00:00Z');

    const issueWithSprintEvent = (when: string, fromIds: string, toIds: string) => ({
        changelog: {
            histories: [{
                created: when,
                items: [{ field: 'Sprint', from: fromIds, to: toIds }],
            }],
        },
    });

    it('returns false when added before sprint start (already-planned)', () => {
        const issue = issueWithSprintEvent('2026-04-15T10:00:00Z', '', '200');
        expect(wasScopeChange(issue, SPRINT_ID, SPRINT_START, new Set(['100']))).toBe(false);
    });

    it('returns false when carried in from the immediately-preceding sprint', () => {
        // Sprint field changes after sprint start, from prev sprint (100) -> [100, 200]
        const issue = issueWithSprintEvent('2026-04-16T13:01:00Z', '100', '100,200');
        expect(wasScopeChange(issue, SPRINT_ID, SPRINT_START, new Set([String(PREV_SPRINT_ID)]))).toBe(false);
    });

    it('returns true when added post-start with no prior sprint membership', () => {
        const issue = issueWithSprintEvent('2026-04-20T09:00:00Z', '', '200');
        expect(wasScopeChange(issue, SPRINT_ID, SPRINT_START, new Set(['100']))).toBe(true);
    });

    it('returns true when added post-start from a foreign sprint (not the prev sprint)', () => {
        // Came from sprint 999, which is not the team's prev sprint (100)
        const issue = issueWithSprintEvent('2026-04-20T09:00:00Z', '999', '999,200');
        expect(wasScopeChange(issue, SPRINT_ID, SPRINT_START, new Set(['100']))).toBe(true);
    });

    it('returns true with empty prevSprintIds when added post-start (first-sprint fallback)', () => {
        // No prior sync known, behave like the original detection
        const issue = issueWithSprintEvent('2026-04-20T09:00:00Z', '', '200');
        expect(wasScopeChange(issue, SPRINT_ID, SPRINT_START, new Set())).toBe(true);
    });

    it('classifies by the EARLIEST post-start Sprint-add event regardless of API ordering', () => {
        // Real-world case: Jira sometimes returns histories descending. Two post-start
        // events: first is carry-in from prev (earlier date), second is a re-add
        // after a brief reshuffle. Earliest event is the canonical entry, so it
        // should be carry-in.
        const issue = {
            changelog: {
                histories: [
                    {
                        created: '2026-04-29T08:38:00Z',
                        items: [{ field: 'Sprint', from: '300', to: '200' }],
                    },
                    {
                        created: '2026-04-16T13:01:00Z',
                        items: [{ field: 'Sprint', from: '100', to: '100,200' }],
                    },
                ],
            },
        };
        expect(wasScopeChange(issue, SPRINT_ID, SPRINT_START, new Set(['100']))).toBe(false);
    });

    it('returns false when ticket has no Sprint changelog events', () => {
        const issue = { changelog: { histories: [] } };
        expect(wasScopeChange(issue, SPRINT_ID, SPRINT_START, new Set(['100']))).toBe(false);
    });
});

describe('wasMovedBackToDev — sequence-aware reopen detection', () => {
    // Default lane sets (empty laneConfig), mirroring buildTicketFactsFromJiraData.
    const inProgress = new Set(['in progress', 'in development', 'reopened']);
    const qa = new Set(['in qa', 'qa review', 'qa testing', 'testing', 'in testing', 'ready for qa', 'qa']);
    const uat = new Set(['po review', 'uat', 'acceptance testing', 'in uat']);
    const doneOrUat = new Set<string>([...EFFECTIVE_DONE, ...uat]);

    const WIN_START = new Date('2026-05-27T00:00:00Z');
    const WIN_END = new Date('2026-06-30T23:59:59Z');

    // rows: [iso, fromString, toString]
    const changes = (rows: Array<[string, string, string]>) =>
        rows.map(([iso, fromString, toString]) => ({ created: new Date(iso), fromString, toString }));

    const run = (rows: Array<[string, string, string]>, start = WIN_START, end = WIN_END) =>
        wasMovedBackToDev(changes(rows), inProgress, qa, doneOrUat, start, end);

    it('detects a reopen routed through an intermediate Blocked status (LP-4949 pattern)', () => {
        expect(run([
            ['2026-06-04T10:00:00Z', 'Dev Complete', 'Testing'],
            ['2026-06-05T11:19:00Z', 'Testing', 'Blocked'],
            ['2026-06-05T11:35:00Z', 'Blocked', 'Reopened'],
            ['2026-06-05T12:07:00Z', 'Reopened', 'In Progress'],
        ])).toBe(true);
    });

    it('detects a reopened standalone bug returning via the Reopened status (LP-4944 pattern)', () => {
        expect(run([
            ['2026-06-01T12:03:00Z', 'In Progress', 'UAT'],
            ['2026-06-01T12:04:00Z', 'UAT', 'Testing'],
            ['2026-06-02T08:57:00Z', 'Testing', 'Reopened'],
            ['2026-06-02T12:15:00Z', 'Reopened', 'Testing'],
        ])).toBe(true);
    });

    it('does NOT flag a ticket that went to Blocked but never returned to dev (LP-4725 pattern)', () => {
        expect(run([
            ['2026-05-28T10:00:00Z', 'Dev Complete', 'Testing'],
            ['2026-05-29T10:00:00Z', 'Testing', 'Blocked'],
            ['2026-05-30T10:00:00Z', 'Blocked', 'Testing'],
            ['2026-05-30T11:00:00Z', 'Testing', 'UAT'],
        ])).toBe(false);
    });

    it('does NOT false-arm on Backlog round-trips before any QA', () => {
        expect(run([
            ['2026-05-27T10:00:00Z', 'In Progress', 'Backlog'],
            ['2026-05-28T10:00:00Z', 'Backlog', 'In Progress'],
            ['2026-05-29T10:00:00Z', 'In Progress', 'Dev Complete'],
        ])).toBe(false);
    });

    it('ignores a regression whose dev hop falls outside the window', () => {
        expect(run([
            ['2026-06-05T10:00:00Z', 'Dev Complete', 'Testing'],
            ['2026-07-10T10:00:00Z', 'Testing', 'In Progress'], // after WIN_END
        ])).toBe(false);
    });

    it('arms from the first hop when the changelog opens already in a review lane', () => {
        expect(run([
            ['2026-06-05T10:00:00Z', 'Testing', 'Blocked'],
            ['2026-06-05T12:00:00Z', 'Blocked', 'In Progress'],
        ])).toBe(true);
    });

    it('detects a carried-over ticket kicked back to dev when QA entry was before the window', () => {
        // Ticket entered Testing in the PRIOR sprint (out of window); the only
        // in-window event is the kick-back. Arming must come from the hop`s `from`.
        expect(run([
            ['2026-05-20T10:00:00Z', 'Dev Complete', 'Testing'], // before WIN_START
            ['2026-05-28T10:00:00Z', 'Testing', 'In Progress'],  // in window: from=Testing arms it
        ])).toBe(true);
    });

    it('does NOT flag a carried-over ticket that only moves forward in-window', () => {
        // Entered Testing prior sprint, then moves forward Testing -> UAT -> Done.
        expect(run([
            ['2026-05-20T10:00:00Z', 'Dev Complete', 'Testing'], // before WIN_START
            ['2026-05-28T10:00:00Z', 'Testing', 'UAT'],
            ['2026-05-29T10:00:00Z', 'UAT', 'Pending Deployment'],
        ])).toBe(false);
    });

    it('detects a reopen landing in a project-specific reopened lane (e.g. PHX "Issues Found")', () => {
        // Simulates a custom workflow: the dev/landing set includes the project's
        // configured reopened lane ("Issues Found"), and QA uses "Ready to Test".
        const devPlus = new Set([...inProgress, 'issues found']);
        const qaPlus = new Set([...qa, 'ready to test']);
        const fired = wasMovedBackToDev(
            changes([
                ['2026-05-28T10:00:00Z', 'In Progress', 'Ready to Test'],
                ['2026-05-29T10:00:00Z', 'Ready to Test', 'Issues Found'],
            ]),
            devPlus, qaPlus, doneOrUat, WIN_START, WIN_END,
        );
        expect(fired).toBe(true);
    });

    // Status-based mode (project has a dedicated "Reopened" status): the landing
    // set is ONLY the reopened lane, not plain in-progress lanes. Mirrors how
    // buildTicketFactsFromJiraData builds reopenLandingStatuses when
    // reopenStatusOnly=true (e.g. PRO / Prospecting).
    const reopenedOnlyLanding = new Set(['reopened', 'issues found']);
    const runStatusOnly = (rows: Array<[string, string, string]>) =>
        wasMovedBackToDev(changes(rows), reopenedOnlyLanding, qa, doneOrUat, WIN_START, WIN_END);

    // The exact PRO-5668 pattern: developer bounces the ticket out of Testing back
    // to In Progress via a transparent Dev Complete hop — never touching Reopened.
    const proDevBounce: Array<[string, string, string]> = [
        ['2026-06-17T12:01:00Z', 'Dev Complete', 'Testing'],
        ['2026-06-19T10:03:51Z', 'Testing', 'Dev Complete'],
        ['2026-06-19T10:03:54Z', 'Dev Complete', 'In Progress'],
        ['2026-06-19T12:41:00Z', 'In Progress', 'Dev Complete'],
        ['2026-06-19T13:15:00Z', 'Dev Complete', 'UAT'],
    ];

    it('flow mode flags the PRO dev-bounce Testing -> Dev Complete -> In Progress (current behavior)', () => {
        expect(run(proDevBounce)).toBe(true);
    });

    it('status-only mode does NOT flag the PRO dev-bounce (never entered Reopened)', () => {
        expect(runStatusOnly(proDevBounce)).toBe(false);
    });

    it('status-only mode still flags a genuine reopen that enters the Reopened status', () => {
        expect(runStatusOnly([
            ['2026-06-17T12:01:00Z', 'Dev Complete', 'Testing'],
            ['2026-06-18T09:00:00Z', 'Testing', 'Reopened'],
        ])).toBe(true);
    });

    it('status-only mode still flags a genuine reopen reached from Done', () => {
        expect(runStatusOnly([
            ['2026-06-17T12:01:00Z', 'UAT', 'Pending Deployment'],
            ['2026-06-18T09:00:00Z', 'Pending Deployment', 'Reopened'],
        ])).toBe(true);
    });
});

describe('isReopenExclusionLabel — separator/case-insensitive matching', () => {
    // The three exclusion labels are matched by EQUALITY on the normalised form,
    // so spelling variants exclude but longer labels that merely start with one
    // of them do not.
    it.each([
        'invalid-reopen', 'Invalid-Reopen', 'invalid_reopen', 'InvalidReopen', 'INVALIDREOPEN',
        'bad-data', 'Bad-Data', 'bad_data', 'BadData', 'Bad Data',
        'scope-change', 'Scope-Change', 'scope_change', 'ScopeChange',
    ])('matches the exclusion label variant %s', (label) => {
        expect(isReopenExclusionLabel(label)).toBe(true);
    });

    // Regression guard for the equality (not prefix) decision: these longer labels
    // must keep NOT excluding, otherwise approved scope changes would silently
    // cancel genuine reopens.
    it.each([
        'scope-change-approved', 'Scope-Change-Approved', 'scopechangeapproved',
        'bad-data-migration', 'invalid-reopen-review',
    ])('does NOT match the longer label %s', (label) => {
        expect(isReopenExclusionLabel(label)).toBe(false);
    });

    // The invalid-bug family keeps its PREFIX behaviour.
    it.each(['invalid-bug', 'invalidbug', 'invalid_bug', 'InvalidBugs', 'invalid-bug-config'])(
        'still matches the fuzzy invalid-bug label %s',
        (label) => { expect(isReopenExclusionLabel(label)).toBe(true); },
    );

    it.each(['invalid', 'invalidated', 'bug-invalid', 'refactor', ''])(
        'ignores the unrelated label %s',
        (label) => { expect(isReopenExclusionLabel(label)).toBe(false); },
    );
});

describe('detectInvalidBug — Root Cause stems and labels', () => {
    const withRootCause = (value: string | null) =>
        ({ customfield_10414: value === null ? null : { value } });

    it.each([
        'Incomplete Requirement', 'incomplete-requirement', 'incomplete_requirement',
        'IncompleteRequirement', 'Incomplete Requirements', 'Incomplete Requirement - UI',
    ])('flags Root Cause %s as an invalid bug', (rc) => {
        expect(detectInvalidBug(withRootCause(rc), []).invalidBug).toBe(true);
    });

    it.each(['Invalid Bug', 'invalid-bug', 'Invalid Bug - Config', 'Bad Data', 'bad-data', 'BadData'])(
        'still flags the pre-existing Root Cause value %s',
        (rc) => { expect(detectInvalidBug(withRootCause(rc), []).invalidBug).toBe(true); },
    );

    it.each(['Requirement Gap', 'Not a Bug', 'Duplicate', 'Cannot Reproduce', 'Regression', ''])(
        'does NOT flag Root Cause %s',
        (rc) => { expect(detectInvalidBug(withRootCause(rc), []).invalidBug).toBe(false); },
    );

    it('does not flag a ticket with no Root Cause and no labels', () => {
        expect(detectInvalidBug({}, []).invalidBug).toBe(false);
        expect(detectInvalidBug(withRootCause(null), []).invalidBug).toBe(false);
        expect(detectInvalidBug(undefined, []).invalidBug).toBe(false);
    });

    it('flags via the label path alone when Root Cause is absent', () => {
        expect(detectInvalidBug({}, ['invalid-bug']).invalidBug).toBe(true);
        expect(detectInvalidBug({}, ['invalidbugs']).invalidBug).toBe(true);
    });

    // 'Incomplete Requirement' is a Root Cause value only — it is deliberately NOT
    // a label trigger, and it must not exclude reopens.
    it('does not flag an incomplete-requirement LABEL', () => {
        expect(detectInvalidBug({}, ['incomplete-requirement']).invalidBug).toBe(false);
    });

    it('does not let an incomplete-requirement label exclude a reopen', () => {
        expect(isReopenExclusionLabel('incomplete-requirement')).toBe(false);
    });

    it('returns the raw, unnormalised Root Cause for storage', () => {
        expect(detectInvalidBug(withRootCause('Incomplete Requirement'), []).rootCause)
            .toBe('Incomplete Requirement');
        expect(detectInvalidBug({}, []).rootCause).toBeNull();
    });
});

describe('findScopeAddedAt — timestamp shape', () => {
    const SPRINT_ID = 200;
    const SPRINT_START = new Date('2026-04-16T00:00:00Z');

    const history = (created: string, fromIds: string, toIds: string) => ({
        created,
        items: [{ field: 'Sprint', from: fromIds, to: toIds }],
    });

    it('returns the exact created timestamp for real post-start creep', () => {
        const created = '2026-04-20T09:00:00Z';
        const result = findScopeAddedAt([history(created, '', '200')], SPRINT_ID, SPRINT_START, new Set(['100']));
        expect(result).toBe(created);
    });

    it('returns null for carry-in from the immediately-preceding sprint', () => {
        const result = findScopeAddedAt(
            [history('2026-04-16T13:01:00Z', '100', '100,200')],
            SPRINT_ID,
            SPRINT_START,
            new Set(['100']),
        );
        expect(result).toBeNull();
    });

    it('classifies by the EARLIEST post-start event when histories arrive unordered', () => {
        // Real-world Jira sometimes returns histories descending. Earliest event
        // is the canonical entry — here, carry-in. Helper must sort first.
        const result = findScopeAddedAt(
            [
                history('2026-04-29T08:38:00Z', '300', '200'),
                history('2026-04-16T13:01:00Z', '100', '100,200'),
            ],
            SPRINT_ID,
            SPRINT_START,
            new Set(['100']),
        );
        expect(result).toBeNull();
    });

    it('with empty prevSprintIds, treats every post-start add as creep (caller-side fallback)', () => {
        // This documents the intentional fallback: when caller cannot resolve a
        // predecessor (e.g. first sprint on board), the helper preserves the
        // original detection rather than silently dropping events.
        const created = '2026-04-16T13:01:00Z';
        const result = findScopeAddedAt(
            [history(created, '100', '100,200')],
            SPRINT_ID,
            SPRINT_START,
            new Set(),
        );
        expect(result).toBe(created);
    });
});

describe('resolveEffectiveDoneStatuses', () => {
    it('falls back to EFFECTIVE_DONE when unset', () => {
        expect(resolveEffectiveDoneStatuses(undefined)).toBe(EFFECTIVE_DONE);
        expect(resolveEffectiveDoneStatuses(null)).toBe(EFFECTIVE_DONE);
        expect(resolveEffectiveDoneStatuses([])).toBe(EFFECTIVE_DONE);
    });

    it('uses the project-configured statuses, lowercased, when set', () => {
        const result = resolveEffectiveDoneStatuses(['Shipped', 'Live']);
        expect(result).toEqual(new Set(['shipped', 'live']));
    });

    it('does not silently merge the configured set with EFFECTIVE_DONE', () => {
        // A board with a bespoke terminal status opts OUT of the built-in set --
        // 'done' itself must not leak back in unless explicitly listed.
        const result = resolveEffectiveDoneStatuses(['Shipped']);
        expect(result.has('done')).toBe(false);
    });
});

describe('jqlEndOfDay', () => {
    it('appends the time that makes a date-only JQL upper bound inclusive of the full day', () => {
        expect(jqlEndOfDay('2026-08-14')).toBe('2026-08-14 23:59');
    });
});

describe('istStartOfDayUtc / istEndOfDayUtc', () => {
    it('start-of-day is 18:30 UTC on the PREVIOUS calendar date (IST is UTC+5:30)', () => {
        expect(istStartOfDayUtc('2026-08-14').toISOString()).toBe('2026-08-13T18:30:00.000Z');
    });

    it('end-of-day is 18:29:59.999 UTC on the SAME calendar date', () => {
        expect(istEndOfDayUtc('2026-08-14').toISOString()).toBe('2026-08-14T18:29:59.999Z');
    });

    it('an early-IST-morning transition falls inside the window, unlike bare UTC midnight', () => {
        // 2026-08-14T01:00 IST == 2026-08-13T19:30Z. Bare `new Date('2026-08-14')`
        // (UTC midnight) would wrongly exclude it as "before the window".
        const transitionUtc = new Date('2026-08-13T19:30:00.000Z');
        expect(transitionUtc.getTime()).toBeGreaterThanOrEqual(istStartOfDayUtc('2026-08-14').getTime());
        expect(new Date('2026-08-14').getTime()).toBeGreaterThan(transitionUtc.getTime());
    });

    it('a late-IST-evening transition on the end date falls inside the window', () => {
        // 2026-08-14T23:00 IST == 2026-08-14T17:30Z -- inside istEndOfDayUtc.
        const transitionUtc = new Date('2026-08-14T17:30:00.000Z');
        expect(transitionUtc.getTime()).toBeLessThanOrEqual(istEndOfDayUtc('2026-08-14').getTime());
    });

    it('the window spans a full 24 hours regardless of IST offset', () => {
        const spanMs = istEndOfDayUtc('2026-08-14').getTime() - istStartOfDayUtc('2026-08-14').getTime();
        expect(spanMs).toBe(24 * 60 * 60 * 1000 - 1);
    });
});

describe('buildStatusChangedDuringJql', () => {
    // Verified live against LS's Jira: this exact query shape (multi-value
    // "status changed to (...)") returned a set that matched an independent
    // full-changelog scan of the entire board exactly -- see the Kanban
    // delivery-models design doc's completion-supplement writeup.
    it('builds a multi-value DURING clause from the done-status set', () => {
        const jql = buildStatusChangedDuringJql(new Set(['done', 'closed']), '2026-07-20', '2026-07-24');
        expect(jql).toBe('status changed to ("done", "closed") DURING ("2026-07-20", "2026-07-24") ORDER BY created ASC');
    });

    it('works with a single status', () => {
        const jql = buildStatusChangedDuringJql(new Set(['pending deployment']), '2026-08-01', '2026-08-07');
        expect(jql).toBe('status changed to ("pending deployment") DURING ("2026-08-01", "2026-08-07") ORDER BY created ASC');
    });

    it('escapes an embedded double quote in a status name defensively', () => {
        const jql = buildStatusChangedDuringJql(new Set(['weird"status']), '2026-08-01', '2026-08-07');
        expect(jql).toContain('"weird\\"status"');
    });

    it('respects a project-configured custom done-status set (not just EFFECTIVE_DONE)', () => {
        const custom = resolveEffectiveDoneStatuses(['Shipped', 'Live']);
        const jql = buildStatusChangedDuringJql(custom, '2026-08-01', '2026-08-07');
        expect(jql).toContain('"shipped"');
        expect(jql).toContain('"live"');
        expect(jql).not.toContain('"done"');
    });
});

describe('shouldIncludeKanbanTicket', () => {
    // Reproduces LS-1745 live on Aug 10-14, 2026: a Story created back in
    // January, already sitting in a Done-category status, with no status or
    // assignee change inside the window -- only a label-automation touch
    // bumped `updated`. Before this fix, an unconditional
    // `fields.status.statusCategory.key === 'done'` bypass let it through
    // regardless; it phantom-inflated a developer's "still open" SP and
    // dragged the cycle's avg completion ratio down. Confirms the fix: no
    // genuine in-window signal anywhere means excluded, full stop -- the
    // ticket's CURRENT status is deliberately not part of this decision.
    it('excludes a ticket with no in-window activity, even if it is currently Done (LS-1745)', () => {
        expect(shouldIncludeKanbanTicket({
            wasCompletedInPeriod: false,
            isBugType: false,
            createdInWindow: false,
            hasStatusChangeInPeriod: false,
            hasAssigneeChangeInPeriod: false,
        })).toBe(false);
    });

    it('includes a ticket that completed in-window, regardless of anything else', () => {
        expect(shouldIncludeKanbanTicket({
            wasCompletedInPeriod: true,
            isBugType: false,
            createdInWindow: false,
            hasStatusChangeInPeriod: false,
            hasAssigneeChangeInPeriod: false,
        })).toBe(true);
    });

    it('includes a bug created in-window even with no status/assignee change (defect-density numerator)', () => {
        expect(shouldIncludeKanbanTicket({
            wasCompletedInPeriod: false,
            isBugType: true,
            createdInWindow: true,
            hasStatusChangeInPeriod: false,
            hasAssigneeChangeInPeriod: false,
        })).toBe(true);
    });

    it('excludes a non-bug ticket merely created in-window with no other activity', () => {
        expect(shouldIncludeKanbanTicket({
            wasCompletedInPeriod: false,
            isBugType: false,
            createdInWindow: true,
            hasStatusChangeInPeriod: false,
            hasAssigneeChangeInPeriod: false,
        })).toBe(false);
    });

    it('includes a ticket with a real status/lane move in-window (moved on the board)', () => {
        expect(shouldIncludeKanbanTicket({
            wasCompletedInPeriod: false,
            isBugType: false,
            createdInWindow: false,
            hasStatusChangeInPeriod: true,
            hasAssigneeChangeInPeriod: false,
        })).toBe(true);
    });

    it('includes a ticket newly assigned in-window (added to the board and assigned to someone)', () => {
        expect(shouldIncludeKanbanTicket({
            wasCompletedInPeriod: false,
            isBugType: false,
            createdInWindow: false,
            hasStatusChangeInPeriod: false,
            hasAssigneeChangeInPeriod: true,
        })).toBe(true);
    });

    // Reproduces LS-2933 live on Aug 17-21, 2026. It reached Pending Deployment
    // on Aug 12 and was correctly counted done in the Aug 10-14 cycle; on Aug 21
    // a release close moved it Pending Deployment -> Closed. That IS an in-window
    // status change, so the previous rule re-admitted it to Aug 17-21 as a "not
    // done" ticket, re-inflating carry-over and the planned-SP denominator (LS
    // Jul 27-31: 217 -> 106 carry-over SP, planned 260 -> 149 once excluded).
    it('excludes a ticket whose only in-window move was between already-done statuses (LS-2933)', () => {
        expect(shouldIncludeKanbanTicket({
            wasCompletedInPeriod: false,
            isBugType: false,
            createdInWindow: false,
            hasStatusChangeInPeriod: true,
            hasAssigneeChangeInPeriod: false,
            isPriorPeriodCompletion: true,
        })).toBe(false);
    });

    it('excludes a prior-period completion that was also reassigned in-window', () => {
        expect(shouldIncludeKanbanTicket({
            wasCompletedInPeriod: false,
            isBugType: false,
            createdInWindow: false,
            hasStatusChangeInPeriod: true,
            hasAssigneeChangeInPeriod: true,
            isPriorPeriodCompletion: true,
        })).toBe(false);
    });

    // Guards the clause ORDER: `isBugType && createdInWindow` must be evaluated
    // BEFORE the prior-period-completion rule. It is the only reason a bug with
    // no in-window status change survives, and it feeds the defect-density /
    // leakage numerator and bugsRaisedCount. If the new rule were promoted above
    // it, bugs logged in-window would silently vanish from those metrics.
    it('still includes a bug created in-window even when flagged a prior-period completion', () => {
        expect(shouldIncludeKanbanTicket({
            wasCompletedInPeriod: false,
            isBugType: true,
            createdInWindow: true,
            hasStatusChangeInPeriod: true,
            hasAssigneeChangeInPeriod: false,
            isPriorPeriodCompletion: true,
        })).toBe(true);
    });

    // A genuine completion always wins, even if the flag were somehow set.
    it('still includes a ticket that completed in-window regardless of the flag', () => {
        expect(shouldIncludeKanbanTicket({
            wasCompletedInPeriod: true,
            isBugType: false,
            createdInWindow: false,
            hasStatusChangeInPeriod: true,
            hasAssigneeChangeInPeriod: false,
            isPriorPeriodCompletion: true,
        })).toBe(true);
    });
});

describe('findQaTester', () => {
    const QA = new Set(['testing', 'qa']);
    const DONE_OR_UAT = new Set(['uat', 'done', 'closed']);

    // LS-2933: Baljeet Chambal moved it Testing -> UAT on Aug 11. Unbounded, that
    // single event credited him in the Aug 3-7, Aug 10-14 AND Aug 17-21 cycles,
    // inflating ticketsTestedCount / clearedSP in each (LS Jul 27-31: 42 tickets
    // / 111 SP of re-credited QA work).
    const changes = [
        { created: new Date('2026-08-11T10:51:38Z'), fromString: 'Testing', toString: 'UAT', authorAccountId: 'acct-baljeet', authorName: 'Baljeet Chambal' },
        { created: new Date('2026-08-21T13:50:36Z'), fromString: 'Pending Deployment', toString: 'Closed', authorAccountId: 'acct-satyajit', authorName: 'Satyajit Bhattacharya' },
    ];

    const window = (from: string, to: string): [Date, Date] =>
        [new Date(`${from}T00:00:00+05:30`), new Date(`${to}T23:59:59+05:30`)];

    it('credits the tester when the QA -> done move falls inside the window', () => {
        const [start, end] = window('2026-08-10', '2026-08-14');
        expect(findQaTester(changes, QA, DONE_OR_UAT, start, end))
            .toEqual({ id: 'acct-baljeet', name: 'Baljeet Chambal' });
    });

    it('credits nobody when the QA -> done move falls outside the window', () => {
        const [start, end] = window('2026-08-17', '2026-08-21');
        expect(findQaTester(changes, QA, DONE_OR_UAT, start, end))
            .toEqual({ id: null, name: null });
    });

    it('credits nobody for a window entirely before the testing happened', () => {
        const [start, end] = window('2026-08-03', '2026-08-07');
        expect(findQaTester(changes, QA, DONE_OR_UAT, start, end))
            .toEqual({ id: null, name: null });
    });

    // The sprint call site still relies on the unbounded behaviour.
    it('scans the whole changelog when no window is supplied', () => {
        expect(findQaTester(changes, QA, DONE_OR_UAT))
            .toEqual({ id: 'acct-baljeet', name: 'Baljeet Chambal' });
    });

    it('keeps the LAST qualifying transition within the window', () => {
        const reTested = [
            ...changes,
            { created: new Date('2026-08-12T09:00:00Z'), fromString: 'Testing', toString: 'UAT', authorAccountId: 'acct-other', authorName: 'Other Tester' },
        ];
        const [start, end] = window('2026-08-10', '2026-08-14');
        expect(findQaTester(reTested, QA, DONE_OR_UAT, start, end))
            .toEqual({ id: 'acct-other', name: 'Other Tester' });
    });
});

describe('Kanban UAT reopen follows the sign-off, not the calendar', () => {
    const UAT = new Set(['uat']);
    const QA = new Set(['testing', 'qa']);
    const IN_PROGRESS = new Set(['in progress', 'reopened']);
    const DONE_OR_UAT = new Set(['uat', 'done', 'closed', 'pending deployment']);

    const at = (iso: string) => new Date(iso);
    const clear = (iso: string, who = 'qa-1') =>
        ({ created: at(iso), fromString: 'Testing', toString: 'UAT', authorAccountId: who, authorName: who });
    const reject = (iso: string) =>
        ({ created: at(iso), fromString: 'UAT', toString: 'Testing', authorAccountId: 'po', authorName: 'PO' });
    const window = (from: string, to: string): [Date, Date] =>
        [new Date(`${from}T00:00:00+05:30`), new Date(`${to}T23:59:59+05:30`)];

    const cycle = window('2026-07-27', '2026-07-31');

    // The whole point of anchoring to the sign-off: on a Kanban board UAT has no
    // deadline, so the reopen routinely lands cycles later. Charging it where it
    // lands would attach it to a cycle where this QA holds no credit -- charged to
    // nobody -- and Kanban quality would flatten to a meaningless 100%.
    it('charges a reopen that happens two cycles after the sign-off', () => {
        const changes = [clear('2026-07-29T10:00:00+05:30'), reject('2026-08-12T10:00:00+05:30')];
        const c = findQaClearing(changes, QA, DONE_OR_UAT, ...cycle);
        expect(c.id).toBe('qa-1');
        expect(wasUatRejectedAfterClearing(changes, UAT, QA, IN_PROGRESS, DONE_OR_UAT, c.at!)).toBe(true);
    });

    it('does not charge when the sign-off was never reopened', () => {
        const changes = [clear('2026-07-29T10:00:00+05:30')];
        const c = findQaClearing(changes, QA, DONE_OR_UAT, ...cycle);
        expect(wasUatRejectedAfterClearing(changes, UAT, QA, IN_PROGRESS, DONE_OR_UAT, c.at!)).toBe(false);
    });

    // Responsibility passes on re-clearing: the second QA owns what follows their
    // own sign-off, so the first QA is not charged for the second reopen.
    it('charges only the first clearer for the reopen that followed their sign-off', () => {
        const changes = [
            clear('2026-07-29T10:00:00+05:30', 'qa-1'),
            reject('2026-08-02T10:00:00+05:30'),
            clear('2026-08-05T10:00:00+05:30', 'qa-2'),
            reject('2026-08-09T10:00:00+05:30'),
        ];
        const first = findQaClearing(changes, QA, DONE_OR_UAT, ...cycle);
        expect(first.id).toBe('qa-1');
        expect(wasUatRejectedAfterClearing(changes, UAT, QA, IN_PROGRESS, DONE_OR_UAT, first.at!)).toBe(true);

        // qa-2's sign-off, in a later cycle, is judged on its own reopen.
        const second = findQaClearing(changes, QA, DONE_OR_UAT, ...window('2026-08-03', '2026-08-07'));
        expect(second.id).toBe('qa-2');
        expect(wasUatRejectedAfterClearing(changes, UAT, QA, IN_PROGRESS, DONE_OR_UAT, second.at!)).toBe(true);
    });

    it('does not charge the first clearer when someone else re-cleared before any reopen', () => {
        const changes = [
            clear('2026-07-29T10:00:00+05:30', 'qa-1'),
            clear('2026-08-05T10:00:00+05:30', 'qa-2'),
            reject('2026-08-09T10:00:00+05:30'),
        ];
        const first = findQaClearing(changes, QA, DONE_OR_UAT, ...cycle);
        expect(wasUatRejectedAfterClearing(changes, UAT, QA, IN_PROGRESS, DONE_OR_UAT, first.at!)).toBe(false);
    });

    it('gives no credit and no charge when nothing was cleared in the cycle', () => {
        const changes = [clear('2026-08-12T10:00:00+05:30'), reject('2026-08-20T10:00:00+05:30')];
        const c = findQaClearing(changes, QA, DONE_OR_UAT, ...cycle);
        expect(c.id).toBeNull();
        expect(c.at).toBeNull();
    });

    it('ignores a forward move out of UAT — that is acceptance, not rejection', () => {
        const changes = [
            clear('2026-07-29T10:00:00+05:30'),
            { created: at('2026-08-01T10:00:00+05:30'), fromString: 'UAT', toString: 'Pending Deployment', authorAccountId: 'x', authorName: 'X' },
        ];
        const c = findQaClearing(changes, QA, DONE_OR_UAT, ...cycle);
        expect(wasUatRejectedAfterClearing(changes, UAT, QA, IN_PROGRESS, DONE_OR_UAT, c.at!)).toBe(false);
    });

    // The sprint path keeps the lifetime scan deliberately.
    it('sprint wasUatRejected still scans the whole history', () => {
        const changes = [reject('2026-07-24T10:00:00+05:30')];
        expect(wasUatRejected(changes, UAT, QA, IN_PROGRESS)).toBe(true);
    });
});

describe('isInCycleCatchEligible — Epic-parented bugs', () => {
    // LS parents its standalone Bugs to an Epic (LS-2633). Epics never appear in
    // a cycle's facts, so every such bug scored as a MISSED catch and the QA lost
    // the whole 30% catch component -- while a QA who raised no bugs at all got a
    // free 1.0 from the zero-denominator guard. The metric punished doing the job.
    it('excludes a bug parented to an Epic (LS-2633)', () => {
        expect(isInCycleCatchEligible('LS-2633', 'Epic')).toBe(false);
    });

    it('excludes a bug whose parent type is unknown (row synced before the column existed)', () => {
        expect(isInCycleCatchEligible('LS-2633', null)).toBe(false);
    });

    it('excludes a bug with no parent at all', () => {
        expect(isInCycleCatchEligible(null, null)).toBe(false);
    });

    it('still judges a sub-bug parented to a Story', () => {
        expect(isInCycleCatchEligible('LS-2885', 'Story')).toBe(true);
    });

    it('still judges a bug parented to a Task', () => {
        expect(isInCycleCatchEligible('LS-2885', 'Task')).toBe(true);
    });

    it('is case-insensitive on the parent type', () => {
        expect(isInCycleCatchEligible('LS-2633', 'EPIC')).toBe(false);
        expect(isInCycleCatchEligible('LS-2633', 'epic')).toBe(false);
    });
});

describe('buildTicketFactsFromJiraData — parent reopen driven by sub-bug validity (LOWA-11467 gap)', () => {
    // A parent whose own status never regresses, but has sub-bug evidence attached,
    // must trust ONLY that evidence — the parent's own flow/label is not consulted
    // at all once sub-bugs exist. Zero sub-bugs falls back to the flow signal.
    const WIN_START = new Date('2026-09-01T00:00:00Z');
    const WIN_END = new Date('2026-09-15T23:59:59Z');

    const baseFields = {
        summary: 'Synthetic issue',
        priority: { name: 'Medium' },
        reporter: { accountId: 'acc-reporter', displayName: 'Fixture Reporter' },
        assignee: { accountId: 'acc-dev', displayName: 'Fixture Dev' },
        status: { name: 'Done' },
        labels: [] as string[],
    };

    function issue(overrides: {
        key: string;
        issueType: string;
        storyPoints?: number | null;
        parentKey?: string;
        labels?: string[];
        rootCause?: string | null;
        statusChanges?: Array<[string, string, string]>;
    }) {
        return {
            key: overrides.key,
            fields: {
                ...baseFields,
                issuetype: { name: overrides.issueType },
                labels: overrides.labels ?? [],
                parent: overrides.parentKey ? { key: overrides.parentKey } : undefined,
                story_points: overrides.storyPoints ?? undefined,
                customfield_10414: overrides.rootCause ? { value: overrides.rootCause } : undefined,
            },
            changelog: {
                histories: (overrides.statusChanges ?? []).map(([iso, fromString, toString]) => ({
                    created: iso,
                    author: { accountId: 'acc-dev', displayName: 'Fixture Dev' },
                    items: [{ field: 'status', fromString, toString }],
                })),
            },
        };
    }

    function build(issues: ReturnType<typeof issue>[], ghKeys: { completed?: string[]; notCompleted?: string[] } = {}) {
        const completedKeys = ghKeys.completed ?? issues.map(i => i.key);
        const notCompletedKeys = ghKeys.notCompleted ?? [];
        return buildTicketFactsFromJiraData({
            issues,
            ghReport: {
                completedIssues: completedKeys.map(key => ({ key })),
                notCompletedIssues: notCompletedKeys.map(key => ({ key })),
                puntedIssues: [],
            },
            laneConfig: {},
            spFieldId: 'story_points',
            prodBugKeys: new Set(),
            sprintStartTs: WIN_START,
            sprintEndTs: WIN_END,
            jiraSprintId: 1,
            syncId: 1,
            projectId: 1,
        });
    }

    it('marks the parent reopened when it has a valid sub-bug, even though its own status never regressed (LOWA-11467)', () => {
        const parent = issue({ key: 'PAR-1', issueType: 'Story', storyPoints: 5 }); // no statusChanges at all
        const subBug = issue({ key: 'SUB-1', issueType: 'Sub-bug', storyPoints: 0, parentKey: 'PAR-1' });
        const facts = build([parent, subBug]);
        expect(facts.find(f => f.jiraKey === 'PAR-1')?.wasReopened).toBe(true);
    });

    it('does NOT mark the parent reopened when ALL of its sub-bugs are invalid, even if the parent genuinely moved back to dev', () => {
        const parent = issue({
            key: 'PAR-2', issueType: 'Story', storyPoints: 5,
            statusChanges: [
                ['2026-09-05T10:00:00Z', 'Dev Complete', 'Testing'],
                ['2026-09-06T10:00:00Z', 'Testing', 'Reopened'], // genuine flow-based reopen
            ],
        });
        const subBug1 = issue({ key: 'SUB-2A', issueType: 'Sub-bug', storyPoints: 0, parentKey: 'PAR-2', rootCause: 'Invalid Bug' });
        const subBug2 = issue({ key: 'SUB-2B', issueType: 'Sub-bug', storyPoints: 0, parentKey: 'PAR-2', labels: ['Invalid-Bug'] });
        const facts = build([parent, subBug1, subBug2]);
        expect(facts.find(f => f.jiraKey === 'PAR-2')?.wasReopened).toBe(false);
    });

    it('marks the parent reopened when at least one sub-bug is valid, even with other invalid sub-bugs present', () => {
        const parent = issue({ key: 'PAR-3', issueType: 'Story', storyPoints: 5 });
        const invalidSubBug = issue({ key: 'SUB-3A', issueType: 'Sub-bug', storyPoints: 0, parentKey: 'PAR-3', rootCause: 'Bad Data' });
        const validSubBug = issue({ key: 'SUB-3B', issueType: 'Sub-bug', storyPoints: 0, parentKey: 'PAR-3' });
        const facts = build([parent, invalidSubBug, validSubBug]);
        expect(facts.find(f => f.jiraKey === 'PAR-3')?.wasReopened).toBe(true);
    });

    it('falls back to the own-status flow signal when the parent has zero sub-bugs', () => {
        const reopenedNoSubBugs = issue({
            key: 'PAR-4', issueType: 'Story', storyPoints: 5,
            statusChanges: [
                ['2026-09-05T10:00:00Z', 'Dev Complete', 'Testing'],
                ['2026-09-06T10:00:00Z', 'Testing', 'Reopened'],
            ],
        });
        const neverReopened = issue({ key: 'PAR-5', issueType: 'Story', storyPoints: 5 });
        const facts = build([reopenedNoSubBugs, neverReopened]);
        expect(facts.find(f => f.jiraKey === 'PAR-4')?.wasReopened).toBe(true);
        expect(facts.find(f => f.jiraKey === 'PAR-5')?.wasReopened).toBe(false);
    });
});
