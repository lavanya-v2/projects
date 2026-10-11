/* eslint-disable @typescript-eslint/no-explicit-any */
import { Op } from 'sequelize';
import { PerfSprintSync } from '../../../models/PerfSprintSync';
import { PerfMemberScore } from '../../../models/PerfMemberScore';
import { PerfTicketFact } from '../../../models/PerfTicketFact';
import { TeamMember } from '../../../models/TeamMember';
import { AccountTeamMember } from '../../../models/AccountTeamMember';
import { computeSprintHoursCapacity } from './capacityMath';

// Optional capacity configuration for hours-based projects. When estimationType is
// 'hours', capacity is computed from available developer hours instead of planned.
export interface CapacityConfig {
  estimationType?: 'story_points' | 'hours' | null;
  defaultDailyCapacityHours?: number | null;
}

// ── Name normalization + ticket-ID stripping ──────────────────────────────────

const EXT_SUFFIX_RE = /[\s_]?\(?ext(?:ernal)?\)?\s*$/i;

export function normalizeName(n: string | null | undefined): string {
  return String(n || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(EXT_SUFFIX_RE, '')
    .trim()
    .toLowerCase();
}

// Compact form: normalized name with all whitespace removed. Used by the
// V2 matcher's substring + Levenshtein fallbacks to bridge compound first
// names ("Ganeshreddy" ↔ "Ganesh Reddy") and small spelling drift
// ("Kakade" ↔ "Kakde") between team_members and perf_member_scores.
// Exported for identityResolutionService, which needs the same primitives to
// SCORE a candidate rather than just accept/reject one.
export function compactName(n: string | null | undefined): string {
  return normalizeName(n).replace(/\s+/g, '');
}

// Iterative DP Levenshtein. Caps work at length ≤ 30 — names longer than
// that almost certainly differ enough that fuzzy matching is unsafe.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (a.length > 30 || b.length > 30) return Math.max(a.length, b.length);
  const m = a.length,
    n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ── V2 member matcher ─────────────────────────────────────────────────────────
//
// Replaces the legacy `v2Names: Set<string>` filter. The old filter
// silently dropped perf rows whose `display_name` didn't exactly match a
// concatenated `first_name + ' ' + last_name` after normalization,
// causing real V2 members like "Bhakti Kakade" (vs "Bhakti Kakde" in
// team_members) and "Ganesh Reddy" (vs "Ganeshreddy Kosuri") to vanish
// from Delivery Presentation team rollups + totals.
//
// The matcher predicates fire in priority order:
//   1. Exact jira_login_id (case-insensitive) — canonical, no ambiguity.
//   2. Exact normalized name — preserves legacy behavior.
//   3. Compact substring (guarded) — handles compound first names.
//   4. Levenshtein ≤ 2 on compact (guarded) — handles small spelling drift.

export interface V2MemberMatcher {
  matches(jiraLoginId: string | null | undefined, displayName: string | null | undefined): boolean;
}

interface V2NameEntry {
  normalized: string;
  compact: string;
  tokens: number;
  sortedTokens: string;
}

// Sort a normalized name's whitespace-separated tokens alphabetically, so
// "manoj pm" and "pm manoj" produce the same key. Jira display names aren't
// always "First Last" — a member can be onboarded as (firstName: "Manoj",
// lastName: "PM") to match their jiraLoginId "manoj.pm@..." while Jira itself
// shows "PM Manoj". Exact same tokens, just reordered — this is a precise
// multiset match, not a fuzzy heuristic, so it's safe to apply before the
// substring/Levenshtein tiers below.
function sortedTokenKey(normalized: string): string {
  return normalized.split(/\s+/).filter(Boolean).sort().join(' ');
}

export function buildV2Matcher(teamMembers: TeamMember[]): V2MemberMatcher {
  const jiraIds = new Set<string>();
  const names: V2NameEntry[] = [];
  for (const m of teamMembers) {
    if (m.jiraLoginId) jiraIds.add(m.jiraLoginId.trim().toLowerCase());
    const full = `${m.firstName ?? ''} ${m.lastName ?? ''}`;
    const normalized = normalizeName(full);
    if (!normalized) continue;
    names.push({
      normalized,
      compact: normalized.replace(/\s+/g, ''),
      tokens: normalized.split(/\s+/).filter(Boolean).length,
      sortedTokens: sortedTokenKey(normalized),
    });
  }
  const normalizedSet = new Set(names.map(n => n.normalized));
  const sortedTokenSet = new Set(names.map(n => n.sortedTokens));

  return {
    matches(jiraLoginId, displayName) {
      const idKey = String(jiraLoginId || '')
        .trim()
        .toLowerCase();
      if (idKey && jiraIds.has(idKey)) return true;

      const candNorm = normalizeName(displayName);
      if (!candNorm) return false;
      if (normalizedSet.has(candNorm)) return true;
      // Word-order-independent exact match (e.g. "PM Manoj" vs roster "Manoj PM").
      if (candNorm.includes(' ') && sortedTokenSet.has(sortedTokenKey(candNorm))) return true;

      const candCompact = candNorm.replace(/\s+/g, '');
      const candTokens = candNorm.split(/\s+/).filter(Boolean).length;

      for (const entry of names) {
        // Compact substring (either direction). Guard against false
        // positives like compact("anu") ⊂ compact("anuradha"): require
        // the shorter side to be ≥ 6 chars OR have ≥ 2 source tokens.
        const shorter =
          entry.compact.length <= candCompact.length ? entry : { compact: candCompact, tokens: candTokens };
        const longerCompact = entry.compact.length > candCompact.length ? entry.compact : candCompact;
        if (longerCompact.includes(shorter.compact) && (shorter.compact.length >= 6 || shorter.tokens >= 2)) {
          return true;
        }

        // Levenshtein ≤ 2 on compact (lengths ≥ 6 only — small names
        // diverge too easily for edit-distance to be meaningful).
        if (
          entry.compact.length >= 6 &&
          candCompact.length >= 6 &&
          Math.abs(entry.compact.length - candCompact.length) <= 2 &&
          levenshtein(entry.compact, candCompact) <= 2
        ) {
          return true;
        }
      }
      return false;
    },
  };
}

// Strip the Jira "_EXT" / "(Ext)" / "(External)" suffix for display, preserving
// the original capitalisation. Use when surfacing names to UI/exports.
export function cleanDisplayName(n: string | null | undefined): string {
  return String(n || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(EXT_SUFFIX_RE, '')
    .trim();
}

const TICKET_ID_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

export function stripTicketIds(text: string | null | undefined): string {
  if (!text) return '';
  return String(text)
    .replace(TICKET_ID_RE, '')
    .replace(/\([\s,;]*\)/g, '')
    .replace(/\[[\s,;]*\]/g, '')
    .replace(/\(\s*[,;]+\s*(?:[,;]\s*)*\)/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^\w])\*(\S.*?\S)\*($|[^\w])/g, '$1$2$3')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function splitNarrativeToBullets(text: string | null | undefined, max: number): string[] {
  if (!text) return [];
  const raw = String(text);
  const lines = raw
    .split(/\r?\n+/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.replace(/^\s*([-*•·]|\d+[.)])\s+/, '').trim())
    // A single WSR narrative is often one multi-sentence paragraph. Split it
    // into sentences so each becomes its own bullet instead of one merged
    // blob. Split only on a sentence terminator followed by whitespace and a
    // new sentence start, so decimals ("6.2") and mid-word dots don't split.
    .flatMap(l => l.split(/(?<=[.!?])\s+(?=[A-Z0-9"'([])/))
    .map(l => l.trim())
    .filter(Boolean);
  const cleaned = lines
    .map(stripTicketIds)
    .map(l => l.replace(/^\(\s*\)\s*/, '').trim())
    .filter(l => l.length > 10);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of cleaned) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

// ── Per-sprint aggregation from PerfMemberScore + PerfTicketFact ──────────────

export interface PerSprintBreakdown {
  syncId: number;
  sprintName: string;
  startDate: string;
  endDate: string;
  // Available-hours capacity for hours-based projects; equals planned for points
  // projects (set by the caller). Used as the productivity/utilization denominator.
  capacity: number;
  planned: number;
  actual: number;
  spillovers: number;
  spilloverCount: number;
  scopeAddedSP: number;
  scopeAddedCount: number;
  puntedCount: number;
  deliveredCount: number;
  reopenedCount: number;
  invalidReopenedCount: number;
  reopenRatePct: number;
  bugsRaised: number;
  // Subset of bugsRaised already ruled invalid — see the same field on `sum`
  // in aggregatePerfSprintMetrics for the full rationale.
  invalidBugsRaised: number;
  subBugsRaised: number;
  prodBugsEscaped: number;
  // Denominator for the reporter-agnostic leakage rate: all valid bugs raised
  // in-window (fact-based, whole-team). Distinct from bugsRaised, which stays
  // QA-member-attributed and scope-split for defect density.
  leakageBugsRaised: number;
}

export interface PerfTeamMember {
  name: string;
  jiraLoginId: string;
  role: 'developer' | 'qa' | 'other';
  planned: number;
  delivered: number;
  spillover: number;
  reopens: number;
  reopenRatePct: number;
  bugsRaised: number;
  // Subset of bugsRaised this QA owner flagged as not a real defect (Root Cause
  // 'Invalid Bug' / 'Bad Data' / 'Incomplete Requirement', or an invalid-bug label).
  // Additive to bugsRaised, not subtracted.
  invalidBugsRaised: number;
  prodBugsEscaped: number;
  // Tickets this QA owner moved out of QA (to UAT or Done) during the sprint.
  // Populated from PerfMemberScore.ticketsTestedCount; meaningful only for QA rows.
  ticketsTested: number;
}

export interface PerfAggregateResult {
  metrics: {
    dataSource: 'perf';
    v2Only: boolean;
    capacity: number;
    planned: number;
    actual: number;
    deliveredCount: number;
    spillovers: number;
    spilloverCount: number;
    spilloverPct: number;
    // 'sum' = single-sprint window or summed across sprints (legacy/safe default).
    // 'last-sprint' = headline reflects only the most recent sprint's spillover,
    // because earlier sprints' spillover is later sprints' incoming work and
    // would otherwise be double-counted.
    spilloverScope: 'sum' | 'last-sprint';
    scopeAddedSP: number;
    scopeAddedCount: number;
    scopeCreepPct: number;
    puntedCount: number;
    reopenedCount: number;
    reopenRatePct: number;
    perSprint: PerSprintBreakdown[];
  };
  quality: {
    dataSource: 'perf';
    storyPoints: number;
    validBugs: number;
    // Subset of validBugs that are Sub-bug type (rework defects against a
    // parent story). Top-level bugs = validBugs - subBugs. Surfaced in the
    // narrative so readers can see why bug counts can dwarf reopen counts.
    subBugs: number;
    bugsProd: number;
    bugDensityPct: number;
    leakageRatePct: number;
  };
  perSprint: PerSprintBreakdown[];
  team: PerfTeamMember[];
  // Per-sprint team breakdown — populated when 2+ syncs are aggregated, so
  // the Delivery Presentation can show one Team table per sprint instead of
  // one combined table. Empty array when only one sprint was aggregated.
  teamBySprint: Array<{
    syncId: number;
    sprintName: string;
    startDate: string;
    endDate: string;
    team: PerfTeamMember[];
  }>;
}

/**
 * Aggregate per-sprint metrics from PerfMemberScore + PerfTicketFact, filtered
 * to V2 team members only when `v2Matcher` is provided.
 *
 *   - Developer rows contribute SP planned, SP delivered, spillovers, delivered-ticket
 *     counts, and reopens.
 *   - QA rows contribute bugs raised + prod-escaped counts.
 *   - Scope creep + punted are cross-verified with PerfTicketFact (V2-filtered).
 */
export async function aggregatePerfSprintMetrics(
  syncs: Array<PerfSprintSync>,
  v2Matcher: V2MemberMatcher | null,
  capacityCfg?: CapacityConfig
): Promise<PerfAggregateResult> {
  const hoursCapacity = capacityCfg?.estimationType === 'hours';
  const emptyMetrics: PerfAggregateResult['metrics'] = {
    dataSource: 'perf',
    v2Only: !!v2Matcher,
    capacity: 0,
    planned: 0,
    actual: 0,
    deliveredCount: 0,
    spillovers: 0,
    spilloverCount: 0,
    spilloverPct: 0,
    spilloverScope: 'sum',
    scopeAddedSP: 0,
    scopeAddedCount: 0,
    scopeCreepPct: 0,
    puntedCount: 0,
    reopenedCount: 0,
    reopenRatePct: 0,
    perSprint: [],
  };
  const emptyQuality: PerfAggregateResult['quality'] = {
    dataSource: 'perf',
    storyPoints: 0,
    validBugs: 0,
    subBugs: 0,
    bugsProd: 0,
    bugDensityPct: 0,
    leakageRatePct: 0,
  };
  if (syncs.length === 0) {
    return { metrics: emptyMetrics, quality: emptyQuality, perSprint: [], team: [], teamBySprint: [] };
  }

  const syncIds = syncs.map(s => s.id);
  const rows = await PerfMemberScore.findAll({ where: { syncId: { [Op.in]: syncIds } } });
  const ticketFacts = await PerfTicketFact.findAll({ where: { syncId: { [Op.in]: syncIds } } });

  const matchesV2 = (jiraLoginId: string | null | undefined, displayName: string | null | undefined) =>
    v2Matcher == null || v2Matcher.matches(jiraLoginId, displayName);
  const v2Rows = rows.filter(r => matchesV2(r.jiraLoginId, r.displayName));
  const v2Facts = ticketFacts.filter(f => matchesV2(f.assigneeJiraId, f.assigneeName));

  const rowsBySync = new Map<number, typeof v2Rows>();
  for (const r of v2Rows) {
    const arr = rowsBySync.get(r.syncId) ?? [];
    arr.push(r);
    rowsBySync.set(r.syncId, arr);
  }
  const factsBySync = new Map<number, typeof v2Facts>();
  for (const f of v2Facts) {
    const arr = factsBySync.get(f.syncId) ?? [];
    arr.push(f);
    factsBySync.set(f.syncId, arr);
  }

  // For hours projects, build a jiraLoginId → daily-capacity-hours map from the
  // project↔member mapping (AccountTeamMember). Members without a configured value
  // fall back to the project default (then 8) inside computeSprintHoursCapacity.
  const memberDailyCapacity = new Map<string, number>();
  if (hoursCapacity) {
    const projectId = syncs[0]?.projectId;
    if (projectId != null) {
      const assocs = await AccountTeamMember.findAll({
        where: { projectId },
        include: [{ model: TeamMember }],
      });
      for (const a of assocs as any[]) {
        const login = a.teamMember?.jiraLoginId;
        const cap = Number(a.dailyCapacityHours);
        if (login && cap > 0) memberDailyCapacity.set(String(login).trim().toLowerCase(), cap);
      }
    }
  }

  const perSprint: PerSprintBreakdown[] = syncs.map(s => {
    const memberRows = rowsBySync.get(s.id) ?? [];
    const facts = factsBySync.get(s.id) ?? [];
    const dev = memberRows.filter(r => r.memberCategory !== 'qa');
    const qa = memberRows.filter(r => r.memberCategory === 'qa');

    const spPlanned = dev.reduce((t, r) => t + Number(r.spPlanned || 0), 0);
    const spDone = dev.reduce((t, r) => t + Number(r.spDone || 0), 0);
    const spCarried = dev.reduce((t, r) => t + Number(r.spCarriedOver || 0), 0);
    const delivered = dev.reduce((t, r) => t + Number(r.deliveredCount || 0), 0);
    const spillovers = dev.reduce((t, r) => t + Number(r.spilloverCount || 0), 0);
    const reopened = dev.reduce((t, r) => t + Number(r.reopenedCount || 0), 0);
    const invalidReopened = dev.reduce((t, r) => t + Number(r.invalidReopenedCount || 0), 0);
    const bugsRaised = qa.reduce((t, r) => t + Number(r.bugsRaisedCount || 0), 0);
    // Subset of bugsRaised already ruled invalid (Root Cause fuzzy-matching
    // 'Invalid Bug'/'Bad Data'/'Incomplete Requirement', or an invalid-bug
    // label) — kept separate so bugsRaised stays the full QA-workload count
    // (raw, inclusive) while density math below can exclude invalid ones.
    const invalidBugsRaised = qa.reduce((t, r) => t + Number(r.invalidBugsCount || 0), 0);
    const subBugsRaised = qa.reduce((t, r) => t + Number(r.subBugsRaisedCount || 0), 0);
    // Leakage numerator/denominator: read the reporter-agnostic, whole-team,
    // date-window counts computed + stored at sync time (quality_report). This
    // is identical across V2/whole-team scopes (project-level metric). Rows
    // synced before this was added lack the fields → treated as 0 until re-synced.
    const prodEscaped = Number(s.qualityReport?.prodBugsEscaped ?? 0);
    const leakageBugsRaised = Number(s.qualityReport?.bugsRaised ?? 0);

    const scopeAddedFacts = facts.filter(f => f.wasScopeChange);
    const scopeAddedCount = scopeAddedFacts.length;
    const scopeAddedSP = scopeAddedFacts.reduce((t, f) => t + Number(f.storyPoints || 0), 0);
    const puntedCount = facts.filter(f => f.wasPunted).length;

    // Hours projects: capacity = available developer hours (advance-set rate × working
    // days − leave). Points projects keep capacity = planned (assigned just below).
    const sprintCapacity = hoursCapacity
      ? computeSprintHoursCapacity(s, dev, memberDailyCapacity, capacityCfg?.defaultDailyCapacityHours)
      : Math.round(spPlanned * 10) / 10;

    return {
      syncId: s.id,
      sprintName: s.sprintName,
      startDate: s.startDate,
      endDate: s.endDate,
      capacity: sprintCapacity,
      planned: Math.round(spPlanned * 10) / 10,
      actual: Math.round(spDone * 10) / 10,
      spillovers: Math.round(spCarried * 10) / 10,
      spilloverCount: spillovers,
      scopeAddedSP: Math.round(scopeAddedSP * 10) / 10,
      scopeAddedCount,
      puntedCount,
      deliveredCount: delivered,
      reopenedCount: reopened,
      invalidReopenedCount: invalidReopened,
      reopenRatePct: delivered > 0 ? Math.round((reopened / delivered) * 1000) / 10 : 0,
      bugsRaised,
      invalidBugsRaised,
      subBugsRaised,
      prodBugsEscaped: prodEscaped,
      leakageBugsRaised,
    };
  });

  const sum = perSprint.reduce(
    (acc, p) => {
      acc.capacity += p.capacity;
      acc.planned += p.planned;
      acc.actual += p.actual;
      acc.spillovers += p.spillovers;
      acc.spilloverCount += p.spilloverCount;
      acc.scopeAddedSP += p.scopeAddedSP;
      acc.scopeAddedCount += p.scopeAddedCount;
      acc.puntedCount += p.puntedCount;
      acc.deliveredCount += p.deliveredCount;
      acc.reopenedCount += p.reopenedCount;
      acc.bugsRaised += p.bugsRaised;
      acc.invalidBugsRaised += (p as any).invalidBugsRaised || 0;
      acc.subBugsRaised += (p as any).subBugsRaised || 0;
      acc.prodBugsEscaped += p.prodBugsEscaped;
      acc.leakageBugsRaised += p.leakageBugsRaised;
      return acc;
    },
    {
      capacity: 0,
      planned: 0,
      actual: 0,
      spillovers: 0,
      spilloverCount: 0,
      scopeAddedSP: 0,
      scopeAddedCount: 0,
      puntedCount: 0,
      deliveredCount: 0,
      reopenedCount: 0,
      bugsRaised: 0,
      invalidBugsRaised: 0,
      subBugsRaised: 0,
      prodBugsEscaped: 0,
      leakageBugsRaised: 0,
    }
  );

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const pct = (num: number, denom: number) => (denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0);

  // Headline spillover: when the window covers 2+ sprints, naively summing each
  // sprint's spillover double-counts because earlier sprints' spillover IS the
  // incoming work of later sprints. The semantically correct headline is what's
  // unfinished at WINDOW end - i.e. the most recent sprint's spillover only.
  // Single-sprint windows fall through to the legacy summed value.
  const isMultiSprint = perSprint.length > 1;
  const lastSprint = perSprint[perSprint.length - 1];
  const headlineSpillovers = isMultiSprint ? lastSprint.spillovers : sum.spillovers;
  const headlineSpilloverCount = isMultiSprint ? lastSprint.spilloverCount : sum.spilloverCount;
  const spilloverDenom = isMultiSprint ? lastSprint.planned : sum.planned;

  const metrics: PerfAggregateResult['metrics'] = {
    dataSource: 'perf',
    v2Only: !!v2Matcher,
    // Hours projects: capacity = Σ available-hours capacity across sprints.
    // Points projects: unchanged — capacity = planned.
    capacity: hoursCapacity ? round1(sum.capacity) : Math.round(sum.planned),
    planned: round1(sum.planned),
    actual: round1(sum.actual),
    deliveredCount: sum.deliveredCount,
    spillovers: round1(headlineSpillovers),
    spilloverCount: headlineSpilloverCount,
    spilloverPct: pct(headlineSpillovers, spilloverDenom),
    spilloverScope: isMultiSprint ? 'last-sprint' : 'sum',
    scopeAddedSP: round1(sum.scopeAddedSP),
    scopeAddedCount: sum.scopeAddedCount,
    scopeCreepPct: pct(sum.scopeAddedSP, sum.planned),
    puntedCount: sum.puntedCount,
    reopenedCount: sum.reopenedCount,
    reopenRatePct: pct(sum.reopenedCount, sum.deliveredCount),
    perSprint,
  };
  // validBugs = bugsRaised minus the subset already ruled invalid (Root Cause
  // fuzzy-matching 'Invalid Bug'/'Bad Data'/'Incomplete Requirement', or an
  // invalid-bug label) — matches the getQualityTrendsOverview exclusion so
  // Delivery Presentation's defect density agrees with Trends/Executive
  // Dashboard. bugsRaised itself is left untouched (still the full,
  // inclusive QA-workload count used by Board View's raw "New Bugs" display).
  const validBugsRaised = Math.max(0, sum.bugsRaised - sum.invalidBugsRaised);
  const quality: PerfAggregateResult['quality'] = {
    dataSource: 'perf',
    storyPoints: round1(sum.actual),
    validBugs: validBugsRaised,
    subBugs: sum.subBugsRaised,
    // bugsProd + leakageRatePct: reporter-agnostic, fact-based, whole-team.
    // bugDensityPct keeps the QA-member `bugsRaised` denominator (scope-split).
    bugsProd: sum.prodBugsEscaped,
    bugDensityPct: pct(validBugsRaised, sum.actual),
    leakageRatePct: pct(sum.prodBugsEscaped, sum.leakageBugsRaised),
  };

  // Roll a set of PerfMemberScore rows up into a per-member team list.
  // Used twice: once across all syncs (the existing aggregated `team`) and
  // once per syncId (the new `teamBySprint`).
  const rollupTeam = (rows: typeof v2Rows): PerfTeamMember[] => {
    const map = new Map<string, PerfTeamMember>();
    for (const r of rows) {
      const key = r.jiraLoginId;
      const prev = map.get(key);
      const next: PerfTeamMember = prev ?? {
        name: cleanDisplayName(r.displayName),
        jiraLoginId: r.jiraLoginId,
        role: (r.memberCategory === 'qa' ? 'qa' : r.memberCategory === 'other' ? 'other' : 'developer') as
          | 'developer'
          | 'qa'
          | 'other',
        planned: 0,
        delivered: 0,
        spillover: 0,
        reopens: 0,
        reopenRatePct: 0,
        bugsRaised: 0,
        invalidBugsRaised: 0,
        prodBugsEscaped: 0,
        ticketsTested: 0,
      };
      next.planned += Number(r.spPlanned || 0);
      next.delivered += Number(r.spDone || 0);
      next.spillover += Number(r.spCarriedOver || 0);
      next.reopens += Number(r.reopenedCount || 0);
      next.bugsRaised += Number(r.bugsRaisedCount || 0);
      next.invalidBugsRaised += Number(r.invalidBugsCount || 0);
      next.prodBugsEscaped += Number(r.prodBugsEscaped || 0);
      next.ticketsTested += Number(r.ticketsTestedCount || 0);
      map.set(key, next);
    }
    return Array.from(map.values()).map(t => ({
      ...t,
      planned: round1(t.planned),
      delivered: round1(t.delivered),
      spillover: round1(t.spillover),
      reopenRatePct: t.delivered > 0 ? Math.round((t.reopens / t.delivered) * 1000) / 10 : 0,
    }));
  };

  const team = rollupTeam(v2Rows);

  // Per-sprint team: only meaningful when the window covers >1 sprint;
  // single-sprint case skips the array and the UI falls back to `team`.
  const teamBySprint =
    syncs.length > 1
      ? syncs.map(s => ({
          syncId: s.id,
          sprintName: s.sprintName,
          startDate: s.startDate,
          endDate: s.endDate,
          team: rollupTeam(rowsBySync.get(s.id) ?? []),
        }))
      : [];

  return { metrics, quality, perSprint, team, teamBySprint };
}

// ── Developer velocity (last 5 closed sprints) ────────────────────────────────

export interface DeveloperVelocity {
  sprints: Array<{
    syncId: number;
    sprintName: string;
    startDate: string;
    endDate: string;
  }>;
  developers: Array<{
    jiraLoginId: string;
    name: string;
    // syncId → SP delivered. Missing keys = developer wasn't on the team
    // for that sprint; the UI renders a 0 dot at the baseline.
    spDeliveredBySync: Record<number, number>;
    // syncId → SP carried over (spillover). Same keying as above; used to
    // seed the optional Team Capacity table's Carry Over SP column.
    spCarriedOverBySync: Record<number, number>;
  }>;
  // Shared Y-axis ceiling for the sparkline grid. Already includes 15%
  // headroom and is rounded up to a clean tick (5 / 10 / 15 / 20 / …) so
  // the highest dot never sits exactly at the top of its row.
  maxSp: number;
  // True when one developer's individual max is more than 3× the median of
  // per-developer maxes. The UI switches to per-row Y-scale (each dev's
  // sparkline uses its own range) so an outlier doesn't flatten everyone
  // else's trend into a near-baseline line.
  perRowScale: boolean;
}

/** Round up to the next "nice" tick — 5, 10, 15, 20, 25 … 100, 125, 150 … */
function roundUpToNiceTick(n: number): number {
  if (n <= 0) return 5;
  if (n <= 100) return Math.ceil(n / 5) * 5;
  return Math.ceil(n / 25) * 25;
}

/**
 * Build the Developer Velocity dataset for a project: V2 developers' SP
 * delivered across the last 5 closed sprints (regardless of presentation
 * window). QA rows are filtered out at the query level — this is a delivery
 * trend, not a quality view.
 *
 * Returns null when the project has no closed sprints / no V2 developer
 * activity, so the frontend can skip the section entirely.
 */
export async function getDeveloperVelocity(
  projectId: number,
  v2Matcher: V2MemberMatcher | null,
  beforeDate?: string
): Promise<DeveloperVelocity | null> {
  const recent = await PerfSprintSync.findAll({
    // beforeDate anchors the "last 5" to a reporting window end (e.g. the
    // selected sprint's end) instead of always the latest sprints.
    where: {
      projectId,
      syncStatus: 'done',
      ...(beforeDate ? { endDate: { [Op.lte]: beforeDate } } : {}),
    },
    order: [['endDate', 'DESC']],
    limit: 5,
  });
  if (recent.length === 0) return null;

  // Reverse to oldest → newest so the sparkline X-axis reads left-to-right
  // chronologically (5.1 on the right = "most recent").
  const syncs = [...recent].reverse();
  const syncIds = syncs.map(s => s.id);

  const memberRows = await PerfMemberScore.findAll({
    where: {
      syncId: { [Op.in]: syncIds },
      memberCategory: { [Op.ne]: 'qa' },
    },
  });

  // V2 filter — same predicate used elsewhere in this file so the velocity
  // grid stays consistent with the Team table.
  const v2Rows = memberRows.filter(r => v2Matcher == null || v2Matcher.matches(r.jiraLoginId, r.displayName));
  if (v2Rows.length === 0) return null;

  // Group by jiraLoginId so a developer who appears across multiple sprints
  // gets one row even if displayName differs slightly between syncs.
  const byDev = new Map<
    string,
    { name: string; spDeliveredBySync: Record<number, number>; spCarriedOverBySync: Record<number, number> }
  >();
  for (const r of v2Rows) {
    const key = r.jiraLoginId;
    const entry = byDev.get(key) ?? {
      name: cleanDisplayName(r.displayName),
      spDeliveredBySync: {},
      spCarriedOverBySync: {},
    };
    entry.spDeliveredBySync[r.syncId] = (entry.spDeliveredBySync[r.syncId] ?? 0) + Number(r.spDone || 0);
    entry.spCarriedOverBySync[r.syncId] = (entry.spCarriedOverBySync[r.syncId] ?? 0) + Number(r.spCarriedOver || 0);
    byDev.set(key, entry);
  }

  // Round each dev/sprint value once and find the per-dev max for outlier
  // detection. Single-pass keeps the maxes consistent with the rendered values.
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const developers: DeveloperVelocity['developers'] = [];
  const perDevMax: number[] = [];
  for (const [jiraLoginId, entry] of byDev) {
    const rounded: Record<number, number> = {};
    let devMax = 0;
    for (const [sid, val] of Object.entries(entry.spDeliveredBySync)) {
      const v = round1(val);
      rounded[Number(sid)] = v;
      if (v > devMax) devMax = v;
    }
    if (devMax === 0) continue; // skip devs who delivered 0 SP across the window
    const carriedRounded: Record<number, number> = {};
    for (const [sid, val] of Object.entries(entry.spCarriedOverBySync)) {
      carriedRounded[Number(sid)] = round1(val);
    }
    developers.push({ jiraLoginId, name: entry.name, spDeliveredBySync: rounded, spCarriedOverBySync: carriedRounded });
    perDevMax.push(devMax);
  }
  if (developers.length === 0) return null;

  developers.sort((a, b) => a.name.localeCompare(b.name));

  // Y-axis: shared ceiling with 15% headroom by default. Switch to per-row
  // scale when one dev is >3× the median per-dev max (outlier guard).
  const globalMax = Math.max(...perDevMax);
  const sortedMaxes = [...perDevMax].sort((a, b) => a - b);
  const median = sortedMaxes[Math.floor(sortedMaxes.length / 2)];
  const perRowScale = median > 0 && globalMax > 3 * median;
  const maxSp = roundUpToNiceTick(globalMax * 1.15);

  return {
    sprints: syncs.map(s => ({
      syncId: s.id,
      sprintName: s.sprintName,
      startDate: s.startDate,
      endDate: s.endDate,
    })),
    developers,
    maxSp,
    perRowScale,
  };
}

export interface DeveloperReopenAndCarryoverTrends {
  sprints: Array<{ syncId: number; sprintName: string; startDate: string; endDate: string }>;
  developers: Array<{
    jiraLoginId: string;
    name: string;
    // syncId → reopen ratio (%) for that developer-sprint pair.
    // null when the developer delivered 0 SP in the sprint (no denominator).
    reopenPctBySync: Record<number, number | null>;
    // syncId → carryover ratio (%) for that developer-sprint pair.
    // Formula: spCarriedOver / (spPlanned + scopeCreepSP) * 100.
    // null when (spPlanned + scopeCreepSP) is 0.
    carryoverPctBySync: Record<number, number | null>;
  }>;
  // Shared Y-axis ceilings (already with 15% headroom, rounded up to a nice tick).
  maxReopenPct: number;
  maxCarryoverPct: number;
  // True when one developer is >3x the median for either metric → render with per-row scale.
  perRowScale: boolean;
}

/**
 * Per-developer Reopen Ratio + Carryover Ratio across the last 5 closed sprints.
 *
 * Reopen Ratio  = reopenedCount / spDone × 100
 *                  (mirrors the team-level reopen formula at performanceSyncService.ts:2045-2049
 *                   but at the developer grain. Equivalent to PerfMemberScore.reopenRatePct.)
 *
 * Carryover Ratio = spCarriedOver / (spPlanned + scopeCreepSP) × 100
 *                  where scopeCreepSP = sum of PerfTicketFact.storyPoints for that
 *                  developer + sync where wasScopeChange = true. This captures
 *                  "did the dev carry work that was added mid-sprint as well as
 *                  what was originally planned for them".
 *
 * Returns null when no closed sprints exist or no non-QA developer activity in the window
 * — so the caller can skip the section entirely.
 *
 * The sprint list is identical to getDeveloperVelocity's so the three per-dev sparkline
 * panels (Velocity / Reopen / Carryover) line up on the same X-axis.
 */
export async function getDeveloperReopenAndCarryoverTrends(
  projectId: number,
  v2Matcher: V2MemberMatcher | null,
  beforeDate?: string
): Promise<DeveloperReopenAndCarryoverTrends | null> {
  const recent = await PerfSprintSync.findAll({
    // beforeDate anchors the "last 5" to a reporting window end — see
    // getDeveloperVelocity.
    where: {
      projectId,
      syncStatus: 'done',
      ...(beforeDate ? { endDate: { [Op.lte]: beforeDate } } : {}),
    },
    order: [['endDate', 'DESC']],
    limit: 5,
  });
  if (recent.length === 0) return null;

  const syncs = [...recent].reverse(); // oldest → newest
  const syncIds = syncs.map(s => s.id);

  const memberRows = await PerfMemberScore.findAll({
    where: {
      syncId: { [Op.in]: syncIds },
      memberCategory: { [Op.ne]: 'qa' },
    },
  });
  const v2Rows = memberRows.filter(r => v2Matcher == null || v2Matcher.matches(r.jiraLoginId, r.displayName));
  if (v2Rows.length === 0) return null;

  // Aggregate scope-creep SP per (syncId, assignee jira id) from PerfTicketFact.
  // Used as part of the carryover denominator.
  const scopeRows = await PerfTicketFact.findAll({
    where: {
      syncId: { [Op.in]: syncIds },
      wasScopeChange: true,
    },
    attributes: ['syncId', 'assigneeJiraId', 'storyPoints'],
  });
  const scopeBySync: Record<number, Record<string, number>> = {};
  for (const r of scopeRows) {
    const key = (r as any).assigneeJiraId as string | null;
    if (!key) continue;
    const bucket = (scopeBySync[r.syncId] ??= {});
    bucket[key] = (bucket[key] ?? 0) + Number(r.storyPoints || 0);
  }

  // Group member-score rows by developer (jiraLoginId). Within each developer,
  // collapse multiple rows in the same sync (rare — same name across syncs with
  // slightly different displayName) by summing.
  type DevAgg = {
    name: string;
    bySync: Record<number, { spPlanned: number; spDone: number; spCarriedOver: number; reopenedCount: number }>;
  };
  const byDev = new Map<string, DevAgg>();
  for (const r of v2Rows) {
    const key = r.jiraLoginId;
    const entry: DevAgg = byDev.get(key) ?? { name: r.displayName, bySync: {} };
    const slot = (entry.bySync[r.syncId] ??= { spPlanned: 0, spDone: 0, spCarriedOver: 0, reopenedCount: 0 });
    slot.spPlanned += Number(r.spPlanned || 0);
    slot.spDone += Number(r.spDone || 0);
    slot.spCarriedOver += Number(r.spCarriedOver || 0);
    slot.reopenedCount += Number(r.reopenedCount || 0);
    byDev.set(key, entry);
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;
  const developers: DeveloperReopenAndCarryoverTrends['developers'] = [];
  const perDevMaxReopen: number[] = [];
  const perDevMaxCarry: number[] = [];

  for (const [jiraLoginId, entry] of byDev) {
    const reopenPctBySync: Record<number, number | null> = {};
    const carryoverPctBySync: Record<number, number | null> = {};
    let devMaxReopen = 0;
    let devMaxCarry = 0;
    let anyValue = false;

    for (const sync of syncs) {
      const slot = entry.bySync[sync.id];
      if (!slot) {
        reopenPctBySync[sync.id] = null;
        carryoverPctBySync[sync.id] = null;
        continue;
      }
      const scopeSp = scopeBySync[sync.id]?.[jiraLoginId] ?? 0;
      const reopenPct = slot.spDone > 0 ? round1((slot.reopenedCount / slot.spDone) * 100) : null;
      const carryDenom = slot.spPlanned + scopeSp;
      const carryPct = carryDenom > 0 ? round1((slot.spCarriedOver / carryDenom) * 100) : null;
      reopenPctBySync[sync.id] = reopenPct;
      carryoverPctBySync[sync.id] = carryPct;
      if (reopenPct != null && reopenPct > devMaxReopen) devMaxReopen = reopenPct;
      if (carryPct != null && carryPct > devMaxCarry) devMaxCarry = carryPct;
      if (reopenPct != null || carryPct != null) anyValue = true;
    }

    // Skip developers who had no measurable activity (all nulls) — the sparkline
    // would be empty / meaningless.
    if (!anyValue) continue;
    developers.push({ jiraLoginId, name: entry.name, reopenPctBySync, carryoverPctBySync });
    perDevMaxReopen.push(devMaxReopen);
    perDevMaxCarry.push(devMaxCarry);
  }
  if (developers.length === 0) return null;

  developers.sort((a, b) => a.name.localeCompare(b.name));

  const globalMaxReopen = Math.max(0, ...perDevMaxReopen);
  const globalMaxCarry = Math.max(0, ...perDevMaxCarry);

  const isOutlier = (perDev: number[], globalMax: number) => {
    if (perDev.length === 0) return false;
    const sorted = [...perDev].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return median > 0 && globalMax > 3 * median;
  };
  const perRowScale = isOutlier(perDevMaxReopen, globalMaxReopen) || isOutlier(perDevMaxCarry, globalMaxCarry);

  // Headroom + clamp to ≥5% so the axis isn't crushed when everyone scored 0–1%.
  const maxReopenPct = Math.max(5, roundUpToNiceTick(globalMaxReopen * 1.15));
  const maxCarryoverPct = Math.max(5, roundUpToNiceTick(globalMaxCarry * 1.15));

  return {
    sprints: syncs.map(s => ({
      syncId: s.id,
      sprintName: s.sprintName,
      startDate: s.startDate,
      endDate: s.endDate,
    })),
    developers,
    maxReopenPct,
    maxCarryoverPct,
    perRowScale,
  };
}
