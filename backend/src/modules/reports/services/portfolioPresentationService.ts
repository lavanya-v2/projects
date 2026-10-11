/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op, Order } from 'sequelize';
import { PortfolioPresentation } from '../../../models/PortfolioPresentation';
import { Account } from '../../../models/Account';
import { Project } from '../../../models/Project';
import { ProjectWeeklyReport } from '../../../models/ProjectWeeklyReport';
import { PerfSprintSync } from '../../../models/PerfSprintSync';
import { PerfMemberScore } from '../../../models/PerfMemberScore';
import { PerfTicketFact } from '../../../models/PerfTicketFact';
import { TeamMember } from '../../../models/TeamMember';
import { Risk } from '../../../models/Risk';
import { ProjectActionItem } from '../../../models/ProjectActionItem';
import { Program } from '../../../models/Program';
import { ProgramActionItem } from '../../../models/ProgramActionItem';
import { DailyBoardSnapshot } from '../../../models/DailyBoardSnapshot';
import { actionItemService } from './actionItemService';
import { programActionItemService } from './programActionItemService';
import { aiService } from '../../ai/services/aiService';
import { validateCustomSections } from './customSections';
import {
  aggregatePerfSprintMetrics,
  PerfAggregateResult,
  getDeveloperVelocity,
  getDeveloperReopenAndCarryoverTrends,
  buildV2Matcher,
  stripTicketIds,
  splitNarrativeToBullets,
} from './perfAggregation';
import { getLaneConfig, getStatusesForRole, LaneConfig } from '../../../common/laneDefaults';
import { EFFECTIVE_DONE, EXCLUDE_PRIOR_PERIOD_COMPLETION } from './performanceSyncService';
import { hasCommitment as computeHasCommitment, isKanbanForDate } from './productivityMath';
import { countWeekdays } from './capacityMath';
import { getAccessibleProjectIds } from '../../../common/projectAccess';
import { sanitizeRichText, richTextToPlain, hasRichFormatting } from '../../../common/utils/richText';
import { Request } from 'express';
import { Health, healthRank, rankToHealth, meanHealth, statusToHealth } from './healthMath';

const priorityRank = (p: string | null | undefined) => {
  if (p === 'CRITICAL') return 4;
  if (p === 'HIGH') return 3;
  if (p === 'MEDIUM') return 2;
  return 1;
};

function isFullySpecifiedPayload(data: any): boolean {
  return (
    Array.isArray(data?.perProjectDrilldown) &&
    data.perProjectDrilldown.length > 0 &&
    data?.trendData &&
    typeof data.trendData === 'object' &&
    Object.keys(data.trendData).length > 0 &&
    data?.selectedSprintMap &&
    typeof data.selectedSprintMap === 'object'
  );
}

/**
 * The executive summary is authored in a minimal rich text editor (bold,
 * italic, underline, bullet and numbered lists), so the persisted value may
 * contain HTML. Run it through the allowlist on every write path — it is
 * rendered as markup on the slide and in the PDF export.
 */
function sanitizeKeyHighlights<T extends { summary?: string } | null | undefined>(highlights: T): T {
  if (!highlights || typeof highlights !== 'object') return highlights;
  if (typeof highlights.summary !== 'string') return highlights;
  return { ...highlights, summary: sanitizeRichText(highlights.summary) };
}

/**
 * Deterministic numeric/formulaic summary. Used as the fallback when the AI
 * narrative path fails or no qualitative data is available, and as the body of
 * the metric footer appended below the AI narrative.
 */
function buildFormulaicSummary(input: {
  accountName: string;
  projectCount: number;
  startDate: string;
  endDate: string;
  overallHealth: Health;
  openRisksCount: number;
  openActionItemsCount: number;
  aggPlanned: number;
  aggActual: number;
  perProjectDrilldown: any[];
}): string {
  const {
    accountName,
    projectCount,
    startDate,
    endDate,
    overallHealth,
    openRisksCount,
    openActionItemsCount,
    aggPlanned,
    aggActual,
    perProjectDrilldown,
  } = input;

  const wsrDrilldowns = perProjectDrilldown.filter(d => d?.sprintMetrics?.dataSource === 'wsr');
  const anyWSR = wsrDrilldowns.length > 0;
  const totalTicketsCompleted = wsrDrilldowns.reduce((s, d) => s + (Number(d.sprintMetrics?.ticketsCompleted) || 0), 0);

  if (anyWSR && wsrDrilldowns.length === perProjectDrilldown.length) {
    return `Across ${projectCount} project(s) in "${accountName}" for the window ${startDate} to ${endDate}, teams completed ${totalTicketsCompleted} ticket(s) (Kanban throughput). Overall health trends ${overallHealth.toLowerCase()}. ${openRisksCount} open risk(s) and ${openActionItemsCount} open action item(s) are tracked for executive review.`;
  }
  if (aggPlanned + aggActual > 0) {
    return `Across ${projectCount} project(s) in "${accountName}" for the window ${startDate} to ${endDate}, delivery covered ${aggActual} of ${aggPlanned} planned units of work. Overall health trends ${overallHealth.toLowerCase()}. ${openRisksCount} open risk(s) and ${openActionItemsCount} open action item(s) are tracked for executive review.`;
  }
  return `Executive delivery review for "${accountName}" covering ${projectCount} project(s) from ${startDate} to ${endDate}. Overall health trends ${overallHealth.toLowerCase()}. ${openRisksCount} open risk(s) and ${openActionItemsCount} open action item(s) are being tracked.`;
}

/**
 * One-line metric footer appended beneath the AI narrative summary. Numbers are
 * computed in TypeScript (not asked of the LLM) so they stay accurate.
 */
function buildMetricFooter(input: {
  startDate: string;
  endDate: string;
  aggActual: number;
  aggPlanned: number;
  openRisksCount: number;
  openActionItemsCount: number;
  perProjectDrilldown: any[];
}): string {
  const wsrDrilldowns = input.perProjectDrilldown.filter(d => d?.sprintMetrics?.dataSource === 'wsr');
  const allWSR = wsrDrilldowns.length > 0 && wsrDrilldowns.length === input.perProjectDrilldown.length;
  const totalTicketsCompleted = wsrDrilldowns.reduce((s, d) => s + (Number(d.sprintMetrics?.ticketsCompleted) || 0), 0);

  const deliveryPart = allWSR
    ? `${totalTicketsCompleted} ticket(s) completed`
    : input.aggPlanned + input.aggActual > 0
      ? `${input.aggActual}/${input.aggPlanned} delivered`
      : 'no delivery metrics';

  return `Window: ${input.startDate} to ${input.endDate} - ${deliveryPart} - ${input.openRisksCount} open risk(s) - ${input.openActionItemsCount} open action item(s).`;
}

/**
 * Sprint selection rule for the delivery presentation window.
 *
 *   Pick the sprint "in progress" at windowEnd (startDate <= windowEnd <= endDate).
 *   If none is in progress, use the latest sprint ending on or before windowEnd.
 *   Then go back one sprint from there — the sprint ending right before the
 *   current one starts.
 *
 *   Returns both, oldest first, so callers can present "previous + current".
 */
function pickCurrentPreviousSprints<T extends { startDate: string; endDate: string }>(
  sprints: T[],
  windowEnd: string
): { previous: T | null; current: T | null } {
  if (sprints.length === 0) return { previous: null, current: null };

  // Ensure sorted ascending by start date for deterministic walks
  const asc = [...sprints].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

  let current: T | null = asc.find(s => s.startDate <= windowEnd && s.endDate >= windowEnd) ?? null;
  if (!current) {
    // No in-progress sprint at windowEnd — fall back to the latest that ended on or before it
    const completedBefore = asc.filter(s => s.endDate <= windowEnd);
    current = completedBefore.length > 0 ? completedBefore[completedBefore.length - 1] : null;
  }

  let previous: T | null = null;
  if (current) {
    // Previous = the sprint with the largest endDate that ends on or before
    // current.startDate, excluding the current sprint itself. `<=` covers
    // back-to-back sprints where the previous sprint ends on the same day
    // the next one starts.
    const curr = current;
    const before = asc.filter(s => s !== curr && s.endDate <= curr.startDate);
    previous = before.length > 0 ? before[before.length - 1] : null;
  }

  return { previous, current };
}

/**
 * Kanban/WSR selection rule.
 *
 *   Find the week "in progress" at windowEnd (the one whose date range contains
 *   windowEnd, if any). Then pick the last two fully-completed weeks — a week
 *   is "completed at windowEnd" iff its endDate <= windowEnd. This definition
 *   handles overlapping week windows gracefully: even if a later week has
 *   already started, earlier weeks that have already ended still count as
 *   completed at the presentation date.
 */
function pickPreviousTwoCompletedWeeks<T extends { startDate: string; endDate: string }>(
  wsrs: T[],
  windowEnd: string
): { current: T | null; completed: T[] } {
  if (wsrs.length === 0) return { current: null, completed: [] };

  const asc = [...wsrs].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  const current: T | null = asc.find(w => w.startDate <= windowEnd && w.endDate > windowEnd) ?? null;
  // Completed = endDate is on or before windowEnd. This excludes the current
  // in-progress week (whose endDate > windowEnd) while still including any
  // earlier week that may overlap the current one on the calendar.
  const priorCompleted = asc.filter(w => w.endDate <= windowEnd);
  const lastTwo = priorCompleted.slice(-2);
  return { current, completed: lastTwo };
}

/**
 * Return every sprint whose calendar range overlaps [windowStart, windowEnd].
 * A sprint overlaps if sprint.endDate > windowStart AND sprint.startDate <= windowEnd.
 * Ascending by startDate. Caller may further cap result length.
 *
 * Why this exists: pickCurrentPreviousSprints caps at 2 sprints (previous +
 * current at windowEnd). A 30-day window that spans 3 sprints would lose the
 * earliest one. For per-sprint table coverage we want all sprints in the window.
 *
 * Start boundary is EXCLUSIVE (`endDate > windowStart`, not `>=`): a sprint that
 * ends exactly on the window's first day contributed effectively none of its
 * work to the window, so counting its full SP into the headline totals
 * double-counts the prior sprint. Example: window 26 May–09 Jun is meant to be
 * Sprint 5.3 (26 May–09 Jun); Sprint 5.2 ends 26 May and must NOT be pulled in.
 */
function pickSprintsInWindow<T extends { startDate: string; endDate: string }>(
  sprints: T[],
  windowStart: string,
  windowEnd: string
): T[] {
  return [...sprints]
    .filter(s => s.endDate > windowStart && s.startDate <= windowEnd)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
}

/** Whole-day gap between two 'YYYY-MM-DD' strings (parsed as UTC midnight). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/**
 * Keep a sprint only when at least half of ITS OWN calendar duration falls
 * inside [windowStart, windowEnd]. Layered on top of pickSprintsInWindow's
 * pure-overlap filter (so oStart <= oEnd always holds). This drops a predecessor
 * sprint whose tail merely grazes the window start (e.g. 1 day of a 14-day
 * sprint) — which happens when the sprint the window is really about hasn't been
 * synced — while keeping any sprint whose bulk is in the window and preserving
 * the exclusive-start invariant (a sprint ending on windowStart never reaches
 * here). Robust to a few days of window/sprint boundary drift, unlike a
 * start-in-window test.
 */
function sprintMeaningfullyInWindow(
  s: { startDate: string; endDate: string },
  windowStart: string,
  windowEnd: string
): boolean {
  const oStart = s.startDate > windowStart ? s.startDate : windowStart; // max(start, wStart)
  const oEnd = s.endDate < windowEnd ? s.endDate : windowEnd; // min(end, wEnd)
  const overlapDays = daysBetween(oStart, oEnd);
  const sprintDays = daysBetween(s.startDate, s.endDate);
  if (sprintDays <= 0) return true; // degenerate sprint — don't drop
  return overlapDays >= sprintDays / 2; // majority of the sprint is in-window
}

/**
 * Live-status lane breakdown shown on the presentation drilldown for both
 * scrum (in-flight sprint) and Kanban projects. Mirrors the lanes used in the
 * DSR sprint progress strip but counts TICKETS, not story points.
 */
type TicketsByLane = {
  todo: number;
  inProgress: number;
  inReview: number;
  qa: number;
  uat: number;
  blocked: number;
  reopened: number;
  done: number;
};

const EMPTY_LANES: TicketsByLane = {
  todo: 0,
  inProgress: 0,
  inReview: 0,
  qa: 0,
  uat: 0,
  blocked: 0,
  reopened: 0,
  done: 0,
};

/**
 * V2-scoped lane breakdown sourced directly from sprintBurndown. Use this for
 * scrum projects with an in-flight sprint — it stays in sync with the V2 SP
 * pipeline numbers shown in the same card (no scope mismatch). Returns null
 * when the snapshot was written before per-lane V2 ticket counts were added,
 * so the caller can fall back to bucketStatusCountsIntoLanes.
 */
function ticketsByLaneFromBurndown(burndown: NonNullable<DailyBoardSnapshot['sprintBurndown']>): TicketsByLane | null {
  // All seven per-lane V2 ticket fields are optional (added later than the
  // burndown itself). If the in-flight lanes aren't present, the snapshot
  // pre-dates the change and we have to fall back to the board-wide source.
  if (
    burndown.todoV2Tickets == null &&
    burndown.inProgressV2Tickets == null &&
    burndown.inReviewV2Tickets == null &&
    burndown.inQaV2Tickets == null &&
    burndown.inUatV2Tickets == null &&
    burndown.blockedV2Tickets == null &&
    burndown.reopenedV2Tickets == null
  ) {
    return null;
  }
  return {
    todo: Number(burndown.todoV2Tickets ?? 0) || 0,
    inProgress: Number(burndown.inProgressV2Tickets ?? 0) || 0,
    inReview: Number(burndown.inReviewV2Tickets ?? 0) || 0,
    qa: Number(burndown.inQaV2Tickets ?? 0) || 0,
    uat: Number(burndown.inUatV2Tickets ?? 0) || 0,
    blocked: Number(burndown.blockedV2Tickets ?? 0) || 0,
    reopened: Number(burndown.reopenedV2Tickets ?? 0) || 0,
    done: Number(burndown.completedV2Tickets ?? 0) || 0,
  };
}

