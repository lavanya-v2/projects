import { Op } from 'sequelize';
import { Project } from '../../../models/Project';
import { Account } from '../../../models/Account';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { TeamMember } from '../../../models/TeamMember';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { PerfSprintSync } from '../../../models/PerfSprintSync';
import { PerfTicketFact } from '../../../models/PerfTicketFact';
import { PerfMemberScore } from '../../../models/PerfMemberScore';
import { JiraService } from '../../jira/services/jiraService';
import { computeLeakageFromFacts, QualityFact } from './qualityMath';
import { getLaneConfig, getOwnerFields, BUILTIN_ASSIGNEE } from '../../../common/laneDefaults';
import { logger } from '../../../common/utils';
import { computeSprintProductivity, computeProductivityTrend, hasCommitment } from './productivityMath';
import { EstimationConfig, ResolvedEstimateFields, resolveEstimateFields, extractEstimate } from './estimateExtraction';
import { ProjectSprint } from '../../../models/ProjectSprint';
import { generateCycles, lastCompletedCycle, cycleByIndex, cycleLabel, KanbanCycle } from './kanbanCycleService';
import { resolveDeliveryPeriods } from './deliveryPeriodResolver';
import { redactIssueTitles, resolveEnvironmentFieldId } from '../../jira/services/jiraFields';
import { buildV2Matcher } from './perfAggregation';
import { resolveSourceKeys } from '../../performanceReview/services/identityResolutionService';
import { attachSyncToOpenCycles } from '../../performanceReview/services/reviewCycleService';

// ─── Constants ────────────────────────────────────────────────────────────────

export const EFFECTIVE_DONE = new Set([
  'pending deployment',
  'ready for deployment',
  'ready for release',
  'deployed',
  'released',
  'done',
  'closed',
  'resolved',
  'complete',
  'completed',
  'accepted',
  'verified',
]);

/**
 * Statuses that sit between UAT and true-done — a ticket sitting here is
 * functionally finished, just awaiting release. Used to detect a pure
 * administrative reassignment: a ticket already parked here that gets handed
 * to a new assignee with no other in-window activity shouldn't inflate the
 * new assignee's carried SP for work they never touched (see LS Vivek Pandey
 * -> Shreyash Chandak bulk handoff, Aug 2026).
 */
export const AWAITING_RELEASE_STATUSES = new Set(['pending deployment', 'ready for deployment', 'ready for release']);

/**
 * Spread into any `where` that reads perf_ticket_facts for metric purposes.
 *
 * Rows flagged `is_prior_period_completion` describe work that COMPLETED in an
 * earlier cycle and only saw an administrative done-to-done move in this one
 * (e.g. Pending Deployment -> Closed). Since Aug 2026 `shouldIncludeKanbanTicket`
 * no longer persists them at all, but spans synced before that still hold ~200
 * such rows, and `recomputeScoresFromStored` runs without live Jira so it can
 * never re-derive them. Filtering at read is what makes old and new spans agree
 * WITHOUT forcing a re-sync of every historical Kanban cycle.
 *
 * Always false on the sprint path, so spreading this is a no-op there.
 */
export const EXCLUDE_PRIOR_PERIOD_COMPLETION = { isPriorPeriodCompletion: false } as const;

/**
 * Parent issue types that can never appear in a cycle's ticket facts, so a bug
 * hanging off one tells us nothing about whether it was caught against this
 * cycle's work. Epics are containers spanning many cycles; they don't move on
 * the board and are never ingested as facts.
 */
const NON_DELIVERABLE_PARENT_TYPES = new Set(['epic', 'initiative', 'theme']);

/**
 * Can this bug's parent answer "was it caught against work in THIS cycle"?
 *
 * Only when the parent is a real deliverable (Story, Task, Bug...). An Epic
 * parent cannot -- and neither can a null parent type, which means the row was
 * synced before parent_issue_type existed. Both are treated as "not applicable"
 * and drop out of the in-cycle-catch ratio entirely (numerator AND denominator),
 * rather than counting as a miss.
 *
 * Why this matters: LS parents its standalone Bugs to an Epic (LS-2633). Every
 * such bug scored as a missed catch, so a QA who raised bugs lost the whole 30%
 * catch component -- while a QA who raised NONE got a free 1.0 from the
 * zero-denominator guard. The metric rewarded not doing the job. Aug 2026.
 */
export function isInCycleCatchEligible(parentKey: string | null, parentIssueType: string | null): boolean {
  if (!parentKey) return false;
  if (!parentIssueType) return false;
  return !NON_DELIVERABLE_PARENT_TYPES.has(parentIssueType.toLowerCase());
}

/**
 * Per-project done-status resolution for Kanban completion detection.
 * `project.kanbanDoneStatuses` is the UI-configured override (comma-separated
 * Jira status names entered in Project Settings) -- it was previously written
 * by admin but never read by any Kanban sync path, so a board with a bespoke
 * terminal status (e.g. "Shipped", "Live") recorded zero completed SP no
 * matter what the setting said. Falls back to EFFECTIVE_DONE when unset or
 * empty, so every existing project's behaviour is unchanged until it opts in.
 */
export function resolveEffectiveDoneStatuses(kanbanDoneStatuses: string[] | null | undefined): Set<string> {
  if (!kanbanDoneStatuses || kanbanDoneStatuses.length === 0) return EFFECTIVE_DONE;
  return new Set(kanbanDoneStatuses.map(s => s.toLowerCase()));
}

/**
 * A bare YYYY-MM-DD literal in JQL is evaluated as that date's 00:00 --
 * `updated <= "2026-08-14"` excludes anything after midnight on the 14th,
 * silently dropping the entire last day of every Kanban window. Append this
 * to the upper bound of a date-only JQL comparison to include the full day,
 * matching the working pattern already used in computeWindowLeakage.
 */
export function jqlEndOfDay(dateStr: string): string {
  return `${dateStr} 23:59`;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * UTC instant of 00:00:00.000 IST on the given YYYY-MM-DD date -- the start of
 * the org's working day, for classifying changelog timestamps (real ISO
 * instants from Jira) against a Kanban window's calendar-date boundaries.
 * `new Date(dateStr)` alone is UTC midnight, which is 5:30 too early: a
 * transition in the first few hours of the IST morning would fall before it
 * and be wrongly excluded from the window.
 */
export function istStartOfDayUtc(dateStr: string): Date {
  return new Date(new Date(`${dateStr}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

/** UTC instant of 23:59:59.999 IST on the given YYYY-MM-DD date -- see istStartOfDayUtc. */
export function istEndOfDayUtc(dateStr: string): Date {
  return new Date(new Date(`${dateStr}T23:59:59.999Z`).getTime() - IST_OFFSET_MS);
}

/**
 * JQL for "any issue that transitioned into one of `doneStatuses` at some
 * point during [fromDate, toDate]", both dates inclusive as whole days.
 *
 * This exists because the primary Kanban fetch (`updated >= from AND updated
 * <= to`) can silently miss a ticket that genuinely completed inside the
 * window: `updated` reflects the LATEST touch, not the completion event, and
 * on a live board the team keeps working -- a ticket closed on day 2 of a
 * cycle that gets a comment or an unrelated edit weeks later has its
 * `updated` pushed past the window on every subsequent re-sync, even though
 * nothing about its actual completion changed. Confirmed against LS's live
 * Jira: `status changed to (...) DURING (...)` on the agile board endpoint
 * returns the tickets directly, matching an independent full-changelog scan
 * exactly, with no dependency on `updated` or `resolutiondate` (the latter is
 * not set at all by every terminal status in every workflow). This runs as an
 * ADDITIONAL supplement alongside the primary fetch -- same merge-by-key
 * pattern as the existing "bugs created in window" supplement below -- not a
 * replacement, since the primary fetch still supplies non-completion facts
 * (blocked/QA/reopen lanes) for tickets that were merely active in the
 * window. The DURING predicate needs at least two distinct dates; a
 * single-day cycle is handled by the caller widening by a day if needed.
 */
export function buildStatusChangedDuringJql(doneStatuses: Set<string>, fromDate: string, toDate: string): string {
  const statusList = Array.from(doneStatuses)
    .map(s => `"${s.replace(/"/g, '\\"')}"`)
    .join(', ');
  return `status changed to (${statusList}) DURING ("${fromDate}", "${toDate}") ORDER BY created ASC`;
}

/**
 * Same `updated`-drift problem as buildStatusChangedDuringJql, but for a
 * ticket that stayed OPEN and was simply touched again later -- not just the
 * completion case. The primary `updated`-window fetch misses any ticket whose
 * most recent edit happened after this window closed, even if it had real,
 * genuine status or assignee activity DURING the window. Without this, a
 * resync of an old Kanban cycle systematically loses visibility into every
 * ticket that kept being worked after that week -- i.e. almost everything
 * that was still open, undercounting real carried/spillover work the older a
 * cycle gets (confirmed against LS: Aug 10-14 dropped from 31 to 4
 * not-completed facts on resync, purely from this gap). `field` is any Jira
 * field JQL's CHANGED operator supports without needing target values --
 * 'status' or 'assignee' here.
 */
export function buildFieldChangedDuringJql(field: 'status' | 'assignee', fromDate: string, toDate: string): string {
  return `${field} changed DURING ("${fromDate}", "${toDate}") ORDER BY created ASC`;
}

