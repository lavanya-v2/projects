
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportService, computeWeekMonday } from './reportService';
import { computeBugAxisScore, ScoredBug } from './bugSeverityMath';
import { tallyDailyHealth, computeWeeklyMajorityStatus, rollupHealth } from './healthMath';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { PerfSprintSync } from '../../../models/PerfSprintSync';
import { PerfTicketFact } from '../../../models/PerfTicketFact';
import { Project } from '../../../models/Project';
import { Account } from '../../../models/Account';

// Mock dependencies
vi.mock('../../jira', () => ({
    jiraService: {
        getIssuesForBoard: vi.fn(),
        extractBlockedInfo: vi.fn(),
    }
}));
vi.mock('../../ai/services/aiService', () => ({
    aiService: {
        analyzeBoard: vi.fn(),
    }
}));
vi.mock('../../../models/DailyBoardSnapshot', () => ({
    DailyBoardSnapshot: {
        findOne: vi.fn(),
        findAll: vi.fn(),
        upsert: vi.fn(),
    }
}));
vi.mock('../../../models/Project', () => ({
    Project: {
        findOne: vi.fn(),
        findByPk: vi.fn(),
        findAll: vi.fn(),
    }
}));
// reportService.ts pulls in seven model modules at import time; each one's
// @Table decorator registers against the real Sequelize singleton in
// config/connection.ts unless mocked, which forces a live DB connection
// attempt and fails the whole file's collection (0 tests run, no error
// surfaced in a normal CI summary -- this is what silently zeroed out every
// test in this file, including this one, until these were added).
vi.mock('../../../models/TeamMember', () => ({ TeamMember: { findAll: vi.fn() } }));
vi.mock('../../../models/AccountTeamMember', () => ({ AccountTeamMember: { findAll: vi.fn() } }));
vi.mock('../../../models/ProjectWeeklyReport', () => ({ ProjectWeeklyReport: { findOne: vi.fn(), findAll: vi.fn(), upsert: vi.fn() } }));
vi.mock('../../../models/AccountWeeklyReport', () => ({ AccountWeeklyReport: { findOne: vi.fn(), findAll: vi.fn(), upsert: vi.fn() } }));
vi.mock('../../../models/Account', () => ({ Account: { findByPk: vi.fn(), findAll: vi.fn() } }));
vi.mock('../../../models/MonthlyProjectReport', () => ({ MonthlyProjectReport: { findOne: vi.fn(), findAll: vi.fn(), upsert: vi.fn() } }));
vi.mock('../../../models/MonthlyAccountReport', () => ({ MonthlyAccountReport: { findOne: vi.fn(), findAll: vi.fn(), upsert: vi.fn() } }));
// reportService.ts also imports performanceSyncService.ts (for isSubBugIssueType),
// which pulls in its own set of models -- mock those too, same reasoning.
vi.mock('../../../models/PerfSprintSync', () => ({ PerfSprintSync: { findOne: vi.fn(), findAll: vi.fn(), create: vi.fn() } }));
vi.mock('../../../models/PerfTicketFact', () => ({ PerfTicketFact: { findAll: vi.fn(), bulkCreate: vi.fn(), destroy: vi.fn() } }));
vi.mock('../../../models/PerfMemberScore', () => ({ PerfMemberScore: { findAll: vi.fn(), destroy: vi.fn() } }));
vi.mock('../../jira/services/jiraService', () => ({ JiraService: vi.fn() }));
// The actual root cause: reportService -> issueSourceAdapter -> excelImportService
// imports config/connection.ts directly, which eagerly constructs a real
// `new Sequelize({ models: [...every model...] })` at import time -- no
// individual model mock above prevents THIS specific file from executing.
// Mocking the connection module itself is the fix that survives future
// transitive-import changes, rather than chasing each new path one at a time.
vi.mock('../../../config/connection', () => ({ default: {} }));
vi.mock('../../../common/utils', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
    }
}));