/**
 * Map DailyBoardSnapshot.statusCounts (raw "In Progress" → 5) into the
 * normalised lane shape using the project's LaneConfig. The "done" lane also
 * absorbs anything in EFFECTIVE_DONE so that customs terminal states like
 * "Production Deployed" / "Released" / "Resolved" count even if the project
 * hasn't listed them in laneConfig.done.
 */
function bucketStatusCountsIntoLanes(statusCounts: Record<string, number>, laneConfig: LaneConfig): TicketsByLane {
  const lower = (arr: string[]) => arr.map(s => s.toLowerCase());
  const lanes = {
    todo: new Set(lower(getStatusesForRole(laneConfig, 'todo'))),
    inProgress: new Set(lower(getStatusesForRole(laneConfig, 'in_progress'))),
    inReview: new Set(lower(getStatusesForRole(laneConfig, 'in_review'))),
    qa: new Set(lower(getStatusesForRole(laneConfig, 'qa'))),
    uat: new Set(lower(getStatusesForRole(laneConfig, 'uat'))),
    blocked: new Set(lower(getStatusesForRole(laneConfig, 'blocked'))),
    reopened: new Set(lower(getStatusesForRole(laneConfig, 'reopened'))),
    done: new Set(lower(getStatusesForRole(laneConfig, 'done'))),
  };
  const out: TicketsByLane = { ...EMPTY_LANES };
  for (const [status, raw] of Object.entries(statusCounts)) {
    const n = Number(raw) || 0;
    const s = status.toLowerCase();
    if (lanes.todo.has(s)) out.todo += n;
    else if (lanes.inProgress.has(s)) out.inProgress += n;
    else if (lanes.inReview.has(s)) out.inReview += n;
    else if (lanes.qa.has(s)) out.qa += n;
    else if (lanes.uat.has(s)) out.uat += n;
    else if (lanes.blocked.has(s)) out.blocked += n;
    else if (lanes.reopened.has(s)) out.reopened += n;
    else if (lanes.done.has(s) || EFFECTIVE_DONE.has(s)) out.done += n;
  }
  return out;
}

// Flat per-scope metric shape the frontend reads (one object per scope).
// planned/capacity/productivityPct/spilloverPct/scopeCreepPct/reEstimatedSp are
// `null` (never 0) for a project with no captured commitment (Kanban/cadence
// with tracksCommitment=false) — there is no plan to measure against. Raw
// counts (actual, spillovers, scopeAddedSP, …) stay real regardless.
interface ScopedDrilldownMetrics {
  planned: number | null; // committed SP for THIS scope (V2 vs whole-team)
  capacity: number | null; // capacity for THIS scope (hours projects) / = planned for points
  actual: number; // delivered SP (scorecard spDone)
  deliveredCount: number;
  reopenedCount: number;
  reopenRatePct: number;
  productivityPct: number | null; // delivered SP / planned SP
  metricKind?: 'percent' | 'throughput';
  // Spillover / scope-added for THIS scope. Denominator (planned SP) is
  // scope-specific, so these follow the V2 ⇄ whole-team toggle too.
  spillovers: number; // spillover SP (Σ spCarriedOver in scope) — real regardless of plan
  spilloverCount: number; // spillover tickets
  spilloverPct: number | null; // spillover SP / planned SP (this scope)
  scopeAddedSP: number; // SP added mid-sprint (this scope) — real regardless of plan
  scopeAddedCount: number; // tickets added mid-sprint
  scopeCreepPct: number | null; // scopeAddedSP / planned SP (this scope)
  reEstimatedSp?: number | null;
  validBugs: number;
  bugDensityPct: number;
  storyPoints: number; // = actual, quality-card SP denominator
  perSprint: Array<{
    syncId: number;
    planned: number | null;
    deliveredSP: number;
    deliveredCount: number;
    reopenedCount: number;
    reopenRatePct: number;
    bugCount: number;
  }>;
}

// Project an aggregatePerfSprintMetrics result (the SAME engine that powers the
// Board View > Developer Performance scorecard) into the flat per-scope shape.
// Called once with the V2 matcher (V2 scope) and once with no matcher (whole
// team), so the presentation reconciles to that table for BOTH scopes.
function scorecardScope(agg: PerfAggregateResult): ScopedDrilldownMetrics {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const m = agg.metrics;
  const q = agg.quality;
  return {
    planned: m.planned,
    capacity: m.capacity,
    actual: m.actual,
    deliveredCount: m.deliveredCount,
    reopenedCount: m.reopenedCount,
    reopenRatePct: m.reopenRatePct,
    productivityPct: m.planned > 0 ? r1((m.actual / m.planned) * 100) : 0,
    spillovers: m.spillovers,
    spilloverCount: m.spilloverCount,
    spilloverPct: m.spilloverPct,
    scopeAddedSP: m.scopeAddedSP,
    scopeAddedCount: m.scopeAddedCount,
    scopeCreepPct: m.scopeCreepPct,
    validBugs: q.validBugs,
    bugDensityPct: q.bugDensityPct,
    storyPoints: q.storyPoints,
    perSprint: (m.perSprint || []).map(p => ({
      syncId: p.syncId,
      planned: p.planned,
      deliveredSP: p.actual,
      deliveredCount: p.deliveredCount,
      reopenedCount: p.reopenedCount,
      reopenRatePct: p.reopenRatePct,
      bugCount: (p as any).bugsRaised ?? 0,
    })),
  };
}

// Project a PerfTeamMember rollup into the slim per-member shape the presentation
// stores (delivery / reopens / bugs only — no scoring). Used for both the V2 and
// whole-team team lists so they share one mapping.
function mapTeam(members: any[]): any[] {
  return (members || []).map(m => ({
    name: m.name,
    role: m.role || '',
    planned: m.planned,
    delivered: m.delivered,
    spillover: m.spillover,
    reopens: m.reopens,
    reopenRatePct: m.reopenRatePct,
    bugsRaised: m.bugsRaised,
    invalidBugsRaised: m.invalidBugsRaised,
    prodBugsEscaped: m.prodBugsEscaped,
    ticketsTested: m.ticketsTested,
    // QA story-point enrichment (present on refreshed/new presentations).
    spTested: m.spTested,
    spDelivered: m.spDelivered,
  }));
}

function mapTeamBySprint(sprints: any[]): any[] {
  return (sprints || []).map(s => ({
    syncId: s.syncId,
    sprintName: s.sprintName,
    startDate: s.startDate,
    endDate: s.endDate,
    team: mapTeam(s.team as any[]),
  }));
}

/**
 * Convert a DailyBoardSnapshot.sprintBurndown JSONB into the in-flight Current
 * Sprint card payload. Shared between the perf-sync-driven path (where bug
 * counts come from PerfMemberScore) and the snapshot-only fallback path (no
 * counts come from PerfMemberScore) and the snapshot-only fallback path (no
 * perf row → bug counts default to 0). Lane breakdown + reopens + sub-bugs
 * always come from the snapshot itself, regardless of whether a perf row exists.
 */
function buildInFlightFromBurndown(
  burndown: NonNullable<DailyBoardSnapshot['sprintBurndown']>,
  snapshotDate: string,
  extras: {
    ticketsByLane: TicketsByLane;
    reopenedTickets: number;
    subBugsLogged: number | null;
    bugsRaised?: number;
    subBugsRaised?: number;
    topLevelBugs?: number;
  }
): any {
  // On-the-go assignment model (see Project.sprintAssignmentModel): the V2-only
  // slice (totalV2SP/completedV2SP) has no stable relationship to the team's real
  // committed scope, so Planned/Delivered here must come from the whole-sprint
  // rollup instead — same substitution the daily report's completionPct/
  // completionPctSP already make. Falls back to the V2 numbers if the snapshot
  // predates this field (older reports won't carry totalSprintSP).
  const isNotTracked = burndown.onTrackStatus === 'not-tracked';
  const plannedSP =
    isNotTracked && burndown.totalSprintSP != null
      ? Number(burndown.totalSprintSP) || 0
      : Number(burndown.totalV2SP) || 0;
  const deliveredSP =
    isNotTracked && burndown.completedSprintSP != null
      ? Number(burndown.completedSprintSP) || 0
      : Number(burndown.completedV2SP) || 0;
  const ticketsTotal = Number(burndown.totalV2Tickets) || 0;
  const ticketsCompleted = Number(burndown.completedV2Tickets) || 0;
  return {
    sprintName: burndown.sprintName,
    startDate: burndown.startDate,
    endDate: burndown.endDate,
    daysTotal: Number(burndown.daysTotal) || 0,
    daysElapsed: Number(burndown.daysElapsed) || 0,
    daysRemaining: Number(burndown.daysPending) || 0,
    sprintElapsedPct: Number(burndown.sprintElapsedPct) || 0,
    plannedSP,
    deliveredSP,
    remainingSP: Math.max(0, plannedSP - deliveredSP),
    completionPctSP: plannedSP > 0 ? Math.round((deliveredSP / plannedSP) * 1000) / 10 : 0,
    ticketsTotal,
    ticketsCompleted,
    ticketsRemaining: Math.max(0, ticketsTotal - ticketsCompleted),
    bugsRaised: extras.bugsRaised ?? 0,
    subBugsRaised: extras.subBugsRaised ?? 0,
    topLevelBugs: extras.topLevelBugs ?? 0,
    pipelineSP: {
      uat: Number(burndown.inUatSP) || 0,
      qa: Number(burndown.inQaSP) || 0,
      review: Number(burndown.inReviewSP) || 0,
      inProgress: Number(burndown.inProgressSP) || 0,
      blocked: Number(burndown.blockedSP) || 0,
      todo: Number(burndown.todoSP) || 0,
    },
    ticketsByLane: extras.ticketsByLane,
    reopenedTickets: extras.reopenedTickets,
    subBugsLogged: extras.subBugsLogged,
    snapshotDate,
    onTrackStatus: burndown.onTrackStatus ?? null,
  };
}

/**
 * Build a Current-Sprint data-point payload for an in-flight sprint. Sourced
 * primarily from the latest matching DailyBoardSnapshot.sprintBurndown for the
 * project (the same data the DSR shows). Bug counts come from PerfMemberScore
 * if a mid-flight sync exists for the sprint; otherwise 0.
 *
 * Lane breakdown / reopens / sub-bugs come from the snapshot itself and are
 * passed in by the caller (so this function doesn't have to re-load it).
 */
async function buildInFlightSprintSummary(
  sync: PerfSprintSync,
  projectId: number,
  today: string,
  extras: { ticketsByLane: TicketsByLane; reopenedTickets: number; subBugsLogged: number | null }
): Promise<any> {
  // Find the latest DailyBoardSnapshot for this project (date <= today) whose
  // sprintBurndown matches this in-flight sprint by name. We scan recent rows
  // since older snapshots may carry a different sprint.
  const snapshots = await DailyBoardSnapshot.findAll({
    where: {
      projectId,
      date: { [Op.lte]: today },
    },
    order: [['date', 'DESC']],
    limit: 30,
  });
  const matching = snapshots.find(s => s.sprintBurndown && s.sprintBurndown.sprintName === sync.sprintName);
  const burndown = matching?.sprintBurndown ?? null;

  // Bug counts (sub-bug split): if a mid-flight perf sync exists for this
  // sprint, sum across QA rows. Otherwise zeros - bug count is a secondary
  // signal here, not load-bearing.
  const qaRows = await PerfMemberScore.findAll({
    where: { syncId: sync.id, memberCategory: 'qa' },
  });
  const bugsRaised = qaRows.reduce((t, r) => t + Number(r.bugsRaisedCount || 0), 0);
  const subBugsRaised = qaRows.reduce((t, r) => t + Number((r as any).subBugsRaisedCount || 0), 0);
  const topLevelBugs = Math.max(0, bugsRaised - subBugsRaised);

  if (!burndown) {
    // Snapshot fallback: card still renders with sprint header, but data
    // points are blank. Frontend shows a "current data unavailable" caption.
    return {
      sprintName: sync.sprintName,
      startDate: sync.startDate,
      endDate: sync.endDate,
      daysTotal: null,
      daysElapsed: null,
      daysRemaining: null,
      sprintElapsedPct: null,
      plannedSP: 0,
      deliveredSP: 0,
      remainingSP: 0,
      completionPctSP: 0,
      ticketsTotal: 0,
      ticketsCompleted: 0,
      ticketsRemaining: 0,
      bugsRaised,
      subBugsRaised,
      topLevelBugs,
      pipelineSP: { uat: 0, qa: 0, review: 0, inProgress: 0, blocked: 0, todo: 0 },
      ticketsByLane: extras.ticketsByLane,
      reopenedTickets: extras.reopenedTickets,
      subBugsLogged: extras.subBugsLogged,
      snapshotDate: null,
      onTrackStatus: null,
    };
  }

  return buildInFlightFromBurndown(burndown, matching!.date, {
    ticketsByLane: extras.ticketsByLane,
    reopenedTickets: extras.reopenedTickets,
    subBugsLogged: extras.subBugsLogged,
    bugsRaised,
    subBugsRaised,
    topLevelBugs,
  });
}

interface PaginationResponse {
  rows: PortfolioPresentation[];
  count: number;
}