// Collapses a Jira label or field value to a comparable form: lowercased with every
// non-alphanumeric separator stripped. 'Bad-Data', 'bad_data', 'Bad Data' and
// 'BadData' all become 'baddata'. QA spells these inconsistently, and Jira labels
// cannot contain spaces, so we normalise defensively on both sides.
function normaliseTag(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Labels the team applies on a parent ticket after dev analysis to mark reopen
// events as not genuine. Each distinct matching label present on a parent subtracts
// one reopen event from that ticket's count (and surfaces it in the Invalid Bugs
// chart). Stored NORMALISED and matched by EQUALITY (not prefix), so spelling
// variants like 'BadData' or 'Invalid_Reopen' do exclude, while a longer label that
// merely starts with one of these — notably 'Scope-Change-Approved' — does NOT.
const REOPEN_EXCLUSION_LABELS = new Set<string>(['invalidreopen', 'baddata', 'scopechange']);

// In addition to the labels above, any "invalid bug" variant matches by PREFIX:
// invalid-bug, invalidbug, invalid_bug, InvalidBugs, invalid-bug-config, etc.
export function isReopenExclusionLabel(label: string): boolean {
  const norm = normaliseTag(label);
  if (REOPEN_EXCLUSION_LABELS.has(norm)) return true;
  return norm.startsWith('invalidbug');
}

// Jira "Root Cause" select field. A value fuzzy-matching "Invalid Bug", "Bad Data" or
// "Incomplete Requirement" (or a fuzzy invalid-bug label) marks a ticket as an invalid
// bug — QA raised it but it wasn't a real defect the dev should be charged with.
const ROOT_CAUSE_FIELD = 'customfield_10414';
// Root Cause stems, matched by PREFIX on the normalised value, so trailing detail
// ('Invalid Bug - Config', 'Incomplete Requirements') still matches.
const INVALID_ROOT_CAUSE_STEMS = ['invalidbug', 'baddata', 'incompleterequirement'];
function isInvalidBugLabel(label: string): boolean {
  return normaliseTag(label).startsWith('invalidbug');
}
// True when the ticket is an "invalid bug": Root Cause fuzzy-matches one of the stems
// above (case-insensitive, punctuation-insensitive) OR any label fuzzy-matches
// invalid-bug. `fields` is the raw Jira issue fields; labels are already-lowercased.
// Note this does NOT feed reopen exclusion — that stays labels-only by design.
export function detectInvalidBug(
  fields: any,
  lowerLabels: string[]
): { rootCause: string | null; invalidBug: boolean } {
  const rootCause = (fields?.[ROOT_CAUSE_FIELD]?.value ?? null) as string | null;
  const rc = typeof rootCause === 'string' ? normaliseTag(rootCause) : '';
  const byRootCause = rc !== '' && INVALID_ROOT_CAUSE_STEMS.some(stem => rc.startsWith(stem));
  const byLabel = lowerLabels.some(isInvalidBugLabel);
  return { rootCause, invalidBug: byRootCause || byLabel };
}

// A bug is a production escape when its Environment field is Prod/Production, a
// label flags it as a prod bug, or (fallback) its summary mentions production.
// Mirrors the prod detection in reportService (no exported helper exists to import).
const PROD_TITLE_REGEX = /\bprod(uction)?\b/i;
function isProdBugLabel(label: string): boolean {
  const n = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return n === 'prod' || n === 'production' || n.startsWith('prodbug') || n.startsWith('productionbug');
}
function classifyProdBug(fields: any, lowerLabels: string[], envFieldId: string): boolean {
  const envField = fields?.[envFieldId];
  if (envField) {
    if (Array.isArray(envField)) {
      if (envField.some((v: any) => v && (v.value === 'Production' || v.value === 'Prod'))) return true;
    } else if (envField.value === 'Production' || envField.value === 'Prod') {
      return true;
    }
  }
  if (lowerLabels.some(isProdBugLabel)) return true;
  return PROD_TITLE_REGEX.test(fields?.summary ?? '');
}

// Defect leakage for a sprint, computed from EVERY Bug/Sub-bug CREATED in the
// sprint's date window project-wide (regardless of which sprint/backlog the ticket
// sits in) — so a prod bug logged in-window but parked elsewhere still counts.
// Returns undefined on Jira failure so the caller can persist without it.
export async function computeWindowLeakage(
  jira: JiraService,
  jiraName: string,
  startDate: string,
  endDate: string,
  envFieldId?: string
): Promise<{ bugsRaised: number; prodBugsEscaped: number; leakageRatePct: number; prodBugKeys: string[] } | undefined> {
  try {
    const envId = envFieldId ?? (await resolveEnvironmentFieldId(jira));
    const jql =
      `project = "${jiraName}" ` +
      `AND issuetype in (Bug, "Sub-bug") ` +
      `AND created >= "${startDate}" AND created <= "${endDate} 23:59" ` +
      `ORDER BY created ASC`;
    const issues = await jira.getAllIssuesFromJql(jql);
    const prodBugKeys: string[] = [];
    const facts: QualityFact[] = issues.map((iss: any) => {
      const f = iss.fields ?? {};
      const lowerLabels = ((f.labels ?? []) as string[]).map(l => l.toLowerCase());
      const isProd = classifyProdBug(f, lowerLabels, envId);
      const invalidBug = detectInvalidBug(f, lowerLabels).invalidBug;
      if (isProd && !invalidBug) prodBugKeys.push(iss.key);
      return {
        storyPoints: null,
        issueType: f.issuetype?.name ?? null,
        isProductionBug: isProd,
        wasReopened: false,
        wasPunted: false,
        invalidBug,
        jiraCreatedAt: f.created ?? null,
      };
    });
    // JQL already restricts to the window, so no window arg needed.
    return { ...computeLeakageFromFacts(facts), prodBugKeys };
  } catch (err: any) {
    logger.warn(
      `Window-leakage compute failed for ${jiraName} ${startDate}..${endDate}: ${err.message}`,
      'PerformanceSyncService'
    );
    return undefined;
  }
}

// ─── Scorecard ticket-list shapes ─────────────────────────────────────────────

export interface ScorecardTicket {
  jiraKey: string;
  summary: string;
  issueType: string;
  assigneeName: string | null;
  assigneeJiraId: string | null;
  storyPoints: number;
  isV2: boolean;
}

export function isSubBugIssueType(issueType: string): boolean {
  const t = issueType.toLowerCase();
  return t.includes('bug') && t !== 'bug';
}

function factToScorecardTicket(f: any, v2JiraIds: Set<string>): ScorecardTicket {
  return {
    jiraKey: f.jiraKey,
    summary: f.summary ?? '',
    issueType: f.issueType ?? '',
    assigneeName: f.assigneeName ?? null,
    assigneeJiraId: f.assigneeJiraId ?? null,
    storyPoints: Number(f.storyPoints ?? 0),
    isV2: v2JiraIds.has(f.assigneeJiraId ?? ''),
  };
}

const BUG_PRIORITY_WEIGHTS: Record<string, number> = {
  critical: 3,
  high: 2,
  medium: 1.5,
  low: 1,
};

// ─── Changelog helpers ────────────────────────────────────────────────────────

interface StatusChange {
  created: Date;
  fromString: string;
  toString: string;
  authorAccountId?: string;
  authorName?: string;
}

function extractStatusChanges(issue: any): StatusChange[] {
  const histories: any[] = issue.changelog?.histories ?? [];
  const changes: StatusChange[] = [];
  for (const h of histories) {
    for (const item of h.items ?? []) {
      if (item.field === 'status') {
        changes.push({
          created: new Date(h.created),
          fromString: item.fromString ?? '',
          toString: item.toString ?? '',
          authorAccountId: h.author?.accountId,
          authorName: h.author?.displayName,
        });
      }
    }
  }
  return changes.sort((a, b) => a.created.getTime() - b.created.getTime());
}

/**
 * Timestamped assignee-change events from the changelog -- same shape/pattern as
 * extractStatusChanges, kept as a SEPARATE array rather than merged into it.
 * statusChanges is relied on by computeCycleTimeHours/computeTimeInQaHours/
 * findQaTester/wasMovedBackToDev/wasUatRejected, all of which assume it means
 * status transitions only; mixing assignee events into it would corrupt every
 * one of them silently.
 *
 * Used by buildKanbanFacts' inclusion filter to recognise "newly added to the
 * board and assigned to someone" as real in-window activity, distinct from a
 * status/lane move.
 */
function extractAssigneeChanges(issue: any): StatusChange[] {
  const histories: any[] = issue.changelog?.histories ?? [];
  const changes: StatusChange[] = [];
  for (const h of histories) {
    for (const item of h.items ?? []) {
      if (item.field === 'assignee') {
        changes.push({
          created: new Date(h.created),
          fromString: item.fromString ?? '',
          toString: item.toString ?? '',
          authorAccountId: h.author?.accountId,
          authorName: h.author?.displayName,
        });
      }
    }
  }
  return changes.sort((a, b) => a.created.getTime() - b.created.getTime());
}

/**
 * Does a Kanban ticket belong in this window's facts? Exported and pure so the
 * decision is directly testable without mocking Jira -- this is the exact rule
 * that decides whether a ticket is "genuinely active in this window" versus a
 * stale ticket incidentally touched by something unrelated (an automation
 * adding a label, a passing comment).
 *
 * A ticket belongs if it completed in-window, or is a bug created in-window
 * (defect-density numerator), or had a real status/lane move in-window, or was
 * newly assigned in-window ("added to the board and assigned to someone").
 * Deliberately does NOT look at the ticket's current status category -- a
 * ticket already sitting in a done-ish status has no bearing on whether
 * anything relevant happened during THIS window. See LS-1745: created months
 * earlier, already Done, no status/assignee change in the window at all --
 * only a label-automation touch bumped `updated` -- and it was wrongly
 * admitted as a phantom "still open" ticket before this rule existed.
 *
 * One in-window signal is explicitly NOT enough: movement purely BETWEEN
 * statuses that were already done (`isPriorPeriodCompletion`). That is the
 * release tail of work finished in an earlier cycle, not this cycle's work.
 * See LS-2933, Aug 2026: reached Pending Deployment on Aug 12 (correctly
 * counted done in the Aug 10-14 cycle), then Pending Deployment -> Closed on
 * Aug 21 -- which re-admitted it to Aug 17-21 as a "not done" ticket and
 * re-inflated that cycle's carried/planned SP.
 *
 * ORDER IS LOAD-BEARING: the `isBugType && createdInWindow` clause must stay
 * ABOVE the prior-period-completion rule. It is the only reason a bug with no
 * in-window status change survives at all, and it feeds the defect-density /
 * leakage numerator and bugsRaisedCount. Demoting it would silently drop bugs
 * from those metrics.
 */
export function shouldIncludeKanbanTicket(params: {
  wasCompletedInPeriod: boolean;
  isBugType: boolean;
  createdInWindow: boolean;
  hasStatusChangeInPeriod: boolean;
  hasAssigneeChangeInPeriod: boolean;
  isPriorPeriodCompletion?: boolean;
}): boolean {
  if (params.wasCompletedInPeriod) return true;
  if (params.isBugType && params.createdInWindow) return true;
  if (params.isPriorPeriodCompletion) return false;
  return params.hasStatusChangeInPeriod || params.hasAssigneeChangeInPeriod;
}

/**
 * Compute cumulative hours across all "In Progress → QA" segments within the window.
 * Bounded to [windowStart, windowEnd] to exclude pre-sprint history.
 */
function computeCycleTimeHours(
  statusChanges: StatusChange[],
  inProgressStatuses: Set<string>,
  qaStatuses: Set<string>,
  windowStart: Date,
  windowEnd: Date
): number | null {
  const changes = statusChanges.filter(c => c.created >= windowStart && c.created <= windowEnd);
  let startTime: Date | null = null;
  let totalMs = 0;
  for (const c of changes) {
    if (inProgressStatuses.has(c.toString.toLowerCase())) {
      if (!startTime) startTime = c.created;
    }
    if (qaStatuses.has(c.toString.toLowerCase()) && startTime) {
      totalMs += c.created.getTime() - startTime.getTime();
      startTime = null;
    }
  }
  return totalMs > 0 ? totalMs / 3_600_000 : null;
}

/**
 * Compute total hours a ticket spent in QA statuses within the window.
 * Only starts the clock when entering QA from a non-QA status.
 * Captures unclosed QA period (ticket still in QA at windowEnd).
 */
function computeTimeInQaHours(
  statusChanges: StatusChange[],
  qaStatuses: Set<string>,
  windowStart: Date,
  windowEnd: Date
): number | null {
  const changes = statusChanges.filter(c => c.created >= windowStart && c.created <= windowEnd);
  let qaStart: Date | null = null;
  let totalMs = 0;
  for (const c of changes) {
    const toStatus = c.toString.toLowerCase();
    const fromStatus = c.fromString.toLowerCase();
    if (qaStatuses.has(toStatus) && !qaStatuses.has(fromStatus)) {
      // Entering QA from a non-QA status — start the clock
      qaStart = c.created;
    } else if (!qaStatuses.has(toStatus) && qaStart !== null) {
      // Leaving QA — accumulate elapsed time
      totalMs += c.created.getTime() - qaStart.getTime();
      qaStart = null;
    }
  }
  // Ticket still in QA at period end
  if (qaStart !== null) {
    totalMs += windowEnd.getTime() - qaStart.getTime();
  }
  return totalMs > 0 ? totalMs / 3_600_000 : null;
}

/**
 * Find the person who last transitioned the ticket from a QA status → Done/UAT.
 *
 * When `windowStart`/`windowEnd` are supplied, only transitions inside that
 * window are considered -- same bounding `computeCycleTimeHours` and
 * `computeTimeInQaHours` already apply. Without it the whole changelog is
 * scanned, so a ticket dragged into a later cycle re-credits the QA who tested
 * it weeks earlier: LS-2933 credited the same tester in the Aug 3, Aug 10 AND
 * Aug 17 cycles, inflating ticketsTestedCount / clearedSP each time.
 *
 * Bounded at the Kanban call site only. The sprint call site deliberately still
 * calls this unbounded -- the same defect exists there, but bounding it would
 * shift QA numbers for every non-Kanban project, which is a separate change.
 */
export function findQaTester(
  statusChanges: StatusChange[],
  qaStatuses: Set<string>,
  doneOrUatStatuses: Set<string>,
  windowStart?: Date,
  windowEnd?: Date
): { id: string | null; name: string | null } {
  const { id, name } = findQaClearing(statusChanges, qaStatuses, doneOrUatStatuses, windowStart, windowEnd);
  return { id, name };
}

/**
 * The sign-off event: the LAST QA → Done/UAT transition, with WHO did it and
 * WHEN. `at` is null when no such transition falls in range.
 *
 * The timestamp is what makes reopen attribution possible. A UAT reopen is
 * evidence about a sign-off decision, so it has to be charged to whoever made
 * that decision and to the cycle they made it in -- not to whichever cycle the
 * reopen happens to land in. On a Kanban board UAT has no deadline, so the tail
 * routinely runs past the cycle boundary; charging the reopen where it lands
 * would leave most of them attached to a cycle where the QA holds no credit, so
 * they would be charged to nobody and Kanban quality would flatten to a
 * meaningless 100%.
 */
export function findQaClearing(
  statusChanges: StatusChange[],
  qaStatuses: Set<string>,
  doneOrUatStatuses: Set<string>,
  windowStart?: Date,
  windowEnd?: Date
): { id: string | null; name: string | null; at: Date | null } {
  let last: { id: string | null; name: string | null; at: Date | null } = { id: null, name: null, at: null };
  for (const c of statusChanges) {
    if (windowStart && c.created < windowStart) continue;
    if (windowEnd && c.created > windowEnd) continue;
    if (qaStatuses.has(c.fromString.toLowerCase()) && doneOrUatStatuses.has(c.toString.toLowerCase())) {
      last = { id: c.authorAccountId ?? null, name: c.authorName ?? null, at: c.created };
    }
  }
  return last;
}

/**
 * Was the sign-off made at `clearedAt` subsequently rejected in UAT?
 *
 * Walks the changelog FORWARD from the clearing, with no window bound -- that is
 * the point: the reopen may happen cycles later and must still be charged back
 * to the cycle the ticket was cleared in.
 *
 *   - first UAT -> (QA | In Progress)  => true, that sign-off was wrong
 *   - a further QA -> Done/UAT clearing reached first => false; someone re-cleared
 *     the ticket and owns whatever follows, so the earlier clearer is off the hook
 *   - nothing further => false
 *
 * Consequence worth knowing: a cycle's QA quality stays provisional until its UAT
 * tail resolves, so re-syncing an older cycle can pick up a later reopen and
 * lower its rating.
 */
export function wasUatRejectedAfterClearing(
  statusChanges: StatusChange[],
  uatStatuses: Set<string>,
  qaStatuses: Set<string>,
  inProgressStatuses: Set<string>,
  doneOrUatStatuses: Set<string>,
  clearedAt: Date
): boolean {
  for (const c of statusChanges) {
    if (c.created <= clearedAt) continue;
    const from = c.fromString.toLowerCase();
    const to = c.toString.toLowerCase();
    if (uatStatuses.has(from) && (qaStatuses.has(to) || inProgressStatuses.has(to))) return true;
    // Re-cleared by someone else before any rejection — responsibility passes on.
    if (qaStatuses.has(from) && doneOrUatStatuses.has(to)) return false;
  }
  return false;
}

/**
 * True if the ticket regressed from a review state back to dev within the window.
 *
 * Sequence-aware: walking the chronological status stream, entering a review lane
 * (QA / UAT / Done-like) ARMS the detector; landing in a dev/in-progress lane
 * (including the literal "Reopened" status) while armed is a REOPEN. Every other
 * status (Backlog, Blocked, Dev Complete, On Hold, ...) is TRANSPARENT — it
 * neither arms nor disarms — so a rejection routed
 * Testing -> Blocked -> Reopened -> In Progress is still detected. Re-entering a
 * review lane re-arms, so a normal forward review -> dev -> review flow is judged
 * per cycle.
 *
 * Bounded to [windowStart, windowEnd] so a regression that physically happened
 * in another sprint isn't credited here. The first hop's `from` seeds the armed
 * state, so a changelog that opens already in a review lane is handled.
 *
 * `statusChanges` is assumed chronologically ascending (extractStatusChanges sorts).
 */
/**
 * Derive the Jira project key from a fetched issue set (prefix of any issue key,
 * e.g. "PRO-5688" -> "PRO"), falling back to the internal project code.
 */
export function deriveJiraProjectKey(issues: any[], project: { code?: string }): string {
  const sampleKey = (issues ?? []).find(i => typeof i?.key === 'string')?.key as string | undefined;
  return (sampleKey?.split('-')[0] || project?.code || '').trim();
}

/**
 * True iff the project's Jira workflow contains one of the statuses in its
 * configured "reopened" lane (e.g. "Reopened" / "Issues Found"). When true,
 * reopen detection is status-based (a reopen requires landing in that lane)
 * rather than firing on any review -> dev regression. Best-effort: any Jira
 * failure falls back to false (flow inference), never throws.
 */
export async function projectUsesReopenedStatus(
  jira: JiraService,
  projectKey: string,
  laneConfig: { reopened?: string[] }
): Promise<boolean> {
  const reopenedLane = (laneConfig.reopened ?? []).map(s => s.toLowerCase());
  if (reopenedLane.length === 0 || !projectKey) return false;
  try {
    const workflowStatuses = await jira.getProjectStatuses(projectKey);
    return reopenedLane.some(s => workflowStatuses.has(s));
  } catch (e: any) {
    logger.warn(
      `Could not fetch workflow statuses for ${projectKey}; using flow-based reopen detection: ${e.message}`,
      'PerformanceSyncService'
    );
    return false;
  }
}

export function wasMovedBackToDev(
  statusChanges: StatusChange[],
  inProgressStatuses: Set<string>,
  qaStatuses: Set<string>,
  doneOrUatStatuses: Set<string>,
  windowStart: Date,
  windowEnd: Date
): boolean {
  const isReview = (s: string) => qaStatuses.has(s) || doneOrUatStatuses.has(s);
  const isDev = (s: string) => inProgressStatuses.has(s);

  let armed = false;
  for (const c of statusChanges) {
    if (c.created < windowStart || c.created > windowEnd) continue;
    const from = c.fromString.toLowerCase();
    const to = c.toString.toLowerCase();
    // Arm on the `from` side too: the ticket was in review immediately before
    // this hop. This covers tickets already sitting in QA/UAT/Done at the start
    // of the window (carried over from a prior sprint) whose only in-window
    // event is the kick-back to dev — there is no in-window "-> review" hop to
    // arm on, so we rely on the kick-back hop's own `from`.
    if (isReview(from)) armed = true;
    if (isDev(to) && armed) return true; // regressed review -> dev (through any intermediate)
    if (isReview(to)) armed = true; // (re-)entered review for later intermediates
  }
  return false;
}

/**
 * True if the ticket moved FROM a UAT status back TO a QA or In-Progress status,
 * anywhere in its history.
 *
 * SPRINT PATH ONLY. The Kanban path uses wasUatRejectedAfterClearing, which
 * anchors the rejection to the sign-off it disproves. Sprint keeps the lifetime
 * scan deliberately: a sprint has a UAT deadline and spillover is short-lived,
 * so the ticket's history and the sprint largely coincide.
 */
export function wasUatRejected(
  statusChanges: StatusChange[],
  uatStatuses: Set<string>,
  qaStatuses: Set<string>,
  inProgressStatuses: Set<string>
): boolean {
  for (const c of statusChanges) {
    const from = c.fromString.toLowerCase();
    const to = c.toString.toLowerCase();
    if (uatStatuses.has(from) && (qaStatuses.has(to) || inProgressStatuses.has(to))) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the ISO timestamp of the earliest post-start Sprint-add event that
 * represents real scope creep, or null when the addition is carry-in from the
 * team's immediately-preceding sprint, pre-start, or absent.
 *
 * Carry-in (from list contains a prev sprint id) is the standard agile pattern
 * of rolling unfinished work forward at kickoff and is not creep. Real creep
 * is a post-start Sprint addition where the from list is empty or contains
 * only foreign sprint ids.
 *
 * Callers wanting a boolean check use wasScopeChange below; callers needing
 * the addedAt timestamp for display (e.g. teamPerformanceService) use this
 * directly.
 */
export function findScopeAddedAt(
  histories: any[],
  sprintId: number,
  sprintStart: Date,
  prevSprintIds: Set<string> = new Set()
): string | null {
  const sprintIdStr = String(sprintId);
  const sorted: any[] = (histories ?? [])
    .slice()
    .sort((a: any, b: any) => new Date(a.created).getTime() - new Date(b.created).getTime());
  for (const h of sorted) {
    const changeDate = new Date(h.created);
    if (changeDate <= sprintStart) continue;
    for (const item of h.items ?? []) {
      if (item.field !== 'Sprint') continue;
      const toIds = (item.to ?? '')
        .toString()
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      const fromIds = (item.from ?? '')
        .toString()
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (!toIds.includes(sprintIdStr) || fromIds.includes(sprintIdStr)) continue;
      const carriedFromPrev = fromIds.some((id: string) => prevSprintIds.has(id));
      if (carriedFromPrev) return null;
      return h.created;
    }
  }
  return null;
}

export function wasScopeChange(
  issue: any,
  sprintId: number,
  sprintStart: Date,
  prevSprintIds: Set<string> = new Set()
): boolean {
  return findScopeAddedAt(issue?.changelog?.histories ?? [], sprintId, sprintStart, prevSprintIds) !== null;
}

/**
 * Returns the set of sprint IDs that were in an issue's Sprint field at time T,
 * reconstructed by walking the changelog. Used to determine "was this ticket
 * in sprint X at sprint-start" for committed-at-start calculation.
 *
 * Result = the `to` value of the latest Sprint-field changelog event with
 * created <= atTime. If atTime is before the earliest event, returns `from`
 * of that earliest event (the pre-event state). Returns null when the issue
 * has no Sprint-field events at all — the caller should fall back to current
 * state (a ticket with no Sprint history that's currently in the sprint has
 * been in it since creation).
 */
export function getSprintFieldIdsAt(histories: any[], atTime: Date): Set<string> | null {
  const sprintEvents = (histories ?? [])
    .flatMap((h: any) =>
      (h.items ?? [])
        .filter((it: any) => it.field === 'Sprint')
        .map((it: any) => ({
          created: new Date(h.created),
          from: String(it.from ?? ''),
          to: String(it.to ?? ''),
        }))
    )
    .sort((a, b) => a.created.getTime() - b.created.getTime());

  if (sprintEvents.length === 0) return null;

  const parse = (s: string): Set<string> =>
    new Set(
      s
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
    );

  if (atTime < sprintEvents[0].created) {
    return parse(sprintEvents[0].from);
  }
  let latest = sprintEvents[0];
  for (const e of sprintEvents) {
    if (e.created <= atTime) latest = e;
    else break;
  }
  return parse(latest.to);
}

/**
 * Returns the Story Points value at time T, reconstructed by walking the
 * changelog. Falls back to currentSp when the field has no events (i.e. set
 * at creation and never changed). Used in committed-at-start calculation so
 * we capture the SP value as it was at sprint planning, not whatever it is now.
 */
export function getStoryPointsAt(histories: any[], atTime: Date, currentSp: number): number {
  // Jira changelog encodes Story Points values in `fromString`/`toString`
  // (the numeric `from`/`to` are null for this custom field). Parse the
  // string representation. Empty/null strings are treated as 0.
  const parseSp = (v: any): number | null => {
    if (v == null) return null;
    const s = String(v).trim();
    if (s === '') return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  const spEvents = (histories ?? [])
    .flatMap((h: any) =>
      (h.items ?? [])
        .filter((it: any) => {
          const fname = String(it.field ?? '');
          return fname === 'Story Points' || /story\s*points/i.test(fname);
        })
        .map((it: any) => ({
          created: new Date(h.created),
          from: parseSp(it.fromString ?? it.from),
          to: parseSp(it.toString ?? it.to),
        }))
    )
    .sort((a, b) => a.created.getTime() - b.created.getTime());

  if (spEvents.length === 0) return currentSp;

  if (atTime < spEvents[0].created) {
    return spEvents[0].from ?? 0;
  }
  let latest = spEvents[0];
  for (const e of spEvents) {
    if (e.created <= atTime) latest = e;
    else break;
  }
  return latest.to ?? 0;
}

// ─── Ticket-fact builder (pure; exported for testing) ─────────────────────────

/** A ticket's developer, as resolved from a project's configured owner field(s). */
export interface ResolvedDeveloper {
  accountId: string | null;
  displayName: string | null;
}

/**
 * Resolve which Jira field(s) name the "developer" for a project (ownerFields.developer
 * — see laneDefaults.ts) and return a synchronous accessor that reads it off a ticket's
 * `fields` object. Used by both the sprint-sync (buildTicketFactsFromJiraData) and
 * Kanban-sync (buildKanbanFacts) fact builders so PerfTicketFact.assigneeJiraId reflects
 * the same field reportService.ts's daily report already resolves correctly, instead of
 * always reading Jira's built-in `assignee` — which on Thrive is a Dev->QA->Dev work-queue
 * pointer, not the ticket's actual developer (see laneDefaults.ts's OwnerFieldsConfig doc).
 *
 * Declared, not inferred: tries each configured field name IN ORDER and returns the first
 * one with a value. A ticket whose configured Developer field is blank is left unassigned
 * here rather than silently falling back to `assignee` (unless 'assignee' is itself one of
 * the configured names) — same "data-hygiene, not silent substitution" rule getOwnerFields
 * documents.
 */
export async function buildDeveloperResolver(
  jira: JiraService,
  project: { jiraLaneConfig?: any }
): Promise<(fields: any) => ResolvedDeveloper> {
  const ownerFields = getOwnerFields(project as any);
  const sources: Array<{ kind: 'assignee' } | { kind: 'custom'; ids: string[] }> = [];
  for (const name of ownerFields.developer) {
    if (!name) continue;
    if (name.toLowerCase() === BUILTIN_ASSIGNEE) {
      sources.push({ kind: 'assignee' });
    } else {
      const ids = await jira.getFieldIdsByName(name);
      if (ids.length > 0) sources.push({ kind: 'custom', ids });
    }
  }

  return (fields: any): ResolvedDeveloper => {
    for (const source of sources) {
      if (source.kind === 'assignee') {
        if (fields.assignee?.accountId) {
          return { accountId: fields.assignee.accountId, displayName: fields.assignee.displayName ?? null };
        }
        continue;
      }
      for (const id of source.ids) {
        const value = fields[id];
        if (value?.accountId) {
          return { accountId: value.accountId, displayName: value.displayName ?? null };
        }
      }
    }
    return { accountId: null, displayName: null };
  };
}

/**
 * Resolve display names for a set of Jira accountIds via the per-user API.
 * Bypasses Jira Cloud's bulk-API name redaction — the bulk search endpoint
 * (POST /rest/api/3/search/jql) returns "User <last5>" placeholders since
 * the May 2026 privacy rollout, but the per-user endpoint still returns
 * real names. Falls back to the accountId itself when the lookup fails.
 */
export async function buildAccountIdMap(
  jira: JiraService,
  accountIds: Iterable<string | null | undefined>
): Promise<Map<string, { email: string; displayName: string }>> {
  const map = new Map<string, { email: string; displayName: string }>();
  const unique = new Set<string>();
  for (const id of accountIds) {
    if (id) unique.add(id);
  }
  await Promise.all(
    Array.from(unique).map(async accountId => {
      try {
        const userResp = await (jira as any).client.get(`/rest/api/3/user?accountId=${accountId}`);
        const email: string = userResp.data?.emailAddress ?? accountId;
        const displayName: string = userResp.data?.displayName ?? accountId;
        map.set(accountId, { email: email.toLowerCase(), displayName });
      } catch {
        map.set(accountId, { email: accountId.toLowerCase(), displayName: accountId });
      }
    })
  );
  return map;
}

/**
 * In-place: replace anonymized "User <last5>" displayNames on a set of facts
 * with the resolved real names from accountIdMap. Used by both sprint and
 * kanban sync paths after fact-building, before bulkCreate.
 */
function enrichFactNamesFromAccountIdMap(
  facts: Partial<PerfTicketFact>[],
  accountIdMap: Map<string, { email: string; displayName: string }>
): void {
  const resolve = (jiraId: string | null | undefined): string | null => {
    if (!jiraId) return null;
    const entry = accountIdMap.get(jiraId);
    return entry?.displayName ?? null;
  };
  for (const f of facts) {
    const a = resolve((f as any).assigneeJiraId);
    if (a) (f as any).assigneeName = a;
    const r = resolve((f as any).reporterJiraId);
    if (r) (f as any).reporterName = r;
    const q = resolve((f as any).qaTesterJiraId);
    if (q) (f as any).qaTesterName = q;
  }
}

export interface BuildTicketFactsInput {
  issues: any[];
  ghReport: { completedIssues: any[]; notCompletedIssues: any[]; puntedIssues: any[] };
  laneConfig: { in_progress?: string[]; qa?: string[]; uat?: string[]; reopened?: string[] };
  spFieldId: string;
  prodBugKeys: Set<string>;
  sprintStartTs: Date;
  sprintEndTs: Date;
  jiraSprintId: number;
  syncId: number;
  projectId: number;
  prevSprintIds?: Set<string>;
  // Estimation config — when omitted, behaves as a story-points project (default).
  estimation?: EstimationConfig;
  hoursFieldId?: string | null;
  // When true, a reopen is only recognized when the ticket lands in the
  // configured "reopened" lane (e.g. "Reopened"/"Issues Found") — NOT on any
  // regression into a plain in-progress lane. Set for projects whose Jira
  // workflow has a dedicated Reopened status (see computeReopenStatusOnly).
  reopenStatusOnly?: boolean;
  // Per-project Done-status override (same field/mechanism already used by the
  // Kanban path via resolveEffectiveDoneStatuses). When set, it REPLACES Jira's
  // generic statusCategory/EFFECTIVE_DONE detection for this project rather than
  // supplementing it -- see the isDoneByStatus computation below for why.
  kanbanDoneStatuses?: string[] | null;
  // Resolves a ticket's developer per the project's configured owner field(s)
  // (see buildDeveloperResolver). Omitted only by tests that don't care —
  // falls back to raw fields.assignee, the pre-ownerFields behavior.
  resolveDeveloper?: (fields: any) => ResolvedDeveloper;
}

export function buildTicketFactsFromJiraData(input: BuildTicketFactsInput): Partial<PerfTicketFact>[] {
  const {
    issues,
    ghReport,
    laneConfig,
    spFieldId,
    prodBugKeys,
    sprintStartTs,
    sprintEndTs,
    jiraSprintId,
    syncId,
    projectId,
    prevSprintIds = new Set<string>(),
    estimation,
    hoursFieldId = null,
    reopenStatusOnly = false,
    kanbanDoneStatuses = null,
    resolveDeveloper = (fields: any) => ({
      accountId: fields.assignee?.accountId ?? null,
      displayName: fields.assignee?.displayName ?? null,
    }),
  } = input;
  // Same resolver already used by the Kanban path (buildKanbanFacts). Falls back
  // to the hardcoded EFFECTIVE_DONE when this project hasn't configured an
  // override -- so every project's behavior is unchanged until it opts in.
  const effectiveDone = resolveEffectiveDoneStatuses(kanbanDoneStatuses);
  const hasDoneOverride = !!(kanbanDoneStatuses && kanbanDoneStatuses.length > 0);
  const resolvedEstimate: ResolvedEstimateFields = { spFieldId, hoursFieldId };

  const inProgressStatuses = new Set<string>(
    [...(laneConfig.in_progress ?? []), 'In Progress', 'In Development', 'Reopened'].map(s => s.toLowerCase())
  );
  // Reopen-landing = the lanes whose entry (while armed) counts as a reopen.
  //  - reopenStatusOnly (project has a dedicated Reopened status): ONLY the
  //    configured "reopened" lane (e.g. "Reopened"/"Issues Found"), so a
  //    developer's own Testing -> In Progress bounce is NOT a reopen — only a
  //    QA kick-back into the Reopened status is.
  //  - otherwise (flow inference): in-progress lanes PLUS the reopened lane, so
  //    a QA-rejected ticket dragged straight back to dev is still caught on
  //    workflows that have no explicit Reopened status.
  // Used only by wasMovedBackToDev — cycle-time / UAT-rejection logic is unaffected.
  const reopenedLaneStatuses = (laneConfig.reopened ?? []).map(s => s.toLowerCase());
  const reopenLandingStatuses = reopenStatusOnly
    ? new Set<string>(reopenedLaneStatuses)
    : new Set<string>([...inProgressStatuses, ...reopenedLaneStatuses]);
  const qaStatuses = new Set<string>(
    [...(laneConfig.qa ?? []), 'In QA', 'QA Review', 'QA Testing', 'Testing', 'In Testing', 'Ready for QA', 'QA'].map(
      s => s.toLowerCase()
    )
  );
  const uatStatuses = new Set<string>(
    [...(laneConfig.uat ?? []), 'PO REVIEW', 'UAT', 'Acceptance Testing', 'In UAT'].map(s => s.toLowerCase())
  );
  // Deliberately NOT effectiveDone here: doneOrUatStatuses feeds QA-clearing
  // detection (findQaTester) and reopen detection (wasMovedBackToDev), which ask
  // "did QA sign off" -- a different question from "is this ticket done for THIS
  // SPRINT's velocity" (which the done-status override exists to answer strictly,
  // per the board's own terminal column). On a workflow where QA signs off by
  // moving Ready to Test -> Resolved, narrowing this set to a sprint-completion
  // override that excludes "Resolved" (e.g. Ypsilon's ["Closed"]) silently zeroed
  // out QA-testing credit for anyone who doesn't also close the ticket -- confirmed
  // live: Vinayak Patil's ticketsTested dropped 18 -> 0 the moment the override
  // was set. Always use the full EFFECTIVE_DONE set here, independent of the
  // per-project override used below for isDoneByStatus.
  const doneOrUatStatuses = new Set<string>([...EFFECTIVE_DONE, ...Array.from(uatStatuses)]);

  const completedKeys = new Set<string>(ghReport.completedIssues.map((i: any) => i.key));

  // Pass 1a: count sub-bug children per parent — both the RAW count (every
  // sub-bug logged, valid or not) and the VALID count (excluding ones ruled
  // invalid via the same detectInvalidBug check used for defect density —
  // Root Cause fuzzy-matching 'Invalid Bug'/'Bad Data'/'Incomplete
  // Requirement', or an invalid-bug label). Both maps are needed by Pass 2:
  // a parent with sub-bug evidence trusts ONLY the valid ones (so 4 invalid
  // sub-bugs = 0 reopen events, vetoing the parent's own flow/label signal —
  // see Pass 2), while a parent with zero sub-bugs falls back to its own
  // status flow unaffected.
  const rawSubBugCountByParent = new Map<string, number>();
  const validSubBugCountByParent = new Map<string, number>();
  for (const issue of issues) {
    const fields = issue.fields as any;
    const itype = (fields.issuetype?.name ?? '').toLowerCase();
    const parentKey: string | undefined = fields.parent?.key;
    if (!parentKey || !itype.includes('bug')) continue;
    rawSubBugCountByParent.set(parentKey, (rawSubBugCountByParent.get(parentKey) ?? 0) + 1);
    const labels: string[] = ((fields.labels ?? []) as string[]).map((l: string) => l.toLowerCase());
    const { invalidBug } = detectInvalidBug(fields, labels);
    if (invalidBug) continue;
    validSubBugCountByParent.set(parentKey, (validSubBugCountByParent.get(parentKey) ?? 0) + 1);
  }

  // Pass 2: extract facts for every non-subtask issue (bug subtasks allowed through).
  const facts: Partial<PerfTicketFact>[] = [];
  for (const issue of issues) {
    const fields = issue.fields as any;
    const issueType: string = fields.issuetype?.name ?? '';
    const issueTypeLower = issueType.toLowerCase();
    if ((issueTypeLower === 'sub-task' || issueTypeLower === 'subtask') && !issueTypeLower.includes('bug')) continue;

    const sp: number = extractEstimate(fields, estimation, resolvedEstimate);
    const statusChanges = extractStatusChanges(issue);

    const cycleTime = computeCycleTimeHours(statusChanges, inProgressStatuses, qaStatuses, sprintStartTs, sprintEndTs);
    const qaTime = computeTimeInQaHours(statusChanges, qaStatuses, sprintStartTs, sprintEndTs);
    const qaTester = findQaTester(statusChanges, qaStatuses, doneOrUatStatuses);

    const bugPriority = issueTypeLower.includes('bug') ? (fields.priority?.name ?? null) : null;

    const reporterAccountId: string | null = fields.reporter?.accountId ?? null;
    const reporterName: string | null = fields.reporter?.displayName ?? null;
    const developer = resolveDeveloper(fields);
    const assigneeAccountId: string | null = developer.accountId;
    const assigneeName: string | null = developer.displayName;

    // GreenHopper's completed/notCompleted split depends on the board's
    // "Done column" mapping — terminal statuses outside that column
    // (e.g. Closed when only Done is the Done column) get bucketed as
    // notCompleted even though the ticket is genuinely done. Fall back
    // to statusCategory + resolutiondate to recover those.
    // Guard: resolutiondate must be within the sprint window so we don't
    // credit tickets closed after sprint close.
    const statusCategoryKey = (fields.status?.statusCategory?.key ?? '').toLowerCase();
    const statusName = (fields.status?.name ?? '').toLowerCase();
    // When this project has configured its own Done-status list, trust it
    // exclusively -- Jira's statusCategory is a workflow-wide property that can
    // say "done" for a status (e.g. "Resolved") that this specific board treats
    // as a non-terminal column, causing tickets to be counted complete before
    // the board itself considers them so (confirmed live: Ypsilon's board has
    // "Resolved" and "closed" as separate columns; only "closed" is terminal).
    const isDoneByStatus = hasDoneOverride
      ? effectiveDone.has(statusName)
      : statusCategoryKey === 'done' || EFFECTIVE_DONE.has(statusName);
    const resolutionDate = fields.resolutiondate ? new Date(fields.resolutiondate) : null;
    const resolvedInSprintWindow = resolutionDate != null && resolutionDate <= sprintEndTs;
    const wasCompleted = completedKeys.has(issue.key) || (isDoneByStatus && resolvedInSprintWindow);

    // Reopen accounting: a ticket WITH sub-bug children trusts ONLY the
    // sub-bug evidence — its own status flow / "Reopened" label/lane is not
    // consulted at all in that case. That means if every sub-bug logged
    // against it turns out invalid, the ticket is NOT reopened even though
    // its own status genuinely moved back to dev or landed in "Reopened" —
    // the sub-bugs are the deciding evidence, and invalid evidence proves
    // nothing. Conversely, even ONE valid sub-bug is enough on its own,
    // independent of whether the flow signal also agrees.
    // A ticket with ZERO sub-bugs falls back to its own status flow
    // (wasMovedBackToDev — review regressing to dev, or landing in a
    // configured "Reopened" status), unaffected by any of the above.
    // Exclusion labels (Invalid-Reopen / Bad-Data / Scope-Change) on the
    // ticket itself subtract one event each from whichever count applies.
    const ticketLabels: string[] = ((fields.labels ?? []) as string[]).map((l: string) => l.toLowerCase());
    const excludedCount = ticketLabels.reduce((acc, l) => acc + (isReopenExclusionLabel(l) ? 1 : 0), 0);
    const rawSubBugCount = rawSubBugCountByParent.get(issue.key) ?? 0;
    const validSubBugCount = validSubBugCountByParent.get(issue.key) ?? 0;
    const flowReopen = wasMovedBackToDev(
      statusChanges,
      reopenLandingStatuses,
      qaStatuses,
      doneOrUatStatuses,
      sprintStartTs,
      sprintEndTs
    );
    const reopenEventCount = rawSubBugCount > 0 ? validSubBugCount : flowReopen ? 1 : 0;
    const netReopens = Math.max(0, reopenEventCount - excludedCount);
    const wasReopenedFinal = netReopens > 0;

    // Scope add = either (a) the ticket was MOVED into this sprint after start
    // (a Sprint-field change event — wasScopeChange), OR (b) it was CREATED
    // directly inside the sprint after start with an estimate. Case (b) is
    // invisible to the changelog detector because Jira logs field *changes*,
    // not the initial Sprint value set at creation — so a born-in-sprint
    // ticket has no Sprint event to match, yet it still expands scope beyond
    // what was committed at start. Carry-ins are created before start, so the
    // created-after-start guard excludes them.
    const createdTs = fields.created ? new Date(fields.created) : null;
    const bornInSprintAdd = !!createdTs && createdTs > sprintStartTs && Number(sp) > 0;
    const isScopeChange = wasScopeChange(issue, jiraSprintId, sprintStartTs, prevSprintIds) || bornInSprintAdd;
    const { rootCause, invalidBug } = detectInvalidBug(fields, ticketLabels);

    facts.push({
      syncId,
      projectId,
      jiraKey: issue.key,
      parentKey: (fields.parent?.key as string) ?? null,
      parentIssueType: (fields.parent?.fields?.issuetype?.name as string) ?? null,
      summary: (fields.summary ?? '').substring(0, 499),
      issueType,
      assigneeJiraId: assigneeAccountId,
      assigneeName,
      reporterJiraId: reporterAccountId,
      reporterName,
      storyPoints: sp,
      wasCompleted,
      wasReopened: wasReopenedFinal,
      invalidReopenCount: Math.min(reopenEventCount, excludedCount),
      rootCause,
      invalidBug,
      wasScopeChange: isScopeChange,
      wasUatRejected: wasUatRejected(statusChanges, uatStatuses, qaStatuses, inProgressStatuses),
      cycleTimeHours: cycleTime,
      timeInQaHours: qaTime,
      qaTesterJiraId: qaTester.id,
      qaTesterName: qaTester.name,
      bugPriority,
      isProductionBug: prodBugKeys.has(issue.key),
      jiraCreatedAt: fields.created ? new Date(fields.created) : null,
    });
  }

  // Pass 3: mark punted tickets already present; append punted-only tickets as skeletons.
  const puntedKeys = new Set(ghReport.puntedIssues.map((pi: any) => pi.key));
  const existingKeys = new Set(facts.map(f => f.jiraKey));
  for (const fact of facts) {
    if (puntedKeys.has(fact.jiraKey!)) {
      fact.wasPunted = true;
      fact.wasCompleted = false;
    }
  }
  for (const pi of ghReport.puntedIssues) {
    if (existingKeys.has(pi.key)) continue;
    facts.push({
      syncId,
      projectId,
      jiraKey: pi.key,
      summary: null,
      issueType: pi.typeName || null,
      assigneeJiraId: pi.assigneeAccountId ?? null,
      assigneeName: pi.assigneeName ?? null,
      reporterJiraId: null,
      reporterName: null,
      storyPoints: pi.storyPoints ?? 0,
      wasCompleted: false,
      wasReopened: false,
      wasScopeChange: false,
      cycleTimeHours: null,
      timeInQaHours: null,
      qaTesterJiraId: null,
      qaTesterName: null,
      bugPriority: null,
      isProductionBug: false,
      wasPunted: true,
    });
  }

  return facts;
}

/**
 * Resolve the immediately-preceding sprint's Jira id(s) for carry-in detection.
 *
 * Prefers a synced predecessor in PerfSprintSync because that represents the
 * sprint the team actively used and rolled forward from. Date-ordered Jira data
 * can include scratch / hotfix sprints that the team never actually closed work
 * out of, and picking one of those misses real carry-in events.
 *
 * Falls back to the Jira sprint list when the predecessor was never imported —
 * that path keeps detection working for projects whose earlier sprints predate
 * the perf-sync feature (e.g. WO – Wordpress sprint 4.2 whose 4.1 wasn't synced).
 */
export async function resolvePrevSprintIds(params: {
  projectId: number;
  boardId: number;
  jiraName: string | null | undefined;
  currentSprintId: number;
  currentSprintStartDate: string | null | undefined;
  currentSprintEndDate?: string | null | undefined;
  excludeSyncId?: number;
  jira: {
    findPreviousSprintForBoard: (
      boardId: number,
      currentSprintId: number,
      startDate: string,
      prefix?: string
    ) => Promise<{ id: number; name: string } | null>;
  };
}): Promise<Set<string>> {
  const {
    projectId,
    boardId,
    jiraName,
    currentSprintId,
    currentSprintStartDate,
    currentSprintEndDate,
    excludeSyncId,
    jira,
  } = params;
  const cutoffStr = (currentSprintStartDate || currentSprintEndDate || '').split('T')[0];
  if (!cutoffStr) return new Set();

  // 1. DB lookup — synced predecessor of the same project, by date.
  const where: any = {
    projectId,
    syncStatus: 'done',
    endDate: { [Op.lte]: cutoffStr },
    jiraSprintId: { [Op.ne]: null as any },
  };
  if (excludeSyncId) where.id = { [Op.ne]: excludeSyncId };
  const priorSync = await PerfSprintSync.findOne({
    where,
    order: [
      ['endDate', 'DESC'],
      ['id', 'DESC'],
    ],
    attributes: ['jiraSprintId'],
  });
  if (priorSync?.jiraSprintId) {
    return new Set([String(priorSync.jiraSprintId)]);
  }

  // 2. Jira fallback — covers projects whose predecessor was never imported.
  if (!currentSprintStartDate) return new Set();
  try {
    const prev = await jira.findPreviousSprintForBoard(
      boardId,
      currentSprintId,
      currentSprintStartDate,
      jiraName ?? undefined
    );
    return new Set(prev ? [String(prev.id)] : []);
  } catch {
    return new Set();
  }
}

// ─── Main service ─────────────────────────────────────────────────────────────

class PerformanceSyncService {
  // Per-project (Jira key) cache of "does this workflow have a Reopened status".
  // Workflow statuses are effectively static; cleared on process restart.
  private reopenStatusOnlyCache = new Map<string, boolean>();

  /**
   * Decide whether reopen detection for this project should be STATUS-BASED
   * (fire only when a ticket lands in the configured "reopened" lane) rather
   * than the default flow inference (fire on any review -> dev regression).
   *
   * A project is status-based iff its Jira workflow actually contains one of the
   * statuses in its `reopened` lane (e.g. "Reopened" / "Issues Found"). Projects
   * without such a status keep flow inference, so nothing regresses for them.
   */
  private async computeReopenStatusOnly(
    jira: JiraService,
    project: Project,
    issues: any[],
    laneConfig: { reopened?: string[] }
  ): Promise<boolean> {
    const projectKey = deriveJiraProjectKey(issues, project as any);
    if (!projectKey) return false;
    const cacheKey = projectKey.toLowerCase();
    const cached = this.reopenStatusOnlyCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const result = await projectUsesReopenedStatus(jira, projectKey, laneConfig);
    this.reopenStatusOnlyCache.set(cacheKey, result);
    return result;
  }

  /**
   * Import a completed sprint from Jira and compute member performance scores.
   * Creates / overwrites a PerfSprintSync record and all related facts + scores.
   */
  async syncSprint(projectId: number, jiraSprintId: number, triggeredByUserId?: number): Promise<PerfSprintSync> {
    const project = await Project.findByPk(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const jira = JiraService.forProject(project);

    // Fetch sprint metadata
    const sprintResp = await (jira as any).client.get(`/rest/agile/1.0/sprint/${jiraSprintId}`);
    const sprintMeta = sprintResp.data;

    // Reject sprints owned by a different board. Without this guard, Jira's
    // sprint endpoints will happily return sprints from sibling boards —
    // we'd persist them tagged with this project's id and pollute the
    // project's trend charts with another team's velocity.
    if (sprintMeta.originBoardId != null && sprintMeta.originBoardId !== project.jiraBoardId) {
      throw new Error(
        `Sprint ${jiraSprintId} ("${sprintMeta.name}") originates from board ${sprintMeta.originBoardId}, ` +
          `not project "${project.name}"'s board ${project.jiraBoardId}. Refusing to sync — this sprint belongs to a different project.`
      );
    }

    const sprintName: string = sprintMeta.name ?? `Sprint ${jiraSprintId}`;
    const startDate: string = (sprintMeta.startDate ?? '').split('T')[0];
    const endDate: string = (sprintMeta.endDate ?? sprintMeta.completeDate ?? '').split('T')[0];
    const sprintEndTs: Date = sprintMeta.completeDate
      ? new Date(sprintMeta.completeDate)
      : (() => {
          const d = new Date(sprintMeta.endDate);
          d.setHours(23, 59, 59, 999);
          return d;
        })();

    // Create / reset PerfSprintSync record
    let syncRecord = await PerfSprintSync.findOne({ where: { projectId, jiraSprintId } });
    if (syncRecord) {
      // Re-sync: delete old facts + scores
      await PerfTicketFact.destroy({ where: { syncId: syncRecord.id } });
      await PerfMemberScore.destroy({ where: { syncId: syncRecord.id } });
      await syncRecord.update({ syncStatus: 'running', errorMessage: null, syncedAt: null });
    } else {
      syncRecord = await PerfSprintSync.create({
        projectId,
        jiraSprintId,
        sprintName,
        startDate: startDate || endDate,
        endDate,
        syncType: 'sprint',
        syncStatus: 'running',
        triggeredByUserId: triggeredByUserId ?? null,
      });
    }

    try {
      // GreenHopper sprint report — authoritative done/not-done at sprint close
      const ghReport = await jira.getSprintReport(project.jiraBoardId, jiraSprintId);

      // Fetch all issues with changelog via the Agile board endpoint
      const jql = encodeURIComponent(`sprint = ${jiraSprintId}`);
      const issuesUrl = `/rest/agile/1.0/board/${project.jiraBoardId}/issue?jql=${jql}&expand=changelog`;
      const issues: any[] = await (jira as any).getAllIssuesFromUrl(issuesUrl);
      redactIssueTitles(issues, project.piiRedactionEnabled !== false);

      // Resolve estimate field(s) — story points and/or the hours custom field.
      const { spFieldId, hoursFieldId } = await resolveEstimateFields(project as any, jira);

      // Collect confirmed production bug keys from daily snapshots
      const prodBugKeys = await this.loadProdBugKeys(projectId, startDate, endDate);

      // Resolve sprint start time for scope change detection
      const sprintStartTs = sprintMeta.startDate ? new Date(sprintMeta.startDate) : new Date(0);

      // Look up the team's immediately-preceding sprint so we can tell carry-in
      // from real scope creep. DB-first (synced predecessor = the sprint the
      // team actually used) with Jira fallback for projects whose predecessor
      // was never imported.
      const prevSprintIds = await resolvePrevSprintIds({
        projectId,
        boardId: project.jiraBoardId,
        jiraName: project.jiraName,
        currentSprintId: jiraSprintId,
        currentSprintStartDate: sprintMeta.startDate ?? startDate,
        currentSprintEndDate: sprintMeta.endDate ?? sprintMeta.completeDate ?? endDate,
        excludeSyncId: syncRecord.id,
        jira,
      });

      const laneConfig = getLaneConfig(project as any);
      const reopenStatusOnly = await this.computeReopenStatusOnly(jira, project, issues, laneConfig);
      const resolveDeveloper = await buildDeveloperResolver(jira, project as any);

      const facts = buildTicketFactsFromJiraData({
        issues,
        ghReport,
        laneConfig,
        spFieldId,
        prodBugKeys,
        sprintStartTs,
        sprintEndTs,
        jiraSprintId,
        syncId: syncRecord.id,
        projectId,
        prevSprintIds,
        estimation: project as any,
        hoursFieldId,
        reopenStatusOnly,
        kanbanDoneStatuses: project.kanbanDoneStatuses,
        resolveDeveloper,
      });

      // Resolve real display names via per-user API (Jira Cloud's bulk search
      // API redacts names to "User <last5>" since May 2026). Done before
      // bulkCreate so persisted facts carry real names.
      const accountIds = new Set<string>();
      for (const f of facts) {
        if (f.assigneeJiraId) accountIds.add(f.assigneeJiraId);
        if (f.reporterJiraId) accountIds.add(f.reporterJiraId);
        if (f.qaTesterJiraId) accountIds.add(f.qaTesterJiraId);
      }
      const accountIdMap = await buildAccountIdMap(jira, accountIds);
      enrichFactNamesFromAccountIdMap(facts, accountIdMap);

      await PerfTicketFact.bulkCreate(facts as any[]);
      logger.info(
        `Synced ${facts.length} ticket facts (incl. ${ghReport.puntedIssues.length} punted) for sprint ${sprintName}`,
        'PerformanceSyncService'
      );

      // Compute member scores (punted tickets excluded from scoring by wasCompleted/wasReopened = false)
      await this.computeAndSaveScores(syncRecord, facts as any[], projectId, jira, accountIdMap);

      // Compute committed_sp: walk Sprint-field changelog per ticket to determine
      // which tickets were in this sprint at sprintStartTs, then walk Story-Points
      // changelog to capture their SP at that moment. Result = SM's "Committed at Start".
      // Net Scope Change = finalScope - committedSp.
      const changelogByKey = new Map<string, any[]>();
      for (const issue of issues) {
        changelogByKey.set(issue.key, issue.changelog?.histories ?? []);
      }
      const puntedKeysNeedingFetch: string[] = ghReport.puntedIssues
        .map((pi: any) => pi.key as string)
        .filter((k: string) => !changelogByKey.has(k));
      if (puntedKeysNeedingFetch.length > 0) {
        try {
          const fetched = await jira.getChangelogsForKeys(puntedKeysNeedingFetch);
          for (const [k, hist] of fetched.entries()) changelogByKey.set(k, hist);
        } catch (e: any) {
          logger.warn(
            `Punted-ticket changelog fetch failed; committed_sp may be inaccurate: ${e.message}`,
            'PerformanceSyncService'
          );
        }
      }

      // Decide each ticket's commitment status:
      //   in_sprint_at_start         → committed (sp at start from SP changelog)
      //   currently in, !scope_change, !punted → carry-in from prev sprint → committed (use current sp)
      //   currently in, scope_change → genuine mid-sprint add → not committed
      //   punted                     → either was committed-then-removed (in_at_start) or
      //                                added-then-removed round-trip (not in_at_start)
      const createdByKey = new Map<string, Date>();
      for (const issue of issues) {
        if (issue.fields?.created) createdByKey.set(issue.key, new Date(issue.fields.created));
      }
      const sprintIdStr = String(jiraSprintId);
      let committedSp = 0;
      for (const f of facts) {
        if (!f.jiraKey) continue;

        // Pattern A — unassigned punted tickets are placeholders/grooming items
        // that lived on the sprint board but were never truly committed. The SM
        // doesn't count them; nor do we. Example: LOT-2884 (3 SP, unassigned,
        // Backlog status, was in sprint at start but moved out day 6).
        if (f.wasPunted && !f.assigneeJiraId) continue;

        const histories = changelogByKey.get(f.jiraKey) ?? [];
        const sprintIdsAtStart = getSprintFieldIdsAt(histories, sprintStartTs);
        const createdTs = createdByKey.get(f.jiraKey) ?? null;

        let wasInSprintAtStart: boolean;
        let spAtStart = 0;
        if (sprintIdsAtStart === null) {
          // No Sprint-field events. Either created with sprint set (no change event)
          // or changelog fetch failed. Use creation date: if created <= sprintStartTs,
          // ticket pre-existed and was in current sprint since creation.
          const createdBeforeStart = createdTs ? createdTs <= sprintStartTs : !f.wasPunted;
          wasInSprintAtStart = createdBeforeStart && !f.wasPunted;
          if (wasInSprintAtStart) spAtStart = Number(f.storyPoints ?? 0);
        } else if (sprintIdsAtStart.has(sprintIdStr) && (!createdTs || createdTs <= sprintStartTs)) {
          // Pattern C — creation-date guard. getSprintFieldIdsAt returns a non-null
          // set even for tickets created after sprintStartTs (uses `from` of earliest
          // event as pre-window state). Reject those: a ticket that didn't exist at
          // sprint start cannot have been committed at start.
          wasInSprintAtStart = true;
          spAtStart = getStoryPointsAt(histories, sprintStartTs, Number(f.storyPoints ?? 0));
        } else {
          wasInSprintAtStart = false;
        }

        // Carry-in: currently in this sprint, not flagged as scope-change, not punted,
        // AND created before sprint start. findScopeAddedAt excludes carry-in from prev
        // sprint, so these tickets reach here as legitimately committed even though they
        // weren't in the Sprint field at the literal sprintStartTs moment (the carry-in
        // event lands minutes/hours after sprint start). The createdTs guard is needed
        // because tickets created mid-sprint with sprint set at creation also pass the
        // first two checks but are NOT carry-in — they're brand-new scope.
        const wasCarryIn =
          !wasInSprintAtStart && !f.wasScopeChange && !f.wasPunted && (!createdTs || createdTs <= sprintStartTs);
        if (wasInSprintAtStart) {
          committedSp += spAtStart;
        } else if (wasCarryIn) {
          committedSp += Number(f.storyPoints ?? 0);
        }
      }
      committedSp = Math.round(committedSp * 100) / 100;
      logger.info(`Sprint ${sprintName}: committed_sp = ${committedSp}`, 'PerformanceSyncService');

      // Step 2 — cross-validate against Jira's authoritative sprint-report sums.
      // Both ours and Jira's view get stored in quality_report; divergence flags
      // are emitted at the 10% threshold. Powers UI badges + audit query.
      const ourCompletedSp =
        Math.round(facts.filter(f => f.wasCompleted).reduce((s, f) => s + Number(f.storyPoints ?? 0), 0) * 100) / 100;
      const jiraInitCompleted = ghReport.sums.completedInitialEstimateSp;
      const jiraInitNotCompleted = ghReport.sums.notCompletedInitialEstimateSp;
      const jiraInitPunted = ghReport.sums.puntedInitialEstimateSp;
      const jiraCompletedCurr = ghReport.sums.completedEstimateSp;
      const jiraCompletedInAnother = ghReport.sums.completedInAnotherSprintEstimateSp;
      const jiraCommittedEquiv = (jiraInitCompleted ?? 0) + (jiraInitNotCompleted ?? 0);
      const jiraDoneEquiv = (jiraCompletedCurr ?? 0) + (jiraCompletedInAnother ?? 0);
      const divergenceFlags: string[] = [];
      const pctDiff = (a: number, b: number) => {
        const denom = Math.max(Math.abs(a), Math.abs(b));
        return denom > 0 ? Math.abs(a - b) / denom : 0;
      };
      if (
        jiraInitCompleted != null &&
        jiraInitNotCompleted != null &&
        committedSp > 0 &&
        pctDiff(committedSp, jiraCommittedEquiv) > 0.1
      ) {
        divergenceFlags.push('committed_diff_gt_10pct');
      }
      if (jiraCompletedCurr != null && ourCompletedSp > 0 && pctDiff(ourCompletedSp, jiraDoneEquiv) > 0.1) {
        divergenceFlags.push('done_diff_gt_10pct');
      }
      // Resolve the Environment field once; reused by leakage + worked-prod.
      const envFieldId = await resolveEnvironmentFieldId(jira);

      // Defect leakage: prod bugs LOGGED (created) in this sprint's window,
      // project-wide regardless of which sprint/backlog they sit in.
      // Reporter-agnostic, whole-team. `prodBugKeys` drives the Leakage table.
      const leakage = await computeWindowLeakage(jira, project.jiraName, startDate, endDate, envFieldId);

      // Production bugs WORKED in this sprint: prod bugs (Environment=Prod) that
      // are on the sprint board this sprint, regardless of when created. Split
      // into valid vs invalid (Root Cause Bad Data / Invalid Bug). Classified from
      // the raw board issues (Environment + Root Cause both present); SP summed
      // from the matching built facts.
      const workedProdKeys = new Set<string>(); // valid prod bugs worked
      const workedProdInvalidKeys = new Set<string>(); // invalid prod bugs worked
      for (const iss of issues) {
        const f = (iss as any).fields ?? {};
        const typeLower = (f.issuetype?.name ?? '').toLowerCase();
        if (!typeLower.includes('bug')) continue;
        const lowerLabels = ((f.labels ?? []) as string[]).map(l => l.toLowerCase());
        if (!classifyProdBug(f, lowerLabels, envFieldId)) continue;
        if (detectInvalidBug(f, lowerLabels).invalidBug) workedProdInvalidKeys.add((iss as any).key);
        else workedProdKeys.add((iss as any).key);
      }
      const sumSp = (keys: Set<string>) =>
        Math.round(
          facts
            .filter(f => f.jiraKey != null && keys.has(f.jiraKey))
            .reduce((s, f) => s + Number(f.storyPoints ?? 0), 0) * 100
        ) / 100;
      const prodBugsWorkedSp = sumSp(workedProdKeys);
      const prodBugsWorkedInvalidSp = sumSp(workedProdInvalidKeys);
      const uatReopenedFacts = facts.filter(f => f.wasUatRejected);

      const qualityReport = {
        ourCommittedSp: committedSp,
        jiraInitialCompletedSp: jiraInitCompleted,
        jiraInitialNotCompletedSp: jiraInitNotCompleted,
        jiraInitialPuntedSp: jiraInitPunted,
        ourCompletedSp,
        jiraCompletedSp: jiraCompletedCurr,
        jiraCompletedInAnotherSp: jiraCompletedInAnother,
        divergenceFlags,
        // Leakage (created-in-window): rate numerator/denominator + numerator keys.
        bugsRaised: leakage?.bugsRaised,
        prodBugsEscaped: leakage?.prodBugsEscaped,
        leakageRatePct: leakage?.leakageRatePct,
        prodBugKeys: leakage?.prodBugKeys,
        // Production bugs WORKED in this sprint (Environment=Prod): valid split.
        prodBugsWorkedCount: workedProdKeys.size,
        prodBugsWorkedSp,
        prodBugsWorkedKeys: [...workedProdKeys],
        // Invalid worked prod bugs (Root Cause Bad Data / Invalid Bug).
        prodBugsWorkedInvalidCount: workedProdInvalidKeys.size,
        prodBugsWorkedInvalidSp,
        prodBugsWorkedInvalidKeys: [...workedProdInvalidKeys],
        // UAT reopens (UAT -> QA/dev) in this sprint: count + keys.
        uatReopenedCount: uatReopenedFacts.length,
        uatReopenedKeys: uatReopenedFacts.map(f => f.jiraKey),
      };

      await syncRecord.update({ syncStatus: 'done', syncedAt: new Date(), committedSp, qualityReport });
      logger.info(`Sprint sync complete: ${sprintName}`, 'PerformanceSyncService');
    } catch (err: any) {
      await syncRecord.update({ syncStatus: 'error', errorMessage: err.message });
      logger.error(`Sprint sync failed: ${err.message}`, err, 'PerformanceSyncService');
      throw err;
    }

    return syncRecord;
  }

  /**
   * Import a Kanban period by date range.
   */
  async syncKanbanPeriod(
    projectId: number,
    fromDate: string,
    toDate: string,
    label: string,
    triggeredByUserId?: number
  ): Promise<PerfSprintSync> {
    const project = await Project.findByPk(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const jira = JiraService.forProject(project);

    // Replace-on-resync: a Kanban "Sync Period" for a window already synced should
    // refresh that span, not pile up duplicate rows. Supersede any prior COMPLETED
    // or ERRORED kanban sync for the exact same window (cascade drops its facts +
    // scores). Active syncs (pending/running) are left alone to avoid clobbering an
    // in-flight job.
    const superseded = await PerfSprintSync.findAll({
      where: {
        projectId,
        syncType: 'kanban',
        startDate: fromDate,
        endDate: toDate,
        syncStatus: { [Op.in]: ['done', 'error'] },
      },
    });
    if (superseded.length > 0) {
      const supersededIds = superseded.map(s => s.id);
      await PerfMemberScore.destroy({ where: { syncId: { [Op.in]: supersededIds } } });
      await PerfTicketFact.destroy({ where: { syncId: { [Op.in]: supersededIds } } });
      await PerfSprintSync.destroy({ where: { id: { [Op.in]: supersededIds } } });
      logger.info(
        `Kanban resync: superseded ${supersededIds.length} prior sync(s) for ${fromDate}..${toDate} (ids ${supersededIds.join(', ')})`,
        'PerformanceSyncService'
      );
    }

    // Create sync record (kanban syncs don't have a unique jira_sprint_id constraint)
    const syncRecord = await PerfSprintSync.create({
      projectId,
      jiraSprintId: null,
      sprintName: label,
      periodLabel: label,
      startDate: fromDate,
      endDate: toDate,
      syncType: 'kanban',
      syncStatus: 'running',
      triggeredByUserId: triggeredByUserId ?? null,
    });

    try {
      const { facts, accountIdMap } = await this.buildKanbanFacts(project, jira, fromDate, toDate, syncRecord.id);

      await PerfTicketFact.bulkCreate(facts as any[]);
      logger.info(`Synced ${facts.length} ticket facts for Kanban period ${label}`, 'PerformanceSyncService');

      await this.computeAndSaveScores(syncRecord, facts as any[], projectId, jira, accountIdMap);

      await syncRecord.update({ syncStatus: 'done', syncedAt: new Date() });
    } catch (err: any) {
      await syncRecord.update({ syncStatus: 'error', errorMessage: err.message });
      logger.error(`Kanban sync failed: ${err.message}`, err, 'PerformanceSyncService');
      throw err;
    }

    return syncRecord;
  }

  /**
   * Build PerfTicketFact rows for a Kanban window [fromDate, toDate] from live
   * Jira, plus the resolved accountId-to-name map. Pure read (no DB writes).
   * Shared by syncKanbanPeriod (persist) and generateLiveKanbanSpan (live).
   * `syncId` is null for the live path.
   */
  private async buildKanbanFacts(
    project: Project,
    jira: JiraService,
    fromDate: string,
    toDate: string,
    syncId: number | null
  ): Promise<{ facts: Partial<PerfTicketFact>[]; accountIdMap: Map<string, { email: string; displayName: string }> }> {
    const projectId = project.id;

    const resolvedEstimate = await resolveEstimateFields(project as any, jira);

    const laneConfig = getLaneConfig(project as any);
    const inProgressStatuses = new Set<string>(
      [...(laneConfig.in_progress ?? []), 'In Progress', 'In Development', 'Reopened'].map(s => s.toLowerCase())
    );
    const qaStatuses = new Set<string>(
      [...(laneConfig.qa ?? []), 'In QA', 'QA Review', 'QA Testing', 'Testing', 'In Testing', 'Ready for QA', 'QA'].map(
        s => s.toLowerCase()
      )
    );
    const uatStatuses = new Set<string>(
      [...(laneConfig.uat ?? []), 'PO REVIEW', 'UAT', 'Acceptance Testing', 'In UAT'].map(s => s.toLowerCase())
    );
    const effectiveDone = resolveEffectiveDoneStatuses(project.kanbanDoneStatuses);
    const doneOrUatStatuses = new Set<string>([...effectiveDone, ...Array.from(uatStatuses)]);

    // Fetch issues updated in the period with changelog. jqlEndOfDay makes the
    // upper bound inclusive of the whole last day -- a bare date literal is
    // evaluated as that date's 00:00 by Jira, so without it every window
    // silently lost its final day.
    const jql = encodeURIComponent(
      `updated >= "${fromDate}" AND updated <= "${jqlEndOfDay(toDate)}" ORDER BY created ASC`
    );
    const issuesUrl = `/rest/agile/1.0/board/${project.jiraBoardId}/issue?jql=${jql}&expand=changelog`;
    const issues: any[] = await (jira as any).getAllIssuesFromUrl(issuesUrl);
    redactIssueTitles(issues, project.piiRedactionEnabled !== false);

    // Reopen-landing set: status-based when the workflow has a Reopened status
    // (fire only on entering it), else flow inference (any in-progress lane +
    // reopened lane). See sprint-sync path + computeReopenStatusOnly.
    const reopenStatusOnly = await this.computeReopenStatusOnly(jira, project, issues, laneConfig);
    const reopenedLaneStatuses = (laneConfig.reopened ?? []).map(s => s.toLowerCase());
    const reopenLandingStatuses = reopenStatusOnly
      ? new Set<string>(reopenedLaneStatuses)
      : new Set<string>([...inProgressStatuses, ...reopenedLaneStatuses]);

    // Defect-density / bugs-raised fix: the `updated`-window fetch above misses
    // bugs CREATED in the period but edited again later (their `updated` moves
    // past the window). Defect density wants bugs first-logged-in-window, so we
    // additionally pull Bugs/Sub-bugs CREATED in the window from the same board
    // endpoint (which embeds changelog — unlike search/jql) and union them in,
    // deduped by key. Best-effort: a Jira failure must not fail the sync.
    try {
      const bugJql = encodeURIComponent(
        `issuetype in (Bug, "Sub-bug") AND created >= "${fromDate}" AND created <= "${jqlEndOfDay(toDate)}" ORDER BY created ASC`
      );
      const bugUrl = `/rest/agile/1.0/board/${project.jiraBoardId}/issue?jql=${bugJql}&expand=changelog`;
      const createdBugIssues: any[] = await (jira as any).getAllIssuesFromUrl(bugUrl);
      redactIssueTitles(createdBugIssues, project.piiRedactionEnabled !== false);
      const seenKeys = new Set(issues.map((i: any) => i.key));
      let merged = 0;
      for (const bug of createdBugIssues) {
        if (seenKeys.has(bug.key)) continue;
        seenKeys.add(bug.key);
        issues.push(bug);
        merged += 1;
      }
      logger.info(
        `Kanban created-in-window bug supplement: +${merged} bug(s) (of ${createdBugIssues.length} created in window) merged into facts`,
        'PerformanceSyncService'
      );
    } catch (e: any) {
      logger.warn(
        `Kanban created-in-window bug supplement skipped (Jira query failed): ${e.message}`,
        'PerformanceSyncService'
      );
    }

    // Completed-elsewhere supplement: recovers a ticket that genuinely
    // completed inside the window but whose `updated` has since drifted
    // past it (touched again later by ongoing team activity -- see
    // buildStatusChangedDuringJql's docstring). DURING needs two distinct
    // dates; widen a same-day window by one day rather than fail.
    try {
      const duringTo =
        toDate === fromDate
          ? new Date(new Date(`${toDate}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
          : toDate;
      const statusChangedJql = encodeURIComponent(buildStatusChangedDuringJql(effectiveDone, fromDate, duringTo));
      const statusChangedUrl = `/rest/agile/1.0/board/${project.jiraBoardId}/issue?jql=${statusChangedJql}&expand=changelog`;
      const completedElsewhereIssues: any[] = await (jira as any).getAllIssuesFromUrl(statusChangedUrl);
      redactIssueTitles(completedElsewhereIssues, project.piiRedactionEnabled !== false);
      const seenKeys2 = new Set(issues.map((i: any) => i.key));
      let mergedCompleted = 0;
      for (const iss of completedElsewhereIssues) {
        if (seenKeys2.has(iss.key)) continue;
        seenKeys2.add(iss.key);
        issues.push(iss);
        mergedCompleted += 1;
      }
      logger.info(
        `Kanban completed-elsewhere supplement: +${mergedCompleted} ticket(s) (of ${completedElsewhereIssues.length} status-changed-to-done in window) merged into facts`,
        'PerformanceSyncService'
      );
    } catch (e: any) {
      logger.warn(
        `Kanban completed-elsewhere supplement skipped (Jira query failed): ${e.message}`,
        'PerformanceSyncService'
      );
    }

    // Still-open-elsewhere supplement: recovers a ticket that stayed OPEN
    // (not completed) but had genuine status or assignee activity inside the
    // window, whose `updated` has since drifted past it because it was worked
    // on again later. Without this, resyncing an old cycle loses almost every
    // ticket that was still active during it -- see buildFieldChangedDuringJql's
    // docstring. Two separate queries (status, assignee) since JQL's CHANGED
    // operator only accepts one field per clause; merged and deduped same as
    // the other supplements. This recovers real carried/spillover work the
    // older data was silently dropping -- it should INCREASE not-completed
    // counts for older cycles, not suppress anything.
    try {
      const duringTo2 =
        toDate === fromDate
          ? new Date(new Date(`${toDate}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
          : toDate;
      const seenKeys3 = new Set(issues.map((i: any) => i.key));
      let mergedStillOpen = 0;
      for (const field of ['status', 'assignee'] as const) {
        const jqlStr = encodeURIComponent(buildFieldChangedDuringJql(field, fromDate, duringTo2));
        const url = `/rest/agile/1.0/board/${project.jiraBoardId}/issue?jql=${jqlStr}&expand=changelog`;
        const stillOpenIssues: any[] = await (jira as any).getAllIssuesFromUrl(url);
        redactIssueTitles(stillOpenIssues, project.piiRedactionEnabled !== false);
        for (const iss of stillOpenIssues) {
          if (seenKeys3.has(iss.key)) continue;
          seenKeys3.add(iss.key);
          issues.push(iss);
          mergedStillOpen += 1;
        }
      }
      logger.info(
        `Kanban still-open-elsewhere supplement: +${mergedStillOpen} ticket(s) merged into facts`,
        'PerformanceSyncService'
      );
    } catch (e: any) {
      logger.warn(
        `Kanban still-open-elsewhere supplement skipped (Jira query failed): ${e.message}`,
        'PerformanceSyncService'
      );
    }

    const fromTs = istStartOfDayUtc(fromDate);
    const toTs = istEndOfDayUtc(toDate);
    const prodBugKeys = await this.loadProdBugKeys(projectId, fromDate, toDate);

    // Repeat-carryover detection: a ticket still open from the immediately-
    // preceding Kanban cycle shouldn't have its full story points re-added to
    // this cycle's carried SP too (see LS Baban Tiwari / 158-vs-67-SP
    // investigation, Aug 2026). Look up that one prior cycle's not-completed
    // facts, keyed by assignee+ticket, once up front.
    const priorCarryKeys = new Set<string>();
    const priorSync = await PerfSprintSync.findOne({
      where: {
        projectId,
        syncType: 'kanban',
        syncStatus: 'done',
        startDate: { [Op.lt]: fromDate },
      },
      order: [['startDate', 'DESC']],
    });
    if (priorSync) {
      const priorFacts = await PerfTicketFact.findAll({
        where: { syncId: priorSync.id, wasCompleted: false },
        attributes: ['jiraKey', 'assigneeJiraId'],
      });
      for (const pf of priorFacts) {
        const af = pf as any;
        if (af.assigneeJiraId) priorCarryKeys.add(`${af.assigneeJiraId}::${af.jiraKey}`);
      }
    }

    // Pass 1a: count sub-bug children per parent — both the RAW count
    // (every sub-bug logged, valid or not) and the VALID count (excluding
    // ones ruled invalid via detectInvalidBug — Root Cause fuzzy-matching
    // 'Invalid Bug'/'Bad Data'/'Incomplete Requirement', or an
    // invalid-bug label). See the sprint-path twin of this pass for the
    // full rationale: a parent with sub-bug evidence trusts ONLY the
    // valid ones (so all-invalid sub-bugs veto the parent's own flow/label
    // signal), while a parent with zero sub-bugs falls back to its own
    // status flow unaffected.
    const rawSubBugCountByParent = new Map<string, number>();
    const validSubBugCountByParent = new Map<string, number>();
    for (const issue of issues) {
      const fields = issue.fields as any;
      const itype = (fields.issuetype?.name ?? '').toLowerCase();
      const parentKey: string | undefined = fields.parent?.key;
      if (!parentKey || !itype.includes('bug')) continue;

      rawSubBugCountByParent.set(parentKey, (rawSubBugCountByParent.get(parentKey) ?? 0) + 1);
      const labels: string[] = ((fields.labels ?? []) as string[]).map((l: string) => l.toLowerCase());
      const { invalidBug } = detectInvalidBug(fields, labels);
      if (invalidBug) continue;

      validSubBugCountByParent.set(parentKey, (validSubBugCountByParent.get(parentKey) ?? 0) + 1);
    }

    const facts: Partial<PerfTicketFact>[] = [];
    for (const issue of issues) {
      const fields = issue.fields as any;
      const issueType: string = fields.issuetype?.name ?? '';
      const issueTypeLower = issueType.toLowerCase();
      if ((issueTypeLower === 'sub-task' || issueTypeLower === 'subtask') && !issueTypeLower.includes('bug')) continue;

      const sp: number = extractEstimate(fields, project as any, resolvedEstimate);
      const statusChanges = extractStatusChanges(issue);
      const assigneeChanges = extractAssigneeChanges(issue);

      // For Kanban: was_completed = transitioned to Done DURING this period --
      // but ONLY a genuine transition from a not-yet-done status. A ticket that
      // already reached an effectively-done status (e.g. Pending Deployment) in
      // an earlier cycle and later gets formally closed/released -- Pending
      // Deployment -> Closed -- is not new work finished this cycle, just an
      // administrative bulk close-out of already-finished backlog. Confirmed
      // against LS's Jul 27-31 cycle: 21 of a 30-ticket sample were exactly this
      // shape (PD -> Closed within a few minutes of each other), some dating
      // back to March 2026 -- inflating that cycle's "done" SP with months-old
      // work. See isPriorPeriodCompletion below for what happens to these instead.
      const inWindowDoneTransitions = statusChanges.filter(
        c => c.created >= fromTs && c.created <= toTs && effectiveDone.has(c.toString.toLowerCase())
      );
      const wasCompletedInPeriod = inWindowDoneTransitions.some(
        c => !effectiveDone.has((c.fromString ?? '').toLowerCase())
      );
      // A done-to-done shuffle happened in-window, but it wasn't a genuine new
      // completion (caught above) -- the ticket isn't this cycle's work at all,
      // in either direction. Excluded from spDone AND spCarriedOver entirely in
      // computeMemberScores (unlike a normal not-completed ticket, which still
      // counts as carried).
      const isPriorPeriodCompletion = !wasCompletedInPeriod && inWindowDoneTransitions.length > 0;
      // Retain bugs CREATED in this window even if they had no status change
      // and aren't done — they belong to the defect-density numerator (and the
      // bugs-raised counts). Without this, freshly-logged bugs sitting in their
      // initial status (e.g. Backlog) would be dropped here.
      const createdInWindow = fields.created
        ? new Date(fields.created) >= fromTs && new Date(fields.created) <= toTs
        : false;
      const isBugType = issueTypeLower.includes('bug');
      const hasStatusChangeInPeriod = statusChanges.some(c => c.created >= fromTs && c.created <= toTs);
      const hasAssigneeChangeInPeriod = assigneeChanges.some(c => c.created >= fromTs && c.created <= toTs);
      if (
        !shouldIncludeKanbanTicket({
          wasCompletedInPeriod,
          isBugType,
          createdInWindow,
          hasStatusChangeInPeriod,
          hasAssigneeChangeInPeriod,
          isPriorPeriodCompletion,
        })
      )
        continue;

      // Administrative reassignment: the ticket only qualified because of an
      // assignee change (no real status/lane movement, not completed this
      // window) and it's already parked in an awaiting-release status. That's
      // an ownership handoff, not new work — don't let it inflate the new
      // assignee's carried SP. A reassignment alongside genuine status/lane
      // movement in the same window is untouched (isAdministrativeReassignment
      // stays false).
      const currentStatusLower = (fields.status?.name ?? '').toLowerCase();
      const isAdministrativeReassignment =
        hasAssigneeChangeInPeriod &&
        !hasStatusChangeInPeriod &&
        !wasCompletedInPeriod &&
        AWAITING_RELEASE_STATUSES.has(currentStatusLower);

      // Same open ticket, same assignee, already carried last cycle -- don't
      // let its points count toward "planned" a second time. Only applies to
      // still-open tickets; a ticket that finally completes this cycle still
      // fully counts as done, same as always.
      const assigneeIdForCarry = fields.assignee?.accountId ?? null;
      const isRepeatCarryover =
        !wasCompletedInPeriod && !!assigneeIdForCarry && priorCarryKeys.has(`${assigneeIdForCarry}::${issue.key}`);

      const cycleTime = computeCycleTimeHours(statusChanges, inProgressStatuses, qaStatuses, fromTs, toTs);
      const qaTime = computeTimeInQaHours(statusChanges, qaStatuses, fromTs, toTs);
      // Window-bounded: QA credit belongs to the cycle the testing actually
      // happened in, not every later cycle the ticket is dragged through.
      // The timestamp anchors reopen attribution below.
      const qaClearing = findQaClearing(statusChanges, qaStatuses, doneOrUatStatuses, fromTs, toTs);
      const qaTester = { id: qaClearing.id, name: qaClearing.name };

      const bugPriority = issueTypeLower.includes('bug') ? (fields.priority?.name ?? null) : null;

      // Reopen accounting (mirrors the sprint-sync path): a ticket with
      // sub-bug children trusts ONLY the valid sub-bug count — all-invalid
      // sub-bugs veto the parent's own flow/label signal entirely, while
      // even one valid sub-bug is sufficient on its own. A ticket with
      // zero sub-bugs falls back to its own status flow. Exclusion labels
      // (Invalid-Reopen / Bad-Data / Scope-Change) subtract one event each.
      const ticketLabels: string[] = ((fields.labels ?? []) as string[]).map((l: string) => l.toLowerCase());
      const excludedCount = ticketLabels.reduce((acc, l) => acc + (isReopenExclusionLabel(l) ? 1 : 0), 0);
      const rawSubBugCount = rawSubBugCountByParent.get(issue.key) ?? 0;
      const validSubBugCount = validSubBugCountByParent.get(issue.key) ?? 0;
      const flowReopen = wasMovedBackToDev(
        statusChanges,
        reopenLandingStatuses,
        qaStatuses,
        doneOrUatStatuses,
        fromTs,
        toTs
      );
      const reopenEventCount = rawSubBugCount > 0 ? validSubBugCount : flowReopen ? 1 : 0;
      const netReopens = Math.max(0, reopenEventCount - excludedCount);
      const wasReopenedFinal = netReopens > 0;
      const { rootCause, invalidBug } = detectInvalidBug(fields, ticketLabels);

      facts.push({
        syncId: syncId ?? undefined,
        projectId,
        jiraKey: issue.key,
        parentKey: (fields.parent?.key as string) ?? null,
        parentIssueType: (fields.parent?.fields?.issuetype?.name as string) ?? null,
        summary: (fields.summary ?? '').substring(0, 499),
        issueType,
        assigneeJiraId: fields.assignee?.accountId ?? null,
        assigneeName: fields.assignee?.displayName ?? null,
        reporterJiraId: fields.reporter?.accountId ?? null,
        reporterName: fields.reporter?.displayName ?? null,
        storyPoints: sp,
        wasCompleted: wasCompletedInPeriod,
        wasReopened: wasReopenedFinal,
        invalidReopenCount: Math.min(reopenEventCount, excludedCount),
        rootCause,
        invalidBug,
        wasScopeChange: false, // no sprint concept for kanban
        // Anchored to the in-window sign-off, not to the cycle the reopen
        // lands in: a Kanban UAT tail routinely runs past the cycle
        // boundary, and the reopen is evidence about THAT sign-off. No
        // in-window clearing means no QA credit, so nothing is charged.
        wasUatRejected: qaClearing.at
          ? wasUatRejectedAfterClearing(
              statusChanges,
              uatStatuses,
              qaStatuses,
              inProgressStatuses,
              doneOrUatStatuses,
              qaClearing.at
            )
          : false,
        cycleTimeHours: cycleTime,
        timeInQaHours: qaTime,
        qaTesterJiraId: qaTester.id,
        qaTesterName: qaTester.name,
        bugPriority,
        isProductionBug: prodBugKeys.has(issue.key),
        jiraCreatedAt: fields.created ? new Date(fields.created) : null,
        isAdministrativeReassignment,
        isRepeatCarryover,
        isPriorPeriodCompletion,
      });
    }

    // Resolve real display names via per-user API (bypasses bulk-API redaction)
    const accountIds = new Set<string>();
    for (const f of facts) {
      if (f.assigneeJiraId) accountIds.add(f.assigneeJiraId);
      if (f.reporterJiraId) accountIds.add(f.reporterJiraId);
      if (f.qaTesterJiraId) accountIds.add(f.qaTesterJiraId);
    }
    const accountIdMap = await buildAccountIdMap(jira, accountIds);
    enrichFactNamesFromAccountIdMap(facts, accountIdMap);

    return { facts, accountIdMap };
  }

  /**
   * Recompute member scores from stored ticket facts (no Jira call needed).
   * Useful when formulas change or team roles are updated.
   */
  async recomputeScores(syncId: number): Promise<void> {
    const syncRecord = await PerfSprintSync.findByPk(syncId);
    if (!syncRecord) throw new Error(`Sync ${syncId} not found`);

    const facts = await PerfTicketFact.findAll({ where: { syncId } });
    const project = await Project.findByPk(syncRecord.projectId);
    if (!project) throw new Error(`Project ${syncRecord.projectId} not found`);

    const jira = JiraService.forProject(project);

    await PerfMemberScore.destroy({ where: { syncId } });
    await this.computeAndSaveScores(syncRecord, facts as any[], syncRecord.projectId, jira);
  }

  /**
   * Recompute scores using ONLY stored facts and existing display names —
   * never calls Jira. Source for display names is the existing PerfMemberScore
   * rows for this sync. Used by backfill scripts after formula changes so we
   * don't re-pay for thousands of Jira API calls just to refresh per-sprint math.
   *
   * Returns true if recomputation ran, false if there are no facts or no existing
   * scores to source display names from (in which case the sync needs a full re-sync).
   */
  async recomputeScoresFromStored(syncId: number): Promise<boolean> {
    const syncRecord = await PerfSprintSync.findByPk(syncId);
    if (!syncRecord) throw new Error(`Sync ${syncId} not found`);

    const facts = await PerfTicketFact.findAll({ where: { syncId } });
    if (facts.length === 0) return false;

    const existingScores = await PerfMemberScore.findAll({ where: { syncId } });
    if (existingScores.length === 0) return false;

    const preBuiltMap = new Map<string, { email: string; displayName: string }>();
    for (const s of existingScores) {
      preBuiltMap.set(s.jiraLoginId, {
        email: s.jiraLoginId, // email not stored on score; placeholder is fine (never read downstream)
        displayName: s.displayName,
      });
    }

    await this.computeAndSaveScores(syncRecord, facts as any[], syncRecord.projectId, null as any, preBuiltMap);
    return true;
  }

  // ─── Read methods ──────────────────────────────────────────────────────────

  async getSyncHistory(projectId: number): Promise<PerfSprintSync[]> {
    return PerfSprintSync.findAll({
      where: { projectId },
      order: [
        ['start_date', 'DESC'],
        ['created_at', 'DESC'],
      ],
    });
  }

  /** Today (IST) as YYYY-MM-DD — anchor for cycle generation. */
  private todayIST(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  /**
   * List the configured Kanban work-cycles for a project (descending), merged
   * with any per-cycle date overrides (ProjectSprint, source 'kanban_cycle')
   * and the sync state of each cycle (matched against PerfSprintSync by dates).
   */
  async getKanbanCyclesForProject(
    projectId: number,
    limit = 24
  ): Promise<Array<KanbanCycle & { syncStatus: string | null; syncId: number | null; isOverridden: boolean }>> {
    const project = await Project.findByPk(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (!project.isKanbanProject || !project.kanbanCycleEnabled) return [];

    // Routed through the shared delivery-period seam (deliveryPeriodResolver.ts)
    // rather than calling generateCycles() directly -- this is the first call
    // site migrated off ad-hoc isKanbanProject branching. Equivalence with the
    // pre-migration direct call is characterisation-tested in
    // deliveryPeriodResolver.test.ts; sourceId is mapped back to `index` here
    // since that's the field name this endpoint's existing consumers (the
    // frontend cycle picker, resolveKanbanCycle's override keying) expect.
    const periods = await resolveDeliveryPeriods(project, null, this.todayIST(), limit);
    if (periods.length === 0) return [];
    const recent = periods.map(p => ({
      index: p.sourceId as number,
      startDate: p.startDate,
      endDate: p.endDate,
      label: p.label,
      isComplete: p.isComplete,
    }));

    // Overrides: keyed by the deterministic default label for that index.
    const overrides = await ProjectSprint.findAll({
      where: { projectId, source: 'kanban_cycle' },
    });
    const overrideByName = new Map<string, ProjectSprint>();
    for (const o of overrides) overrideByName.set(o.name, o);

    // Sync state: match by startDate+endDate among kanban syncs.
    const syncs = await PerfSprintSync.findAll({
      where: { projectId, syncType: 'kanban' },
      attributes: ['id', 'startDate', 'endDate', 'syncStatus'],
      order: [['created_at', 'DESC']],
    });

    return recent.map(cycle => {
      const override = overrideByName.get(cycle.label);
      const startDate = override?.startDate ?? cycle.startDate;
      const endDate = override?.endDate ?? cycle.endDate;
      const sync = syncs.find(s => s.startDate === startDate && s.endDate === endDate);
      return {
        ...cycle,
        startDate,
        endDate,
        label: override ? cycleLabel(startDate, endDate) : cycle.label,
        isOverridden: !!override,
        syncStatus: sync?.syncStatus ?? null,
        syncId: sync?.id ?? null,
      };
    });
  }

  /**
   * Resolve a cycle index to its effective date window (honouring any override
   * stored against the cycle's default label).
   */
  async resolveKanbanCycle(
    projectId: number,
    cycleIndex: number
  ): Promise<{ startDate: string; endDate: string; label: string } | null> {
    const project = await Project.findByPk(projectId);
    if (!project || !project.kanbanCycleDays || !project.kanbanCycleAnchorDate) return null;
    const cycle = cycleByIndex(
      project.kanbanCycleAnchorDate,
      project.kanbanCycleDays,
      cycleIndex,
      project.kanbanCycleStrideDays
    );
    if (!cycle) return null;
    const override = await ProjectSprint.findOne({
      where: { projectId, source: 'kanban_cycle', name: cycle.label },
    });
    const startDate = override?.startDate ?? cycle.startDate;
    const endDate = override?.endDate ?? cycle.endDate;
    return { startDate, endDate, label: override ? cycleLabel(startDate, endDate) : cycle.label };
  }

  /**
   * Live (non-persisted) scorecard for the IN-PROGRESS Kanban cycle.
   * Window = current cycle start -> today (IST). Reads Jira live each call and
   * returns a payload shape-compatible with getScorecard so the existing
   * scorecard UI can render it. Nothing is written to the DB.
   */
  async generateLiveKanbanSpan(projectId: number): Promise<any> {
    const project = await Project.findByPk(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (!project.isKanbanProject) throw new Error('Live span is only available for Kanban projects');
    if (!project.kanbanCycleEnabled || !project.kanbanCycleDays || !project.kanbanCycleAnchorDate) {
      throw new Error('Configure a work-cycle cadence (length + start date) to view the current span');
    }

    const today = this.todayIST();
    const cycles = generateCycles(
      project.kanbanCycleAnchorDate,
      project.kanbanCycleDays,
      today,
      project.kanbanCycleStrideDays
    );
    if (cycles.length === 0) {
      throw new Error('Cycle start date is in the future — no current span yet');
    }
    const current = cycles[cycles.length - 1];
    const fromDate = current.startDate;
    const toDate = today; // in-progress: cycle start -> today
    const label = cycleLabel(fromDate, toDate);

    const jira = JiraService.forProject(project);
    const { facts, accountIdMap } = await this.buildKanbanFacts(project, jira, fromDate, toDate, null);
    const scores = await this.computeMemberScores(
      { id: null, startDate: fromDate, endDate: toDate, sprintName: label },
      facts as any[],
      projectId,
      jira,
      accountIdMap,
      { includeOffboardBugs: true }
    );

    const totalCompletedSp = facts.reduce((sum, f) => sum + (f.wasCompleted ? (f.storyPoints ?? 0) : 0), 0);
    const unassignedTicketCount = facts.filter(f => !f.assigneeJiraId).length;
    const nowIso = new Date().toISOString();

    return {
      sync: {
        id: null,
        projectId,
        startDate: fromDate,
        endDate: toDate,
        syncType: 'kanban',
        periodLabel: label,
        sprintName: label,
        syncStatus: 'done',
        syncedAt: nowIso,
        createdAt: nowIso,
        isLive: true,
      },
      scores,
      // Kanban has no commitment / carryover / scope-creep / punted concepts.
      scopeCreepCount: 0,
      scopeCreepSp: 0,
      v2ScopeCreepCount: 0,
      v2ScopeCreepSp: 0,
      puntedCount: 0,
      puntedSp: 0,
      v2PuntedCount: 0,
      v2PuntedSp: 0,
      scopeCreepTickets: [],
      carryOverTickets: [],
      committedSp: null,
      finalScopeSp: totalCompletedSp,
      netScopeChangeSp: null,
      totalCompletedSp,
      unassignedTicketCount,
      qualityReport: null,
    };
  }

  async getScorecard(syncId: number): Promise<{
    sync: PerfSprintSync;
    scores: Array<Record<string, any> & { isV2: boolean }>;
    scopeCreepCount: number;
    scopeCreepSp: number;
    v2ScopeCreepCount: number;
    v2ScopeCreepSp: number;
    puntedCount: number;
    puntedSp: number;
    v2PuntedCount: number;
    v2PuntedSp: number;
    scopeCreepTickets: ScorecardTicket[];
    carryOverTickets: ScorecardTicket[];
    committedSp: number | null;
    finalScopeSp: number;
    netScopeChangeSp: number | null;
    totalCompletedSp: number;
    unassignedTicketCount: number;
    qualityReport: any | null;
  }> {
    const sync = await PerfSprintSync.findByPk(syncId);
    if (!sync) throw new Error(`Sync ${syncId} not found`);
    const scores = await PerfMemberScore.findAll({
      where: { syncId },
      order: [['display_name', 'ASC']],
    });
    const scopeFacts = await PerfTicketFact.findAll({ where: { syncId, wasScopeChange: true } });
    const scopeCreepCount = scopeFacts.length;
    const scopeCreepSp = scopeFacts.reduce((sum, f) => sum + (f.storyPoints ?? 0), 0);
    const puntedFacts = await PerfTicketFact.findAll({ where: { syncId, wasPunted: true } });
    const puntedCount = puntedFacts.length;
    const puntedSp = puntedFacts.reduce((sum, f) => sum + (f.storyPoints ?? 0), 0);
    // Carry-over tickets (forward spillover): in this sprint, has assignee, not
    // punted, not completed, not a sub-bug. Mirrors the spilloverCount aggregation
    // in computeAndSaveScores (lines 855-869).
    const carryOverFacts = await PerfTicketFact.findAll({
      where: {
        syncId,
        wasCompleted: false,
        wasPunted: false,
        assigneeJiraId: { [Op.ne]: null as any },
        // Work finished in an earlier cycle is not carry-over here.
        ...EXCLUDE_PRIOR_PERIOD_COMPLETION,
      },
      order: [['jira_key', 'ASC']],
    });

    // V2 truth: team_members.v2_member. Match by jiraLoginId first (authoritative),
    // then by displayName (suffix-stripped) for resilience. Build once for all
    // assignees touched by scope-creep / punted / carry-over facts.
    const v2Members = await TeamMember.findAll({
      where: { v2Member: true },
      attributes: ['firstName', 'lastName', 'jiraLoginId'],
    });
    const v2LoginIds = new Set<string>();
    const v2DisplayNames = new Set<string>();
    for (const m of v2Members) {
      const loginId = (m as any).jiraLoginId;
      if (loginId) v2LoginIds.add(loginId);
      const full = (((m as any).firstName ?? '') + ' ' + ((m as any).lastName ?? '')).trim().toLowerCase();
      if (full) v2DisplayNames.add(full);
    }
    const v2JiraIds = new Set<string>();
    const resolveV2 = (assigneeJiraId: string | null, assigneeName: string | null) => {
      const aid = assigneeJiraId ?? '';
      if (!aid) return;
      if (v2LoginIds.has(aid)) {
        v2JiraIds.add(aid);
        return;
      }
      const name = (assigneeName ?? '').replace(/_ext$/i, '').trim().toLowerCase();
      if (name && v2DisplayNames.has(name)) v2JiraIds.add(aid);
    };
    for (const f of [...scopeFacts, ...puntedFacts, ...carryOverFacts]) {
      resolveV2(f.assigneeJiraId, f.assigneeName);
    }

    const v2ScopeFacts = scopeFacts.filter(f => v2JiraIds.has(f.assigneeJiraId ?? ''));
    const v2ScopeCreepCount = v2ScopeFacts.length;
    const v2ScopeCreepSp = v2ScopeFacts.reduce((sum, f) => sum + (f.storyPoints ?? 0), 0);
    const v2PuntedFacts = puntedFacts.filter(f => v2JiraIds.has(f.assigneeJiraId ?? ''));
    const v2PuntedCount = v2PuntedFacts.length;
    const v2PuntedSp = v2PuntedFacts.reduce((sum, f) => sum + (f.storyPoints ?? 0), 0);

    const carryOverTickets: ScorecardTicket[] = carryOverFacts
      .filter(f => !isSubBugIssueType(f.issueType ?? ''))
      .map(f => factToScorecardTicket(f, v2JiraIds));
    const scopeCreepTickets: ScorecardTicket[] = scopeFacts
      .slice()
      .sort((a, b) => (a.jiraKey ?? '').localeCompare(b.jiraKey ?? ''))
      .map(f => factToScorecardTicket(f, v2JiraIds));
    // totalCompletedSp = raw sum across ALL completed tickets (Pattern B).
    // Captures unassigned-but-completed work (e.g. LOT-3059, LOT-3087) that
    // the dev-attributed sum misses because computeAndSaveScores filters on
    // assigneeJiraId. This is the number we surface in "Total Completed".
    const completedFacts = await PerfTicketFact.findAll({ where: { syncId, wasCompleted: true } });
    const totalCompletedSp =
      Math.round(completedFacts.reduce((sum, f) => sum + Number(f.storyPoints ?? 0), 0) * 100) / 100;

    // Edge-case indicator: tickets without an assignee. SM commonly excludes
    // these from her tallies, so a non-zero count is a strong predictor of
    // SM/our-numbers mismatch. Always surfaced in the UI banner.
    const unassignedTicketCount = await PerfTicketFact.count({
      where: { syncId, assigneeJiraId: null as any, ...EXCLUDE_PRIOR_PERIOD_COMPLETION },
    });

    // Final scope = totalCompletedSp + carry-over SP (raw, includes unassigned).
    // This replaces the older "Σ sp_planned on dev rows" that silently dropped
    // unassigned tickets — matches what SM would see in Jira's UI.
    const carryOverSp =
      Math.round(
        carryOverFacts
          .filter(f => !isSubBugIssueType(f.issueType ?? ''))
          .reduce((sum, f) => sum + Number(f.storyPoints ?? 0), 0) * 100
      ) / 100;
    const finalScopeSp = Math.round((totalCompletedSp + carryOverSp) * 100) / 100;
    const committedSp = sync.committedSp != null ? Number(sync.committedSp) : null;
    const netScopeChangeSp = committedSp != null ? Math.round((finalScopeSp - committedSp) * 100) / 100 : null;

    // Tag each member score with V2 membership so the Board View can offer a
    // V2-only scope toggle. PerfMemberScore.jiraLoginId is the Jira ACCOUNT id
    // (e.g. 712020:...) which never matches the roster's email-based login id,
    // so we resolve by login id first (cheap) then by suffix-stripped display
    // name — the same matcher used for facts above.
    const scoreIsV2 = (loginId: string | null, displayName: string | null): boolean => {
      const id = loginId ?? '';
      if (id && v2LoginIds.has(id)) return true;
      const name = (displayName ?? '').replace(/_ext$/i, '').trim().toLowerCase();
      return !!name && v2DisplayNames.has(name);
    };
    const scoresWithV2 = scores.map(s => ({
      ...s.toJSON(),
      isV2: scoreIsV2(s.jiraLoginId, s.displayName),
    }));

    return {
      sync,
      scores: scoresWithV2,
      scopeCreepCount,
      scopeCreepSp,
      v2ScopeCreepCount,
      v2ScopeCreepSp,
      puntedCount,
      puntedSp,
      v2PuntedCount,
      v2PuntedSp,
      scopeCreepTickets,
      carryOverTickets,
      committedSp,
      finalScopeSp,
      netScopeChangeSp,
      totalCompletedSp,
      unassignedTicketCount,
      qualityReport: (sync as any).qualityReport ?? null,
    };
  }

  async getTicketFacts(syncId: number, jiraLoginId?: string): Promise<PerfTicketFact[]> {
    // Prior-period completions are filtered here rather than in each caller:
    // every consumer of this endpoint (the ticket drilldown, the score
    // breakdown's client-side QA re-derivation, the executive drilldown)
    // wants the same population the scorecard counted. Historical spans still
    // hold these rows, so this keeps them consistent without a re-sync.
    const where: any = { syncId, ...EXCLUDE_PRIOR_PERIOD_COMPLETION };
    if (jiraLoginId) {
      // Match either assignee or qa_tester
      where[Op.or] = [
        { assigneeJiraId: jiraLoginId },
        { qaTesterJiraId: jiraLoginId },
        { reporterJiraId: jiraLoginId },
      ];
    }
    return PerfTicketFact.findAll({ where, order: [['jira_key', 'ASC']] });
  }

  async saveOverride(params: {
    syncId: number;
    jiraLoginId: string;
    metrics: Record<string, number>;
    reason: string;
    userId: number;
  }): Promise<PerfMemberScore> {
    const score = await PerfMemberScore.findOne({
      where: { syncId: params.syncId, jiraLoginId: params.jiraLoginId },
    });
    if (!score) throw new Error(`Member ${params.jiraLoginId} not found in sync ${params.syncId}`);

    await score.update({
      overriddenMetrics: params.metrics,
      overrideReason: params.reason,
      overriddenByUserId: params.userId,
      isOverridden: true,
    });
    return score;
  }

  async clearOverride(syncId: number, jiraLoginId: string): Promise<void> {
    await PerfMemberScore.update(
      { overriddenMetrics: {}, overrideReason: null, overriddenByUserId: null, isOverridden: false },
      { where: { syncId, jiraLoginId } }
    );
  }

  // ─── Scheduler: detect newly closed sprints ────────────────────────────────

  async detectAndEnqueueNewlyClosed(): Promise<void> {
    const { perfSyncQueue } = require('../queues/perfSyncQueue');

    const projects = await Project.findAll({
      where: { jiraBoardId: { [Op.ne]: null }, isActive: true },
    });

    for (const project of projects) {
      try {
        // Kanban projects: auto-sync the most-recently-completed cycle
        // (per the configured cadence) instead of detecting closed sprints.
        if ((project as any).isKanbanProject) {
          if (
            project.kanbanCycleEnabled &&
            project.kanbanAutoSync &&
            project.kanbanCycleDays &&
            project.kanbanCycleAnchorDate
          ) {
            const cycle = lastCompletedCycle(
              project.kanbanCycleAnchorDate,
              project.kanbanCycleDays,
              this.todayIST(),
              project.kanbanCycleStrideDays
            );
            if (cycle) {
              // Dedup against any existing kanban sync for this exact window.
              const existing = await PerfSprintSync.findOne({
                where: {
                  projectId: project.id,
                  syncType: 'kanban',
                  startDate: cycle.startDate,
                  endDate: cycle.endDate,
                  syncStatus: { [Op.in]: ['pending', 'running', 'done'] },
                },
              });
              if (!existing) {
                logger.info(
                  `Auto-queuing Kanban cycle sync ${cycle.label} (project ${project.code})`,
                  'PerformanceSyncService'
                );
                await perfSyncQueue.add(
                  'sync-sprint-performance',
                  {
                    projectId: project.id,
                    fromDate: cycle.startDate,
                    toDate: cycle.endDate,
                    label: cycle.label,
                  },
                  { jobId: 'kanban-cycle-' + project.id + '-' + cycle.startDate }
                );
              }
            }
          } else if (!project.kanbanCycleEnabled && project.kanbanAutoSync) {
            // Continuous: no configured cycle, so the reporting week (Fri-Thu)
            // stands in for one -- auto-sync the most-recently-completed week.
            // Reuses the SAME kanbanAutoSync opt-in as cadence rather than a new
            // toggle, so no existing continuous project (e.g. one that was never
            // auto-syncing before because it had no cadence to enable it with)
            // starts syncing weekly until someone explicitly turns it on.
            const periods = await resolveDeliveryPeriods({ deliveryModel: 'continuous' }, null, this.todayIST(), 2);
            const week = periods.find(p => p.isComplete);
            if (week) {
              const existing = await PerfSprintSync.findOne({
                where: {
                  projectId: project.id,
                  syncType: 'kanban',
                  startDate: week.startDate,
                  endDate: week.endDate,
                  syncStatus: { [Op.in]: ['pending', 'running', 'done'] },
                },
              });
              if (!existing) {
                logger.info(
                  `Auto-queuing continuous reporting-week sync ${week.label} (project ${project.code})`,
                  'PerformanceSyncService'
                );
                await perfSyncQueue.add(
                  'sync-sprint-performance',
                  {
                    projectId: project.id,
                    fromDate: week.startDate,
                    toDate: week.endDate,
                    label: week.label,
                  },
                  { jobId: 'continuous-week-' + project.id + '-' + week.startDate }
                );
              }
            }
          }
          continue;
        }

        const jira = JiraService.forProject(project);
        const allSprints = await jira.listBoardSprints(project.jiraBoardId, 20);
        const closedSprints = allSprints.filter((s: any) => s.state === 'closed');

        // Check which ones are already synced (status = done)
        const syncedIds = (
          await PerfSprintSync.findAll({
            where: { projectId: project.id, jiraSprintId: { [Op.ne]: null }, syncStatus: 'done' },
            attributes: ['jiraSprintId'],
          })
        ).map((s: any) => s.jiraSprintId);

        const syncedSet = new Set(syncedIds);
        for (const sprint of closedSprints) {
          if (!syncedSet.has(sprint.id)) {
            logger.info(
              `Auto-queuing perf sync for sprint ${sprint.name} (project ${project.code})`,
              'PerformanceSyncService'
            );
            await perfSyncQueue.add('sync-sprint-performance', {
              projectId: project.id,
              jiraSprintId: sprint.id,
            });
          }
        }
      } catch (err: any) {
        logger.error(
          `detectAndEnqueueNewlyClosed failed for project ${project.code}: ${err.message}`,
          err,
          'PerformanceSyncService'
        );
      }
    }
  }

  // ─── Internal: score computation ──────────────────────────────────────────

  /**
   * Pure-ish score computation: builds PerfMemberScore rows from facts and
   * returns them WITHOUT persisting. Shared by the persisting wrapper
   * (computeAndSaveScores) and the live Kanban span read (generateLiveKanbanSpan).
   * `syncMeta.id` is null for the live path (rows are never written).
   */
  private async computeMemberScores(
    syncMeta: { id: number | null; startDate: string; endDate: string; sprintName: string | null },
    facts: PerfTicketFact[],
    projectId: number,
    jira: JiraService | null,
    preBuiltAccountIdMap?: Map<string, { email: string; displayName: string }>,
    options?: { includeOffboardBugs?: boolean }
  ): Promise<Partial<PerfMemberScore>[]> {
    // Build role map: jiraAccountId → 'developer' | 'qa' | 'other'
    // AccountTeamMember.role stores 'developer', 'qa', etc.
    const atm = await AccountTeamMember.findAll({
      where: { projectId },
      include: [{ model: TeamMember, as: 'teamMember', attributes: ['jiraLoginId', 'email', 'firstName', 'lastName'] }],
    });

    // Build role maps: email → category, displayName → category
    // Multiple keys per member for resilience against email mismatches
    // Substring match, not exact equality: a role field is free text (e.g. "VueJS
    // Developer", "Senior QA Engineer"), not a fixed enum. Exact equality against
    // 'developer'/'qa' silently mis-bucketed any non-canonical role string into
    // 'other' -- confirmed live on 2 non-Thrive projects (LOSAI, Compliance) where
    // roster role is literally "VueJS Developer": a genuine developer with real
    // delivered SP work was reclassified from the correct SP-heuristic 'developer'
    // to an incorrect roster-matched 'other'. 'qa' is checked first so a role like
    // "QA/Dev Hybrid" (containing both substrings) resolves to 'qa', the safer side
    // to err toward for scoring.
    const roleToCategory = (role: string): string => {
      const r = role.toLowerCase();
      if (r.includes('qa')) return 'qa';
      if (r.includes('dev')) return 'developer';
      return 'other';
    };

    const emailToCategory = new Map<string, string>();
    const nameToCategory = new Map<string, string>();
    for (const a of atm) {
      const tm = (a as any).teamMember;
      const jiraLoginId: string | undefined = tm?.jiraLoginId;
      const email: string | undefined = tm?.email;
      const category = roleToCategory((a as any).role ?? '');
      if (jiraLoginId) emailToCategory.set(jiraLoginId.toLowerCase(), category);
      if (email) emailToCategory.set(email.toLowerCase(), category);
      // displayName fallback: "FirstName LastName"
      const firstName: string = (tm?.firstName ?? '').trim();
      const lastName: string = (tm?.lastName ?? '').trim();
      if (firstName && lastName) {
        nameToCategory.set((firstName + ' ' + lastName).toLowerCase(), category);
      }
    }

    // Fuzzy fallback for roster matching, used below before anyone is treated as
    // "external". The exact email/name lookups above miss a genuine roster member
    // when Jira withholds their email (a Cloud privacy setting — falls back to the
    // raw accountId as a pseudo-email, which never matches) or when their Jira
    // display name is a shortened/varied form of the name stored on their roster
    // record (e.g. "Charly V" vs "Charly Varghese"). buildV2Matcher already solves
    // exactly this class of mismatch elsewhere (Delivery Presentation, member
    // dashboards) via jiraLoginId / exact-name / compact-substring / small-edit-
    // distance fallbacks — reused here rather than re-implemented.
    const rosterMatchers: { category: string; matcher: ReturnType<typeof buildV2Matcher> }[] = [];
    for (const a of atm) {
      const tm = (a as any).teamMember;
      if (!tm) continue;
      const category = roleToCategory((a as any).role ?? '');
      rosterMatchers.push({ category, matcher: buildV2Matcher([tm]) });
    }
    const matchRosterCategory = (
      jiraLoginId: string | null | undefined,
      displayName: string | null | undefined
    ): string | undefined => {
      for (const { category, matcher } of rosterMatchers) {
        if (matcher.matches(jiraLoginId, displayName)) return category;
      }
      return undefined;
    };

    // Resolve accountIds → { email, displayName }. Reuse the map built upstream
    // by syncSprint / syncKanbanPeriod when available (avoids duplicate Jira
    // API calls). When called from recomputeScores (re-running on existing
    // facts), no map is passed and we build it from scratch.
    let accountIdMap: Map<string, { email: string; displayName: string }>;
    if (preBuiltAccountIdMap) {
      accountIdMap = preBuiltAccountIdMap;
    } else {
      const uniqueAccountIds = new Set<string>();
      for (const f of facts) {
        if ((f as any).assigneeJiraId) uniqueAccountIds.add((f as any).assigneeJiraId);
        if ((f as any).qaTesterJiraId) uniqueAccountIds.add((f as any).qaTesterJiraId);
        if ((f as any).reporterJiraId) uniqueAccountIds.add((f as any).reporterJiraId);
      }
      accountIdMap = jira ? await buildAccountIdMap(jira, uniqueAccountIds) : new Map();
    }

    // Dev accumulators: keyed by accountId
    const devAccumulator = new Map<
      string,
      {
        displayName: string;
        email: string;
        spDone: number;
        spCarriedOver: number;
        spRework: number;
        deliveredCount: number;
        spilloverCount: number;
        /** DISPLAY ONLY. Points on still-open tickets, INCLUDING repeat
         *  carryovers -- unlike spCarriedOver, which omits them so points
         *  aren't double-counted across cycles. Never feeds spPlanned or any
         *  score; it exists so the scorecard can show pending work honestly. */
        spOpen: number;
        reopenedCount: number;
        invalidReopenedCount: number;
        cycleTimes: number[];
      }
    >();

    // QA accumulators: keyed by accountId
    const qaAccumulator = new Map<
      string,
      {
        displayName: string;
        email: string;
        bugsRaisedCount: number;
        invalidBugsCount: number;
        subBugsRaisedCount: number;
        offboardBugsRaisedCount: number;
        offboardSubBugsRaisedCount: number;
        bugsByPriority: Record<string, number>;
        ticketsTestedCount: number;
        qaCycleTimes: number[];
        prodBugsEscaped: number;
        clearedSP: number;
        uatFailedSP: number;
        inSprintBugCount: number;
        /** Denominator for the in-cycle catch: bugs whose parent type can
         *  actually answer "was this caught against this cycle's work".
         *  Excludes Epic-parented and unknown-parent bugs -- see
         *  isInCycleCatchEligible. Deliberately NOT bugsRaisedCount, which
         *  stays a true count of bugs raised for its own metric. */
        inSprintEligibleCount: number;
      }
    >();

    const ensureDev = (accountId: string) => {
      if (!devAccumulator.has(accountId)) {
        const info = accountIdMap.get(accountId) ?? { email: accountId, displayName: accountId };
        devAccumulator.set(accountId, {
          displayName: info.displayName,
          email: info.email,
          spDone: 0,
          spCarriedOver: 0,
          spRework: 0,
          deliveredCount: 0,
          spilloverCount: 0,
          spOpen: 0,
          reopenedCount: 0,
          invalidReopenedCount: 0,
          cycleTimes: [],
        });
      }
      return devAccumulator.get(accountId)!;
    };

    const ensureQa = (accountId: string) => {
      if (!qaAccumulator.has(accountId)) {
        const info = accountIdMap.get(accountId) ?? { email: accountId, displayName: accountId };
        qaAccumulator.set(accountId, {
          displayName: info.displayName,
          email: info.email,
          bugsRaisedCount: 0,
          invalidBugsCount: 0,
          subBugsRaisedCount: 0,
          offboardBugsRaisedCount: 0,
          offboardSubBugsRaisedCount: 0,
          bugsByPriority: { critical: 0, high: 0, medium: 0, low: 0 },
          ticketsTestedCount: 0,
          qaCycleTimes: [],
          prodBugsEscaped: 0,
          clearedSP: 0,
          uatFailedSP: 0,
          inSprintBugCount: 0,
          inSprintEligibleCount: 0,
        });
      }
      return qaAccumulator.get(accountId)!;
    };

    // Set of jira keys in this sync — used to detect bugs whose parent is a current-sprint story
    const currentSprintKeys = new Set<string>(facts.map((f: any) => f.jiraKey));

    // A bug is "new in this sprint" iff its Jira `created` timestamp falls within
    // the sprint's date window. Previous implementation used sync-history first-seen,
    // which mis-attributed bugs that pre-dated the team's earliest sync (e.g. LOT-2598
    // created Feb 2026 but first appeared in our PerfTicketFact rows under LOT 5.1).
    // startDate / endDate are DATEONLY (YYYY-MM-DD); we truncate jiraCreatedAt to its
    // UTC date for comparison. Bugs missing jiraCreatedAt (pre-backfill rows) are
    // excluded with a deduped warning rather than falling back to the old logic.
    const sprintStartStr = String(syncMeta.startDate);
    const sprintEndStr = String(syncMeta.endDate);
    const missingCreatedKeys = new Set<string>();
    const isNewBugInSprint = (fact: any): boolean => {
      if (!fact.jiraCreatedAt) {
        if (!missingCreatedKeys.has(fact.jiraKey)) {
          missingCreatedKeys.add(fact.jiraKey);
          logger.warn(
            `Skipping bug ${fact.jiraKey} from new-bug count: jira_created_at is null (re-sync or run backfill-perf-ticket-fact-created.js)`,
            'PerformanceSyncService'
          );
        }
        return false;
      }
      const createdStr = new Date(fact.jiraCreatedAt).toISOString().slice(0, 10);
      return createdStr >= sprintStartStr && createdStr <= sprintEndStr;
    };

    for (const f of facts) {
      const fact = f as any;

      // ── Developer metrics (per assignee) ────────────────────────
      // Skip sub-bugs from developer metrics — they only count for QA bug tracking
      const factTypeLower = (fact.issueType ?? '').toLowerCase();
      const isSubBugFact = factTypeLower.includes('bug') && factTypeLower !== 'bug';
      if (fact.assigneeJiraId && !isSubBugFact && !fact.wasPunted) {
        const acc = ensureDev(fact.assigneeJiraId);
        if (fact.wasCompleted) {
          acc.spDone += fact.storyPoints ?? 0;
          acc.deliveredCount += 1;
        } else if (fact.isPriorPeriodCompletion) {
          // Done-to-done shuffle (e.g. Pending Deployment -> Closed) --
          // real completion happened in an earlier cycle, not this one.
          // Not this cycle's done SP, and not carried/open work either --
          // excluded from both entirely.
        } else if (fact.isAdministrativeReassignment) {
          // Pure ownership handoff of an already-near-done ticket (e.g.
          // Pending Deployment) -- no development work happened, don't
          // count it toward this assignee's carried SP or ticket count.
        } else if (fact.isRepeatCarryover) {
          // Same open ticket already counted as carried in the
          // immediately-preceding cycle -- keep it visible in the ticket
          // count, but don't re-add its points to spCarriedOver/spPlanned.
          acc.spilloverCount += 1;
          acc.spOpen += fact.storyPoints ?? 0;
        } else {
          acc.spCarriedOver += fact.storyPoints ?? 0;
          acc.spilloverCount += 1;
          acc.spOpen += fact.storyPoints ?? 0;
        }
        if (fact.wasReopened) {
          acc.reopenedCount += 1;
          acc.spRework += fact.storyPoints ?? 0;
        }
        // Invalid reopens accrue independently of wasReopened: a ticket with
        // 1 reopen + 1 exclusion label has wasReopened=false but still
        // contributes 1 disregarded reopen here.
        acc.invalidReopenedCount += fact.invalidReopenCount ?? 0;
        if (fact.cycleTimeHours != null) acc.cycleTimes.push(fact.cycleTimeHours);
      }

      // ── QA metrics ────────────────────────────────────────────────
      // Bugs raised: every Bug/Sub-bug counted for whoever reported it,
      // BUT only in the sprint the bug was first logged — carryovers
      // from earlier sprints are skipped to prevent double-counting.
      // The downstream write-out block skips anyone classified as 'developer',
      // so devs who incidentally file a bug don't create a spurious QA row.
      if ((fact.issueType ?? '').toLowerCase().includes('bug') && fact.reporterJiraId && isNewBugInSprint(fact)) {
        const acc = ensureQa(fact.reporterJiraId);
        acc.bugsRaisedCount += 1;
        // Invalid bug: Root Cause == 'Invalid Bug' or a fuzzy invalid-bug label.
        if (fact.invalidBug) acc.invalidBugsCount += 1;
        // Sub-bugs (issue type contains 'bug' but is NOT exactly 'bug') are
        // counted separately so the narrative can split top-level Bug vs
        // Sub-bug. Sub-bugs typically don't force a parent reopen, which
        // explains why bug counts can be much higher than reopen counts.
        if (factTypeLower !== 'bug') {
          acc.subBugsRaisedCount += 1;
        }
        const pri = (fact.bugPriority ?? 'medium').toLowerCase();
        if (pri in acc.bugsByPriority) {
          acc.bugsByPriority[pri] += 1;
        } else {
          acc.bugsByPriority['medium'] += 1;
        }
        if (fact.isProductionBug) acc.prodBugsEscaped += 1;
        // In-sprint catch: bug's parent story is a current-sprint issue.
        // Only counted when the parent can actually answer the question --
        // an Epic parent (or an unknown one) is skipped entirely rather
        // than scored as a miss.
        if (isInCycleCatchEligible(fact.parentKey ?? null, fact.parentIssueType ?? null)) {
          acc.inSprintEligibleCount += 1;
          if (currentSprintKeys.has(fact.parentKey)) {
            acc.inSprintBugCount += 1;
          }
        }
      }

      // Tickets tested: qa_tester_jira_id. Prior-period completions are
      // skipped for the same reason the developer block skips them above --
      // the testing happened in an earlier cycle, so crediting it again here
      // double-counts ticketsTestedCount and clearedSP. Defensive: such rows
      // are no longer written, but historical spans still hold them and
      // recomputeScoresFromStored replays those rows verbatim.
      if (fact.qaTesterJiraId && !fact.isPriorPeriodCompletion) {
        const acc = ensureQa(fact.qaTesterJiraId);
        acc.ticketsTestedCount += 1;
        if (fact.timeInQaHours != null) acc.qaCycleTimes.push(fact.timeInQaHours);
        // SP-weighted UAT-pass tracking: every tested ticket contributes to "cleared",
        // and the SP of any UAT rejection is the failure charge.
        const sp = Number(fact.storyPoints ?? 0);
        acc.clearedSP += sp;
        if (fact.wasUatRejected) acc.uatFailedSP += sp;
      }
    }

    // ── Off-board bug supplement ──────────────────────────────────────────
    // The board fetch (`sprint = {id}`) only ingests bugs ATTACHED to the
    // sprint. Teams often log Bugs/Sub-bugs without ever putting them in a
    // sprint, so those never reach perf_ticket_facts and the member dashboard
    // under-counts "Bugs logged". Here we additionally pull every Bug/Sub-bug
    // CREATED within the sprint window for this project, drop the ones already
    // counted on-board, and credit the remainder to their reporter via the
    // SEPARATE offboard_* counters (kept out of quality_rate / leakage math).
    // Best-effort: a Jira failure must not fail the sync. Skipped when jira is
    // null (recomputeScoresFromStored path — no live Jira available).
    if (jira && options?.includeOffboardBugs !== false) {
      try {
        const projForJira = await Project.findByPk(projectId);
        const jiraName = projForJira?.jiraName;
        if (jiraName) {
          const startStr = String(syncMeta.startDate);
          const endStr = String(syncMeta.endDate);
          const offboardJql =
            `project = "${jiraName}" ` +
            `AND issuetype in (Bug, "Sub-bug") ` +
            `AND created >= "${startStr}" AND created <= "${endStr} 23:59" ` +
            `ORDER BY created ASC`;
          const offIssues = await jira.getAllIssuesFromJql(offboardJql);

          // Resolve names for any reporters not already in the account map.
          const newReporterIds = new Set<string>();
          for (const iss of offIssues) {
            const rid = (iss as any).fields?.reporter?.accountId;
            if (rid && !accountIdMap.has(rid)) newReporterIds.add(rid);
          }
          if (newReporterIds.size) {
            const extraMap = await buildAccountIdMap(jira, newReporterIds);
            for (const [k, v] of extraMap.entries()) accountIdMap.set(k, v);
          }

          let offCounted = 0;
          for (const iss of offIssues) {
            const key = (iss as any).key as string;
            if (currentSprintKeys.has(key)) continue; // already counted on-board
            const f = (iss as any).fields ?? {};
            const reporterId: string | null = f.reporter?.accountId ?? null;
            if (!reporterId) continue;
            const typeLower = (f.issuetype?.name ?? '').toLowerCase();
            if (!typeLower.includes('bug')) continue;
            const acc = ensureQa(reporterId);
            acc.offboardBugsRaisedCount += 1;
            if (typeLower !== 'bug') acc.offboardSubBugsRaisedCount += 1;
            offCounted += 1;
          }
          logger.info(
            `Off-board bug supplement: +${offCounted} bugs/sub-bugs (of ${offIssues.length} in-window) for sprint ${syncMeta.sprintName}`,
            'PerformanceSyncService'
          );
        }
      } catch (e: any) {
        logger.warn(`Off-board bug supplement skipped (Jira query failed): ${e.message}`, 'PerformanceSyncService');
      }
    }

    // Build PerfMemberScore records
    const scores: Partial<PerfMemberScore>[] = [];
    // Track accountIds that actually got a developer row written, so the
    // QA-side loop can skip only true duplicates (not members who were
    // accumulated as assignees but classified as QA).
    const writtenDevAccountIds = new Set<string>();

    // Developer scores
    // jiraLoginId = Jira accountId (so ticket fact filters match directly on assigneeJiraId)
    for (const [accountId, acc] of devAccumulator.entries()) {
      const memberInfo = accountIdMap.get(accountId);
      const memberEmail = (memberInfo?.email ?? accountId).toLowerCase();
      let category =
        emailToCategory.get(memberEmail) ??
        nameToCategory.get((memberInfo?.displayName ?? '').toLowerCase()) ??
        matchRosterCategory(accountId, memberInfo?.displayName);
      if (!category) {
        // External (not in AccountTeamMember). Real dev work (any SP done
        // or carried over) is the substantive signal — keep them as dev
        // even if they also filed bugs or transitioned tickets out of QA
        // (common pattern for tech leads). Only when SP work is zero do
        // we look for QA signals.
        const hasDevWork = acc.spDone > 0 || acc.spCarriedOver > 0;
        if (hasDevWork) {
          category = 'developer';
        } else {
          const qAcc = qaAccumulator.get(accountId);
          const qaTested = qAcc?.ticketsTestedCount ?? 0;
          const bugsRaised = qAcc?.bugsRaisedCount ?? 0;
          const ticketCount = acc.deliveredCount + acc.spilloverCount;
          const hasExplicitQaSignal = qaTested >= 1 || bugsRaised >= 1;
          const hasImplicitZeroSpSignal = ticketCount >= 2;
          category = hasExplicitQaSignal || hasImplicitZeroSpSignal ? 'qa' : 'developer';
        }
      }
      if (category === 'qa') {
        // Seed qaAccumulator so the QA write loop emits a row for members
        // whose only signal was "zero-SP tickets only" (no qa-tester /
        // bug-reporter activity to seed them otherwise).
        if (!qaAccumulator.has(accountId)) {
          ensureQa(accountId);
        }
        continue;
      }

      const spPlanned = acc.spDone + acc.spCarriedOver;
      const deliveryPct = spPlanned > 0 ? round1((acc.spDone / spPlanned) * 100) : 0;
      const reworkFactor = spPlanned > 0 ? round1((acc.spRework / spPlanned) * 100) : 0;
      const executionScore = round1(deliveryPct * 0.8 + (100 - reworkFactor) * 0.2);
      // reopenRatePct kept for informational display (issue-count based)
      const reopenRatePct = acc.deliveredCount > 0 ? round1((acc.reopenedCount / acc.deliveredCount) * 100) : 0;
      const avgCycleTime =
        acc.cycleTimes.length > 0 ? round1(acc.cycleTimes.reduce((a, b) => a + b, 0) / acc.cycleTimes.length) : null;

      scores.push({
        syncId: syncMeta.id ?? undefined,
        projectId,
        jiraLoginId: accountId, // store accountId — matches ticket fact fields
        displayName: acc.displayName,
        memberCategory: 'developer',
        spPlanned,
        spDone: acc.spDone,
        spCarriedOver: acc.spCarriedOver,
        spRework: acc.spRework,
        reworkFactor,
        deliveredCount: acc.deliveredCount,
        spilloverCount: acc.spilloverCount,
        // Display only — deliberately NOT part of spPlanned/deliveryPct above.
        spOpen: round1(acc.spOpen),
        reopenedCount: acc.reopenedCount,
        invalidReopenedCount: acc.invalidReopenedCount,
        reopenRatePct,
        deliveryPct,
        avgCycleTimeHours: avgCycleTime,
        executionScore,
      });
      writtenDevAccountIds.add(accountId);
    }

    // QA scores — skip members who already have a dev score (avoids unique constraint violation
    // when a developer also appears as a QA tester in ticket facts). Note: we check
    // writtenDevAccountIds (rows actually emitted), not devAccumulator.keys(), so a
    // QA member who was an incidental assignee still gets a QA row.
    for (const [accountId, acc] of qaAccumulator.entries()) {
      const memberInfo = accountIdMap.get(accountId);
      const memberEmail = (memberInfo?.email ?? accountId).toLowerCase();
      const category =
        emailToCategory.get(memberEmail) ??
        nameToCategory.get((memberInfo?.displayName ?? '').toLowerCase()) ??
        matchRosterCategory(accountId, memberInfo?.displayName) ??
        'other';
      // Skip if already written as a developer score, or explicitly classified as developer
      if (writtenDevAccountIds.has(accountId) || category === 'developer') continue;

      const prio = acc.bugsByPriority;
      const weightedScore = round1(
        (prio.critical ?? 0) * 3 + (prio.high ?? 0) * 2 + (prio.medium ?? 0) * 1.5 + (prio.low ?? 0) * 1
      );

      // Composite QA quality: 0.70 × UAT pass rate (SP-weighted) + 0.30 × in-sprint catch.
      // Stored as a risk-rate (1 − composite) × 100 so the existing `<=` qualityBand thresholds
      // keep their semantics (lower = better). Sentinel -1 when activity is below the floor.
      const passRate = acc.clearedSP > 0 ? 1 - acc.uatFailedSP / acc.clearedSP : 1;
      // Denominator is the ELIGIBLE bugs, not every bug raised: a bug
      // parented to an Epic can't be judged on in-cycle catch, so it is
      // excluded from both sides rather than counted as a miss. When none
      // are eligible the ratio falls back to 1 (no penalty), same as when
      // no bugs were raised at all.
      const inSprintCatch = acc.inSprintEligibleCount > 0 ? acc.inSprintBugCount / acc.inSprintEligibleCount : 1;
      const composite = 0.7 * passRate + 0.3 * inSprintCatch;
      const qualityRate = acc.ticketsTestedCount < 5 ? -1 : round1((1 - composite) * 100);

      // Display-only: escape rate vs tickets tested (denominator fix). Not fed into qualityRate.
      const bugEscapeRatePct =
        acc.ticketsTestedCount > 0 ? round1((acc.prodBugsEscaped / acc.ticketsTestedCount) * 100) : 0;
      const avgQaCycle =
        acc.qaCycleTimes.length > 0
          ? round1(acc.qaCycleTimes.reduce((a, b) => a + b, 0) / acc.qaCycleTimes.length)
          : null;

      scores.push({
        syncId: syncMeta.id ?? undefined,
        projectId,
        jiraLoginId: accountId, // store accountId — matches ticket fact fields
        displayName: acc.displayName,
        memberCategory: 'qa',
        bugsRaisedCount: acc.bugsRaisedCount,
        invalidBugsCount: acc.invalidBugsCount,
        subBugsRaisedCount: acc.subBugsRaisedCount,
        offboardBugsRaisedCount: acc.offboardBugsRaisedCount,
        offboardSubBugsRaisedCount: acc.offboardSubBugsRaisedCount,
        bugsByPriority: acc.bugsByPriority,
        weightedBugScore: weightedScore,
        ticketsTestedCount: acc.ticketsTestedCount,
        avgQaCycleTimeHours: avgQaCycle,
        prodBugsEscaped: acc.prodBugsEscaped,
        bugEscapeRatePct,
        qualityRate,
        // Persist the raw counters behind qualityRate, not just the derived
        // rate. A review cycle covering several sprints has to re-derive
        // the rate from summed numerators/denominators; without these it
        // can only average per-sprint percentages, which weights a small
        // sprint equally with a large one.
        clearedSp: acc.clearedSP,
        uatFailedSp: acc.uatFailedSP,
        inSprintBugCount: acc.inSprintBugCount,
        inSprintEligibleCount: acc.inSprintEligibleCount,
      });
    }

    return scores;
  }

  /**
   * Persisting wrapper: compute member scores and write them, replacing any
   * existing rows for this sync. Used by all sync paths (sprint + kanban +
   * recompute). The live Kanban span read calls computeMemberScores directly.
   */
  private async computeAndSaveScores(
    syncRecord: PerfSprintSync,
    facts: PerfTicketFact[],
    projectId: number,
    jira: JiraService | null,
    preBuiltAccountIdMap?: Map<string, { email: string; displayName: string }>
  ): Promise<void> {
    const scores = await this.computeMemberScores(
      {
        id: syncRecord.id,
        startDate: String(syncRecord.startDate),
        endDate: String(syncRecord.endDate),
        sprintName: syncRecord.sprintName ?? null,
      },
      facts,
      projectId,
      jira,
      preBuiltAccountIdMap
    );

    // Resolve each score's Jira accountId to a team member through a CONFIRMED
    // identity link, so the performance review module never has to re-run
    // fuzzy name matching. Unresolved rows keep teamMemberId = null on
    // purpose: that null is what makes an unlinked person visible as zero
    // coverage instead of silently vanishing from their own review.
    const identityMap = await resolveSourceKeys(projectId, 'jira');
    for (const score of scores as any[]) {
      score.teamMemberId = identityMap.get(score.jiraLoginId) ?? null;
    }

    // Delete existing scores for this sync (handles re-sync idempotently)
    await PerfMemberScore.destroy({ where: { syncId: syncRecord.id } });
    if (scores.length > 0) {
      await PerfMemberScore.bulkCreate(scores as any[]);
    }

    const unresolved = (scores as any[]).filter(s => !s.teamMemberId).length;
    if (unresolved > 0) {
      logger.warn(
        `${unresolved} of ${scores.length} member scores for sync ${syncRecord.id} have no confirmed identity link`,
        'PerformanceSyncService',
      );
    }

    // Offer this sync to any OPEN review cycle whose window claims it. Locked
    // and published cycles are deliberately untouched — a re-sync must never
    // rewrite an artefact of record.
    //
    // Isolated: the performance review module is downstream of delivery sync,
    // so a failure here must never fail the sync that produced the data.
    try {
      const touched = await attachSyncToOpenCycles(
        projectId,
        syncRecord.id,
        String(syncRecord.endDate),
        syncRecord.syncType,
      );
      if (touched.length > 0) {
        logger.info(
          `Sync ${syncRecord.id} attached to review cycle(s) ${touched.join(', ')}`,
          'PerformanceSyncService',
        );
      }
    } catch (error) {
      logger.warn(
        `Could not attach sync ${syncRecord.id} to review cycles: ${error instanceof Error ? error.message : error}`,
        'PerformanceSyncService',
      );
    }

    logger.info(`Computed ${scores.length} member scores for sync ${syncRecord.id}`, 'PerformanceSyncService');
  }

  private async loadProdBugKeys(projectId: number, startDate: string, endDate: string): Promise<Set<string>> {
    const snapshots = await DailyBoardSnapshot.findAll({
      where: {
        projectId,
        date: { [Op.between]: [startDate, endDate] },
        confirmedProdBugKeys: { [Op.ne]: null },
      },
      attributes: ['confirmedProdBugKeys'],
    });
    const keys = new Set<string>();
    for (const s of snapshots) {
      for (const k of s.confirmedProdBugKeys ?? []) keys.add(k);
    }
    return keys;
  }
  // ─── Productivity Overview (cross-project) ──────────────────────────────

  async getProductivityOverview(
    v2Only: boolean,
    accountId?: number
  ): Promise<{
    projects: {
      projectId: number;
      projectName: string;
      accountName: string;
      sprints: {
        syncId: number;
        sprintName: string;
        startDate: string;
        endDate: string;
        spDone: number;
        spPlanned: number;
        productivity: number;
        devCount: number;
        syncType: string;
        periodDays: number;
      }[];
      currentProductivity: number | null;
      avgProductivity: number | null;
      trend: 'up' | 'down' | 'neutral';
      trendPct: number;
      health: 'green' | 'amber' | 'red';
      isKanbanProject: boolean;
      metricKind: 'percent' | 'throughput';
      hasLegacySprintHistory: boolean;
    }[];
  }> {
    // 1. Get non-shared, ACTIVE projects (sprint + kanban; filtered by account if provided).
    // Inactive projects (Project.isActive=false) are hidden from Trends, matching
    // Board View/Presentation pickers and the Account/Program report rollups.
    const projectWhere: any = { isSharedTeam: false, isActive: true };
    if (accountId) projectWhere.accountId = accountId;
    const allProjects = await Project.findAll({
      where: projectWhere,
      include: [{ model: Account, attributes: ['id', 'name'] }],
      attributes: ['id', 'name', 'isKanbanProject', 'tracksCommitment'],
    });

    if (allProjects.length === 0) return { projects: [] };

    const projectIds = allProjects.map(p => p.id);
    // Each project shows only its own span type (kanban projects → kanban syncs).
    const projectMode = new Map<number, 'sprint' | 'kanban'>(
      allProjects.map(p => [p.id, (p as any).isKanbanProject ? 'kanban' : 'sprint'])
    );

    // 2. Build V2 name set if filtering (used later to match against PerfMemberScore display names)
    let v2DisplayNames: Set<string> | null = null;
    if (v2Only) {
      const v2Members = await TeamMember.findAll({
        where: { v2Member: true },
        attributes: ['firstName', 'lastName'],
      });
      v2DisplayNames = new Set(
        v2Members
          .map(m => ((m as any).firstName + ' ' + (m as any).lastName).trim().toLowerCase())
          .filter(n => n.length > 0)
      );
    }

    // 3. Get last 5 completed syncs per project (batch query). Sprint projects
    // use sprint syncs; kanban projects use kanban span syncs.
    const allSyncs = await PerfSprintSync.findAll({
      where: {
        projectId: { [Op.in]: projectIds },
        syncType: { [Op.in]: ['sprint', 'kanban'] },
        syncStatus: 'done',
      },
      // Secondary sort by id DESC gives a deterministic tiebreaker when two
      // syncs share a start_date -- e.g. a Kanban project's cadence config
      // changed (window/stride) mid-history, leaving overlapping cycle syncs
      // that start the same day but cover different windows. Without this,
      // which one lands in "last 5" was undefined by Postgres and could flip
      // between requests. Higher id = synced more recently, which is always
      // the one reflecting the project's CURRENT cadence config.
      order: [
        ['project_id', 'ASC'],
        ['start_date', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    // Group syncs by project, take first 5 per project by recency. Rows are
    // not filtered to the project's current syncType so a project that
    // switched delivery models (e.g. Scrum -> Kanban) keeps a continuous
    // trend across the cutover instead of resetting to its new mode's
    // syncs alone.
    const syncsByProject = new Map<number, PerfSprintSync[]>();
    // Whether a project has ANY syncType='sprint' row at all -- computed from
    // allSyncs (the project's FULL synced history, not the last-5 cap below),
    // since the legacy-view toggle needs to stay correct even once a fully-
    // transitioned Kanban project's last-5 window has aged all sprints out.
    const projectIdsWithSprintHistory = new Set<number>();
    for (const sync of allSyncs) {
      const arr = syncsByProject.get(sync.projectId) ?? [];
      if (arr.length < 5) arr.push(sync);
      syncsByProject.set(sync.projectId, arr);
      if (sync.syncType === 'sprint') projectIdsWithSprintHistory.add(sync.projectId);
    }

    // 4. Batch-fetch unique ticket facts for relevant syncs
    const allSyncIds = Array.from(syncsByProject.values())
      .flat()
      .map(s => s.id);
    if (allSyncIds.length === 0) return { projects: [] };

    const allFacts = await PerfTicketFact.findAll({
      where: {
        syncId: { [Op.in]: allSyncIds },
        wasPunted: false,
        // Keeps spPlanned from counting work finished in an earlier cycle.
        ...EXCLUDE_PRIOR_PERIOD_COMPLETION,
      },
      attributes: ['id', 'syncId', 'jiraKey', 'assigneeJiraId', 'storyPoints', 'wasCompleted'],
    });

    // Deduplicate facts by (syncId, jiraKey) — keep first occurrence
    const uniqueFactsBySyncId = new Map<number, Map<string, PerfTicketFact>>();
    for (const fact of allFacts) {
      let syncMap = uniqueFactsBySyncId.get(fact.syncId);
      if (!syncMap) {
        syncMap = new Map();
        uniqueFactsBySyncId.set(fact.syncId, syncMap);
      }
      if (!syncMap.has(fact.jiraKey)) syncMap.set(fact.jiraKey, fact);
    }

    // Fetch developer scores per sync (for devCount + V2 filtering by display name)
    const allScores = await PerfMemberScore.findAll({
      where: { syncId: { [Op.in]: allSyncIds }, memberCategory: 'developer' },
      attributes: ['syncId', 'jiraLoginId', 'displayName'],
    });
    const devsBySyncId = new Map<number, Set<string>>();
    // Build V2 account ID set: match PerfMemberScore.displayName against TeamMember names
    let v2AccountIds: Set<string> | null = null;
    if (v2DisplayNames) {
      v2AccountIds = new Set<string>();
    }
    for (const s of allScores) {
      const set = devsBySyncId.get(s.syncId) ?? new Set();
      set.add(s.jiraLoginId);
      devsBySyncId.set(s.syncId, set);
      if (v2DisplayNames && v2AccountIds && s.displayName) {
        // Jira display names may have suffixes like "_EXT" — strip them
        const nameLower = s.displayName.replace(/_ext$/i, '').trim().toLowerCase();
        if (v2DisplayNames.has(nameLower)) {
          v2AccountIds.add(s.jiraLoginId);
        }
      }
    }

    // 5. Build response
    const result: {
      projectId: number;
      projectName: string;
      accountName: string;
      sprints: {
        syncId: number;
        sprintName: string;
        startDate: string;
        endDate: string;
        spDone: number;
        spPlanned: number;
        productivity: number;
        devCount: number;
        syncType: string;
        periodDays: number;
      }[];
      currentProductivity: number | null;
      avgProductivity: number | null;
      trend: 'up' | 'down' | 'neutral';
      trendPct: number;
      health: 'green' | 'amber' | 'red';
      isKanbanProject: boolean;
      metricKind: 'percent' | 'throughput';
      hasLegacySprintHistory: boolean;
    }[] = [];

    for (const project of allProjects) {
      const syncs = syncsByProject.get(project.id);
      if (!syncs || syncs.length === 0) continue;

      const sprintRows = syncs.map(sync => {
        const syncFacts = uniqueFactsBySyncId.get(sync.id);
        let facts = syncFacts ? Array.from(syncFacts.values()) : [];
        if (v2AccountIds) {
          facts = facts.filter(f => f.assigneeJiraId && v2AccountIds!.has(f.assigneeJiraId));
        }
        const { spDone, spPlanned, productivity } = computeSprintProductivity(facts);

        let devCount = 0;
        const devSet = devsBySyncId.get(sync.id);
        if (devSet) {
          devCount = v2AccountIds ? Array.from(devSet).filter(id => v2AccountIds!.has(id)).length : devSet.size;
        }

        const periodDays = Math.max(
          1,
          Math.round((new Date(sync.endDate).getTime() - new Date(sync.startDate).getTime()) / 86400000) + 1
        );

        return {
          syncId: sync.id,
          sprintName: sync.sprintName ?? sync.periodLabel ?? '',
          startDate: sync.startDate,
          endDate: sync.endDate,
          spDone,
          spPlanned,
          productivity,
          devCount,
          syncType: sync.syncType,
          periodDays,
        };
      });

      const isKanban = projectMode.get(project.id) === 'kanban';
      // Which sync type to read (kanban vs sprint spans) stays keyed on
      // isKanban -- that's a data-source decision. Which TREND ALGORITHM and
      // display framing to use is a different question: a Kanban project that
      // explicitly tracks commitment should still get percent-style trend/health,
      // not throughput -- so this is keyed on hasCommitment, not isKanban.
      const projectHasCommitment = hasCommitment(project as any);
      let currentProductivity: number | null;
      let avgProductivity: number | null;
      let trend: 'up' | 'down' | 'neutral';
      let trendPct: number;
      let health: 'green' | 'amber' | 'red';

      if (!projectHasCommitment) {
        // No committed target -- measure throughput (SP completed per span)
        // and grade trend/health against the project's OWN rolling average of
        // prior spans, not the sprint %-bands.
        //
        // Raw spDone totals aren't comparable across spans of different
        // lengths -- a project moving from 14-day sprints to a 5-day
        // cadence (e.g. WO's Scrum->Kanban cutover, or LS's 7-day->5-day
        // stride change) would otherwise read as a false productivity
        // crash purely because the newer spans are shorter. Rescale each
        // historical span's SP to "what it would have delivered in a span
        // as long as the CURRENT one" (same daily rate, current's day
        // count) before averaging, so the comparison is apples-to-apples.
        // currentProductivity stays the raw current-span total (periodDays
        // cancels out for the current row itself), so display/sort fields
        // that already assume raw SP (frontend ProductivityOverview.tsx)
        // are unaffected.
        const currentPeriodDays = sprintRows.length > 0 ? sprintRows[0].periodDays : 1;
        const lengthAdjustedRows = sprintRows.map(r => ({
          productivity: (r.spDone / r.periodDays) * currentPeriodDays,
        }));
        const t = computeProductivityTrend(lengthAdjustedRows);
        currentProductivity = t.currentProductivity; // SP completed in the latest span
        avgProductivity = t.avgProductivity; // length-adjusted mean SP of prior spans
        trend = t.trend;
        trendPct = t.trendPct;
        health = throughputHealth(currentProductivity, avgProductivity);
      } else {
        const t = computeProductivityTrend(sprintRows);
        currentProductivity = t.currentProductivity;
        avgProductivity = t.avgProductivity;
        trend = t.trend;
        trendPct = t.trendPct;
        health = t.health;
      }

      result.push({
        projectId: project.id,
        projectName: project.name,
        accountName: (project as any).account?.name ?? '',
        sprints: sprintRows,
        currentProductivity,
        avgProductivity,
        trend,
        trendPct,
        health,
        isKanbanProject: isKanban,
        metricKind: projectHasCommitment ? 'percent' : 'throughput',
        hasLegacySprintHistory: projectIdsWithSprintHistory.has(project.id),
      });
    }

    return { projects: result };
  }

  // ─── Legacy Sprint View (single project, opt-in) ───────────────────────────
  // For a project that switched Scrum -> Kanban mid-history: an on-demand,
  // read-only reconstruction of "what this project's Trends row looked like
  // before the switch" -- last 5 syncType='sprint' rows ONLY, graded with the
  // original percent/commitment algorithm, independent of the project's
  // CURRENT isKanbanProject/tracksCommitment values. Correct to compute even
  // after cutover: historically hasCommitment() was true for a Scrum project
  // simply because isKanbanProject was false back then (hasCommitment =
  // !isKanbanProject || tracksCommitment), not because of tracksCommitment --
  // so no historical-config-tracking is needed, just filtering to the old
  // sync rows. Manual/opt-in only; not wired into any default view or cron.
  async getLegacySprintView(projectId: number): Promise<{
    projectId: number;
    projectName: string;
    sprints: {
      syncId: number;
      sprintName: string;
      startDate: string;
      endDate: string;
      spDone: number;
      spPlanned: number;
      productivity: number;
      devCount: number;
    }[];
    currentProductivity: number | null;
    avgProductivity: number | null;
    trend: 'up' | 'down' | 'neutral';
    trendPct: number;
    health: 'green' | 'amber' | 'red';
    metricKind: 'percent';
  } | null> {
    const project = await Project.findByPk(projectId, { attributes: ['id', 'name'] });
    if (!project) return null;

    const syncs = await PerfSprintSync.findAll({
      where: { projectId, syncType: 'sprint', syncStatus: 'done' },
      order: [
        ['start_date', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 5,
    });
    if (syncs.length === 0) return null;

    const syncIds = syncs.map(s => s.id);
    const allFacts = await PerfTicketFact.findAll({
      where: { syncId: { [Op.in]: syncIds }, wasPunted: false, ...EXCLUDE_PRIOR_PERIOD_COMPLETION },
      attributes: ['id', 'syncId', 'jiraKey', 'assigneeJiraId', 'storyPoints', 'wasCompleted'],
    });
    const uniqueFactsBySyncId = new Map<number, Map<string, PerfTicketFact>>();
    for (const fact of allFacts) {
      let syncMap = uniqueFactsBySyncId.get(fact.syncId);
      if (!syncMap) {
        syncMap = new Map();
        uniqueFactsBySyncId.set(fact.syncId, syncMap);
      }
      if (!syncMap.has(fact.jiraKey)) syncMap.set(fact.jiraKey, fact);
    }
    const allScores = await PerfMemberScore.findAll({
      where: { syncId: { [Op.in]: syncIds }, memberCategory: 'developer' },
      attributes: ['syncId', 'jiraLoginId'],
    });
    const devsBySyncId = new Map<number, Set<string>>();
    for (const s of allScores) {
      const set = devsBySyncId.get(s.syncId) ?? new Set();
      set.add(s.jiraLoginId);
      devsBySyncId.set(s.syncId, set);
    }

    const sprintRows = syncs.map(sync => {
      const facts = Array.from((uniqueFactsBySyncId.get(sync.id) ?? new Map()).values());
      const { spDone, spPlanned, productivity } = computeSprintProductivity(facts);
      return {
        syncId: sync.id,
        sprintName: sync.sprintName ?? '',
        startDate: sync.startDate,
        endDate: sync.endDate,
        spDone,
        spPlanned,
        productivity,
        devCount: devsBySyncId.get(sync.id)?.size ?? 0,
      };
    });

    const t = computeProductivityTrend(sprintRows);
    return {
      projectId: project.id,
      projectName: project.name,
      sprints: sprintRows,
      currentProductivity: t.currentProductivity,
      avgProductivity: t.avgProductivity,
      trend: t.trend,
      trendPct: t.trendPct,
      health: t.health,
      metricKind: 'percent',
    };
  }

  // ─── Quality Trends Overview (cross-project) ───────────────────────────────

  async getQualityTrendsOverview(
    v2Only: boolean,
    accountId?: number
  ): Promise<{
    projects: {
      projectId: number;
      projectName: string;
      accountName: string;
      sprints: {
        syncId: number;
        sprintName: string;
        startDate: string;
        endDate: string;
        spDone: number;
        spPlanned: number;
        productivity: number;
        devCount: number;
        bugCount: number;
        defectDensity: number;
        prodBugCount: number;
        reopenedStoryCount: number;
        totalStoryCount: number;
        reopenRatio: number;
      }[];
      productivity: {
        current: number | null;
        avg: number | null;
        trend: 'up' | 'down' | 'neutral';
        trendPct: number;
        health: 'green' | 'amber' | 'red';
      };
      defectDensity: {
        current: number | null;
        avg: number | null;
        trend: 'up' | 'down' | 'neutral';
        trendPct: number;
        health: 'green' | 'amber' | 'red';
      };
      defectLeakage: {
        current: number | null;
        avg: number | null;
        trend: 'up' | 'down' | 'neutral';
        trendPct: number;
        health: 'green' | 'amber' | 'red';
      };
      reopenRatio: {
        current: number | null;
        avg: number | null;
        trend: 'up' | 'down' | 'neutral';
        trendPct: number;
        health: 'green' | 'amber' | 'red';
      };
      isKanbanProject: boolean;
      metricKind: 'percent' | 'throughput';
    }[];
  }> {
    // 1. Get non-shared, ACTIVE projects (sprint + kanban) -- see getProductivityOverview.
    const projectWhere: any = { isSharedTeam: false, isActive: true };
    if (accountId) projectWhere.accountId = accountId;
    const allProjects = await Project.findAll({
      where: projectWhere,
      include: [{ model: Account, attributes: ['id', 'name'] }],
      attributes: ['id', 'name', 'isKanbanProject', 'tracksCommitment'],
    });

    if (allProjects.length === 0) return { projects: [] };

    const projectIds = allProjects.map(p => p.id);
    // Each project shows only its own span type (kanban projects → kanban syncs).
    const projectMode = new Map<number, 'sprint' | 'kanban'>(
      allProjects.map(p => [p.id, (p as any).isKanbanProject ? 'kanban' : 'sprint'])
    );

    // 2. V2 name set
    let v2DisplayNames: Set<string> | null = null;
    if (v2Only) {
      const v2Members = await TeamMember.findAll({
        where: { v2Member: true },
        attributes: ['firstName', 'lastName'],
      });
      v2DisplayNames = new Set(
        v2Members
          .map(m => ((m as any).firstName + ' ' + (m as any).lastName).trim().toLowerCase())
          .filter(n => n.length > 0)
      );
    }

    // 3. Last 5 completed syncs per project (sprint or kanban, matching the project type)
    const allSyncs = await PerfSprintSync.findAll({
      where: {
        projectId: { [Op.in]: projectIds },
        syncType: { [Op.in]: ['sprint', 'kanban'] },
        syncStatus: 'done',
      },
      // Secondary sort by id DESC gives a deterministic tiebreaker when two
      // syncs share a start_date -- e.g. a Kanban project's cadence config
      // changed (window/stride) mid-history, leaving overlapping cycle syncs
      // that start the same day but cover different windows. Without this,
      // which one lands in "last 5" was undefined by Postgres and could flip
      // between requests. Higher id = synced more recently, which is always
      // the one reflecting the project's CURRENT cadence config.
      order: [
        ['project_id', 'ASC'],
        ['start_date', 'DESC'],
        ['id', 'DESC'],
      ],
    });

    // Rows are not filtered to the project's current syncType so a project
    // that switched delivery models (e.g. Scrum -> Kanban) keeps a
    // continuous trend across the cutover instead of resetting to its new
    // mode's syncs alone.
    const syncsByProject = new Map<number, PerfSprintSync[]>();
    for (const sync of allSyncs) {
      const arr = syncsByProject.get(sync.projectId) ?? [];
      if (arr.length < 5) arr.push(sync);
      syncsByProject.set(sync.projectId, arr);
    }

    // 4. Batch-fetch ticket facts with quality-relevant fields
    const allSyncIds = Array.from(syncsByProject.values())
      .flat()
      .map(s => s.id);
    if (allSyncIds.length === 0) return { projects: [] };

    const allFacts = await PerfTicketFact.findAll({
      where: {
        syncId: { [Op.in]: allSyncIds },
        wasPunted: false,
        // Keeps the spPlanned and reopen-ratio denominators from counting
        // work finished in an earlier cycle.
        ...EXCLUDE_PRIOR_PERIOD_COMPLETION,
      },
      attributes: [
        'id',
        'syncId',
        'jiraKey',
        'assigneeJiraId',
        'storyPoints',
        'wasCompleted',
        'issueType',
        'isProductionBug',
        'wasReopened',
        'invalidReopenCount',
        'parentKey',
        'jiraCreatedAt',
        'invalidBug',
      ],
    });

    // Deduplicate facts by (syncId, jiraKey)
    const uniqueFactsBySyncId = new Map<number, Map<string, PerfTicketFact>>();
    for (const fact of allFacts) {
      let syncMap = uniqueFactsBySyncId.get(fact.syncId);
      if (!syncMap) {
        syncMap = new Map();
        uniqueFactsBySyncId.set(fact.syncId, syncMap);
      }
      if (!syncMap.has(fact.jiraKey)) syncMap.set(fact.jiraKey, fact);
    }

    // 5. Developer scores for devCount + V2 filtering
    const allScores = await PerfMemberScore.findAll({
      where: { syncId: { [Op.in]: allSyncIds }, memberCategory: 'developer' },
      attributes: ['syncId', 'jiraLoginId', 'displayName'],
    });
    const devsBySyncId = new Map<number, Set<string>>();
    let v2AccountIds: Set<string> | null = null;
    if (v2DisplayNames) {
      v2AccountIds = new Set<string>();
    }
    for (const s of allScores) {
      const set = devsBySyncId.get(s.syncId) ?? new Set();
      set.add(s.jiraLoginId);
      devsBySyncId.set(s.syncId, set);
      if (v2DisplayNames && v2AccountIds && s.displayName) {
        const nameLower = s.displayName.replace(/_ext$/i, '').trim().toLowerCase();
        if (v2DisplayNames.has(nameLower)) {
          v2AccountIds.add(s.jiraLoginId);
        }
      }
    }

    // 6. Build response
    type MetricSummary = {
      current: number | null;
      avg: number | null;
      trend: 'up' | 'down' | 'neutral';
      trendPct: number;
      health: 'green' | 'amber' | 'red';
    };

    const computeTrend = (
      current: number | null,
      avg: number | null
    ): { trend: 'up' | 'down' | 'neutral'; trendPct: number } => {
      if (current == null || avg == null || avg === 0) return { trend: 'neutral', trendPct: 0 };
      const pct = Math.round(((current - avg) / avg) * 100);
      return { trend: pct > 5 ? 'up' : pct < -5 ? 'down' : 'neutral', trendPct: pct };
    };

    const productivityHealth = (v: number | null): 'green' | 'amber' | 'red' =>
      v == null ? 'red' : v >= 80 ? 'green' : v >= 60 ? 'amber' : 'red';

    const defectDensityHealth = (v: number | null): 'green' | 'amber' | 'red' =>
      v == null ? 'red' : v < 0.15 ? 'green' : v <= 0.3 ? 'amber' : 'red';

    const defectLeakageHealth = (v: number | null): 'green' | 'amber' | 'red' =>
      v == null ? 'red' : v <= 1 ? 'green' : v <= 3 ? 'amber' : 'red';

    const reopenRatioHealth = (v: number | null): 'green' | 'amber' | 'red' =>
      v == null ? 'red' : v < 10 ? 'green' : v <= 20 ? 'amber' : 'red';

    const result: any[] = [];

    for (const project of allProjects) {
      const syncs = syncsByProject.get(project.id);
      if (!syncs || syncs.length === 0) continue;

      const sprintRows = syncs.map(sync => {
        const syncFacts = uniqueFactsBySyncId.get(sync.id);
        let facts = syncFacts ? Array.from(syncFacts.values()) : [];
        if (v2AccountIds) {
          facts = facts.filter(f => f.assigneeJiraId && v2AccountIds!.has(f.assigneeJiraId));
        }

        // Productivity
        const spDone = facts.filter(f => f.wasCompleted).reduce((sum, f) => sum + (f.storyPoints ?? 0), 0);
        const spPlanned = facts.reduce((sum, f) => sum + (f.storyPoints ?? 0), 0);
        const productivity = spPlanned > 0 ? round1((spDone / spPlanned) * 100) : 0;

        // Dev count
        let devCount = 0;
        const devSet = devsBySyncId.get(sync.id);
        if (devSet) {
          devCount = v2AccountIds ? Array.from(devSet).filter(id => v2AccountIds!.has(id)).length : devSet.size;
        }

        // Defect Density: bugs first logged in this sprint / SP delivered.
        // "First logged" = Jira `created` timestamp falls within the sprint window.
        // Excludes carryover bugs (created in earlier sprints), excludes tickets
        // already ruled invalid (invalidBug — Root Cause fuzzy-matching 'Invalid
        // Bug'/'Bad Data'/'Incomplete Requirement', or an invalid-bug label; same
        // exclusion computeLeakageFromFacts already applies), and uses SP Done
        // (delivered) so the metric reflects bugs-per-shipped-value. Facts without
        // jiraCreatedAt (pre-backfill) are skipped — see migration 20260518120000.
        const sprintStartStr = String(sync.startDate);
        const sprintEndStr = String(sync.endDate);
        const bugCount = facts.filter(f => {
          if (!(f.issueType ?? '').toLowerCase().includes('bug')) return false;
          if (f.invalidBug) return false;
          if (!f.jiraCreatedAt) return false;
          const created = new Date(f.jiraCreatedAt).toISOString().slice(0, 10);
          return created >= sprintStartStr && created <= sprintEndStr;
        }).length;
        const defectDensity = spDone > 0 ? round2(bugCount / spDone) : 0;

        // Defect Leakage: production bugs
        const prodBugCount = facts.filter(f => f.isProductionBug).length;

        // Reopen Ratio: reopened tickets / total tickets, counting Stories +
        // standalone Bugs (and Tech Debt/Tasks). Sub-bugs are excluded — a
        // sub-bug is the evidence of a parent story's reopen, not a separate
        // reopened work item, so counting it would double-count.
        const reopenScopeFacts = facts.filter(f => !isSubBugIssueType(f.issueType ?? ''));
        const reopenedStoryCount = reopenScopeFacts.filter(f => f.wasReopened).length;
        const totalStoryCount = reopenScopeFacts.length;
        const reopenRatio = totalStoryCount > 0 ? round1((reopenedStoryCount / totalStoryCount) * 100) : 0;
        // Invalid reopens: reopen events disregarded via exclusion labels
        // (Invalid-Reopen / Bad-Data / Scope-Change), summed across the same scope.
        const invalidReopenCount = reopenScopeFacts.reduce((sum, f) => sum + (f.invalidReopenCount ?? 0), 0);

        return {
          syncId: sync.id,
          sprintName: sync.sprintName ?? sync.periodLabel ?? '',
          startDate: sync.startDate,
          endDate: sync.endDate,
          spDone: round1(spDone),
          spPlanned: round1(spPlanned),
          productivity,
          devCount,
          bugCount,
          defectDensity,
          prodBugCount,
          reopenedStoryCount,
          totalStoryCount,
          reopenRatio,
          invalidReopenCount,
        };
      });

      // Compute metric summaries (current = index 0, historical = all prior)
      const buildSummary = (
        getValue: (row: (typeof sprintRows)[0]) => number,
        healthFn: (v: number | null) => 'green' | 'amber' | 'red'
      ): MetricSummary => {
        const current = sprintRows.length > 0 ? getValue(sprintRows[0]) : null;
        const historical = sprintRows.slice(1);
        const avg =
          historical.length > 0
            ? round2(historical.reduce((sum, s) => sum + getValue(s), 0) / historical.length)
            : null;
        const { trend, trendPct } = computeTrend(current, avg);
        return { current, avg, trend, trendPct, health: healthFn(current) };
      };

      // Productivity (delivery %) is commitment-relative -- a Kanban project
      // with no tracked commitment has no real target to measure against, so
      // its % summary is nulled rather than shown as a misleading number.
      // Quality/defect metrics are NOT commitment-relative and stay computed
      // regardless (see productivityMath.hasCommitment's docstring).
      const projectHasCommitment = hasCommitment(project as any);
      const productivitySummary = buildSummary(r => r.productivity, productivityHealth);

      result.push({
        projectId: project.id,
        projectName: project.name,
        accountName: (project as any).account?.name ?? '',
        sprints: sprintRows,
        productivity: projectHasCommitment ? productivitySummary : { ...productivitySummary, current: null, avg: null },
        defectDensity: buildSummary(r => r.defectDensity, defectDensityHealth),
        defectLeakage: buildSummary(r => r.prodBugCount, defectLeakageHealth),
        reopenRatio: buildSummary(r => r.reopenRatio, reopenRatioHealth),
        isKanbanProject: !!(project as any).isKanbanProject,
        metricKind: projectHasCommitment ? 'percent' : 'throughput',
      });
    }

    return { projects: result };
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Health for Kanban throughput (SP completed per span) judged against the
 * project's OWN rolling average of prior spans — no fixed target. Green at or
 * above average, amber within 30% below, red beyond that. With no prior spans
 * (avg null) any delivery is green.
 */
function throughputHealth(current: number | null, avg: number | null): 'green' | 'amber' | 'red' {
  if (current == null) return 'red';
  if (avg == null || avg === 0) return current > 0 ? 'green' : 'red';
  if (current >= avg) return 'green';
  if (current >= 0.7 * avg) return 'amber';
  return 'red';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const performanceSyncService = new PerformanceSyncService();