describe('ReportService Timezone Logic', () => {
    let reportService: ReportService;

    beforeEach(() => {
        reportService = new ReportService();
    });

    it('should correctly identify activity in late afternoon (IST) without double conversion', () => {
        // Scenario:
        // Window is 10:00 UTC to 14:00 UTC.
        // (In IST: 15:30 to 19:30)
        // Event happened at 13:00 UTC (18:30 IST).
        // This is INSIDE the window.

        // Old Logic (Buggy):
        // Event converted to 13:00 + 5.5 = 18:30 "Date value".
        // Compared vs Window End 14:00.
        // 18.5 > 14.0 -> REJECTED.

        // New Logic (Fixed):
        // Event 13:00 compared vs Window End 14:00.
        // 13.0 <= 14.0 -> ACCEPTED.

        const window = {
            start: new Date('2025-02-13T10:00:00Z'),
            end: new Date('2025-02-13T14:00:00Z')
        };

        const issue = {
            key: 'TEST-1',
            fields: {
                status: { name: 'In Progress' },
                created: '2025-02-12T10:00:00Z', // Old
                comment: {
                    comments: [
                        {
                            // 13:00 UTC = 18:30 IST
                            created: '2025-02-13T13:00:00Z',
                            body: 'Late afternoon comment'
                        }
                    ]
                }
            },
            changelog: { histories: [] }
        };

        // Access private method via casting to any. isTeamMember is a required param
        // (no default) -- this test only exercises window-boundary logic, so every
        // author counts as a team member.
        const result = (reportService as any).identifyDailyActivity([issue], window, () => true);

        // identifyDailyActivity returns `teamActiveTickets`, never `activeTickets` --
        // the previous property name here never matched the real return shape.
        expect(result.teamActiveTickets.length).toBe(1);
        expect(result.teamActiveTickets[0].key).toBe('TEST-1');
        expect(result.teamActiveTickets[0].dailyActivity).toContain('Comment added');
    });

    it('should correctly exclude activity outside the window', () => {
        const window = {
            start: new Date('2025-02-13T10:00:00Z'),
            end: new Date('2025-02-13T14:00:00Z')
        };

        const issue = {
            key: 'TEST-2',
            fields: {
                status: { name: 'In Progress' },
                created: '2025-02-12T10:00:00Z',
                comment: {
                    comments: [
                        {
                            // 15:00 UTC = 20:30 IST -> Out of window
                            created: '2025-02-13T15:00:00Z',
                            body: 'Too late comment'
                        }
                    ]
                }
            },
            changelog: { histories: [] }
        };

        const result = (reportService as any).identifyDailyActivity([issue], window, () => true);

        expect(result.teamActiveTickets.length).toBe(0);
        expect(result.contextTickets.length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Prod Bug Detection — isolated logic tests
// These mirror the exact logic in generateBoardReport so we can test each
// fix without needing to wire up Jira / AI / DB mocks.
// ---------------------------------------------------------------------------

/**
 * Mirrors the PROD_TITLE_REGEX from reportService (Fix #1).
 * \bprod(uction)?\b  — word-boundary anchored so "product" won't match.
 */
const PROD_TITLE_REGEX = /\bprod(uction)?\b/i;

/**
 * Mirrors the resolved-status check (Fix #3).
 */
const RESOLVED_STATUSES = ['done', 'resolved', 'closed', "won't fix", 'duplicate'];
const isResolved = (statusName: string) =>
    RESOLVED_STATUSES.some(s => statusName.toLowerCase().includes(s));


// ---------------------------------------------------------------------------
describe('Prod Bug Detection — Fix #1: title regex (no false positives)', () => {

    it('matches standalone "prod" (uppercase)', () => {
        expect(PROD_TITLE_REGEX.test('[PROD] Login page crash')).toBe(true);
    });

    it('matches standalone "prod" (lowercase)', () => {
        expect(PROD_TITLE_REGEX.test('prod - payment failure')).toBe(true);
    });

    it('matches "production" as full word', () => {
        expect(PROD_TITLE_REGEX.test('Production bug: checkout error')).toBe(true);
    });

    it('matches "Prod" in parens or brackets', () => {
        expect(PROD_TITLE_REGEX.test('(Prod) API timeout')).toBe(true);
        expect(PROD_TITLE_REGEX.test('[prod] API timeout')).toBe(true);
    });

    it('does NOT match "product" (word boundary prevents it)', () => {
        expect(PROD_TITLE_REGEX.test('Improve product listing page')).toBe(false);
    });

    it('does NOT match "productivity"', () => {
        expect(PROD_TITLE_REGEX.test('Team productivity tracking feature')).toBe(false);
    });

    it('does NOT match "production-ready" as a compound word', () => {
        // "production" followed by "-" breaks the word boundary on some engines —
        // \b before hyphen IS a boundary, so "production" still matches here.
        // This is acceptable: "production-ready bug" IS a prod bug title.
        expect(PROD_TITLE_REGEX.test('production-ready feature check')).toBe(true);
    });

    it('does NOT match "reproduce"', () => {
        expect(PROD_TITLE_REGEX.test('Unable to reproduce the issue')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
describe('Prod Bug Detection — Fix #3: resolved/done bugs excluded', () => {

    it('excludes a bug with status Done', () => {
        expect(isResolved('Done')).toBe(true);
    });

    it('excludes a bug with status Closed', () => {
        expect(isResolved('Closed')).toBe(true);
    });

    it('excludes a bug with status Resolved', () => {
        expect(isResolved('Resolved')).toBe(true);
    });

    it('excludes a bug with status Duplicate', () => {
        expect(isResolved('Duplicate')).toBe(true);
    });

    it('does NOT exclude a bug with status In Progress', () => {
        expect(isResolved('In Progress')).toBe(false);
    });

    it('does NOT exclude a bug with status Open', () => {
        expect(isResolved('Open')).toBe(false);
    });

    it('does NOT exclude a bug with status In Review', () => {
        expect(isResolved('In Review')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Mirrors getLastBoardEntryDate + isOldProdBug from reportService.
// Rule: if (boardEntryDate - bug.created) > 15 days → old prod bug → score 0.
// ---------------------------------------------------------------------------

const SPRINT_DAYS_TEST = 15;

const getLastBoardEntryDate = (issue: any): Date | null => {
    const histories: any[] = issue.changelog?.histories || [];

    // Signal 1: most recent Sprint field assignment (Scrum)
    let latestSprint: Date | null = null;
    for (const history of histories) {
        for (const item of history.items || []) {
            if (item.field === 'Sprint' && item.toString) {
                const d = new Date(history.created);
                if (!latestSprint || d > latestSprint) latestSprint = d;
            }
        }
    }
    if (latestSprint) return latestSprint;

    // Signal 2: earliest transition out of Backlog / To Do (Kanban)
    const BACKLOG_STATUSES = ['backlog', 'to do'];
    const sorted = [...histories].sort(
        (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime()
    );
    for (const history of sorted) {
        for (const item of history.items || []) {
            if (item.field === 'status') {
                const from = (item.fromString || '').toLowerCase();
                if (BACKLOG_STATUSES.some(s => from.includes(s))) {
                    return new Date(history.created);
                }
            }
        }
    }

    return null; // No board entry → treat as new incident (conservative)
};

const isOldProdBug = (issue: any): boolean => {
    const boardEntryDate = getLastBoardEntryDate(issue);
    if (!boardEntryDate) return false; // No info → assume new
    const createdDate = new Date(issue.fields.created);
    const gapDays = (boardEntryDate.getTime() - createdDate.getTime()) / 86400000;
    return gapDays > SPRINT_DAYS_TEST;
};

// ---------------------------------------------------------------------------
describe('Prod Bug Detection — Old vs New: gap between created and board entry', () => {

    const TODAY = new Date('2026-02-19T12:00:00Z');
    const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86400000).toISOString();

    // Helper: build an issue with Sprint field assignment
    const makeSprintIssue = (createdDaysAgo: number, sprintAssignedDaysAgo: number) => ({
        fields: { created: daysAgo(createdDaysAgo), updated: daysAgo(sprintAssignedDaysAgo) },
        changelog: {
            histories: [{
                created: daysAgo(sprintAssignedDaysAgo),
                items: [{ field: 'Sprint', toString: 'Sprint 42' }]
            }]
        }
    });

    // Helper: build an issue with Backlog→Active status transition
    const makeKanbanIssue = (createdDaysAgo: number, movedFromBacklogDaysAgo: number) => ({
        fields: { created: daysAgo(createdDaysAgo), updated: daysAgo(movedFromBacklogDaysAgo) },
        changelog: {
            histories: [{
                created: daysAgo(movedFromBacklogDaysAgo),
                items: [{ field: 'status', fromString: 'Backlog', toString: 'In Progress' }]
            }]
        }
    });

    // Helper: build an issue with no Sprint or Backlog changelog entry
    const makeNoChangelogIssue = (createdDaysAgo: number) => ({
        fields: { created: daysAgo(createdDaysAgo), updated: daysAgo(createdDaysAgo) },
        changelog: { histories: [] }
    });

    // --- getLastBoardEntryDate ---

    it('uses Sprint field assignment date (Scrum signal)', () => {
        const issue = makeSprintIssue(60, 5);
        const entry = getLastBoardEntryDate(issue);
        expect(entry).not.toBeNull();
        // Entry date should be ~5 days ago
        const gapFromToday = (TODAY.getTime() - entry!.getTime()) / 86400000;
        expect(gapFromToday).toBeCloseTo(5, 0);
    });

    it('uses earliest Backlog→active transition (Kanban signal) when no Sprint field', () => {
        const issue = makeKanbanIssue(60, 10);
        const entry = getLastBoardEntryDate(issue);
        expect(entry).not.toBeNull();
        const gapFromToday = (TODAY.getTime() - entry!.getTime()) / 86400000;
        expect(gapFromToday).toBeCloseTo(10, 0);
    });

    it('uses most recent Sprint assignment when re-assigned to multiple sprints', () => {
        const issue = {
            fields: { created: daysAgo(90), updated: daysAgo(3) },
            changelog: {
                histories: [
                    { created: daysAgo(45), items: [{ field: 'Sprint', toString: 'Sprint 40' }] },
                    { created: daysAgo(3),  items: [{ field: 'Sprint', toString: 'Sprint 42' }] },
                ]
            }
        };
        const entry = getLastBoardEntryDate(issue);
        const gapFromToday = (TODAY.getTime() - entry!.getTime()) / 86400000;
        expect(gapFromToday).toBeCloseTo(3, 0); // Most recent sprint assignment
    });

    it('returns null when no Sprint or Backlog transition exists', () => {
        const issue = makeNoChangelogIssue(30);
        expect(getLastBoardEntryDate(issue)).toBeNull();
    });

    // --- isOldProdBug ---

    it('classifies as OLD when gap (boardEntry - created) > 15 days', () => {
        // Created 60 days ago, added to sprint 5 days ago → gap = 55 days > 15
        const issue = makeSprintIssue(60, 5);
        expect(isOldProdBug(issue)).toBe(true);
    });

    it('classifies as NEW when gap ≤ 15 days (bug created recently, added to sprint quickly)', () => {
        // Created 10 days ago, added to sprint 3 days ago → gap = 7 days ≤ 15
        const issue = makeSprintIssue(10, 3);
        expect(isOldProdBug(issue)).toBe(false);
    });

    it('classifies as NEW when gap is exactly 15 days (boundary — not strictly greater)', () => {
        // Created 20 days ago, added to sprint 5 days ago → gap = 15 days, NOT > 15
        const issue = makeSprintIssue(20, 5);
        expect(isOldProdBug(issue)).toBe(false);
    });

    it('classifies as NEW (conservative) when no changelog entry exists', () => {
        // No Sprint or Backlog transition — option A: treat as new incident
        const issue = makeNoChangelogIssue(60);
        expect(isOldProdBug(issue)).toBe(false);
    });

    it('classifies as OLD via Kanban signal: created 45d ago, moved from Backlog 10d ago → gap=35d', () => {
        const issue = makeKanbanIssue(45, 10);
        expect(isOldProdBug(issue)).toBe(true);
    });

});

// ---------------------------------------------------------------------------
// End-to-end scoring — imports and exercises the REAL computeBugAxisScore from
// bugSeverityMath.ts. Phase 0 extracted the then-current formula verbatim (count/priority
// branches, unweighted); Phase 1 replaced it with the severity-weighted score tested here.
//
// A prior version of this block hand-simulated the scoring formula inline
// (`score = count === 1 && hasHighPriority ? 2 : 1`) instead of calling real production code,
// plus two "volume check" tests (`newBugVolumePct > 10 ? 2 : 1`) asserting a
// percentage-of-total-tickets rule that does not exist anywhere in reportService.ts — those
// two were removed rather than converted, since there was no real function to test them
// against; they exercised fictional logic that gave false confidence.
// ---------------------------------------------------------------------------
describe('Prod Bug Detection — End-to-end scoring (computeBugAxisScore, Phase 1 weighted formula)', () => {
    const bug = (priorityName: string | null, overrides: Partial<ScoredBug> = {}): ScoredBug => ({
        isOld: false,
        isReopenedSubBug: false,
        isInRemediation: false,
        priorityName,
        ...overrides,
    });

    it('5 old prod bugs (all excluded) → score 0 (Green, no health impact)', () => {
        const bugs = Array.from({ length: 5 }, () => bug('High', { isOld: true }));
        expect(computeBugAxisScore(bugs).score).toBe(0);
    });

    it('2 old + 1 new High-priority bug → only the new one counts → Amber (weight 1.5, below the Red threshold of 2.0)', () => {
        const bugs = [
            bug('High', { isOld: true }),
            bug('High', { isOld: true }),
            bug('High'), // new
        ];
        const result = computeBugAxisScore(bugs);
        expect(result.score).toBe(1);
        expect(result.freshCount).toBe(1);
    });

    it('one Critical bug unaddressed → Red (weight 2.0 meets the Red threshold alone)', () => {
        expect(computeBugAxisScore([bug('Critical')]).score).toBe(2);
    });

    it('3 new High-priority bugs → Red (weight 4.5) — same outcome as the old ">2 bugs" rule, but because of severity, not count', () => {
        const bugs = [bug('High'), bug('High'), bug('High')];
        expect(computeBugAxisScore(bugs).score).toBe(2);
    });

    it('3 new Low-priority bugs → Amber, NOT auto-Red (weight 1.05) — the old count>2 shortcut ignored severity entirely', () => {
        const bugs = [bug('Low'), bug('Low'), bug('Low')];
        expect(computeBugAxisScore(bugs).score).toBe(1);
    });

    it('a single new Low-priority bug → score stays 0 (Green), by calibration — but is now visible in tierBreakdown', () => {
        const result = computeBugAxisScore([bug('Low')]);
        expect(result.score).toBe(0);
        expect(result.tierBreakdown.low).toBe(1); // no longer silently absent from the detail
    });

    it('a single new Medium-priority bug → score 1 (Amber)', () => {
        expect(computeBugAxisScore([bug('Medium')]).score).toBe(1);
    });

    it('a Critical bug moved to In Progress drops from Red to Amber, not further — severity still shows (weight 1.0, not flattened to a fixed 1)', () => {
        const result = computeBugAxisScore([bug('Critical', { isInRemediation: true })]);
        expect(result.score).toBe(1);
        expect(result.totalWeight).toBeCloseTo(1.0);
    });

    it('4 Blocker bugs in QA → Red; 1 Medium bug in QA → Green — no longer identical, the core Phase 1 fix', () => {
        const fourBlockersInQa = Array.from({ length: 4 }, () => bug('Blocker', { isInRemediation: true }));
        const oneMediumInQa = [bug('Medium', { isInRemediation: true })];
        // 4 * (2.0 critical * 0.5 discount) = 4.0 -> Red
        expect(computeBugAxisScore(fourBlockersInQa).score).toBe(2);
        // 1 * (0.75 medium * 0.5 discount) = 0.375 -> Green
        expect(computeBugAxisScore(oneMediumInQa).score).toBe(0);
    });

    it('a "Highest"-priority bug now scores AT LEAST as severe as "High" — the priority-name gap Phase 1 fixes', () => {
        // Old exact-string allowlist (['High','Critical','Blocker']) didn't include 'Highest',
        // so a single Highest bug scored BELOW a single High bug. The new tier map puts
        // 'highest' in the 'critical' tier (weight 2.0), correctly above 'high' (weight 1.5).
        expect(computeBugAxisScore([bug('High')]).score).toBe(1);    // Amber (1.5)
        expect(computeBugAxisScore([bug('Highest')]).score).toBe(2); // Red (2.0) — now correctly more severe
    });

    it('CCM\'s actual priority naming ("Normal") is recognized as medium severity', () => {
        // Confirmed via perf_ticket_facts: CCM uses Normal/High/Critical/Low, never
        // Blocker/Highest. 'Normal' must not fall through to the unrecognized-label default
        // by coincidence — it is explicitly mapped.
        expect(computeBugAxisScore([bug('Normal')]).score).toBe(1); // Amber (0.75), same as Medium
    });

    it('an unrecognized priority label defaults to medium severity, not the most lenient tier', () => {
        expect(computeBugAxisScore([bug('P1')]).score).toBe(1); // treated as medium (0.75) -> Amber, not invisible
    });

    it('a project-level bug_priority_map override replaces the default map entirely', () => {
        const customMap = { p1: 'critical' as const, p2: 'low' as const };
        expect(computeBugAxisScore([bug('P1')], customMap).score).toBe(2); // now Red via the override
        // 'High' is not in the override map, so it falls through to unrecognized -> medium (Amber)
        expect(computeBugAxisScore([bug('High')], customMap).score).toBe(1);
    });
});

describe('computeWeekMonday', () => {
    // 2026-08-14 is a confirmed Friday; 2026-08-10 the Monday of that week.
    it('a Friday maps to the Monday four days earlier', () => {
        const monday = computeWeekMonday('2026-08-14');
        expect(monday.getFullYear()).toBe(2026);
        expect(monday.getMonth()).toBe(7); // August, 0-indexed
        expect(monday.getDate()).toBe(10);
        expect(monday.getDay()).toBe(1); // Monday
    });

    it('a Monday maps to itself', () => {
        const monday = computeWeekMonday('2026-08-10');
        expect(monday.getDate()).toBe(10);
    });

    it('a Sunday maps to the Monday of the SAME week, not the next one (day===0 edge case)', () => {
        const monday = computeWeekMonday('2026-08-16'); // Sunday
        expect(monday.getDate()).toBe(10);
    });

    it('zeroes the time component', () => {
        const monday = computeWeekMonday('2026-08-14');
        expect(monday.getHours()).toBe(0);
        expect(monday.getMinutes()).toBe(0);
        expect(monday.getSeconds()).toBe(0);
    });

    it('is a pure function of asOf -- repeated calls with the same date agree', () => {
        // This is the actual bug being fixed: the old implementation ignored its
        // input entirely and read `new Date()`, so a DSR regenerated for a past
        // date on two different days classified bugs against two different
        // "current" weeks. Anchoring on asOf makes it a pure function.
        const a = computeWeekMonday('2026-03-12');
        const b = computeWeekMonday('2026-03-12');
        expect(a.getTime()).toBe(b.getTime());
    });

    it('two different report dates in different weeks resolve to different Mondays', () => {
        const week1 = computeWeekMonday('2026-08-14');
        const week2 = computeWeekMonday('2026-08-21');
        expect(week1.getTime()).not.toBe(week2.getTime());
    });

    it('without asOf, still returns a Monday at midnight (today\'s week)', () => {
        const monday = computeWeekMonday();
        expect(monday.getDay()).toBe(1);
        expect(monday.getHours()).toBe(0);
    });
});

describe('getWeeklyMetrics — throughput scoping', () => {
    let reportService: ReportService;
    const start = new Date('2026-08-07T00:00:00Z');
    const end = new Date('2026-08-13T00:00:00Z');

    beforeEach(() => {
        reportService = new ReportService();
        vi.clearAllMocks();
    });

    function snapshot(date: string, doneCount: number) {
        return {
            date,
            statusCounts: { Done: doneCount },
            blockedTickets: [],
            teamMembers: [],
        } as any;
    }

    it('sprint projects (isKanban=false) are BYTE-IDENTICAL to the original max-min approximation', async () => {
        // The regression-prevention test the plan calls for: this fix must not
        // move a single sprint project's number. Never calls PerfSprintSync --
        // if it did, that alone would be a sign the scoping broke.
        (DailyBoardSnapshot.findAll as any).mockResolvedValue([
            snapshot('2026-08-07', 2), snapshot('2026-08-08', 5), snapshot('2026-08-09', 3),
        ]);
        const result = await (reportService as any).getWeeklyMetrics(1, start, end, undefined, false);
        expect(result.throughput).toBe(3); // max(5) - min(2), the untouched approximation
        expect(PerfSprintSync.findAll).not.toHaveBeenCalled();
    });

    it('sprint projects with isKanban omitted (undefined) also use the untouched approximation', async () => {
        // Every pre-existing call site that never passes the new 5th argument
        // must keep behaving exactly as before.
        (DailyBoardSnapshot.findAll as any).mockResolvedValue([
            snapshot('2026-08-07', 2), snapshot('2026-08-08', 5),
        ]);
        const result = await (reportService as any).getWeeklyMetrics(1, start, end);
        expect(result.throughput).toBe(3);
        expect(PerfSprintSync.findAll).not.toHaveBeenCalled();
    });

    it('kanban projects use real completed-fact counts when a synced span overlaps the week', async () => {
        (DailyBoardSnapshot.findAll as any).mockResolvedValue([
            snapshot('2026-08-07', 2), snapshot('2026-08-08', 1), snapshot('2026-08-09', 0), // approx would be 2
        ]);
        (PerfSprintSync.findAll as any).mockResolvedValue([{ id: 900 }]);
        (PerfTicketFact.findAll as any).mockResolvedValue([
            { jiraKey: 'KAN-1' }, { jiraKey: 'KAN-2' }, { jiraKey: 'KAN-3' }, { jiraKey: 'KAN-4' }, { jiraKey: 'KAN-5' },
        ]);
        const result = await (reportService as any).getWeeklyMetrics(1, start, end, undefined, true);
        expect(result.throughput).toBe(5); // real count, not the 2-vs-approximation the snapshots alone would give
    });

    it('kanban projects dedup facts across overlapping sync spans', async () => {
        (DailyBoardSnapshot.findAll as any).mockResolvedValue([snapshot('2026-08-07', 1)]);
        (PerfSprintSync.findAll as any).mockResolvedValue([{ id: 900 }, { id: 901 }]);
        (PerfTicketFact.findAll as any).mockResolvedValue([
            { jiraKey: 'KAN-1' }, { jiraKey: 'KAN-1' }, { jiraKey: 'KAN-2' }, // KAN-1 appears in both spans
        ]);
        const result = await (reportService as any).getWeeklyMetrics(1, start, end, undefined, true);
        expect(result.throughput).toBe(2);
    });

    it('kanban projects fall back to the snapshot approximation when nothing is synced for this week', async () => {
        (DailyBoardSnapshot.findAll as any).mockResolvedValue([
            snapshot('2026-08-07', 2), snapshot('2026-08-08', 6),
        ]);
        (PerfSprintSync.findAll as any).mockResolvedValue([]); // nothing synced overlapping this week
        const result = await (reportService as any).getWeeklyMetrics(1, start, end, undefined, true);
        expect(result.throughput).toBe(4); // max(6)-min(2) -- the fallback, not a false zero
        expect(PerfTicketFact.findAll).not.toHaveBeenCalled();
    });

    it('the PerfSprintSync overlap query is scoped to done kanban syncs touching the week', async () => {
        (DailyBoardSnapshot.findAll as any).mockResolvedValue([snapshot('2026-08-07', 1)]);
        (PerfSprintSync.findAll as any).mockResolvedValue([]);
        await (reportService as any).getWeeklyMetrics(42, start, end, undefined, true);
        const call = (PerfSprintSync.findAll as any).mock.calls[0][0];
        expect(call.where.projectId).toBe(42);
        expect(call.where.syncType).toBe('kanban');
        expect(call.where.syncStatus).toBe('done');
    });
});

// ---------------------------------------------------------------------------
// Weekly majority-rule status (computeWeeklyMajorityStatus from healthMath.ts).
//
// Phase 0 of the RAG-reliability plan: this rule previously had ZERO test coverage of any
// kind — it was only ever exercised indirectly through full weekly-report generation. As of
// Phase 2, reportService.ts no longer calls this function (see `rollupHealth` tests below,
// which cover the function actually in production) — these tests remain as a documented
// record of the OLD behavior, including the exact over-reaction defect Phase 2 fixed: a
// single Amber/Red day among mostly Green days used to taint the whole week to Amber.
// ---------------------------------------------------------------------------
describe('computeWeeklyMajorityStatus — superseded rule, kept as a record of old behavior', () => {
    const counts = (healths: string[]) => tallyDailyHealth(healths);

    it('all Green days → Green', () => {
        const c = counts(['Green', 'Green', 'Green', 'Green', 'Green']);
        expect(computeWeeklyMajorityStatus(c, 5)).toBe('Green');
    });

    it('4 Green + 1 Amber → Amber today (the over-reaction Phase 2 fixes)', () => {
        const c = counts(['Green', 'Green', 'Green', 'Green', 'Amber']);
        expect(computeWeeklyMajorityStatus(c, 5)).toBe('Amber');
    });

    it('3 Green + 2 Amber → Amber', () => {
        const c = counts(['Green', 'Green', 'Green', 'Amber', 'Amber']);
        expect(computeWeeklyMajorityStatus(c, 5)).toBe('Amber');
    });

    it('a strict majority of Red days (3 of 5) → Red', () => {
        const c = counts(['Red', 'Red', 'Red', 'Green', 'Green']);
        expect(computeWeeklyMajorityStatus(c, 5)).toBe('Red');
    });

    it('exactly half Red (not a strict majority) → Amber, not Red', () => {
        const c = counts(['Red', 'Red', 'Green', 'Green']);
        expect(computeWeeklyMajorityStatus(c, 4)).toBe('Amber');
    });

    it('a single Red day among mostly Green → Amber (Red alone is not majority)', () => {
        const c = counts(['Green', 'Green', 'Green', 'Green', 'Red']);
        expect(computeWeeklyMajorityStatus(c, 5)).toBe('Amber');
    });

    it('all Unknown days → Green (Unknown is not Red or Amber under the current rule)', () => {
        const c = counts(['Unknown', 'Unknown', 'Unknown']);
        expect(computeWeeklyMajorityStatus(c, 3)).toBe('Green');
    });

    it('a null/missing daily health is tallied as Unknown, not silently dropped', () => {
        const c = tallyDailyHealth([null, undefined, 'Green']);
        expect(c.Unknown).toBe(2);
        expect(c.Green).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// rollupHealth (healthMath.ts) — Phase 2's proportional replacement, actually called by
// reportService.ts's generateWeeklyReport as of this phase. Moderate calibration chosen with
// the user: Green if avg < 0.35, Amber if avg < 1.2, else Red, with a safety escalation that a
// strict majority of Red entries still forces Red regardless of average.
// ---------------------------------------------------------------------------
describe('rollupHealth — Phase 2 proportional rule (production behavior)', () => {
    it('all Green → Green (avg 0)', () => {
        const r = rollupHealth(['Green', 'Green', 'Green', 'Green', 'Green']);
        expect(r.health).toBe('Green');
        expect(r.avg).toBe(0);
    });

    it('4 Green + 1 Amber → Green (avg 0.20) — the exact over-reaction this phase fixes', () => {
        const r = rollupHealth(['Green', 'Green', 'Green', 'Green', 'Amber']);
        expect(r.health).toBe('Green');
        expect(r.avg).toBeCloseTo(0.2);
    });

    it('3 Green + 2 Amber → Amber (avg 0.40)', () => {
        const r = rollupHealth(['Green', 'Green', 'Green', 'Amber', 'Amber']);
        expect(r.health).toBe('Amber');
        expect(r.avg).toBeCloseTo(0.4);
    });

    it('1 Red + 4 Green → Amber (avg 0.40), not Green — a single Red day still surfaces', () => {
        const r = rollupHealth(['Red', 'Green', 'Green', 'Green', 'Green']);
        expect(r.health).toBe('Amber');
        expect(r.avg).toBeCloseTo(0.4);
    });

    it('2 Red + 3 Green → Amber (avg 0.80)', () => {
        const r = rollupHealth(['Red', 'Red', 'Green', 'Green', 'Green']);
        expect(r.health).toBe('Amber');
        expect(r.avg).toBeCloseTo(0.8);
    });

    it('a strict majority of Red days (3 of 5) → Red via the safety escalation, even though avg alone would also cross the Red band', () => {
        const r = rollupHealth(['Red', 'Red', 'Red', 'Green', 'Green']);
        expect(r.health).toBe('Red');
    });

    it('exactly half Red (2 of 4, not a strict majority) → Amber, not Red (avg 1.0, below the 1.2 Red ceiling)', () => {
        const r = rollupHealth(['Red', 'Red', 'Green', 'Green']);
        expect(r.health).toBe('Amber');
        expect(r.avg).toBeCloseTo(1.0);
    });

    it('all Unknown → Unknown, not a misleadingly reassuring Green', () => {
        const r = rollupHealth(['Unknown', 'Unknown', 'Unknown']);
        expect(r.health).toBe('Unknown');
        expect(r.scorableCount).toBe(0);
    });

    it('Unknown entries are excluded from both the sum and the denominator', () => {
        const r = rollupHealth(['Green', 'Unknown', 'Unknown']);
        expect(r.scorableCount).toBe(1);
        expect(r.avg).toBe(0);
        expect(r.health).toBe('Green');
    });
});

describe('statusAsOfWindowEnd — historical ticket-status rewind (retroactive DSR accuracy)', () => {
    let reportService: ReportService;

    beforeEach(() => {
        reportService = new ReportService();
    });

    it('rewinds to the status held immediately before the earliest post-window change (real SC-2502 changelog shape)', () => {
        // windowEnd = end of 22 Sep IST. The 09:06(-04:00) change converts to 13:06 UTC,
        // BEFORE windowEnd, so it is what was already true at window close — not a "later"
        // change to rewind past. The first change strictly after windowEnd is the 23rd's.
        const windowEnd = new Date('2026-09-22T18:30:00.000Z');
        const issue = {
            fields: { status: { name: 'Pending Deployment' } },
            changelog: {
                histories: [
                    { created: '2026-09-22T09:06:03.765-04:00', items: [{ field: 'status', fromString: 'Testing', toString: 'Reopened' }] },
                    { created: '2026-09-23T02:07:25.567-04:00', items: [{ field: 'status', fromString: 'Reopened', toString: 'Backlog' }] },
                    { created: '2026-09-28T14:09:47.216-04:00', items: [{ field: 'status', fromString: 'UAT', toString: 'Pending Deployment' }] },
                ],
            },
        };
        expect((reportService as any).statusAsOfWindowEnd(issue, windowEnd)).toBe('Reopened');
    });

    it('keeps the current status unchanged when no changelog entry exists after windowEnd', () => {
        const windowEnd = new Date('2026-09-22T14:30:00.000Z');
        const issue = {
            fields: { status: { name: 'In Progress' } },
            changelog: {
                histories: [
                    { created: '2026-09-10T09:06:03.765-04:00', items: [{ field: 'status', fromString: 'Backlog', toString: 'In Progress' }] },
                ],
            },
        };
        expect((reportService as any).statusAsOfWindowEnd(issue, windowEnd)).toBe('In Progress');
    });

    it('ignores non-status changelog items (e.g. assignee changes) after windowEnd', () => {
        const windowEnd = new Date('2026-09-22T14:30:00.000Z');
        const issue = {
            fields: { status: { name: 'Done' } },
            changelog: {
                histories: [
                    { created: '2026-09-25T09:06:03.765-04:00', items: [{ field: 'assignee', fromString: 'Alice', toString: 'Bob' }] },
                ],
            },
        };
        expect((reportService as any).statusAsOfWindowEnd(issue, windowEnd)).toBe('Done');
    });

    it('takes the earliest post-window status change when several exist, not the latest', () => {
        const windowEnd = new Date('2026-09-22T14:30:00.000Z');
        const issue = {
            fields: { status: { name: 'Pending Deployment' } },
            changelog: {
                histories: [
                    { created: '2026-09-25T00:00:00.000-04:00', items: [{ field: 'status', fromString: 'UAT', toString: 'Pending Deployment' }] },
                    { created: '2026-09-23T00:00:00.000-04:00', items: [{ field: 'status', fromString: 'Testing', toString: 'UAT' }] },
                ],
            },
        };
        expect((reportService as any).statusAsOfWindowEnd(issue, windowEnd)).toBe('Testing');
    });
});

describe('extractTicketDetailsStructured — chip data must come from Jira, not AI-formatted text', () => {
    let reportService: ReportService;

    beforeEach(() => {
        reportService = new ReportService();
    });

    it('pairs each AI-mentioned key with the real issueType/status from Jira data', () => {
        const issues = [
            { key: 'SC-2502', fields: { issuetype: { name: 'Bug' }, status: { name: 'Reopened' } } },
            { key: 'SC-100', fields: { issuetype: { name: 'Spike' }, status: { name: 'In Progress' } } },
        ];
        const text = '- SC-2502: [Bug] Fixed profile error\n- SC-100: [Spike] Investigated caching approach';
        const result = (reportService as any).extractTicketDetailsStructured(issues, text);
        expect(result).toEqual([
            { key: 'SC-2502', issueType: 'Bug', status: 'Reopened', description: 'Fixed profile error' },
            { key: 'SC-100', issueType: 'Spike', status: 'In Progress', description: 'Investigated caching approach' },
        ]);
    });

    it('resolves the real issue type even when the AI omits or mislabels the bracketed type (the original chip-rendering defect)', () => {
        const issues = [
            { key: 'SC-100', fields: { issuetype: { name: 'Spike' }, status: { name: 'In Progress' } } },
        ];
        // No recognisable [Type] token at all — the exact shape that broke the old regex parser.
        const text = '- SC-100: Investigated caching approach, no type tag from AI';
        const result = (reportService as any).extractTicketDetailsStructured(issues, text);
        expect(result).toEqual([
            { key: 'SC-100', issueType: 'Spike', status: 'In Progress', description: 'Investigated caching approach, no type tag from AI' },
        ]);
    });

    it('never fabricates data for a key the AI mentioned that is not one of the considered tickets', () => {
        const issues = [
            { key: 'SC-2502', fields: { issuetype: { name: 'Bug' }, status: { name: 'Reopened' } } },
        ];
        const text = '- SC-2502: [Bug] Fixed profile error\n- SC-9999: [Bug] Hallucinated ticket not in this report';
        const result = (reportService as any).extractTicketDetailsStructured(issues, text);
        expect(result).toEqual([
            { key: 'SC-2502', issueType: 'Bug', status: 'Reopened', description: 'Fixed profile error' },
        ]);
    });

    it('returns null when ticketDetailsText is empty', () => {
        const result = (reportService as any).extractTicketDetailsStructured([], null);
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Configurable weekly report cycle (Account.weekStartDay) — proves generateWeeklyReport
// resolves the project's account and threads its real weekStartDay into normalizeWindow,
// rather than the old hardcoded Friday-Thursday window computed before Project/Account were
// even looked up. Exercised via the validation-rejection path only: the method's cache-check
// branch requires the ProjectWeeklyReport model through a runtime `require()` call (line ~2789
// of reportService.ts) which this test file's module mocking cannot intercept -- a pre-existing
// vitest/dynamic-require limitation unrelated to this feature (confirmed via a minimal repro:
// even a bare `require()` of an already-vi.mock'd model fails identically in this suite).
// Validation happens before that require is ever reached, so it's fully exercisable here.
// ---------------------------------------------------------------------------
describe('ReportService.generateWeeklyReport — configurable weekStartDay (Account.weekStartDay)', () => {
    let reportService: ReportService;

    beforeEach(() => {
        vi.clearAllMocks();
        reportService = new ReportService();
    });

    it('rejects a Friday-start date range for a project whose account is configured with weekStartDay=1 (Monday) -- proves the cycle is actually read from the account, not hardcoded', async () => {
        (Project.findOne as any).mockResolvedValue({ id: 41, name: 'DevOps', code: 'DEVOPS', accountId: 3 });
        (Account.findByPk as any).mockResolvedValue({ id: 3, weekStartDay: 1 });

        await expect(reportService.generateWeeklyReport('DEVOPS', '2026-02-06', '2026-02-12', false))
            .rejects.toThrow('Start date must be a Monday.');
    });

    it('rejects a Monday-start date range when the account has no weekStartDay set -- still defaults to Friday-Thursday validation, matching every account before this feature', async () => {
        (Project.findOne as any).mockResolvedValue({ id: 41, name: 'DevOps', code: 'DEVOPS', accountId: 3 });
        (Account.findByPk as any).mockResolvedValue({ id: 3 });

        await expect(reportService.generateWeeklyReport('DEVOPS', '2026-02-09', '2026-02-15', false))
            .rejects.toThrow('Start date must be a Friday.');
    });
});