class PortfolioPresentationService {
  async listByAccount(
    req: Request,
    accountId: number,
    page: number,
    limit: number,
    selectedProjectIds?: number | 'all',
    searchParams: string = '',
    sortBy?: string,
    sortOrder?: string
  ): Promise<PaginationResponse> {
    const where: any = { accountId, [Op.and]: [] };

    const offset = (page - 1) * limit;

    if (selectedProjectIds && selectedProjectIds !== 'all') {
      where[Op.and].push({
        selectedProjectIds: {
          [Op.contains]: [Number(selectedProjectIds)],
        },
      });
    }
    const order: Order | undefined = [[sortBy || 'meetingDate', sortOrder || 'DESC']];

    // eslint-disable-next-line
    const searchReplacements: string[] | { [key: string]: unknown } = {};
    const searchTrimmed = searchParams?.trim();

    if (typeof searchParams === 'string' && searchTrimmed !== '') {
      const matchingProjects = await Project.findAll({
        attributes: ['id'],
        where: { name: { [Op.iLike]: `%${searchTrimmed}%` } },
        raw: true,
      });
      const foundProjectIds = matchingProjects.map(p => p.id);
      where[Op.or] = [{ title: { [Op.iLike]: `%${searchTrimmed}%` } }];
      if (foundProjectIds.length > 0) {
        where[Op.or].push({
          selectedProjectIds: {
            [Op.contains]: foundProjectIds,
          },
        });
      }
    }

    // Superuser see everything. Everyone else only sees presentations
    // that include ≥1 project they have access to.
    const role = (req as any).user?.role;
    const userId = (req as any).user?.id;

    const accessible = await getAccessibleProjectIds(userId);
    const accessibleArray = [...accessible];

    if (!(role === 'SUPERUSER' || !userId)) {
      if (accessibleArray.length > 0) {
        const overlapConditions = accessibleArray.map(id => ({
          selectedProjectIds: {
            [Op.contains]: [id],
          },
        }));
        where[Op.and].push({
          [Op.or]: overlapConditions,
        });
      } else {
        where[Op.and].push({ id: -1 });
      }
    }
    const { rows, count } = await PortfolioPresentation.findAndCountAll({
      where,
      offset: offset,
      limit: limit,
      include: [{ model: Account }],
      order,
    });

    const presentations = rows.map(r => r.toJSON());
    const allProjectIds = [...new Set(presentations.flatMap(p => p.selectedProjectIds || []))];

    const projects = await Project.findAll({
      where: { id: allProjectIds },
      attributes: ['id', 'name'],
    });
    const projectMap = new Map(projects.map(p => [p.id, p.name]));

    const res = presentations.map(p => {
      const projectNames: string[] = [];
      if (Array.isArray(p.selectedProjectIds) && p.selectedProjectIds.length > 0) {
        p.selectedProjectIds.forEach((id: number) => {
          const projName = projectMap.get(id);
          if (projName) projectNames.push(projName);
        });
      }
      return { ...p, projectNames };
    });
    const response = {
      rows: res,
      count: count,
    };
    return response;
  }

  /**
   * Builds the full prefill payload (metrics, risks, action items, trends, drilldown)
   * from live system data. Used by both the preview endpoint and the create path.
   */
  /**
   * @param opts.skipAiSummary Skip the AI narrative synthesis and fall back to the
   *   formulaic summary. Set this when the caller is going to discard the AI summary
   *   anyway — see `refreshFromSystem`. The AI block is one `collateWeeklyInsights`
   *   call per project plus one `generatePortfolioExecutiveSummary`, so on a
   *   ten-project account it is eleven API calls; running them to throw the result
   *   away is pure cost. Nothing else in the payload depends on them.
   */
  async buildPrefillPayload(
    accountId: number,
    selectedProjectIds: number[],
    startDate: string,
    endDate: string,
    programId?: number | null,
    selectedSprintId?: number | null,
    opts: { skipAiSummary?: boolean } = {}
  ): Promise<any> {
    const account = await Account.findByPk(accountId);
    if (!account) throw new Error('Account not found');

    // "Today" cutoff used to classify sprints: a sprint is considered
    // completed iff sprint.endDate < today. In-flight sprints are pulled
    // out and shown separately as a Current Sprint card so their mid-flight
    // numbers (delivered-so-far, remaining work) aren't read as final.
    const today = new Date().toISOString().slice(0, 10);

    const projectIds = selectedProjectIds.filter(id => typeof id === 'number' && !isNaN(id));
    const projects = projectIds.length > 0 ? await Project.findAll({ where: { id: projectIds, accountId } }) : [];

    // Enforce projects belong to the account
    const projectMap = new Map<number, Project>();
    for (const p of projects) projectMap.set(p.id, p);

    // V2 roster — used to filter PerfMemberScore + PerfTicketFact so delivery
    // numbers reflect only V2 contributions. Matcher prefers jira_login_id
    // (canonical) and falls back to fuzzy name match so spelling drift and
    // compound first names don't silently drop members.
    const v2TeamMembers = await TeamMember.findAll({ where: { v2Member: true } });
    const v2Matcher = buildV2Matcher(v2TeamMembers);

    const selectedSprintMap: Record<string, number | null> = {};
    const perProjectDrilldown: any[] = [];
    const trendData: Record<string, any> = {};

    const aggregateHealthVotes: Health[] = [];
    const allRisks: any[] = [];
    const allActionItems: any[] = [];

    // Points-unit headline totals (story-point projects only). Hours-based
    // projects are tracked separately below so units are NEVER summed together.
    let aggPlanned = 0;
    let aggActual = 0;
    let aggBugs = 0;
    let aggSP = 0;
    // Hours-unit subtotals (hours-based projects only).
    let aggPlannedHours = 0;
    let aggActualHours = 0;
    let aggBugsHours = 0;
    let aggSPHours = 0;
    // WSR/Kanban-with-no-perf-sync subtotal: metrics.actual there is a raw
    // TICKET COUNT (weekly throughput), not story points -- it was previously
    // summed straight into aggActual alongside SP, inflating "Delivered (SP)"
    // whenever a deck mixed perf and WSR projects. Tracked separately so it
    // can be surfaced as its own figure instead of silently merged in.
    let aggTicketsThroughput = 0;

    const allAchievements: string[] = [];
    const allBlockers: string[] = [];

    // Per-project context fed into the AI executive-summary synthesis below.
    const aiProjectContext: Array<{
      projectName: string;
      wsrExecSummaries: string[];
      achievements: string[];
      risks: string[];
    }> = [];

    for (const projectId of projectIds) {
      const project = projectMap.get(projectId);
      if (!project) continue;

      // Which delivery-model rules apply to THIS presentation's date range --
      // not just "is the project Kanban right now". A refresh/regenerate of an
      // OLD Scrum-era presentation must keep using Scrum rules even after the
      // project's live flag has since flipped to Kanban. See
      // isKanbanForDate's docstring.
      const isKanbanEffective = isKanbanForDate(project as any, startDate);

      // Bounded window: 6 months back from endDate
      const windowEndMs = new Date(endDate).getTime();
      const sixMonthsBackISO = new Date(windowEndMs - 186 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      // Period-selection rule (applied per project):
      //   Sprint projects — pick the sprint in progress at endDate, then go back
      //     one → present "previous + current". User's startDate is a hint; if
      //     "previous" pre-dates it we still include it because the rule is
      //     calendar-based, not window-based.
      //   Kanban/WSR projects — skip the current week (incomplete) and present
      //     the previous two fully-completed weeks.
      // Was forced to [] for Kanban projects before the query even ran --
      // synced Kanban spans (cadence cycles and continuous reporting weeks,
      // both syncType='kanban') exist and already power Team Performance, but
      // never reached the presentation. Query unconditionally; every
      // downstream branch in this function already keys off perfSprints'
      // emptiness rather than isKanbanProject directly, so a Kanban project
      // with synced spans now flows through the same perf-based logic a
      // sprint project does instead of falling straight to the WSR/weekly
      // fallback. See the Kanban delivery-models design doc.
      const perfSprints = await PerfSprintSync.findAll({
        where: {
          projectId,
          syncStatus: 'done',
          endDate: { [Op.gte]: sixMonthsBackISO },
        },
        order: [['endDate', 'ASC']],
      });

      // Pick every sprint whose calendar overlaps the window — a 30-day
      // window can span 3 sprints, and we want all of them in the
      // Per-Sprint Breakdown. Cap at 6 most-recent for sanity (quarterly
      // windows could otherwise pull 7+ sprints; the cap keeps the
      // per-sprint table readable and the perf aggregation cheap).
      // Sprint-pin mode: when the presentation was built "By sprint" (single
      // project), restrict the breakdown to EXACTLY that Jira sprint, matched
      // by id — NOT by the date window. This is the whole point of the feature:
      // a date that is one sprint's end and the next sprint's start would make
      // the window overlap test (endDate > windowStart && startDate <= windowEnd)
      // pull TWO sprints; pinning by id pulls one. Deliberately NO date-window
      // fallback — if the picked sprint has no synced row, we show a "needs
      // sync" breakdown (below) rather than risk pulling a neighbouring sprint.
      const sprintPinned = !isKanbanEffective && selectedSprintId != null;
      // Range mode: keep pickSprintsInWindow's exclusive-start overlap as the
      // base set, then drop any sprint that only MARGINALLY overlaps the
      // window (a predecessor whose tail grazes the window start). This
      // happens when the sprint the window is really about hasn't been
      // synced — without this filter the predecessor is silently presented
      // as the window's delivery. `rawOverlap` is retained to distinguish
      // "a sprint touched the window but was excluded" from "no sprint at all."
      const rawOverlap = sprintPinned ? [] : pickSprintsInWindow(perfSprints, startDate, endDate);
      const overlapping = sprintPinned
        ? perfSprints.filter(s => s.jiraSprintId === selectedSprintId)
        : rawOverlap.filter(s => sprintMeaningfullyInWindow(s, startDate, endDate));
      const selectedPerfSprints = overlapping.slice(-6);
      // Pinned sprint chosen but not yet synced into PerfSprintSync — no data
      // to aggregate. Handled as an explicit empty/needs-sync state so a scrum
      // project doesn't silently fall through to the WSR (weekly) branch.
      const sprintPinUnsynced = sprintPinned && selectedPerfSprints.length === 0;
      // Range-mode uncovered state: a synced sprint DID overlap the window,
      // but only marginally (predecessor), so the meaningful filter dropped
      // everything. Treat as needs-sync/uncovered rather than silently
      // pulling the predecessor or dropping to weekly (WSR) data. When NO
      // sprint overlapped at all (rawOverlap empty), this stays false and
      // the existing WSR fallback still applies to genuine weekly projects.
      // Applies equally to Kanban now that its spans are queried above — a
      // cadence cycle or continuous week can just as easily "marginally
      // overlap and get excluded" as a sprint can.
      const rangeSprintUnsynced = !sprintPinned && rawOverlap.length > 0 && selectedPerfSprints.length === 0;
      const droppedForWindow = rangeSprintUnsynced ? rawOverlap[rawOverlap.length - 1] : null;
      const windowCoverageWarning: string | null = rangeSprintUnsynced
        ? `No fully-synced sprint covers ${startDate} to ${endDate}. The nearest sprint (${droppedForWindow?.sprintName ?? 'previous sprint'}) only marginally overlaps this window and was excluded to avoid reporting its work as this window's delivery. Sync the intended sprint or adjust the dates.`
        : null;

      // Also retain the "current at windowEnd" sprint for in-flight
      // detection — even if it overlaps the window we still want to know
      // which one represents "live now."
      const { current: currPerf } = pickCurrentPreviousSprints(perfSprints, endDate);

      // Split picked sprints into completed (sprint.endDate < today) vs
      // in-flight. Completed sprints feed the per-sprint table, combined
      // totals, team table, and trend graphs. In-flight sprints get a
      // separate Current Sprint card so mid-flight numbers aren't read
      // as final.
      const completedPerfSprints = selectedPerfSprints.filter(s => s.endDate < today);
      const inFlightPerfSprints = selectedPerfSprints.filter(s => s.endDate >= today);

      selectedSprintMap[String(projectId)] = currPerf ? currPerf.id : null;

      // ---- WSR context — always loaded for narrative + Kanban fallback --------
      const allProjectWSRs = await ProjectWeeklyReport.findAll({
        where: { projectId },
        order: [['startDate', 'ASC']],
      });
      const { current: currentWeek, completed: completedTwoWeeks } = pickPreviousTwoCompletedWeeks(
        allProjectWSRs,
        endDate
      );

      // ---- Trend data — last 5 COMPLETED periods (never current-in-progress) --
      // syncId is included so the UI can offer per-sprint "remove from trend"
      // controls that target the correct PerfSprintSync row (only meaningful
      // when dataSource='perf'; null for WSR/Kanban entries).
      let trendSprints: Array<{
        syncId: number | null;
        name: string;
        startDate?: string;
        endDate?: string;
        metrics: any;
        qualityMetrics: any;
        metricsByScope?: any;
        qualityMetricsByScope?: any;
      }>;
      let trendSource: 'sprint' | 'wsr' = 'sprint';
      if (perfSprints.length > 0) {
        // Completed perf sprints only (sprint.endDate < today) — in-progress
        // sprints are excluded so the trend lines reflect historical truth,
        // not mid-flight snapshots that will keep changing.
        // Sprint mode only: anchor to the selected sprint's end so the trend
        // shows that sprint + its previous sprints. Date-range/program mode
        // keeps the long-standing behavior (latest 5 up to today) — in that
        // mode trendCutoff === today, so the s.endDate < today clause already
        // dominates and the extra bound is a no-op.
        // Kanban presentations: only Kanban periods (cycles / reporting weeks)
        // belong on the trend, and it ends at the presentation's end date -- a
        // project that was Scrum before it moved to Kanban would otherwise mix
        // old sprint names ("8.2", "9.1") into weekly period labels, and show
        // periods after the range being presented.
        const trendCutoff = sprintPinned || isKanbanEffective ? endDate : today;
        const completed = perfSprints
          .filter(s => !isKanbanEffective || s.syncType === 'kanban')
          .filter(s => s.endDate < today && s.endDate <= trendCutoff)
          .slice(-5);
        const syncIds = completed.map(s => s.id);
        const scoreRows =
          syncIds.length > 0 ? await PerfMemberScore.findAll({ where: { syncId: { [Op.in]: syncIds } } }) : [];
        const byncId = new Map<number, typeof scoreRows>();
        for (const row of scoreRows) {
          const arr = byncId.get(row.syncId) ?? [];
          arr.push(row);
          byncId.set(row.syncId, arr);
        }
        // Both scopes from the member scorecard (same engine as the
        // drilldown): V2 = rows matched by the V2 matcher, whole-team = all
        // rows. Velocity = dev spDone; defect density = QA bugs / spDone;
        // productivity = spDone / spPlanned. planned/capacity are per-scope
        // (V2 vs whole-team committed).
        //
        // spPlanned here is Σ per-developer (spDone + spCarriedOver) — a WIP
        // snapshot, NOT a captured commitment. For a project with a real plan
        // (sprint, or cadence with tracksCommitment=true) that's a reasonable
        // stand-in. For Kanban/cadence WITHOUT tracksCommitment there is no
        // plan at all, so presenting spDone/spPlanned as a "delivered/planned
        // %" is actively misleading (it can fall in the same cycle delivery
        // rises, since the WIP denominator can grow faster than spDone).
        // metricKind flags this the same way getProductivityOverview() does
        // for the internal Team Performance page — callers use it to omit
        // these projects from percent-based charts rather than plot a
        // meaningless number.
        const hasCommitment = computeHasCommitment(project as any);
        const r1 = (n: number) => Math.round(n * 10) / 10;
        const scoreTrendFor = (rows: typeof scoreRows) => {
          const dev = rows.filter(r => r.memberCategory !== 'qa');
          const qa = rows.filter(r => r.memberCategory === 'qa');
          const spPlanned = dev.reduce((t, r) => t + Number(r.spPlanned || 0), 0);
          const spDone = dev.reduce((t, r) => t + Number(r.spDone || 0), 0);
          const delivered = dev.reduce((t, r) => t + Number(r.deliveredCount || 0), 0);
          const reopened = dev.reduce((t, r) => t + Number(r.reopenedCount || 0), 0);
          const invalidReopened = dev.reduce((t, r) => t + Number(r.invalidReopenedCount || 0), 0);
          const bugs = qa.reduce((t, r) => t + Number(r.bugsRaisedCount || 0), 0);
          const invalidBugs = qa.reduce((t, r) => t + Number(r.invalidBugsCount || 0), 0);
          const prodEscaped = qa.reduce((t, r) => t + Number(r.prodBugsEscaped || 0), 0);
          return {
            metrics: {
              dataSource: 'perf',
              metricKind: hasCommitment ? 'percent' : 'throughput',
              capacity: hasCommitment ? Math.round(spPlanned) : null,
              planned: hasCommitment ? r1(spPlanned) : null,
              actual: r1(spDone),
              productivityPct: hasCommitment ? (spPlanned > 0 ? r1((spDone / spPlanned) * 100) : 0) : null,
            },
            qualityMetrics: {
              dataSource: 'perf',
              storyPoints: r1(spDone),
              // validBugs/bugDensityPct exclude the invalidBugs subset (Root
              // Cause fuzzy-matching 'Invalid Bug'/'Bad Data'/'Incomplete
              // Requirement', or an invalid-bug label) — matches
              // getQualityTrendsOverview so Developer Trends agrees with
              // Team Performance Trends/Executive Dashboard. `bugs` (the raw,
              // inclusive count) is untouched elsewhere for QA-workload views.
              validBugs: Math.max(0, bugs - invalidBugs),
              bugsProd: prodEscaped,
              bugDensityPct: spDone > 0 ? r1((Math.max(0, bugs - invalidBugs) / spDone) * 100) : 0,
              leakageRatePct: bugs > 0 ? r1((prodEscaped / bugs) * 100) : 0,
              // Reopen ratio trend (scorecard basis): reopened ÷ delivered tickets.
              reopenedCount: reopened,
              deliveredCount: delivered,
              reopenRatePct: delivered > 0 ? r1((reopened / delivered) * 100) : 0,
              // Invalid reopens disregarded via exclusion labels, per sprint.
              invalidReopenCount: invalidReopened,
              // Invalid bugs (Root Cause 'Invalid Bug' / 'Bad Data' / 'Incomplete
              // Requirement', OR an invalid-bug label), per sprint.
              invalidBugCount: invalidBugs,
              // Project-level fields filled from quality_report below (same both scopes).
              leakageBugsRaised: 0, // leakage denominator (created-in-window valid bugs)
              prodBugsWorked: 0, // prod bugs worked in the sprint (count)
              prodBugsWorkedSp: 0, // their story points
              prodBugsWorkedInvalid: 0, // invalid worked prod bugs (count)
              prodBugsWorkedInvalidSp: 0,
              uatReopenedCount: 0,
              prodBugKeys: [] as string[], // leakage numerator tickets
              prodBugsWorkedKeys: [] as string[], // production-bugs-worked tickets (valid)
              prodBugsWorkedInvalidKeys: [] as string[], // invalid worked prod tickets
              uatReopenedKeys: [] as string[], // UAT reopen tickets
            },
          };
        };
        trendSprints = completed.map(s => {
          const rows = byncId.get(s.id) ?? [];
          const v2S = scoreTrendFor(rows.filter(r => v2Matcher.matches(r.jiraLoginId, r.displayName)));
          const allS = scoreTrendFor(rows);
          // Leakage is reporter-agnostic + project-level (whole-team): use the
          // date-window value computed + stored at sync time (quality_report),
          // identical in both scopes. Rows synced before this was added lack
          // the fields → 0 until re-synced.
          const qr = s.qualityReport;
          const leakProd = Number(qr?.prodBugsEscaped ?? 0);
          const leakPct = Number(qr?.leakageRatePct ?? 0);
          const leakDenom = Number(qr?.bugsRaised ?? 0);
          const uatReopens = Number(qr?.uatReopenedCount ?? 0);
          const prodWorked = Number(qr?.prodBugsWorkedCount ?? 0);
          const prodWorkedSp = Number(qr?.prodBugsWorkedSp ?? 0);
          const prodWorkedInvalid = Number(qr?.prodBugsWorkedInvalidCount ?? 0);
          const prodWorkedInvalidSp = Number(qr?.prodBugsWorkedInvalidSp ?? 0);
          const prodBugKeys = qr?.prodBugKeys ?? [];
          const prodWorkedKeys = qr?.prodBugsWorkedKeys ?? [];
          const prodWorkedInvalidKeys = qr?.prodBugsWorkedInvalidKeys ?? [];
          const uatKeys = qr?.uatReopenedKeys ?? [];
          for (const qm of [v2S.qualityMetrics, allS.qualityMetrics]) {
            // Leakage (created-in-window) — numerator, denominator, rate, tickets.
            qm.bugsProd = leakProd;
            qm.leakageRatePct = leakPct;
            qm.leakageBugsRaised = leakDenom;
            qm.prodBugKeys = prodBugKeys;
            // Production bugs worked in the sprint — valid + invalid split.
            qm.prodBugsWorked = prodWorked;
            qm.prodBugsWorkedSp = prodWorkedSp;
            qm.prodBugsWorkedKeys = prodWorkedKeys;
            qm.prodBugsWorkedInvalid = prodWorkedInvalid;
            qm.prodBugsWorkedInvalidSp = prodWorkedInvalidSp;
            qm.prodBugsWorkedInvalidKeys = prodWorkedInvalidKeys;
            // UAT reopens — count, tickets.
            qm.uatReopenedCount = uatReopens;
            qm.uatReopenedKeys = uatKeys;
          }
          return {
            syncId: s.id,
            name: s.sprintName,
            startDate: s.startDate,
            endDate: s.endDate,
            // Base = V2 (default render). byScope carries both.
            metrics: v2S.metrics,
            qualityMetrics: v2S.qualityMetrics,
            metricsByScope: { v2: v2S.metrics, overall: allS.metrics },
            qualityMetricsByScope: { v2: v2S.qualityMetrics, overall: allS.qualityMetrics },
          };
        });
      } else {
        trendSource = 'wsr';
        // Completed weeks only — a week is completed at windowEnd when its
        // endDate <= windowEnd. This matches the drilldown rule and handles
        // overlapping week windows correctly.
        const completedAll = allProjectWSRs.filter(w => w.endDate <= endDate);
        trendSprints = completedAll.slice(-5).map(w => {
          const m = (w.metrics || {}) as any;
          const throughput = Number(m.throughput) || 0;
          const avgActive = Number(m.avgActiveTickets) || 0;
          const blocked = Number(m.maxBlockedTickets) || 0;
          return {
            syncId: null,
            name: `Wk ${w.weekNumber}`,
            startDate: w.startDate,
            endDate: w.endDate,
            metrics: {
              dataSource: 'wsr',
              // `actual` kept for chart compatibility — tickets completed
              actual: throughput,
              ticketsCompleted: throughput,
              avgActiveTickets: avgActive,
              maxBlockedTickets: blocked,
            },
            qualityMetrics: { dataSource: 'wsr' },
          };
        });
      }

      trendData[String(projectId)] = {
        projectName: project.name,
        sprints: trendSprints,
        dataSource: trendSource,
        // Base URL for linking ticket keys in the per-chart ticket tables.
        jiraBaseUrl: project.jiraBaseUrl ?? null,
      };

      // ---- Drilldown metrics --------------------------------------------------
      let metrics: any = {};
      let quality: any = {};
      // Whole-team (no-matcher) counterparts of metrics/quality, used to
      // base the account-level Executive Summary totals on the entire team
      // rather than V2 only. Populated only for perf-sprint projects.
      let metricsOverall: any = {};
      let qualityOverall: any = {};
      // Dual-scope delivery+quality (V2 + whole-team) computed from
      // PerfTicketFact with Board-View formulas. Attached additively so the
      // frontend can toggle scope per-slide (default V2). Null for
      // WSR/Kanban projects (no PerfTicketFact rows).
      let metricsByScope: { v2: ScopedDrilldownMetrics; overall: ScopedDrilldownMetrics } | null = null;
      let team: any[] = [];
      // Per-sprint team breakdown — populated only when 2+ sprints are
      // aggregated for this project. UI uses it to render one Team table
      // per sprint instead of one combined table; falls back to `team`.
      let teamBySprint: any[] = [];
      // Whole-team counterparts (all contributors, not just V2) — used to make
      // the drilldown Team table switch with the V2 ⇄ Whole-team toggle.
      let teamOverall: any[] = [];
      let teamBySprintOverall: any[] = [];
      // Developer Velocity — sprint mode: the 5 closed sprints ending on/before
      // the selected sprint's end, so the sparkline lines up with the presented
      // sprint. Date-range/program mode: pass undefined so the function keeps
      // its original "latest 5, no window" behavior (protects the stable flow).
      // Sprint-based metric, so skipped for Kanban. Null when the project has no
      // closed sprints / no V2 developer activity; the UI hides the section then.
      const trendBeforeDate = sprintPinned ? endDate : undefined;
      const developerVelocity = isKanbanEffective
        ? null
        : await getDeveloperVelocity(projectId, v2Matcher, trendBeforeDate);
      // Whole-team variant (no matcher) so the per-developer trends switch with
      // the V2 ⇄ Whole-team toggle and include non-V2 developers.
      const developerVelocityOverall = isKanbanEffective
        ? null
        : await getDeveloperVelocity(projectId, null, trendBeforeDate);
      // Companion per-developer trend pair (Reopen % + Carryover %) over the
      // same 5-sprint window as developerVelocity. Same skip rules apply.
      const developerTrends = isKanbanEffective
        ? null
        : await getDeveloperReopenAndCarryoverTrends(projectId, v2Matcher, trendBeforeDate);
      const developerTrendsOverall = isKanbanEffective
        ? null
        : await getDeveloperReopenAndCarryoverTrends(projectId, null, trendBeforeDate);
      let sprintName = `Window ${startDate} to ${endDate}`;
      let narrative: string;
      // The WSRs used for narrative extraction — different from the window rule
      // because achievements/blockers should cover what we're actually presenting.
      let narrativeWSRs: ProjectWeeklyReport[] = [];

      // ---- Live Status (Current Sprint / Current Board Status) --------------
      // The drilldown card shown for every project where there's something
      // live to report. Three scenarios:
      //   1. Scrum + perf row exists for the live sprint → enrich the
      //      existing perf-driven payload with snapshot lane breakdown.
      //   2. Scrum + NO perf row but the latest snapshot's burndown says
      //      a sprint is in flight today → build the card from the snapshot
      //      alone (this is the OPS2 case — user only syncs PerfSprintSync
      //      AFTER a sprint closes).
      //   3. Kanban → no sprint concept; show only lane counts from the
      //      latest snapshot (no SP, no days remaining, no goal).
      //
      // Lane counts + reopens + sub-bugs come from DailyBoardSnapshot in
      // every scenario, so the same data drives the DSR display too.
      const latestSnapshot = await DailyBoardSnapshot.findOne({
        where: { projectId, date: { [Op.lte]: today } },
        order: [['date', 'DESC']],
      });
      const projectLaneConfig = getLaneConfig(project);
      // Board-wide lane bucketing — used for Kanban (no other source) and
      // as a fallback for scrum snapshots written before per-lane V2 ticket
      // counts were tracked on sprintBurndown.
      const boardTicketsByLane = latestSnapshot?.statusCounts
        ? bucketStatusCountsIntoLanes(latestSnapshot.statusCounts, projectLaneConfig)
        : null;
      const subBugsLogged = latestSnapshot?.subBugsLoggedCount ?? null;

      let inFlightSprint: any = null;
      // Sprint mode presents one historical completed sprint, so the live
      // "Current Sprint" card (built from today's board snapshot, independent
      // of the window) is out of context — suppress it. Date-range/program
      // mode (!sprintPinned) is unaffected.
      if (!isKanbanEffective && !sprintPinned) {
        // Scrum: prefer V2-scoped ticket counts pulled from sprintBurndown
        // so the lane breakdown reconciles with the SP pipeline (both
        // V2-team-only). Falls back to board-wide statusCounts only when
        // the snapshot pre-dates the per-lane V2 ticket fields.
        const burndown = latestSnapshot?.sprintBurndown ?? null;
        const v2Lanes = burndown ? ticketsByLaneFromBurndown(burndown) : null;
        const scrumLanes = v2Lanes ?? boardTicketsByLane ?? EMPTY_LANES;
        const scopeLabel = v2Lanes ? 'v2-sprint' : 'board';
        // Reopened count: prefer the V2 in-reopened-lane count (matches the
        // table). Otherwise fall back to the board-wide reopen count from
        // the snapshot column or the bucketed board lane.
        const scrumReopened = v2Lanes
          ? v2Lanes.reopened
          : (latestSnapshot?.reopenedTicketsCount ?? boardTicketsByLane?.reopened ?? 0);

        if (inFlightPerfSprints.length > 0) {
          const enriched = await buildInFlightSprintSummary(inFlightPerfSprints[0], projectId, today, {
            ticketsByLane: scrumLanes,
            reopenedTickets: scrumReopened,
            subBugsLogged,
          });
          inFlightSprint = { ...enriched, type: 'sprint', scopeLabel };
        } else if (burndown && burndown.endDate >= today) {
          inFlightSprint = buildInFlightFromBurndown(burndown, latestSnapshot!.date, {
            ticketsByLane: scrumLanes,
            reopenedTickets: scrumReopened,
            subBugsLogged,
          });
          inFlightSprint.type = 'sprint';
          inFlightSprint.scopeLabel = scopeLabel;
        }
      } else if (latestSnapshot?.statusCounts) {
        // Kanban: only the board snapshot is available. No V2 vs board
        // distinction here — the snapshot already represents team-scoped
        // work and we surface it as the whole board.
        const reopenedTickets = latestSnapshot.reopenedTicketsCount ?? boardTicketsByLane?.reopened ?? 0;
        inFlightSprint = {
          type: 'kanban',
          scopeLabel: 'board',
          boardName: latestSnapshot.boardName ?? project.name,
          sprintName: null,
          startDate: null,
          endDate: null,
          daysTotal: null,
          daysElapsed: null,
          daysRemaining: null,
          sprintElapsedPct: null,
          plannedSP: null,
          deliveredSP: null,
          remainingSP: null,
          completionPctSP: null,
          ticketsTotal: null,
          ticketsCompleted: null,
          ticketsRemaining: null,
          bugsRaised: 0,
          subBugsRaised: 0,
          topLevelBugs: 0,
          pipelineSP: null,
          ticketsByLane: boardTicketsByLane ?? EMPTY_LANES,
          reopenedTickets,
          subBugsLogged,
          snapshotDate: latestSnapshot.date,
          onTrackStatus: null,
        };
      }
      const noCompletedSprintInWindow = selectedPerfSprints.length > 0 && completedPerfSprints.length === 0;

      if (completedPerfSprints.length > 0) {
        // Kanban/cadence projects with tracksCommitment=false have no captured
        // plan (committedSp is null on their syncs) — every commitment-relative
        // figure below (Planned/Capacity, Productivity%, Net Scope Change,
        // spillover/scope-creep AS A % OF PLAN) is meaningless for them and must
        // render as N/A, never a 0-coerced number. Raw counts (delivered SP,
        // still-open-at-cycle-end tickets) stay real regardless.
        const hasCommitment = computeHasCommitment(project as any);
        // Tables/totals/team/trend now driven by completed sprints only.
        // V2-only filter is applied by default.
        // Both scopes come from the SAME scorecard engine that powers the
        // Board View > Developer Performance table: V2 = matcher applied,
        // whole-team = no matcher. So the presentation reconciles to that
        // table for both scopes (LP 6.1: V2 70 / whole-team 92). Base
        // metrics/quality default to V2; metricsByScope carries both for
        // the per-slide toggle.
        // Capacity config (hours-based projects) applies to both scopes.
        const capacityCfg = {
          estimationType: (project as any).estimationType,
          defaultDailyCapacityHours: (project as any).defaultDailyCapacityHours,
        };
        const agg = await aggregatePerfSprintMetrics(completedPerfSprints, v2Matcher, capacityCfg);
        const overallAgg = await aggregatePerfSprintMetrics(completedPerfSprints, null, capacityCfg);
        metrics = agg.metrics;
        quality = agg.quality;
        metricsOverall = overallAgg.metrics;
        qualityOverall = overallAgg.quality;
        team = agg.team;
        teamBySprint = agg.teamBySprint;
        teamOverall = overallAgg.team;
        teamBySprintOverall = overallAgg.teamBySprint;
        metricsByScope = {
          v2: scorecardScope(agg),
          overall: scorecardScope(overallAgg),
        };

        // ── Reconcile Committed/Delivered to the Board View ───────────
        // The developer-only member rollup above zeroes out story points
        // that landed on QA-category members, so the Delivery card diverged
        // from the Team Performance Board View (Scorecard). Re-source the
        // headline Committed + Delivered (SP and tickets) from the SAME
        // whole-sprint truth the Board reads — perf_sprint_syncs.committed_sp
        // and perf_ticket_facts across ALL assignees — so both toggle scopes
        // reconcile to the Board and QA-assigned delivery is counted. This is
        // presentation-only: the shared aggregation engine, the Board's
        // getScorecard and member scores are untouched.
        {
          const completedSyncIds = completedPerfSprints.map(s => s.id);
          // Prior-period completions excluded so V2 `committed` and the QA
          // `spTested` table don't count work finished in an earlier cycle.
          const allFacts = await PerfTicketFact.findAll({
            where: { syncId: { [Op.in]: completedSyncIds }, ...EXCLUDE_PRIOR_PERIOD_COMPLETION },
          });
          const factsBySync = new Map<number, PerfTicketFact[]>();
          for (const f of allFacts) {
            const arr = factsBySync.get(f.syncId) ?? [];
            arr.push(f);
            factsBySync.set(f.syncId, arr);
          }
          const r1 = (n: number) => Math.round(n * 10) / 10;
          // Per-sprint Board-sourced figures for a given population.
          //   Delivered SP    = Σ story points of completed tickets (any assignee).
          //   Delivered count = completed tickets excluding Sub-bugs (0-SP noise).
          //   Committed       = whole-team: EXACT committed_sp (what the Board shows);
          //                     V2 subset: approximated from ticket facts (tickets in
          //                     the sprint at start = not a mid-sprint scope add), since
          //                     no per-team committed_sp is persisted.
          //                     Neither is meaningful when the project has no captured
          //                     plan at all (hasCommitment=false) — committed is null
          //                     rather than 0 in that case, all the way through.
          const boardFor = (matchV2: boolean) => {
            const perSprint = completedPerfSprints.map(s => {
              const facts = (factsBySync.get(s.id) ?? []).filter(
                f => !matchV2 || v2Matcher.matches(f.assigneeJiraId, f.assigneeName)
              );
              const deliveredSP = r1(
                facts.filter(f => f.wasCompleted).reduce((t, f) => t + Number(f.storyPoints || 0), 0)
              );
              const deliveredCount = facts.filter(f => f.wasCompleted && f.issueType !== 'Sub-bug').length;
              const committed = !hasCommitment
                ? null
                : matchV2
                  ? r1(facts.filter(f => !f.wasScopeChange).reduce((t, f) => t + Number(f.storyPoints || 0), 0))
                  : r1(s.committedSp != null ? Number(s.committedSp) : 0);
              // Removed = tickets punted (pulled out) mid-sprint. Same
              // source as the Board View's "Removed (Team)" tile.
              const puntedFacts = facts.filter(f => f.wasPunted);
              const removedSP = r1(puntedFacts.reduce((t, f) => t + Number(f.storyPoints || 0), 0));
              const removedCount = puntedFacts.length;
              return { syncId: s.id, committed, deliveredSP, deliveredCount, removedSP, removedCount };
            });
            return {
              committed: hasCommitment ? r1(perSprint.reduce((t, p) => t + (p.committed ?? 0), 0)) : null,
              deliveredSP: r1(perSprint.reduce((t, p) => t + p.deliveredSP, 0)),
              deliveredCount: perSprint.reduce((t, p) => t + p.deliveredCount, 0),
              removedSP: r1(perSprint.reduce((t, p) => t + p.removedSP, 0)),
              removedCount: perSprint.reduce((t, p) => t + p.removedCount, 0),
              perSprint,
            };
          };
          const boardV2 = boardFor(true);
          const boardWhole = boardFor(false);

          // Overwrite the SP headline + per-sprint rows on a metrics object
          // in-place. Handles both shapes: base metrics.perSprint uses
          // `actual`; metricsByScope.perSprint uses `deliveredSP`. Spillover /
          // scope-added / reopen / bug fields are intentionally left as-is —
          // they already reconcile to the Board.
          const applyBoard = (mObj: any, board: ReturnType<typeof boardFor>) => {
            if (!mObj) return;
            mObj.capacity = board.committed;
            mObj.planned = board.committed;
            mObj.actual = board.deliveredSP;
            mObj.deliveredCount = board.deliveredCount;
            mObj.metricKind = board.committed != null ? 'percent' : 'throughput';
            mObj.productivityPct =
              board.committed != null
                ? board.committed > 0
                  ? r1((board.deliveredSP / board.committed) * 100)
                  : 0
                : null;
            // Removed SP (tickets punted mid-sprint) + its % of committed.
            // The count is real WIP data regardless of commitment; the % (a
            // share OF the plan) only exists when there's a plan to divide by.
            mObj.removedSp = board.removedSP;
            mObj.removedCount = board.removedCount;
            mObj.removedPct =
              board.committed != null
                ? board.committed > 0
                  ? r1((board.removedSP / board.committed) * 100)
                  : 0
                : null;
            // "SP updated mid-sprint" = re-estimation residual, the same
            // reconciling identity the Board View uses:
            //   added − removed + reEstimated = net scope change,
            //   net = finalScope − committed, finalScope = delivered + spillover.
            // Spillover / scope-added are left member-based (they already
            // reconcile to the Board); this makes the parts tie to the net.
            // The whole identity is anchored on `committed` — with no plan to
            // anchor to, "re-estimation residual" isn't a coherent number.
            if (board.committed != null) {
              const spill = Number(mObj.spillovers || 0);
              const added = Number(mObj.scopeAddedSP || 0);
              mObj.reEstimatedSp = r1(board.deliveredSP + spill - board.committed - added + board.removedSP);
            } else {
              mObj.reEstimatedSp = null;
            }
            // Plan-relative percentages (spillover / scope-creep AS A SHARE OF
            // PLAN) are meaningless without a plan; the underlying SP/ticket
            // counts (mObj.spillovers, mObj.scopeAddedSP, …) stay untouched —
            // they're real "still open" / "added mid-cycle" board facts.
            if (board.committed == null) {
              mObj.spilloverPct = null;
              mObj.scopeCreepPct = null;
            }
            const bBySync = new Map(board.perSprint.map(p => [p.syncId, p]));
            if (Array.isArray(mObj.perSprint)) {
              for (const p of mObj.perSprint) {
                const b = bBySync.get(p.syncId);
                if (!b) continue;
                p.planned = b.committed;
                p.actual = b.deliveredSP;
                p.deliveredSP = b.deliveredSP;
                p.deliveredCount = b.deliveredCount;
                p.removedSp = b.removedSP;
                p.removedCount = b.removedCount;
              }
            }
          };
          // base sprintMetrics is the V2 population; metricsByScope carries both.
          applyBoard(metrics, boardV2);
          applyBoard(metricsByScope.v2, boardV2);
          applyBoard(metricsByScope.overall, boardWhole);

          // ── QA story-point enrichment (presentation-only, no resync) ──
          // The QA table shows Tickets Tested; enrich each member with the
          // SP weight of tickets they TESTED (by qa_tester) and any SP they
          // DELIVERED as an assignee (dev work QA members occasionally pick
          // up — the member rollup zeroes it). Derived from the already-loaded
          // ticket facts; shared engine, Board and member scores untouched.
          const qaStatsFor = (facts: PerfTicketFact[]) => {
            const tested = new Map<string, number>();
            const delivered = new Map<string, number>();
            for (const f of facts) {
              if (f.qaTesterJiraId)
                tested.set(f.qaTesterJiraId, (tested.get(f.qaTesterJiraId) || 0) + Number(f.storyPoints || 0));
              if (f.assigneeJiraId && f.wasCompleted)
                delivered.set(f.assigneeJiraId, (delivered.get(f.assigneeJiraId) || 0) + Number(f.storyPoints || 0));
            }
            return { tested, delivered };
          };
          const enrichQaSp = (members: any[], stats: ReturnType<typeof qaStatsFor>) => {
            for (const mm of members || []) {
              const t = stats.tested.get(mm.jiraLoginId);
              const dv = stats.delivered.get(mm.jiraLoginId);
              if (t != null) mm.spTested = r1(t);
              if (dv != null) mm.spDelivered = r1(dv);
            }
          };
          const aggQaStats = qaStatsFor(allFacts);
          enrichQaSp(team as any[], aggQaStats);
          enrichQaSp(teamOverall as any[], aggQaStats);
          for (const s of (teamBySprint as any[]) || [])
            enrichQaSp(s.team, qaStatsFor(factsBySync.get(s.syncId) ?? []));
          for (const s of (teamBySprintOverall as any[]) || [])
            enrichQaSp(s.team, qaStatsFor(factsBySync.get(s.syncId) ?? []));
        }

        const labels = completedPerfSprints.map(s => s.sprintName);
        sprintName =
          labels.length >= 2 ? `${labels.slice(0, -1).join(' + ')} + ${labels[labels.length - 1]}` : labels[0];
        // Board-type in-flight cards (Kanban / scrum board snapshot) carry no
        // sprintName — fall back to boardName, and use board-appropriate prose
        // when neither exists so we never emit "Current sprint null …".
        const inFlightName = inFlightSprint?.sprintName || inFlightSprint?.boardName || null;
        const inFlightSuffix = inFlightName
          ? ` Current sprint ${inFlightName} is in flight — see the Current Sprint card.`
          : inFlightSprint
            ? ` See the Current Sprint card for live board status.`
            : '';
        // Scope-neutral prose: the actual figures (delivery, scope, reopens,
        // defects) live in the metric cards/tables below, which switch with
        // the V2 ⇄ Whole-team toggle. Keeping numbers out of the narrative
        // avoids it going stale (or implying one scope) when the toggle flips.
        narrative =
          labels.length >= 2
            ? `Team delivery across ${labels.length} completed sprints (${labels.join(', ')}). Delivery, scope changes, reopens and defects are summarised in the metrics below and broken out sprint-by-sprint in the Per-Sprint Breakdown.${inFlightSuffix}`
            : `Team delivery in completed sprint ${labels[0]}. Delivery, spillover, scope changes, reopens and defects are summarised in the metrics below.${inFlightSuffix}`;

        // Narrative WSRs — weeks that SUBSTANTIALLY fall inside the sprint
        // window, used to source achievements, blockers, AI exec-summary
        // context and WSR-based health. We require the week's MIDPOINT to
        // sit within the window (i.e. the majority of the week belongs to
        // this sprint) rather than any overlap at all. A pure-overlap test
        // let a week that touches the window by a single day (e.g. the week
        // ending on the sprint's first day) contribute its whole — largely
        // pre-sprint — achievements/blockers list, which then crowded out
        // the weeks actually inside the sprint.
        const sprintWindowStart = completedPerfSprints[0].startDate;
        const sprintWindowEnd = completedPerfSprints[completedPerfSprints.length - 1].endDate;
        const wsrMidpointInWindow = (w: ProjectWeeklyReport) => {
          const startMs = new Date(w.startDate).getTime();
          const endMs = new Date(w.endDate).getTime();
          const midpoint = new Date((startMs + endMs) / 2).toISOString().slice(0, 10);
          return midpoint >= sprintWindowStart && midpoint <= sprintWindowEnd;
        };
        narrativeWSRs = allProjectWSRs.filter(wsrMidpointInWindow);
      } else if (noCompletedSprintInWindow) {
        // Only in-flight sprint(s) picked. No tables/totals/team data to
        // show — the Current Sprint card carries the whole story.
        // Board-type in-flight cards have no sprintName — fall back to boardName.
        const inFlightName = inFlightSprint?.sprintName || inFlightSprint?.boardName || null;
        sprintName = inFlightName ? `${inFlightName} (in progress)` : '(no completed sprint)';
        narrative = inFlightName
          ? `No completed sprint in window. Current sprint ${inFlightName} is in progress — see the Current Sprint card.`
          : `No completed sprint in window. The current sprint is in progress — see the Current Sprint card.`;
        metrics = { dataSource: 'perf', v2Only: !!v2Matcher };
        quality = { dataSource: 'perf' };
        team = [];
      } else if (sprintPinUnsynced) {
        // "By sprint" was chosen but that sprint has no synced PerfSprintSync
        // row yet. Show an explicit needs-sync state rather than falling
        // through to the WSR (weekly) branch, which would silently present
        // weekly data in place of the sprint the user asked for.
        sprintName = '(selected sprint not synced)';
        narrative =
          'The selected sprint has not been synced yet. Run a sprint sync for this project to populate delivery, scope, reopen and defect metrics.';
        metrics = { dataSource: 'perf', v2Only: !!v2Matcher };
        quality = { dataSource: 'perf' };
        team = [];
      } else if (rangeSprintUnsynced) {
        // A sprint overlaps this date range but only a marginally-
        // overlapping predecessor was synced (excluded above). Show an
        // explicit uncovered/needs-sync state instead of the predecessor's
        // numbers or a silent fall-through to WSR weekly data. The
        // windowCoverageWarning is surfaced as a banner in the drilldown.
        sprintName = '(no synced sprint covers this window)';
        narrative =
          "A sprint overlaps this date range but has not been synced into delivery metrics. Only an earlier, marginally-overlapping sprint was found and excluded to avoid misreporting its work as this window's. Run a sprint sync for this project, or verify the intended sprint dates.";
        metrics = { dataSource: 'perf', v2Only: !!v2Matcher };
        quality = { dataSource: 'perf' };
        team = [];
      } else if (completedTwoWeeks.length > 0) {
        // Aggregate the two previous completed weeks.
        let throughput = 0;
        let avgActiveSum = 0;
        let maxBlocked = 0;
        const teamSet = new Set<string>();
        for (const w of completedTwoWeeks) {
          const m = (w.metrics || {}) as any;
          throughput += Number(m.throughput) || 0;
          avgActiveSum += Number(m.avgActiveTickets) || 0;
          maxBlocked = Math.max(maxBlocked, Number(m.maxBlockedTickets) || 0);
          for (const name of Array.isArray(m.teamMembers) ? m.teamMembers : []) teamSet.add(String(name));
        }
        const weeks = completedTwoWeeks.length;
        const avgActiveRounded = weeks > 0 ? Math.round(avgActiveSum / weeks) : 0;
        metrics = {
          dataSource: 'wsr',
          actual: throughput,
          ticketsCompleted: throughput,
          avgActiveTickets: avgActiveRounded,
          maxBlockedTickets: maxBlocked,
          weeksCovered: weeks,
        };
        quality = { dataSource: 'wsr' };
        team = Array.from(teamSet).map(name => ({
          name,
          role: '',
          storyPoints: 0,
          execution: 0,
          quality: 0,
          overallRating: 0,
        }));
        const labels = completedTwoWeeks.map(w => `Wk ${w.weekNumber}`);
        const currentLabel = currentWeek ? `Wk ${currentWeek.weekNumber}` : null;
        sprintName = currentLabel
          ? `${labels.join(' + ')} (completed; ${currentLabel} in progress — excluded)`
          : `${labels.join(' + ')} (last two completed weeks)`;

        // Narrative: prefer latest completed WSR exec summary
        const latestCompleted = completedTwoWeeks[completedTwoWeeks.length - 1];
        const cleanedExec = stripTicketIds(latestCompleted.executiveSummary || latestCompleted.workSummary || '');
        narrative = (cleanedExec.split(/\n{2,}/)[0] || cleanedExec).slice(0, 600);
        if (!narrative) {
          narrative = `Completed ${throughput} ticket(s) across ${weeks} completed week(s); max blocked in-window: ${maxBlocked}.`;
        }
        // Narrative WSRs = the two completed weeks used for the drilldown
        narrativeWSRs = completedTwoWeeks;
      } else {
        narrative = isKanbanEffective
          ? `Kanban project: no completed weeks available before ${endDate}.`
          : `No sprint or weekly report data available for this window.`;
      }

      // Account-level totals (exec summary, account-rollup, defect density)
      // follow the presentation's DEFAULT scope = Whole Team (matching the
      // frontend's DEFAULT_SCOPE = 'overall'). Prefer the whole-team
      // aggregation; fall back to base for WSR/Kanban projects that have no
      // V2/whole-team split (metricsByScope null).
      const execMetrics = metricsByScope ? metricsOverall : metrics;
      const execQuality = metricsByScope ? qualityOverall : quality;
      const execPlannedN = Number((execMetrics as any).planned) || 0;
      const execActualN = Number((execMetrics as any).actual) || 0;
      // Per-project health fallback + drilldown stay on the base scope.
      const plannedN = Number((metrics as any).planned) || 0;
      const actualN = Number((metrics as any).actual) || 0;
      const isHoursProject = (project as any).estimationType === 'hours';
      const isWsrTickets = (execMetrics as any).dataSource === 'wsr';
      // Never sum across units: route each project's totals to the
      // accumulator matching its actual unit (SP, hours, or WSR ticket count).
      if (isWsrTickets) {
        aggTicketsThroughput += execActualN;
      } else if (isHoursProject) {
        aggPlannedHours += execPlannedN;
        aggActualHours += execActualN;
        aggBugsHours += Number((execQuality as any).validBugs) || 0;
        aggSPHours += Number((execQuality as any).storyPoints) || 0;
      } else {
        aggPlanned += execPlannedN;
        aggActual += execActualN;
        aggBugs += Number((execQuality as any).validBugs) || 0;
        aggSP += Number((execQuality as any).storyPoints) || 0;
      }

      // ---- Project health — derived from WSR statuses covering the drilldown --
      // Mean across the weeks, not worst-case. For a multi-week delivery view, a single
      // bad week shouldn't dominate: 3 Amber + 1 Red rounds to Amber, not Red.
      let projectHealth: Health = 'Green';
      if (narrativeWSRs.length > 0) {
        projectHealth = meanHealth(narrativeWSRs.map(w => statusToHealth(w.status)));
      } else {
        if (plannedN > 0) {
          const redT = account.redThresholdPercentage ?? 30;
          const amberT = account.amberThresholdPercentage ?? 20;
          const missPct = ((plannedN - actualN) / plannedN) * 100;
          if (missPct >= redT) projectHealth = 'Red';
          else if (missPct >= amberT) projectHealth = 'Amber';
        }
      }
      aggregateHealthVotes.push(projectHealth);

      // ---- Extract per-project achievements + blockers from WSR narratives ----
      // Use the WSRs that cover the chosen drilldown period (sprint window or the
      // two completed Kanban weeks). Sr. management view: strip Jira ticket IDs,
      // cap to 3 items per project.
      let achBulletsForAi: string[] = [];
      let blockerBulletsForAi: string[] = [];
      if (narrativeWSRs.length > 0) {
        const achText = narrativeWSRs.map(w => w.achievements || '').join('\n');
        const riskText = narrativeWSRs.map(w => w.risks || '').join('\n');
        achBulletsForAi = splitNarrativeToBullets(achText, 3);
        blockerBulletsForAi = splitNarrativeToBullets(riskText, 3);
        for (const a of achBulletsForAi) allAchievements.push(`[${project.name}] ${a}`);
        for (const b of blockerBulletsForAi) allBlockers.push(`[${project.name}] ${b}`);
      }

      // Capture per-project context for AI synthesis (latest 2 WSR exec summaries from
      // the narrative WSRs - the same WSRs feeding achievements/blockers above).
      const wsrExecSummaries = narrativeWSRs
        .slice(-2)
        .map(w => stripTicketIds((w as any).executiveSummary || w.workSummary || '').trim())
        .filter(s => s.length > 0)
        .map(s => s.slice(0, 600));
      aiProjectContext.push({
        projectName: project.name,
        wsrExecSummaries,
        achievements: achBulletsForAi,
        risks: blockerBulletsForAi,
      });

      // Kanban Team Capacity seed: one row per V2 developer per completed
      // Kanban period (cycle / reporting week) overlapping the presentation
      // window, with the period's weekday count (weekends ignored; no holiday
      // calendar -- same rule as capacityMath.countWeekdays). Sprint-based
      // developerVelocity is skipped for Kanban, so this is the Kanban
      // replacement. Leaves are never computed -- the user enters them.
      let kanbanCycleCapacity: Array<{
        syncId: number; period: string; startDate: string; endDate: string; workingDays: number;
        jiraLoginId: string; name: string; spDelivered: number;
      }> | null = null;
      if (isKanbanEffective && completedPerfSprints.length > 0) {
        const cycleSyncIds = completedPerfSprints.map(s => s.id);
        const cycleScores = await PerfMemberScore.findAll({ where: { syncId: { [Op.in]: cycleSyncIds } } });
        kanbanCycleCapacity = [];
        for (const sp of completedPerfSprints) {
          const workingDays = countWeekdays(new Date(sp.startDate), new Date(sp.endDate));
          for (const r of cycleScores) {
            if (r.syncId !== sp.id || r.memberCategory === 'qa') continue;
            if (!v2Matcher.matches(r.jiraLoginId, r.displayName)) continue;
            kanbanCycleCapacity.push({
              syncId: sp.id,
              period: sp.sprintName ?? '',
              startDate: sp.startDate,
              endDate: sp.endDate,
              workingDays,
              jiraLoginId: r.jiraLoginId,
              name: r.displayName,
              spDelivered: Math.round(Number(r.spDone || 0) * 10) / 10,
            });
          }
        }
      }

      perProjectDrilldown.push({
        projectId,
        projectName: project.name,
        estimationType: (project as any).estimationType ?? 'story_points',
        health: projectHealth, // system-computed per-project RAG (mean of WSR statuses)
        healthOverride: null, // manual override — null = use computed. Preserved across refreshFromSystem.
        narrative,
        sprintName,
        sprintMetrics: metrics,
        qualityMetrics: quality,
        // Both scopes (V2 + whole-team) for delivered SP / tickets /
        // reopen / productivity / defect density, computed from
        // PerfTicketFact. Frontend toggles per slide (default V2);
        // scope-independent fields stay on sprintMetrics. Null when the
        // drilldown is WSR/Kanban-based.
        metricsByScope,
        // Team — delivery/reopens/bugs only. No execution or quality scoring.
        // Base = V2 (default render, backward-compat).
        teamMembers: mapTeam(team as any[]),
        // Per-sprint team breakdown — non-empty when 2+ completed
        // sprints in window. Frontend renders one Team table per sprint
        // when present; otherwise falls back to teamMembers (aggregate).
        teamBySprint: mapTeamBySprint(teamBySprint as any[]),
        // Both scopes so the Team table switches with the V2 ⇄ Whole-team
        // toggle (whole-team adds the non-V2 contributors). Empty arrays for
        // WSR/Kanban drilldowns; frontend falls back to base teamMembers.
        teamMembersByScope: {
          v2: mapTeam(team as any[]),
          overall: mapTeam(teamOverall as any[]),
        },
        teamBySprintByScope: {
          v2: mapTeamBySprint(teamBySprint as any[]),
          overall: mapTeamBySprint(teamBySprintOverall as any[]),
        },
        isVisible: true,
        // In-flight sprint card payload (null when no in-flight sprint
        // was picked for this project). Frontend renders it above the
        // existing project drilldown card and hides tables when there
        // is no completed sprint in window.
        inFlightSprint,
        noCompletedSprintInWindow,
        // Range-mode "the intended sprint isn't synced" state — true when a
        // predecessor was excluded for marginal overlap. Frontend/PDF render
        // windowCoverageWarning as a banner and suppress the empty tables.
        rangeSprintUnsynced,
        windowCoverageWarning,
        // Developer Velocity for the last 5 closed sprints (compact
        // row layout, one row per V2 developer). Independent of the
        // presentation window. Null for Kanban / no data.
        developerVelocity,
        // Kanban-only: per-developer per-period rows for the Team Capacity table.
        kanbanCycleCapacity,
        isKanbanEffective,
        // Per-developer Reopen % + Carryover % trends across the same
        // 5-sprint window as developerVelocity.
        developerTrends,
        // Both scopes so the per-developer trends switch with the V2 ⇄
        // Whole-team toggle (whole-team adds non-V2 developers). Base
        // fields above stay V2 for backward-compat.
        developerVelocityByScope: { v2: developerVelocity, overall: developerVelocityOverall },
        developerTrendsByScope: { v2: developerTrends, overall: developerTrendsOverall },
      });

      // Risks — open only (status != DONE) within window. STRICTLY
      // project-scoped: account-level risks (rows with project_id IS NULL)
      // are intentionally excluded from Delivery Presentations. Do not
      // loosen this filter to pull projectId=null rows.
      const projectRisks = await Risk.findAll({
        where: {
          projectId,
          notifiedDate: { [Op.between]: [startDate, endDate] },
          status: { [Op.ne]: 'DONE' },
        },
        order: [['notifiedDate', 'DESC']],
      });
      for (const r of projectRisks) {
        allRisks.push({
          projectId: r.projectId,
          projectName: project.name,
          title: r.title,
          description: r.description,
          priority: r.priority,
          status: r.status,
          source: r.source,
        });
      }

      // Action items — project-scoped, open/in-progress
      const items = await ProjectActionItem.findAll({
        where: { projectId, status: { [Op.in]: ['Open', 'In-Progress', 'In Progress'] } },
        order: [['dueDate', 'ASC']],
      });
      for (const it of items) {
        allActionItems.push({
          id: it.id,
          projectId: it.projectId,
          projectName: project.name,
          title: it.title,
          owner: it.owner,
          status: it.status,
          dueDate: it.dueDate,
          category: it.category,
          source: 'project' as const,
        });
      }
    }

    // Program-level action items (only when the presentation is built from a
    // program). Account-level action items are intentionally NOT pulled — a
    // Delivery Presentation surfaces only the selected projects' items plus,
    // when program-scoped, that program's own action items.
    if (programId) {
      const program = await Program.findByPk(programId);
      const programItems = await ProgramActionItem.findAll({
        where: { programId, status: { [Op.in]: ['Open', 'In-Progress', 'In Progress'] } },
        order: [['dueDate', 'ASC']],
      });
      for (const it of programItems) {
        allActionItems.push({
          id: it.id,
          projectId: null,
          projectName: program ? (program as any).name : 'Program',
          title: it.title,
          owner: it.owner,
          status: it.status,
          dueDate: it.dueDate,
          category: it.category,
          source: 'program' as const,
        });
      }
    }

    // Aggregate roll-up
    const sortedRisks = allRisks.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
    // Portfolio-level health = mean across participating projects (same rule as per-project).
    const overallHealth: Health = meanHealth(aggregateHealthVotes);

    const defectDensity = aggSP > 0 ? Math.round((aggBugs / aggSP) * 1000) / 10 : 0;

    // Prefer richer narrative blockers when available; otherwise fall back to risk titles.
    const blockerBullets =
      allBlockers.length > 0
        ? allBlockers.slice(0, 6)
        : sortedRisks.slice(0, 3).map(r => `[${r.projectName}] ${r.title}`);

    // Aggregate delivery headline. Pure formulaic version is used as fallback
    // (and as the metric footer) when AI synthesis runs below.
    const formulaicSummary = buildFormulaicSummary({
      accountName: account.name,
      projectCount: projectIds.length,
      startDate,
      endDate,
      overallHealth,
      openRisksCount: sortedRisks.length,
      openActionItemsCount: allActionItems.length,
      aggPlanned,
      aggActual,
      perProjectDrilldown,
    });

    // ---- AI executive narrative -----------------------------------------
    // Two-tier hierarchy mirroring collateAccountInsights:
    //   Tier 1: per project, collate window-bounded daily managerInsights
    //   Tier 2: portfolio-level synthesis from per-project digests + WSR
    //           exec summaries + achievements + risks
    // Numbers are appended deterministically as a footer below.
    let summaryText: string;
    let aiNarrative = '';
    // The AI narrative is the ONLY thing this block produces: it feeds summaryText,
    // which becomes keyHighlights.summary and originalAiSummary. achievements comes
    // from WSR narratives, blockers from risk titles, capacityNotes is empty — none
    // of them touch the model. So when the caller is going to discard the summary,
    // the whole block is skipped and summaryText falls back to the formulaic version.
    if (opts.skipAiSummary) {
      console.log(
        `[PortfolioPrefill] Skipping AI summary synthesis for account ${accountId} — the caller will discard it (saved ${aiProjectContext.length + 1} API calls).`
      );
    } else {
      try {
        const tier1Inputs = await Promise.all(
          aiProjectContext.map(async (ctx, idx) => {
            const projectId = projectIds[idx];
            const dailyInsights = await DailyBoardSnapshot.findAll({
              where: {
                projectId,
                date: { [Op.between]: [startDate, endDate] },
                managerInsights: { [Op.ne]: null },
              } as any,
              order: [['date', 'DESC']],
              limit: 5,
            });
            const insightStrings = dailyInsights
              .map(s => (s.managerInsights || '').trim())
              .filter(s => s.length > 0)
              .map(s => s.slice(0, 500));
            let collated = '';
            if (insightStrings.length > 0) {
              collated = await aiService.collateWeeklyInsights(insightStrings.reverse(), ctx.projectName);
            }
            return { ...ctx, collatedInsights: collated };
          })
        );

        const projectsWithSignal = tier1Inputs.filter(
          p =>
            (p.collatedInsights && p.collatedInsights.length > 0) ||
            (p.wsrExecSummaries && p.wsrExecSummaries.length > 0) ||
            (p.achievements && p.achievements.length > 0) ||
            (p.risks && p.risks.length > 0)
        );

        if (projectsWithSignal.length > 0) {
          aiNarrative = await aiService.generatePortfolioExecutiveSummary({
            accountName: account.name,
            scopeLabel: 'the whole delivery team',
            startDate,
            endDate,
            overallHealth,
            projectSummaries: projectsWithSignal,
          });
        }
      } catch (err) {
        console.error('Portfolio AI summary synthesis failed; falling back to formulaic.', err);
        aiNarrative = '';
      }
    }

    if (aiNarrative && aiNarrative.length > 0) {
      const footer = buildMetricFooter({
        startDate,
        endDate,
        aggActual,
        aggPlanned,
        openRisksCount: sortedRisks.length,
        openActionItemsCount: allActionItems.length,
        perProjectDrilldown,
      });
      summaryText = `${aiNarrative}\n\n${footer}`;
    } else {
      summaryText = formulaicSummary;
    }

    return {
      selectedProjectIds: projectIds,
      selectedSprintMap,
      perProjectDrilldown,
      trendData,
      risks: sortedRisks,
      actionItemsSnapshot: allActionItems,
      keyHighlights: {
        summary: summaryText,
        achievements: allAchievements.slice(0, 9),
        blockers: blockerBullets,
        capacityNotes: [],
      },
      // Baseline used by refreshFromSystem to detect manager edits.
      // Equal to keyHighlights.summary at this point - any divergence later
      // means the user has edited it.
      originalAiSummary: summaryText,
      milestones: [],
      techRecommendations: [],
      discussionPoints: [],
      health: overallHealth,
      aggregates: {
        // Story-point projects only — never conflated with hours.
        planned: aggPlanned,
        actual: aggActual,
        validBugs: aggBugs,
        storyPoints: aggSP,
        defectDensityPct: defectDensity,
        // Separate hours-unit subtotals for hours-based projects.
        hours: {
          planned: aggPlannedHours,
          actual: aggActualHours,
          validBugs: aggBugsHours,
          storyPoints: aggSPHours,
          defectDensityPct: aggSPHours > 0 ? Math.round((aggBugsHours / aggSPHours) * 1000) / 10 : 0,
        },
        // WSR/Kanban-with-no-perf-sync ticket throughput -- a COUNT, never
        // added into `actual` (SP). See aggTicketsThroughput above.
        ticketsThroughput: aggTicketsThroughput,
      },
    };
  }

  async previewPayload(accountId: number, data: any): Promise<any> {
    // Normalize window bounds to a bare calendar day (YYYY-MM-DD). Any stray
    // timestamp (e.g. a client that serialized a picked date as an instant)
    // is stripped of its time component BEFORE it reaches pickSprintsInWindow's
    // lexical string comparison, so a "...-24T18:00:00Z" value can't out-rank a
    // sprint's DATEONLY endDate and pull in an extra sprint.
    const startDate = String(data.startDate ?? '').slice(0, 10);
    const endDate = String(data.endDate ?? '').slice(0, 10);
    const projectIds: number[] = Array.isArray(data.selectedProjectIds) ? data.selectedProjectIds : [];
    const programId: number | null = data.programId ?? null;
    const selectedSprintId: number | null = data.selectedSprintId ?? null;
    if (!startDate || !endDate) throw new Error('startDate and endDate are required');
    return this.buildPrefillPayload(accountId, projectIds, startDate, endDate, programId, selectedSprintId);
  }

  async createPresentation(accountId: number, data: any, userId: number | null): Promise<any> {
    const customSections = validateCustomSections(data.customSections);
    // Single seam for caller-supplied rich text; both branches below read
    // data.keyHighlights.
    if (data.keyHighlights) data.keyHighlights = sanitizeKeyHighlights(data.keyHighlights);
    // Normalize the window to a bare calendar day (see previewPayload) so both
    // the sprint selection and the persisted DATEONLY columns use the same
    // drift-free value.
    const startDate = String(data.startDate ?? '').slice(0, 10);
    const endDate = String(data.endDate ?? '').slice(0, 10);
    let payload: any;
    if (isFullySpecifiedPayload(data)) {
      // Demo / explicit payload path — persist as-is. originalAiSummary stays
      // null so refresh treats whatever exists as user content (won't overwrite).
      payload = {
        selectedProjectIds: Array.isArray(data.selectedProjectIds) ? data.selectedProjectIds : [],
        selectedSprintMap: data.selectedSprintMap ?? {},
        perProjectDrilldown: data.perProjectDrilldown ?? [],
        trendData: data.trendData ?? {},
        risks: data.risks ?? [],
        actionItemsSnapshot: data.actionItemsSnapshot ?? [],
        keyHighlights: data.keyHighlights ?? { summary: '', achievements: [], blockers: [], capacityNotes: [] },
        milestones: data.milestones ?? [],
        techRecommendations: data.techRecommendations ?? [],
        discussionPoints: data.discussionPoints ?? [],
        originalAiSummary: null,
      };
    } else {
      const projectIds: number[] = Array.isArray(data.selectedProjectIds) ? data.selectedProjectIds : [];
      const prefill = await this.buildPrefillPayload(
        accountId,
        projectIds,
        startDate,
        endDate,
        data.programId ?? null,
        data.selectedSprintId ?? null
      );
      // If the caller supplied their own keyHighlights (manual override at create time),
      // we treat it as a user edit -> originalAiSummary should match what we present so
      // refresh doesn't fight them. Use whichever summary we ultimately persist.
      const finalKeyHighlights = data.keyHighlights ?? prefill.keyHighlights;
      const originalAiSummary = data.keyHighlights ? finalKeyHighlights.summary : prefill.originalAiSummary;
      payload = {
        selectedProjectIds: prefill.selectedProjectIds,
        selectedSprintMap: prefill.selectedSprintMap,
        perProjectDrilldown: data.perProjectDrilldown ?? prefill.perProjectDrilldown,
        trendData: prefill.trendData,
        risks: data.risks ?? prefill.risks,
        actionItemsSnapshot: data.actionItemsSnapshot ?? prefill.actionItemsSnapshot,
        keyHighlights: finalKeyHighlights,
        milestones: data.milestones ?? prefill.milestones,
        techRecommendations: data.techRecommendations ?? prefill.techRecommendations,
        discussionPoints: data.discussionPoints ?? prefill.discussionPoints,
        originalAiSummary,
      };
    }

    const created = await PortfolioPresentation.create({
      accountId,
      programId: data.programId ?? null,
      title: data.title,
      meetingDate: data.meetingDate,
      startDate,
      endDate,
      health: data.health ?? 'Green',
      dateSelectionMode: data.dateSelectionMode ?? 'range',
      selectedSprintId: data.selectedSprintId ?? null,
      createdByUserId: userId,
      ...payload,
      customSections,
      hiddenCharts: data.hiddenCharts ?? {},
      graphNotes: data.graphNotes ?? {},
      velocityCapacityFlags: data.velocityCapacityFlags ?? [],
      teamCapacityRows: data.teamCapacityRows ?? [],
    });

    // Forward-sync: push edited/new action items into the real action-item
    // tables, then persist any new ids back into the snapshot.
    const syncedSnapshot = await this.syncActionItemsToSystem(created.actionItemsSnapshot || [], {
      programId: created.programId,
      selectedProjectIds: created.selectedProjectIds || [],
      userId,
    });
    if (syncedSnapshot) {
      await created.update({ actionItemsSnapshot: syncedSnapshot });
    }

    return this.getPresentation(created.id);
  }

  async getPresentation(id: number): Promise<any | null> {
    const row = await PortfolioPresentation.findByPk(id, {
      include: [{ model: Account }],
    });
    if (!row) return null;

    const json = row.toJSON() as any;
    const ids: number[] = Array.isArray(json.selectedProjectIds) ? json.selectedProjectIds : [];
    if (ids.length > 0) {
      const projects = await Project.findAll({ where: { id: ids } });
      json.selectedProjects = projects.map(p => ({ id: p.id, name: p.name, isKanbanProject: p.isKanbanProject }));
    } else {
      json.selectedProjects = [];
    }

    return json;
  }

  async updatePresentation(id: number, data: any): Promise<any | null> {
    const row = await PortfolioPresentation.findByPk(id);
    if (!row) return null;

    if (row.lockedAt) {
      throw { status: 403, message: 'Presentation is locked (MOM accepted). No further edits allowed.' };
    }

    const customSections =
      data.customSections !== undefined ? validateCustomSections(data.customSections) : row.customSections;

    // Forward-sync edited/new action items into the real action-item tables
    // BEFORE persisting the snapshot, so new ids land in what we store.
    const incomingSnapshot = data.actionItemsSnapshot ?? row.actionItemsSnapshot;
    const syncedSnapshot =
      data.actionItemsSnapshot !== undefined
        ? await this.syncActionItemsToSystem(incomingSnapshot, {
            programId: data.programId !== undefined ? data.programId : row.programId,
            selectedProjectIds: data.selectedProjectIds ?? row.selectedProjectIds ?? [],
            userId: row.createdByUserId,
          })
        : null;

    await row.update({
      title: data.title ?? row.title,
      meetingDate: data.meetingDate ?? row.meetingDate,
      // Strip any time component so a client-sent instant can't drift the day.
      startDate: data.startDate !== undefined ? String(data.startDate).slice(0, 10) : row.startDate,
      endDate: data.endDate !== undefined ? String(data.endDate).slice(0, 10) : row.endDate,
      health: data.health ?? row.health,
      dateSelectionMode: data.dateSelectionMode ?? row.dateSelectionMode,
      selectedSprintId: data.selectedSprintId !== undefined ? data.selectedSprintId : row.selectedSprintId,
      programId: data.programId !== undefined ? data.programId : row.programId,
      selectedProjectIds: data.selectedProjectIds ?? row.selectedProjectIds,
      selectedSprintMap: data.selectedSprintMap ?? row.selectedSprintMap,
      keyHighlights: sanitizeKeyHighlights(data.keyHighlights) ?? row.keyHighlights,
      milestones: data.milestones ?? row.milestones,
      risks: data.risks ?? row.risks,
      actionItemsSnapshot: syncedSnapshot ?? incomingSnapshot,
      techRecommendations: data.techRecommendations ?? row.techRecommendations,
      discussionPoints: data.discussionPoints ?? row.discussionPoints,
      perProjectDrilldown: data.perProjectDrilldown ?? row.perProjectDrilldown,
      trendData: data.trendData ?? row.trendData,
      presenterNotes: data.presenterNotes ?? row.presenterNotes,
      hiddenCharts: data.hiddenCharts ?? row.hiddenCharts,
      graphNotes: data.graphNotes ?? row.graphNotes,
      velocityCapacityFlags: data.velocityCapacityFlags ?? row.velocityCapacityFlags,
      teamCapacityRows: data.teamCapacityRows ?? row.teamCapacityRows,
      customSections,
    });

    return this.getPresentation(id);
  }

  /**
   * Duplicate an existing presentation into a brand-new, fully-editable one.
   * Content (drilldown, trends, risks, action items, milestones, highlights,
   * custom sections) is deep-copied verbatim so the user only edits what changed.
   * MOM (transcript/content/status) and the lock are intentionally dropped so the
   * copy is "as good as new", and the meeting date resets to today. The action-item
   * snapshot is copied as-is and NOT re-synced — its rows already reference existing
   * action items, so re-syncing would create duplicates in the system.
   */
  async duplicatePresentation(id: number, userId: number | null): Promise<any | null> {
    const row = await PortfolioPresentation.findByPk(id);
    if (!row) return null;

    const src = row.toJSON() as any;
    const clone = (v: any) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

    const created = await PortfolioPresentation.create({
      accountId: src.accountId,
      programId: src.programId ?? null,
      title: `(Copy) ${src.title}`,
      meetingDate: new Date().toISOString().slice(0, 10),
      startDate: src.startDate,
      endDate: src.endDate,
      health: src.health ?? 'Green',
      dateSelectionMode: src.dateSelectionMode ?? 'range',
      selectedSprintId: src.selectedSprintId ?? null,
      createdByUserId: userId,
      selectedProjectIds: clone(src.selectedProjectIds),
      selectedSprintMap: clone(src.selectedSprintMap),
      keyHighlights: clone(src.keyHighlights),
      originalAiSummary: src.originalAiSummary ?? null,
      milestones: clone(src.milestones),
      risks: clone(src.risks),
      actionItemsSnapshot: clone(src.actionItemsSnapshot),
      techRecommendations: clone(src.techRecommendations),
      discussionPoints: clone(src.discussionPoints),
      perProjectDrilldown: clone(src.perProjectDrilldown),
      trendData: clone(src.trendData),
      customSections: clone(src.customSections) ?? [],
      hiddenCharts: clone(src.hiddenCharts) ?? {},
      graphNotes: clone(src.graphNotes) ?? {},
      velocityCapacityFlags: clone(src.velocityCapacityFlags) ?? [],
      teamCapacityRows: clone(src.teamCapacityRows) ?? [],
      // MOM + lock intentionally omitted (default null) — copy starts fresh & unlocked.
    });

    return this.getPresentation(created.id);
  }

  /**
   * Forward-sync the presentation's action-item snapshot into the real action-item
   * tables. Mapped items (with id) are updated; new items (no id) are created and
   * their new id written back. Status is never pushed (it has its own lifecycle in
   * the Action Items section); rows removed from the snapshot are never deleted.
   * Account-scoped legacy items are skipped. Returns the (possibly id-augmented)
   * snapshot, or null if nothing to sync.
   */
  /**
   * Additively merge system action items into the presentation's snapshot:
   * keep every existing row (preserving edits), append only incoming items
   * whose source:id key isn't already present. Never overwrites or deletes.
   */
  private mergeActionItemSnapshots(existing: any[], incoming: any[]): any[] {
    const key = (a: any) => `${a?.source || 'project'}:${a?.id ?? 'new'}`;
    const seen = new Set((existing || []).map(key));
    const additions = (incoming || []).filter(it => !seen.has(key(it)));
    return [...(existing || []), ...additions];
  }

  private async syncActionItemsToSystem(
    snapshot: any[],
    ctx: { programId: number | null; selectedProjectIds: number[]; userId: number | null }
  ): Promise<any[] | null> {
    if (!Array.isArray(snapshot) || snapshot.length === 0) return null;
    const allowedProjectIds = new Set((ctx.selectedProjectIds || []).filter(n => typeof n === 'number'));

    const result = [...snapshot];
    for (let i = 0; i < result.length; i++) {
      const item = result[i];
      if (!item || !item.title?.trim()) continue;
      const fields = {
        title: item.title,
        owner: item.owner,
        category: item.category,
        dueDate: item.dueDate ?? null,
      };
      try {
        if (item.source === 'project') {
          if (item.id) {
            await actionItemService.updateItem(item.id, fields);
          } else if (item.projectId && allowedProjectIds.has(item.projectId)) {
            const created = await actionItemService.createItem(item.projectId, fields, ctx.userId ?? undefined);
            result[i] = { ...item, id: created.id };
          }
        } else if (item.source === 'program') {
          if (item.id) {
            await programActionItemService.updateItem(item.id, fields);
          } else if (ctx.programId) {
            const created = await programActionItemService.createItem(ctx.programId, fields, ctx.userId ?? undefined);
            result[i] = { ...item, id: created.id, projectId: null };
          }
        }
        // source 'account' (legacy) or unmapped/invalid: skip — never create/delete.
      } catch (err) {
        console.error(
          'syncActionItemsToSystem: failed to sync item',
          { index: i, id: item.id, source: item.source },
          err
        );
      }
    }
    return result;
  }

  async refreshFromSystem(id: number): Promise<any | null> {
    const row = await PortfolioPresentation.findByPk(id);
    if (!row) return null;
    if (row.lockedAt) {
      throw { status: 403, message: 'Presentation is locked. Cannot refresh.' };
    }

    // Preserve user-edited text; overwrite auto-derived fields.
    // Summary preservation: compare current keyHighlights.summary against the
    // baseline originalAiSummary. Equal => the user has not edited it, so we
    // regenerate from AI and update the baseline. Different => user edited,
    // preserve it and leave the baseline alone (so they can still detect later).
    //
    // The comparison is format-agnostic because the summary is authored in a rich
    // text editor while the AI baseline stays plain text: merely opening the form
    // wraps the prose in <p> tags, which must NOT read as an edit. Applying
    // bold/bullets without changing a word, however, must — otherwise a refresh
    // would silently discard the presenter's formatting.
    //
    // Computed BEFORE the prefill is built: when the user has edited the summary the
    // AI narrative is discarded a few lines below, so generating it would mean paying
    // for one collation call per project plus a synthesis call and binning every one.
    // Because `hasRichFormatting` counts as an edit, merely bolding a word used to
    // trigger that.
    const preservedHighlights = row.keyHighlights || ({} as any);
    const currentSummary: string = preservedHighlights.summary || '';
    const baseline: string | null = (row as any).originalAiSummary || null;
    const userHasEditedSummary =
      !!baseline &&
      (richTextToPlain(currentSummary) !== richTextToPlain(baseline) || hasRichFormatting(currentSummary));

    const prefill = await this.buildPrefillPayload(
      row.accountId,
      row.selectedProjectIds || [],
      row.startDate,
      row.endDate,
      row.programId,
      row.dateSelectionMode === 'sprint' ? row.selectedSprintId : null,
      { skipAiSummary: userHasEditedSummary }
    );

    const nextSummary = userHasEditedSummary ? currentSummary : prefill.keyHighlights.summary;
    const nextOriginalAiSummary = userHasEditedSummary ? baseline : prefill.originalAiSummary;

    const mergedHighlights = {
      summary: nextSummary,
      achievements: preservedHighlights.achievements ?? prefill.keyHighlights.achievements,
      blockers: preservedHighlights.blockers ?? prefill.keyHighlights.blockers,
      capacityNotes: preservedHighlights.capacityNotes ?? prefill.keyHighlights.capacityNotes,
    };

    // Preserve narratives + per-project health overrides + visibility flags per project
    const narrativeByProject = new Map<number, string>();
    const overrideByProject = new Map<number, Health | null>();
    // Manual per-scope headline overrides (metricsOverrideByScope) are a
    // presenter-owned edit layer — a refresh re-pulls the imported facts but
    // must NOT wipe them (mirrors narrative preservation).
    const metricsOverrideByProject = new Map<number, any>();
    for (const d of row.perProjectDrilldown || []) {
      if (d.projectId != null) {
        narrativeByProject.set(d.projectId, d.narrative || '');
        overrideByProject.set(d.projectId, (d as any).healthOverride ?? null);
        if ((d as any).metricsOverrideByScope)
          metricsOverrideByProject.set(d.projectId, (d as any).metricsOverrideByScope);
      }
    }
    const mergedDrilldown = prefill.perProjectDrilldown.map((d: any) => ({
      ...d,
      narrative: narrativeByProject.get(d.projectId) ?? d.narrative,
      healthOverride: overrideByProject.get(d.projectId) ?? null,
      isVisible: (row.perProjectDrilldown || []).find((prev: any) => prev.projectId === d.projectId)?.isVisible ?? true,
      ...(metricsOverrideByProject.has(d.projectId)
        ? { metricsOverrideByScope: metricsOverrideByProject.get(d.projectId) }
        : {}),
    }));

    // Action items are merged ADDITIVELY: keep every existing (possibly edited)
    // row, append only system items not already present. A refresh never
    // overwrites or drops a user's curated/edited action items — it only pulls
    // in newly-created ones.
    const mergedActionItems = this.mergeActionItemSnapshots(
      row.actionItemsSnapshot || [],
      prefill.actionItemsSnapshot || []
    );

    await row.update({
      selectedSprintMap: prefill.selectedSprintMap,
      trendData: prefill.trendData,
      risks: prefill.risks,
      actionItemsSnapshot: mergedActionItems,
      perProjectDrilldown: mergedDrilldown,
      keyHighlights: mergedHighlights,
      originalAiSummary: nextOriginalAiSummary,
    });

    return this.getPresentation(id);
  }

  // Render the presenter's per-slide notes into a labelled block the MOM copy
  // editor can fold into the record. Slide ids are mapped to friendly topic
  // labels; drilldown-<projectId> resolves to the project name.
  private buildPresenterNotesBlock(reportData: any): string {
    const notes: Record<string, string> = reportData?.presenterNotes || {};
    const entries = Object.entries(notes).filter(([, v]) => (v ?? '').trim().length > 0);
    if (entries.length === 0) return '';

    const STATIC_LABELS: Record<string, string> = {
      overview: 'Delivery Overview',
      'highlights-actions': 'Highlights, Risks & Actions',
      'highlights-risks': 'Highlights & Risks',
      'actions-tech': 'Action Items & Tech',
      trends: 'Trends',
      'additional-insights': 'Additional Insights',
      discussion: 'Additional Discussion Points',
    };
    const drilldown: any[] = reportData?.perProjectDrilldown || [];
    const labelFor = (slideId: string): string => {
      if (STATIC_LABELS[slideId]) return STATIC_LABELS[slideId];
      const m = slideId.match(/^drilldown-(\d+)$/);
      if (m) {
        const proj = drilldown.find(d => String(d.projectId) === m[1]);
        return proj?.projectName ? `Project: ${proj.projectName}` : 'Project';
      }
      return slideId;
    };

    const block = entries.map(([slideId, text]) => `[${labelFor(slideId)}]\n${text.trim()}`).join('\n\n');
    return `Discussion notes captured during the presentation (by topic):\n\n${block}`;
  }

  /** Max AI (re)generations allowed per presentation, to avoid token over-usage. */
  private static readonly MOM_MAX_AI_ATTEMPTS = 3;

  async generateMOM(
    id: number,
    opts: { transcript: string; useAI?: boolean; includeNotes?: boolean }
  ): Promise<any | null> {
    const row = await PortfolioPresentation.findByPk(id);
    if (!row) return null;
    if (row.lockedAt) {
      throw { status: 403, message: 'Presentation is locked (MOM accepted). No further edits allowed.' };
    }

    const reportData = await this.getPresentation(id);
    const transcript = opts.transcript ?? '';

    // Fold per-slide presenter notes into the transcript only when the user
    // opted to include them.
    const notesBlock = opts.includeNotes ? this.buildPresenterNotesBlock(reportData) : '';
    const combined = [transcript.trim(), notesBlock].filter(Boolean).join('\n\n---\n\n');

    let momContent: string;
    const update: any = {
      meetingTranscript: transcript,
      momGeneratedAt: new Date(),
      momStatus: 'draft',
    };

    if (opts.useAI) {
      if (row.momGenerateAttempts >= PortfolioPresentationService.MOM_MAX_AI_ATTEMPTS) {
        throw {
          status: 429,
          message: 'AI generation limit reached (3 per presentation). Edit the draft manually instead.',
        };
      }
      momContent = await aiService.generatePortfolioMOM(reportData, combined);
      update.momGenerateAttempts = row.momGenerateAttempts + 1;
    } else {
      // Paste-without-AI: store the user's content verbatim (no tokens spent).
      momContent = combined;
    }
    update.momContent = momContent;

    await PortfolioPresentation.update(update, { where: { id } });
    return this.getPresentation(id);
  }

  /** Persist an edited MOM draft (user overwrite of AI/pasted content) without locking. */
  async saveMOMDraft(id: number, momContent: string): Promise<any | null> {
    const row = await PortfolioPresentation.findByPk(id);
    if (!row) return null;
    if (row.lockedAt) {
      throw { status: 403, message: 'Presentation is locked (MOM accepted). No further edits allowed.' };
    }
    await row.update({ momContent, momStatus: 'draft' });
    return this.getPresentation(id);
  }

  async acceptMOM(id: number, userId: number, momContent?: string): Promise<any | null> {
    const row = await PortfolioPresentation.findByPk(id);
    if (!row) return null;

    // Capture any last-second edits before locking.
    const finalContent = momContent !== undefined ? momContent : row.momContent;
    if (!finalContent || !finalContent.trim()) {
      throw { status: 400, message: 'Cannot accept an empty MOM. Generate or write the MOM first.' };
    }

    await row.update({
      momContent: finalContent,
      momStatus: 'accepted',
      lockedAt: new Date(),
      lockedById: userId,
    });
    return this.getPresentation(id);
  }

  async deletePresentation(id: number): Promise<boolean> {
    const row = await PortfolioPresentation.findByPk(id);
    if (!row) return false;
    await row.destroy();
    return true;
  }
}

export const portfolioPresentationService = new PortfolioPresentationService();
