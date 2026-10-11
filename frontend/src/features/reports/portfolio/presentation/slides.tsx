import { useState, type ReactNode } from 'react';
import {
  Box, Typography, Paper, Chip, Stack, Table, TableHead, TableBody, TableRow, TableCell,
  Alert, Tooltip, ToggleButton, ToggleButtonGroup, Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Warning as WarningIcon,
  ShowChart as ShowChartIcon,
  Group as GroupIcon,
  FactCheck as FactCheckIcon,
  InfoOutlined as InfoOutlinedIcon,
  Insights as InsightsIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { InsightsSlide } from './InsightsSlide';
import { paginateSections } from '../../shared/customSections/types';
import {
  ResponsiveContainer, LineChart, Line, ComposedChart, BarChart, Bar, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, LabelList, ReferenceLine,
} from 'recharts';

import { ExpandableList } from './ExpandableList';
import { RiskList } from './RiskList';
import { isChartHidden, isKanbanPresentation } from './trendCharts';
import { shortenSprintName, sprintWorkingDays } from './sprintLabel';
import {
  LABEL_SUFFIX,
  barLabelFor,
  buildIndividualTrendsView,
  participationCaption,
  type MetricRow,
  type SprintRef,
} from './developerParticipation';
import RichTextView from '../../../../shared/components/RichTextView';
import {
  type Scope, DEFAULT_SCOPE, scopeFootnote, scopeShortLabel,
  scopedDrilldown, scopedTrendSprint, scopedTeam, scopedDeveloperTrends, hasScopeData, anyScopeData,
  applyHeadlineOverride, netScopeChange, formatNetScope,
} from './scope';

export const SECTION_COLORS = {
  Overview: '#1565c0',
  Highlights: '#2e7d32',
  Risks: '#b71c1c',
  Actions: '#6a1b9a',
  Tech: '#00695c',
  Velocity: '#0277bd',
  Quality: '#e65100',
  Insights: '#00695c',
  Drilldown: '#37474f',
  Team: '#455a64',
};

const CHART_COLORS = ['#1565c0', '#2e7d32', '#e65100', '#6a1b9a', '#00695c'];
// Muted red for the "invalid" segment of the stacked Production Bugs chart.
const INVALID_BUG_COLOR = '#e57373';

// Renders "N/A" for a commitment-relative figure (Planned/Capacity/Productivity%)
// that's structurally absent — Kanban/cadence projects with tracksCommitment=false
// have no captured plan, so `null` here means "no such thing," not "0." Distinct
// from the em-dash '—' used elsewhere for "no data yet" so the two don't blur.
function naSpan() {
  return <Box component="span" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>N/A</Box>;
}

// Tableau-style categorical palette for the per-developer productivity stack — a
// single project can easily have more contributors than CHART_COLORS has entries,
// and adjacent stack segments must stay distinguishable on a projector. Ordered so
// neighbouring segments always contrast. Beyond the curated list we fall back to
// golden-angle HSL (at presentation-friendly saturation/lightness) so colours keep
// spreading without repeating.
const DEV_STACK_COLORS = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7',
  '#9c755f', '#bab0ac', '#8cd17d', '#b6992d', '#d37295', '#86bcb6', '#a0cbe8', '#79706e',
];
function devStackColor(idx: number): string {
  if (idx < DEV_STACK_COLORS.length) return DEV_STACK_COLORS[idx];
  return `hsl(${(idx * 137.508) % 360}, 60%, 55%)`;
}

// Shared Y-axis domain for BOTH productivity views (Total % and By-developer) so the
// same value reads at the same height in both. At least 0–120% (headroom above 100%
// for over-delivery / stack rounding), expanding to the nearest 10 above the data.
const PRODUCTIVITY_Y_DOMAIN: [number, (max: number) => number] = [0, (max: number) => Math.max(120, Math.ceil((max || 0) / 10) * 10)];

export interface ProjectFilterState {
  hidden: Set<number>;
  toggle: (projectId: number) => void;
  visibleIds: number[];
}

// Per-slide scope state, owned by the presentation container and passed into
// each slide's render. `scope` is the slide's current scope (default V2);
// `onScopeChange` flips it. Slides without scoped metrics ignore both.
export interface SlideScopeCtx {
  scope: Scope;
  onScopeChange: (s: Scope) => void;
  // Raw SP vs sprint-length-normalized view, local to the Velocity Trend chart
  // only. Ignored by slides other than Trends.
  velocityViewMode?: VelocityViewMode;
  onVelocityViewModeChange?: (m: VelocityViewMode) => void;
}

export type VelocityViewMode = 'raw' | 'normalized';

export interface SlideDef {
  id: string;
  name: string;
  color: string;
  icon: ReactNode;
  // True when this slide has a V2 ⇄ Whole-team toggle. The container renders the
  // toggle in the always-visible slide header bar (so it stays reachable while
  // scrolling through charts), keyed to this slide's id.
  scoped?: boolean;
  render: (report: any, filter: ProjectFilterState, scopeCtx: SlideScopeCtx) => ReactNode;
}

const healthColor = (h: string) => {
  if (h === 'Green') return 'success';
  if (h === 'Amber') return 'warning';
  if (h === 'Red') return 'error';
  return 'default';
};

interface PortfolioKpis {
  planned: number;
  actual: number;
  ticketsCompleted: number;
  deliveryPct: number | null;
  allWsr: boolean;
  anyPerf: boolean;
  risks: number;
  actions: number;
  healthCounts: { Green: number; Amber: number; Red: number };
}

function computeKpis(report: any, scope: Scope): PortfolioKpis {
  const drill: any[] = report.perProjectDrilldown || [];
  const risks: any[] = report.risks || [];
  const actions: any[] = report.actionItemsSnapshot || [];
  let planned = 0, actual = 0, ticketsCompleted = 0;
  let anyPerf = false, anyWsr = false;
  for (const d of drill) {
    const { m: mf, q: qf } = scopedDrilldown(d, scope);
    // High-level KPI totals reflect manual headline overrides (charts/tables stay factual).
    const { m } = applyHeadlineOverride(mf, qf, d.metricsOverrideByScope?.[scope]);
    // WSR's m.actual is a ticket COUNT (weekly throughput), not SP -- it was
    // previously added into `actual` alongside every perf project's real SP,
    // inflating "Delivered (SP)" in any deck mixing the two. ticketsCompleted
    // already captures the same number correctly (WSR sets both fields to the
    // same value); only accumulate `planned`/`actual` for SP-based (perf) data.
    if (m.dataSource === 'perf') {
      planned += Number(m.planned) || 0;
      actual += Number(m.actual) || 0;
      anyPerf = true;
    }
    ticketsCompleted += Number(m.ticketsCompleted) || 0;
    if (m.dataSource === 'wsr') anyWsr = true;
  }
  const allWsr = anyWsr && !anyPerf;
  const deliveryPct = planned > 0 ? Math.round((actual / planned) * 100) : null;
  const healthCounts = { Green: 0, Amber: 0, Red: 0 } as { Green: number; Amber: number; Red: number };
  for (const d of drill) {
    const eff = (d.healthOverride ?? d.health ?? 'Green') as keyof typeof healthCounts;
    if (eff in healthCounts) healthCounts[eff]++;
  }
  return { planned, actual, ticketsCompleted, deliveryPct, allWsr, anyPerf, risks: risks.length, actions: actions.length, healthCounts };
}

function KpiTile({ label, value, sublabel, color }: { label: string; value: ReactNode; sublabel?: string; color?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, minWidth: 0, borderLeft: color ? `4px solid ${color}` : undefined }}>
      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, fontSize: 10.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, mt: 0.25 }}>{value}</Typography>
      {sublabel && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{sublabel}</Typography>}
    </Paper>
  );
}

function HealthDistributionTile({ counts }: { counts: PortfolioKpis['healthCounts'] }) {
  const total = counts.Green + counts.Amber + counts.Red;
  return (
    <Paper variant="outlined" sx={{ p: 1.25, minWidth: 0 }}>
      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, fontSize: 10.5 }}>
        Project Health
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
        <Chip size="small" label={`${counts.Green} G`} sx={{ bgcolor: '#e8f5e9', color: '#1b5e20', fontWeight: 700, fontSize: 12 }} />
        <Chip size="small" label={`${counts.Amber} A`} sx={{ bgcolor: '#fff3e0', color: '#e65100', fontWeight: 700, fontSize: 12 }} />
        <Chip size="small" label={`${counts.Red} R`} sx={{ bgcolor: '#ffebee', color: '#b71c1c', fontWeight: 700, fontSize: 12 }} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        across {total} project{total === 1 ? '' : 's'}
      </Typography>
    </Paper>
  );
}

// Single-project presentations: the G/A/R distribution ("1G · 0A · 0R") is
// redundant, so show just that project's health as a coloured chip.
function SingleHealthTile({ health }: { health: 'Green' | 'Amber' | 'Red' }) {
  const cfg = {
    Green: { bg: '#e8f5e9', fg: '#1b5e20' },
    Amber: { bg: '#fff3e0', fg: '#e65100' },
    Red: { bg: '#ffebee', fg: '#b71c1c' },
  }[health];
  return (
    <Paper variant="outlined" sx={{ p: 1.25, minWidth: 0 }}>
      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, fontSize: 10.5 }}>
        Project Health
      </Typography>
      <Box sx={{ display: 'flex', mt: 0.5 }}>
        <Chip size="small" label={health} sx={{ bgcolor: cfg.bg, color: cfg.fg, fontWeight: 700, fontSize: 12 }} />
      </Box>
    </Paper>
  );
}

function KpiTileStrip({ kpis }: { kpis: PortfolioKpis }) {
  const hc = kpis.healthCounts;
  const totalProjects = hc.Green + hc.Amber + hc.Red;
  const singleHealth: 'Green' | 'Amber' | 'Red' = hc.Red ? 'Red' : hc.Amber ? 'Amber' : 'Green';
  const deliveryTile = kpis.allWsr
    ? { label: 'Tickets Completed', value: kpis.ticketsCompleted, sublabel: 'weekly throughput' }
    : kpis.planned > 0
      ? { label: 'Delivered (SP)', value: `${kpis.actual} / ${kpis.planned}`, sublabel: kpis.deliveryPct != null ? `${kpis.deliveryPct}% of plan` : undefined }
      : { label: 'Delivered', value: kpis.actual || '—', sublabel: undefined };
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.25 }}>
      <KpiTile label={deliveryTile.label} value={deliveryTile.value} sublabel={deliveryTile.sublabel} color={SECTION_COLORS.Velocity} />
      <KpiTile label="Open Risks" value={kpis.risks} color={SECTION_COLORS.Risks} />
      <KpiTile label="Open Action Items" value={kpis.actions} color={SECTION_COLORS.Actions} />
      {totalProjects === 1
        ? <SingleHealthTile health={singleHealth} />
        : <HealthDistributionTile counts={kpis.healthCounts} />}
    </Box>
  );
}

function OverviewSlide({ report, scopeCtx }: { report: any; scopeCtx: SlideScopeCtx }) {
  const highlights = report.keyHighlights || {};
  const drilldown: any[] = report.perProjectDrilldown || [];
  const anyWsr = drilldown.some(d => d?.sprintMetrics?.dataSource === 'wsr');
  const anyPerf = drilldown.some(d => d?.sprintMetrics?.dataSource === 'perf');
  const anyNoCommitment = drilldown.some(d => d?.sprintMetrics?.metricKind === 'throughput');
  const scope = scopeCtx.scope;
  const showScopeToggle = anyScopeData(drilldown);
  const kpis = computeKpis(report, scope);
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <KpiTileStrip kpis={kpis} />

      <Paper sx={{ p: 2.5, borderLeft: `6px solid ${SECTION_COLORS.Overview}` }}>
        <Typography variant="subtitle2" color="text.secondary">Executive Summary</Typography>
        <RichTextView value={highlights.summary} sx={{ mt: 1, lineHeight: 1.75 }} />
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>Projects in Scope</Typography>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#f7f9fc' }}>
              <TableCell><strong>Project</strong></TableCell>
              <TableCell align="center"><strong>RAG</strong></TableCell>
              <TableCell><strong>Sprint / Window</strong></TableCell>
              {anyPerf ? (
                <>
                  <TableCell align="right"><strong>Planned (SP)</strong></TableCell>
                  <TableCell align="right"><strong>Delivered (SP)</strong></TableCell>
                  <TableCell align="right"><strong>Spillover</strong></TableCell>
                  <TableCell align="right"><strong>Net Scope Change</strong></TableCell>
                  <TableCell align="right"><strong>Reopens</strong></TableCell>
                  <TableCell align="right"><strong>Bugs (QA)</strong></TableCell>
                </>
              ) : anyWsr ? (
                <>
                  <TableCell align="right"><strong>Tickets Completed</strong></TableCell>
                  <TableCell align="right"><strong>Avg Active</strong></TableCell>
                  <TableCell align="right"><strong>Max Blocked</strong></TableCell>
                </>
              ) : (
                <>
                  <TableCell align="right"><strong>Planned</strong></TableCell>
                  <TableCell align="right"><strong>Actual</strong></TableCell>
                  <TableCell align="right"><strong>Defect Density</strong></TableCell>
                </>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {drilldown.map((d: any) => {
              const isWsr = d?.sprintMetrics?.dataSource === 'wsr';
              const isPerf = d?.sprintMetrics?.dataSource === 'perf';
              const { m: smf, q: sqf } = scopedDrilldown(d, scope);
              // Per-project summary row = high-level totals → reflect manual overrides.
              const { m: sm, q: sq } = applyHeadlineOverride(smf, sqf, d.metricsOverrideByScope?.[scope]);
              const isInFlightOnly = !!d?.noCompletedSprintInWindow;
              // Show em-dash and an "In Progress" chip beside the project name
              // when there is no completed sprint in window — the audience
              // shouldn't read the row as if the project missed; the per-project
              // slide carries the live status card.
              const blankCell = isInFlightOnly ? '—' : null;
              return (
                <TableRow key={`${d.projectId}-${d.projectName}`}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                      <span>{d.projectName}</span>
                      {isInFlightOnly && (
                        <Chip size="small" label="In Progress" color="info" sx={{ fontSize: 10, height: 18 }} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="center">
                    {(() => {
                      const effective = d.healthOverride ?? d.health ?? 'Green';
                      return (
                        <Chip size="small" label={effective} color={healthColor(effective) as any}
                          sx={{ fontWeight: 700, minWidth: 60 }} />
                      );
                    })()}
                  </TableCell>
                  <TableCell>{d.sprintName}</TableCell>
                  {anyPerf ? (
                    <>
                      <TableCell align="right">{blankCell ?? (isPerf ? (sm.planned != null ? sm.planned : naSpan()) : '—')}</TableCell>
                      <TableCell align="right">{blankCell ?? (isPerf ? (sm.actual ?? 0) : '—')}</TableCell>
                      <TableCell align="right">{blankCell ?? (isPerf ? `${sm.spillovers ?? 0} (${sm.spilloverCount ?? 0})` : '—')}</TableCell>
                      {/* Net (added − removed), the same headline the Delivery
                          card shows — not gross scope-added, which read as a
                          different number for the same sprint. */}
                      <TableCell align="right">{blankCell ?? (isPerf ? formatNetScope(netScopeChange(sm).net) : '—')}</TableCell>
                      <TableCell align="right">{blankCell ?? (isPerf ? `${sm.reopenedCount ?? 0} (${sm.reopenRatePct ?? 0}%)` : '—')}</TableCell>
                      <TableCell align="right">{blankCell ?? (isPerf ? (sq.validBugs ?? 0) : '—')}</TableCell>
                    </>
                  ) : anyWsr ? (
                    <>
                      <TableCell align="right">{isWsr ? (sm.ticketsCompleted ?? 0) : (sm.actual ?? '—')}</TableCell>
                      <TableCell align="right">{isWsr ? (sm.avgActiveTickets ?? 0) : '—'}</TableCell>
                      <TableCell align="right">{isWsr ? (sm.maxBlockedTickets ?? 0) : '—'}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell align="right">{sm.planned ?? '—'}</TableCell>
                      <TableCell align="right">{sm.actual ?? '—'}</TableCell>
                      <TableCell align="right">{(sq.bugDensityPct ?? '—')}%</TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {anyPerf && showScopeToggle && `${scopeFootnote(scope)} `}
          {anyPerf && 'Spillover / Reopens shown as SP (tickets). Net Scope Change = SP added − SP removed mid-sprint. Delivered, reopen and bug-density figures match the Board View at the selected scope.'}
          {anyWsr && !anyPerf && 'Weekly Status Report projects show ticket throughput and board state, not story-point commitments.'}
          {anyNoCommitment && ' Projects with no tracked commitment show Planned as N/A — Spillover for them means tickets still open at cycle end, not a missed plan.'}
        </Typography>
      </Paper>
    </Box>
  );
}

function buildVelocitySeries(report: any, visibleIds: number[], scope: Scope) {
  const trend = report.trendData || {};
  // Collect the union of sprint names across projects (x-axis); preserve order
  // from the first project that has data.
  const allSprintLabels: string[] = [];
  for (const pid of visibleIds) {
    const arr = trend[String(pid)]?.sprints || [];
    for (const s of arr) {
      if (!allSprintLabels.includes(s.name)) allSprintLabels.push(s.name);
    }
  }
  return allSprintLabels.map(label => {
    const row: any = { sprint: label };
    for (const pid of visibleIds) {
      const proj = trend[String(pid)];
      if (!proj) continue;
      const hit = proj.sprints.find((s: any) => s.name === label);
      row[proj.projectName] = hit ? (scopedTrendSprint(hit, scope).metrics?.actual ?? null) : null;
    }
    return row;
  });
}

interface VelocityCapacityFlag {
  projectId: number;
  syncId: number;
  sprintName: string;
  reason: string;
}

// Per-project average delivered SP for the Velocity Trend average line. Sprints the
// presenter flagged as reduced-capacity (velocityCapacityFlags) are EXCLUDED so a
// genuine leave-driven dip neither sits under a polluted baseline nor drags it down.
// Only returns a mean when a project has >=2 un-flagged data points.
function buildVelocityAverages(
  report: any, visibleIds: number[], scope: Scope,
): { projectName: string; mean: number }[] {
  const trend = report.trendData || {};
  const flags: VelocityCapacityFlag[] = Array.isArray(report.velocityCapacityFlags) ? report.velocityCapacityFlags : [];
  const out: { projectName: string; mean: number }[] = [];
  for (const pid of visibleIds) {
    const proj = trend[String(pid)];
    if (!proj?.projectName) continue;
    const excluded = new Set(
      flags.filter(f => String(f.projectId) === String(pid)).map(f => String(f.syncId)),
    );
    const values = (proj.sprints || [])
      .filter((s: any) => !excluded.has(String(s.syncId)))
      .map((s: any) => scopedTrendSprint(s, scope).metrics?.actual)
      .filter((v: any) => v != null && Number.isFinite(Number(v)))
      .map((v: any) => Number(v));
    if (values.length >= 2) {
      const mean = Math.round(values.reduce((t: number, v: number) => t + v, 0) / values.length);
      out.push({ projectName: proj.projectName, mean });
    }
  }
  return out;
}

// Human-readable list of the reduced-capacity sprints excluded from the average,
// scoped to the projects currently on screen. Empty string when there are none.
function velocityExclusionFootnote(report: any, visibleIds: number[]): string {
  const trend = report.trendData || {};
  const flags: VelocityCapacityFlag[] = Array.isArray(report.velocityCapacityFlags) ? report.velocityCapacityFlags : [];
  const visible = new Set(visibleIds.map(String));
  const parts = flags
    .filter(f => visible.has(String(f.projectId)))
    .map(f => {
      const projectName = trend[String(f.projectId)]?.projectName || '';
      // sprintName often already embeds the project code (e.g. "EXP 2026 5.1"),
      // so shorten it to the version ("5.1") to avoid "EXP EXP 2026 5.1".
      const label = [projectName, shortenSprintName(f.sprintName)].filter(Boolean).join(' ');
      const reason = f.reason?.trim().replace(/\.+$/, '');
      return reason ? `${label} — ${reason}` : label;
    })
    .filter(Boolean);
  return parts.length ? `Excluded from average (reduced capacity): ${parts.join('; ')}.` : '';
}

// Median working-day count across a project's sprints in the trend window — its
// "normal" cadence, used as the baseline a shorter/longer sprint is scaled to.
function sprintWorkingDaysBaseline(sprints: any[]): number | null {
  const days = (sprints || [])
    .map((s: any) => sprintWorkingDays(s?.startDate, s?.endDate))
    .filter((d: number | null): d is number => d != null && d > 0)
    .sort((a: number, b: number) => a - b);
  if (!days.length) return null;
  return days[Math.floor(days.length / 2)];
}

// Additive "Normalized" view of the Velocity Trend chart: scales each sprint's
// delivered SP to the project's usual sprint length (working days) so a
// shorter/longer sprint — a scheduling decision, not a team output change —
// doesn't read as a productivity swing. Sprints at the baseline length pass
// through unchanged. Does not affect buildVelocitySeries (the raw view).
function buildNormalizedVelocitySeries(report: any, visibleIds: number[], scope: Scope) {
  const trend = report.trendData || {};
  const allSprintLabels: string[] = [];
  for (const pid of visibleIds) {
    const arr = trend[String(pid)]?.sprints || [];
    for (const s of arr) {
      if (!allSprintLabels.includes(s.name)) allSprintLabels.push(s.name);
    }
  }
  const baselineByPid = new Map<number, number | null>();
  for (const pid of visibleIds) {
    baselineByPid.set(pid, sprintWorkingDaysBaseline(trend[String(pid)]?.sprints || []));
  }
  return allSprintLabels.map(label => {
    const row: any = { sprint: label };
    for (const pid of visibleIds) {
      const proj = trend[String(pid)];
      if (!proj) continue;
      const hit = proj.sprints.find((s: any) => s.name === label);
      const name = proj.projectName;
      if (!hit) { row[name] = null; continue; }
      const actual = scopedTrendSprint(hit, scope).metrics?.actual;
      const baseline = baselineByPid.get(pid);
      const days = sprintWorkingDays(hit.startDate, hit.endDate);
      if (actual == null || !baseline || days == null || days <= 0 || days === baseline) {
        row[name] = actual ?? null;
        row[`${name}__adjusted`] = false;
      } else {
        row[name] = Math.round((Number(actual) * baseline / days) * 10) / 10;
        row[`${name}__adjusted`] = true;
        row[`${name}__days`] = days;
      }
    }
    return row;
  });
}

// Same as buildVelocityAverages but averaging the normalized values, so the
// average line matches what the normalized chart actually plots.
function buildNormalizedVelocityAverages(
  report: any, visibleIds: number[], scope: Scope,
): { projectName: string; mean: number }[] {
  const trend = report.trendData || {};
  const flags: VelocityCapacityFlag[] = Array.isArray(report.velocityCapacityFlags) ? report.velocityCapacityFlags : [];
  const out: { projectName: string; mean: number }[] = [];
  for (const pid of visibleIds) {
    const proj = trend[String(pid)];
    if (!proj?.projectName) continue;
    const excluded = new Set(
      flags.filter(f => String(f.projectId) === String(pid)).map(f => String(f.syncId)),
    );
    const baseline = sprintWorkingDaysBaseline(proj.sprints || []);
    const values = (proj.sprints || [])
      .filter((s: any) => !excluded.has(String(s.syncId)))
      .map((s: any) => {
        const actual = scopedTrendSprint(s, scope).metrics?.actual;
        const days = sprintWorkingDays(s.startDate, s.endDate);
        if (actual == null || !baseline || days == null || days <= 0 || days === baseline) return actual;
        return Number(actual) * baseline / days;
      })
      .filter((v: any) => v != null && Number.isFinite(Number(v)))
      .map((v: any) => Number(v));
    if (values.length >= 2) {
      const mean = Math.round(values.reduce((t: number, v: number) => t + v, 0) / values.length);
      out.push({ projectName: proj.projectName, mean });
    }
  }
  return out;
}

// Footnote listing which sprints were scaled to the baseline sprint length,
// scoped to the projects currently on screen. Empty string when none were.
function velocityNormalizationFootnote(report: any, visibleIds: number[], scope: Scope): string {
  const trend = report.trendData || {};
  const parts: string[] = [];
  for (const pid of visibleIds) {
    const proj = trend[String(pid)];
    if (!proj?.projectName) continue;
    const baseline = sprintWorkingDaysBaseline(proj.sprints || []);
    for (const s of (proj.sprints || [])) {
      const days = sprintWorkingDays(s.startDate, s.endDate);
      const actual = scopedTrendSprint(s, scope).metrics?.actual;
      if (actual == null || !baseline || days == null || days <= 0 || days === baseline) continue;
      const adjusted = Math.round((Number(actual) * baseline / days) * 10) / 10;
      parts.push(`${proj.projectName} ${shortenSprintName(s.name)} (${days}-day sprint, raw ${actual} → shown as ${adjusted})`);
    }
  }
  return parts.length ? `Normalized to a full sprint (${parts.join('; ')}).` : '';
}

// Presenter's free-text note for a given trend chart, rendered under the chart on
// the slide and in the PDF. Returns null when absent/blank so nothing renders.
function graphNoteFor(report: any, chartId: string): string | null {
  const note = report?.graphNotes?.[chartId];
  return typeof note === 'string' && note.trim() ? note.trim() : null;
}

function GraphNote({ report, chartId }: { report: any; chartId: string }) {
  const note = graphNoteFor(report, chartId);
  if (!note) return null;
  return (
    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontStyle: 'italic', color: 'text.primary', fontWeight: 500 }}>
      {note}
    </Typography>
  );
}

// Kanban period labels ("Sep 29-Oct 3") are wider than sprint numbers ("9.1"),
// and Recharts centres the first/last tick on its data point, so the outer
// labels spill past the plot and get clipped. Pad the axis ends for Kanban only.
function kanbanXAxisPadding(report: any, visibleIds: number[]) {
  return isKanbanPresentation(report, visibleIds) ? { padding: { left: 30, right: 50 } } : {};
}

// Kanban/cadence projects with no tracked commitment have no "plan" to divide
// delivered SP by — scoreTrendFor() (backend) flags this via metricKind, and
// this chart is fundamentally a delivered/planned % chart, so those projects
// are omitted from it entirely rather than plotting a 0/misleading number.
// Their SP figures already render correctly on the Velocity Trend chart.
function throughputOnlyProjectIds(report: any, visibleIds: number[], scope: Scope): Set<number> {
  const trend = report.trendData || {};
  const result = new Set<number>();
  for (const pid of visibleIds) {
    const sprints = trend[String(pid)]?.sprints || [];
    if (sprints.length === 0) continue;
    const allThroughput = sprints.every((s: any) => scopedTrendSprint(s, scope).metrics?.metricKind === 'throughput');
    if (allThroughput) result.add(pid);
  }
  return result;
}

function buildProductivitySeries(report: any, visibleIds: number[], scope: Scope) {
  const trend = report.trendData || {};
  const throughputIds = throughputOnlyProjectIds(report, visibleIds, scope);
  const scoredIds = visibleIds.filter(pid => !throughputIds.has(pid));
  const allLabels: string[] = [];
  for (const pid of scoredIds) {
    const arr = trend[String(pid)]?.sprints || [];
    for (const s of arr) if (!allLabels.includes(s.name)) allLabels.push(s.name);
  }
  return allLabels.map(label => {
    const row: any = { sprint: label };
    for (const pid of scoredIds) {
      const proj = trend[String(pid)];
      if (!proj) continue;
      const hit = proj.sprints.find((s: any) => s.name === label);
      if (!hit) { row[proj.projectName] = null; continue; }
      const sm = scopedTrendSprint(hit, scope).metrics;
      // Prefer the Board-View productivity (delivered SP / Σ in-sprint SP) when
      // present; fall back to delivered/planned for older saved presentations.
      let pct: number | null;
      if (sm?.productivityPct != null) {
        pct = sm.productivityPct;
      } else {
        const planned = sm?.planned || 0;
        const actual = sm?.actual || 0;
        pct = planned > 0 ? Math.round((actual / planned) * 100) : null;
      }
      row[proj.projectName] = pct;
      // Label carries delivered/planned SP behind the %.
      row[`${proj.projectName}__label`] = pct == null ? '' : `${pct}% (${sm?.actual ?? 0}/${sm?.planned ?? 0})`;
    }
    return row;
  });
}

function buildDefectSeries(report: any, visibleIds: number[], scope: Scope) {
  const trend = report.trendData || {};
  const allLabels: string[] = [];
  for (const pid of visibleIds) {
    const arr = trend[String(pid)]?.sprints || [];
    for (const s of arr) if (!allLabels.includes(s.name)) allLabels.push(s.name);
  }
  return allLabels.map(label => {
    const row: any = { sprint: label };
    for (const pid of visibleIds) {
      const proj = trend[String(pid)];
      if (!proj) continue;
      const hit = proj.sprints.find((s: any) => s.name === label);
      const sq = hit ? scopedTrendSprint(hit, scope).qualityMetrics : null;
      const pct = sq ? (sq.bugDensityPct ?? null) : null;
      row[proj.projectName] = pct;
      // Parallel key carrying the raw defect COUNT for that sprint, surfaced in
      // the hover tooltip (the plotted value stays the density %).
      row[`${proj.projectName}__bugs`] = sq ? (sq.validBugs ?? null) : null;
      // On-chart label: density % with bugs/SP behind it.
      row[`${proj.projectName}__label`] = pct == null ? '' : `${pct}% (${sq?.validBugs ?? 0}/${sq?.storyPoints ?? 0})`;
    }
    return row;
  });
}

// Generic trend-chart hover tooltip: shows the full detail label (e.g. "57.1%
// (4/7)" or "3 (7 SP)") per project, which the on-chart LabelList intentionally
// omits (chart shows the primary value; details on hover).
function LabeledTrendTooltip({ active, payload, label }: any) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const rows = payload.filter((p: any) => p.value != null);
  if (rows.length === 0) return null;
  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #cfd8dc', borderRadius: 1, boxShadow: 3, px: 1, py: 0.75, maxWidth: 280 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.5, color: '#0f172a' }}>{label}</Typography>
      {rows.map((p: any) => {
        const detail = p.payload?.[`${p.name}__label`];
        return (
          <Box key={p.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, lineHeight: 1.45 }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: p.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 11, color: '#374151', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</Typography>
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#0f172a' }}>{detail || p.value}</Typography>
          </Box>
        );
      })}
    </Box>
  );
}

// Defect-density hover tooltip: density % plus the raw bug count per project.
function DefectDensityTooltip({ active, payload, label }: any) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const rows = payload.filter((p: any) => p.value != null);
  if (rows.length === 0) return null;
  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #cfd8dc', borderRadius: 1, boxShadow: 3, px: 1, py: 0.75, maxWidth: 250 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.5, color: '#0f172a' }}>{label}</Typography>
      {rows.map((p: any) => {
        const bugs = p.payload?.[`${p.name}__bugs`];
        return (
          <Box key={p.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, lineHeight: 1.45 }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: p.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 11, color: '#374151', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</Typography>
            <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#0f172a' }}>
              {p.value}%{bugs != null ? ` (${bugs} ${bugs === 1 ? 'bug' : 'bugs'})` : ''}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

// Generic per-sprint quality-metric series builder (one line/area per project).
// `pick` reads the value for a sprint's scoped qualityMetrics.
function buildQualitySeries(report: any, visibleIds: number[], scope: Scope, pick: (q: any) => number | null) {
  const trend = report.trendData || {};
  const allLabels: string[] = [];
  for (const pid of visibleIds) {
    const arr = trend[String(pid)]?.sprints || [];
    for (const s of arr) if (!allLabels.includes(s.name)) allLabels.push(s.name);
  }
  return allLabels.map(label => {
    const row: any = { sprint: label };
    for (const pid of visibleIds) {
      const proj = trend[String(pid)];
      if (!proj) continue;
      const hit = proj.sprints.find((s: any) => s.name === label);
      row[proj.projectName] = hit ? (pick(scopedTrendSprint(hit, scope).qualityMetrics) ?? null) : null;
    }
    return row;
  });
}

// Like buildQualitySeries but also emits a parallel `${name}__label` string per
// point (e.g. "57.1% (4/7)") that a LabelList can display, keeping the plotted
// value numeric. `pickValue`/`pickLabel` receive the scoped qualityMetrics + metrics.
function buildLabeledSeries(
  report: any, visibleIds: number[], scope: Scope,
  pickValue: (q: any, m: any) => number | null,
  pickLabel: (q: any, m: any) => string,
) {
  const trend = report.trendData || {};
  const allLabels: string[] = [];
  for (const pid of visibleIds) {
    const arr = trend[String(pid)]?.sprints || [];
    for (const s of arr) if (!allLabels.includes(s.name)) allLabels.push(s.name);
  }
  return allLabels.map(label => {
    const row: any = { sprint: label };
    for (const pid of visibleIds) {
      const proj = trend[String(pid)];
      if (!proj) continue;
      const hit = proj.sprints.find((s: any) => s.name === label);
      if (!hit) { row[proj.projectName] = null; row[`${proj.projectName}__label`] = ''; continue; }
      const scoped = scopedTrendSprint(hit, scope);
      const v = pickValue(scoped.qualityMetrics, scoped.metrics);
      row[proj.projectName] = v ?? null;
      row[`${proj.projectName}__label`] = v == null ? '' : pickLabel(scoped.qualityMetrics, scoped.metrics);
    }
    return row;
  });
}

const buildReopenSeries = (report: any, visibleIds: number[], scope: Scope) =>
  buildLabeledSeries(report, visibleIds, scope,
    q => q?.reopenRatePct ?? null,
    q => `${q?.reopenRatePct ?? 0}% (${q?.reopenedCount ?? 0}/${q?.deliveredCount ?? 0})`);
// "Invalid Bugs" chart: prefer the Root-Cause/label-based invalidBugCount; fall back
// to the legacy reopen-exclusion invalidReopenCount for presentations saved before it.
const buildInvalidReopenSeries = (report: any, visibleIds: number[], scope: Scope) =>
  buildQualitySeries(report, visibleIds, scope, q => q?.invalidBugCount ?? q?.invalidReopenCount ?? null);
// Leakage %: label carries the created-in-window numerator/denominator (prod/total).
const buildLeakageSeries = (report: any, visibleIds: number[], scope: Scope) =>
  buildLabeledSeries(report, visibleIds, scope,
    q => q?.leakageRatePct ?? null,
    q => `${q?.leakageRatePct ?? 0}% (${q?.bugsProd ?? 0}/${q?.leakageBugsRaised ?? 0})`);
// Production bugs WORKED in the sprint — stacked valid + invalid per project.
// Emits per project: `${name}` = valid count (bottom segment), `${name}__invalid` =
// invalid count (top segment), plus segment labels and a combined hover tip.
function buildProdBugsSeries(report: any, visibleIds: number[], scope: Scope) {
  const trend = report.trendData || {};
  const allLabels: string[] = [];
  for (const pid of visibleIds) {
    const arr = trend[String(pid)]?.sprints || [];
    for (const s of arr) if (!allLabels.includes(s.name)) allLabels.push(s.name);
  }
  return allLabels.map(label => {
    const row: any = { sprint: label };
    for (const pid of visibleIds) {
      const proj = trend[String(pid)];
      if (!proj) continue;
      const hit = proj.sprints.find((s: any) => s.name === label);
      const q = hit ? scopedTrendSprint(hit, scope).qualityMetrics : null;
      const valid = q ? Number(q.prodBugsWorked ?? 0) : null;
      const invalid = q ? Number(q.prodBugsWorkedInvalid ?? 0) : null;
      row[proj.projectName] = valid;
      row[`${proj.projectName}__invalid`] = invalid;
      row[`${proj.projectName}__vlabel`] = valid ? `${valid}` : '';
      row[`${proj.projectName}__ilabel`] = invalid ? `${invalid}` : '';
      // Hover detail: valid + invalid counts with SP.
      row[`${proj.projectName}__label`] = q
        ? `${valid ?? 0} valid (${q.prodBugsWorkedSp ?? 0} SP) · ${invalid ?? 0} invalid (${q.prodBugsWorkedInvalidSp ?? 0} SP)`
        : '';
    }
    return row;
  });
}
// Count of tickets reopened from UAT per sprint (no rate).
const buildUatReopensSeries = (report: any, visibleIds: number[], scope: Scope) =>
  buildQualitySeries(report, visibleIds, scope, q => q?.uatReopenedCount ?? null);

function ProjectNames(report: any, visibleIds: number[]): string[] {
  const trend = report.trendData || {};
  return visibleIds.map(pid => trend[String(pid)]?.projectName).filter(Boolean);
}

// visibleIds whose trend is WSR-sourced (no perf sync -- typically a Kanban
// project with nothing synced yet, or a genuinely weekly-only project).
function wsrProjectIds(report: any, visibleIds: number[]): number[] {
  const trend = report.trendData || {};
  return visibleIds.filter(pid => trend[String(pid)]?.dataSource === 'wsr');
}

// Was a single any()-over-all-projects check: if ONE visible project (out of
// however many) had no perf sync, the whole slide collapsed to velocity-only
// for EVERY project, discarding Productivity/Defect Density/Reopen/Leakage/
// Prod Bugs/UAT Reopens charts for projects that had perfectly good data.
// Each chart's own series builder (buildProductivitySeries etc.) already
// keys its columns by project name and tolerates a project contributing no
// data points -- the collapse was a blanket UI decision layered on top of
// builders that never needed it. Only collapse when EVERY visible project
// is WSR-sourced; a partial mix instead gets a footnote naming which
// projects are missing from these charts (see PartialWsrNotice).
function allTrendsFromWsr(report: any, visibleIds: number[]): boolean {
  const wsrIds = wsrProjectIds(report, visibleIds);
  return visibleIds.length > 0 && wsrIds.length === visibleIds.length;
}

// True when the Trends slide has dual-scope perf data to toggle. Shared by
// buildSlides (to flag the slide as scoped) and TrendsSlide. Only relevant
// when at least one visible project has perf data with a scope split --
// an all-WSR deck has no scope concept at all.
function trendsScoped(report: any, visibleIds: number[]): boolean {
  if (allTrendsFromWsr(report, visibleIds)) return false;
  return visibleIds.some(pid => {
    const sprints = report.trendData?.[String(pid)]?.sprints || [];
    return sprints.some((s: any) => s?.metricsByScope?.v2 && s?.metricsByScope?.overall);
  });
}

// Small duration badge rendered under a Velocity Trend point when its sprint was
// scaled to the baseline sprint length (Normalized view only) — shows why that
// point moved, e.g. "5d sprint".
function velocityDurationLabelContent(data: any[], name: string) {
  return (props: any) => {
    const { x, y, index } = props;
    const row = data[index];
    if (!row?.[`${name}__adjusted`]) return null;
    const days = row[`${name}__days`];
    return (
      <text x={x} y={y + 16} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#78909c">
        {days}d sprint
      </text>
    );
  };
}

function VelocityTrendSlide({
  report, filter, scope = DEFAULT_SCOPE, crowded = false,
  viewMode = 'normalized', onViewModeChange = () => {},
}: {
  report: any; filter: ProjectFilterState; scope?: Scope; crowded?: boolean;
  viewMode?: VelocityViewMode; onViewModeChange?: (m: VelocityViewMode) => void;
}) {
  // A non-empty normalization footnote means at least one visible sprint would
  // actually be scaled. When none would be (every sprint already runs the
  // project's usual length) the two views are numerically identical, so the
  // toggle is hidden entirely and the raw view is shown — a control that
  // provably does nothing reads as broken. Recomputed per render because the
  // project filter and the scope toggle both change which sprints qualify.
  const normalizationApplies = velocityNormalizationFootnote(report, filter.visibleIds, scope) !== '';
  const normalized = viewMode === 'normalized' && normalizationApplies;
  const data = normalized
    ? buildNormalizedVelocitySeries(report, filter.visibleIds, scope)
    : buildVelocitySeries(report, filter.visibleIds, scope);
  const names = ProjectNames(report, filter.visibleIds);
  // "all WSR", not "any" -- this chart already plots a mixed deck fine (its
  // series builder is project-name-keyed and reads .sprints regardless of
  // dataSource), so the title should only say "Weekly Throughput" when that's
  // true for literally everything shown.
  const wsrMode = allTrendsFromWsr(report, filter.visibleIds);
  const averages = normalized
    ? buildNormalizedVelocityAverages(report, filter.visibleIds, scope)
    : buildVelocityAverages(report, filter.visibleIds, scope);
  const avgByName = new Map(averages.map(a => [a.projectName, a.mean]));
  const exclusionNote = velocityExclusionFootnote(report, filter.visibleIds);
  const normalizationNote = normalized ? velocityNormalizationFootnote(report, filter.visibleIds, scope) : '';
  // Draw the on-chart dashed average line only for a single project; with several
  // projects the overlapping lines/labels are unreadable, so the values move to the
  // caption instead (see averagesNote below).
  const singleProject = names.length === 1;
  const averagesNote = averages.length
    ? (singleProject
        ? `Dashed line is the average of the sprints shown (avg ${averages[0].mean}).`
        : `Averages over the sprints shown — ${averages.map(a => `${a.projectName} ${a.mean}`).join(', ')}.`)
    : '';
  const xAxisProps = { ...(crowded ? { angle: -30, textAnchor: 'end' as const, height: 50 } : {}), ...kanbanXAxisPadding(report, filter.visibleIds) };
  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Velocity, mb: 0 }}>
          {wsrMode ? 'Weekly Throughput — tickets completed (last 5 weeks)' : 'Velocity Trend (last 5 sprints per project)'}
        </Typography>
        {!wsrMode && normalizationApplies && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={viewMode}
            onChange={(_e, val) => { if (val) onViewModeChange(val as VelocityViewMode); }}
            sx={{ ml: 'auto', '& .MuiToggleButton-root': { px: 1, py: 0.1, fontSize: 10.5, fontWeight: 700, textTransform: 'none' } }}
          >
            <ToggleButton value="raw">SP Delivered</ToggleButton>
            <ToggleButton value="normalized">Normalized</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>
      <Box sx={{ height: crowded ? 340 : 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 24, right: 36, left: 0, bottom: crowded ? 28 : 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sprint" tickFormatter={shortenSprintName} interval={0} {...xAxisProps} />
            <YAxis />
            <RTooltip />
            <Legend />
            {singleProject && names.map((name, idx) => {
              const mean = avgByName.get(name);
              const color = CHART_COLORS[idx % CHART_COLORS.length];
              return mean != null ? (
                <ReferenceLine
                  key={`avg-${name}`}
                  y={mean}
                  stroke={color}
                  strokeDasharray="6 3"
                  strokeOpacity={0.75}
                  label={{ value: `avg ${mean}`, position: 'insideTopRight', fill: color, fontSize: 11, fontWeight: 700 }}
                />
              ) : null;
            })}
            {names.map((name, idx) => (
              <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={2} dot>
                <LabelList dataKey={name} position="top" style={{ fontSize: 11, fontWeight: 600 }} />
                {normalized && <LabelList dataKey={name} content={velocityDurationLabelContent(data, name)} />}
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Box>
      <GraphNote report={report} chartId="velocity-trend" />
      {!wsrMode && averagesNote && (
        <Box sx={{ mt: 1, px: 1, py: 0.5, bgcolor: '#eef2f6', borderLeft: `3px solid ${SECTION_COLORS.Velocity}`, borderRadius: 0.5 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: SECTION_COLORS.Velocity }}>
            {averagesNote}
          </Typography>
        </Box>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 'auto', pt: 1 }}>
        {wsrMode
          ? 'Tickets completed per week, last 5 weeks (Weekly Status Reports).'
          : normalized
            ? `Story points delivered per sprint, scaled to each project's usual sprint length. ${scopeFootnote(scope)}`
            : `Story points delivered per sprint, last 5 sprints. ${scopeFootnote(scope)}`}
        {exclusionNote && <><br />{exclusionNote}</>}
        {normalizationNote && <><br />{normalizationNote}</>}
      </Typography>
    </Paper>
  );
}

// When exactly one project is on screen we can break the single productivity bar
// into a STACK of per-developer contributions: each developer's segment =
// (their delivered SP / total delivered SP) × the sprint's productivity %, so the
// segments add back up to the same productivity % the single bar would have shown.
// Returns null when per-developer velocity data isn't available (Kanban/WSR/empty)
// so the caller falls back to the plain per-project bar.
function buildProductivityStackSeries(report: any, projectId: number, scope: Scope): { data: any[]; devNames: string[] } | null {
  const trend = report.trendData?.[String(projectId)];
  const drill = (report.perProjectDrilldown || []).find((d: any) => String(d.projectId) === String(projectId));
  if (!trend || !drill) return null;
  if (throughputOnlyProjectIds(report, [projectId], scope).has(projectId)) return null;
  const dv = drill.developerVelocityByScope?.[scope] ?? drill.developerVelocity;
  if (!dv || !Array.isArray(dv.developers) || dv.developers.length === 0) return null;

  const developers = dv.developers as Array<{ name: string; spDeliveredBySync: Record<string, number> }>;
  const devNames = developers.map(d => d.name);
  const sprints = trend.sprints || [];

  const data = sprints.map((s: any) => {
    const row: any = { sprint: s.name };
    const sm = scopedTrendSprint(s, scope).metrics;
    const productivityPct = sm?.productivityPct != null
      ? sm.productivityPct
      : (sm?.planned > 0 ? Math.round((sm.actual / sm.planned) * 100) : 0);
    const syncId = s.syncId;
    const perDev = developers.map(d => (syncId != null ? Number(d.spDeliveredBySync?.[syncId] ?? 0) : 0));
    const total = perDev.reduce((t, v) => t + v, 0);
    // Round each segment but make them sum EXACTLY to the sprint productivity %
    // (avoids the stack reading 99/101 when individual rounds drift). The leftover
    // ± is absorbed by the largest contributor.
    const target = Math.round(productivityPct);
    const rounded = perDev.map(v => (total > 0 ? Math.round((v / total) * productivityPct) : 0));
    const drift = target - rounded.reduce((t, v) => t + v, 0);
    if (drift !== 0 && perDev.length > 0) {
      let maxIdx = 0;
      for (let i = 1; i < perDev.length; i++) if (perDev[i] > perDev[maxIdx]) maxIdx = i;
      rounded[maxIdx] += drift;
    }
    developers.forEach((d, i) => { row[d.name] = rounded[i]; });
    return row;
  });
  return { data, devNames };
}

// Compact, opaque tooltip for the per-developer productivity stack. The default
// Recharts tooltip lists every developer (including 0% ones), making it tall enough
// to bleed over the legend/caption. This drops zero contributors, sorts by share,
// and shows the sprint total — kept narrow and solid so it never smears.
function ProductivityStackTooltip({ active, payload, label }: any) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const rows = payload
    .filter((p: any) => p.value != null && Number(p.value) > 0)
    .sort((a: any, b: any) => Number(b.value) - Number(a.value));
  const total = payload.reduce((t: number, p: any) => t + (Number(p.value) || 0), 0);
  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #cfd8dc', borderRadius: 1, boxShadow: 3, px: 1, py: 0.75, maxWidth: 230 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.5, color: '#0f172a' }}>{label} · {Math.round(total)}%</Typography>
      {rows.length === 0 ? (
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>No contribution this sprint</Typography>
      ) : rows.map((p: any) => (
        <Box key={p.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, lineHeight: 1.45 }}>
          <Box sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: p.color, flexShrink: 0 }} />
          <Typography sx={{ fontSize: 11, color: '#374151', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</Typography>
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#0f172a' }}>{p.value}%</Typography>
        </Box>
      ))}
    </Box>
  );
}

function ProductivityChart({ report, filter, scope = DEFAULT_SCOPE, crowded = false }: { report: any; filter: ProjectFilterState; scope?: Scope; crowded?: boolean }) {
  // Kanban/cadence projects with no tracked commitment have no plan to
  // measure "delivered / planned %" against — they're omitted from this
  // chart entirely (their SP figures already render on Velocity Trend) so
  // the caption below can name them rather than plot a misleading number.
  const throughputIds = throughputOnlyProjectIds(report, filter.visibleIds, scope);
  const scoredIds = filter.visibleIds.filter(pid => !throughputIds.has(pid));
  const omittedNames = ProjectNames(report, filter.visibleIds).filter((_, i) => throughputIds.has(filter.visibleIds[i]));
  const names = ProjectNames(report, scoredIds);
  const xAxisProps = { ...(crowded ? { angle: -30, textAnchor: 'end' as const, height: 50 } : {}), ...kanbanXAxisPadding(report, filter.visibleIds) };

  // Stacked per-developer contribution is OPTIONAL (toggle below) and only
  // possible for a single project with per-developer velocity data. Default is
  // the plain Productivity % bar. The stack honours the slide-level V2/Whole-team
  // scope (recomputed when `scope` changes).
  const [stacked, setStacked] = useState(false);
  const stack = filter.visibleIds.length === 1
    ? buildProductivityStackSeries(report, filter.visibleIds[0], scope)
    : null;
  const showStacked = stacked && !!stack;

  const prod = showStacked ? null : buildProductivitySeries(report, filter.visibleIds, scope);

  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ color: SECTION_COLORS.Velocity }}>
          {showStacked ? 'Productivity (%) — developer contribution' : 'Productivity (delivered / planned SP × 100)'}
        </Typography>
        {stack && (
          <ToggleButtonGroup
            size="small"
            exclusive
            value={stacked ? 'dev' : 'total'}
            onChange={(_e, val) => { if (val) setStacked(val === 'dev'); }}
            sx={{ '& .MuiToggleButton-root': { px: 1, py: 0.2, fontSize: 10.5, fontWeight: 700, textTransform: 'none' } }}
          >
            <ToggleButton value="total">Total %</ToggleButton>
            <ToggleButton value="dev">By developer</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>
      <Box sx={{ height: crowded ? 340 : 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          {showStacked && stack ? (
            <ComposedChart data={stack.data} margin={{ top: 24, right: 36, left: 0, bottom: crowded ? 28 : 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="sprint" tickFormatter={shortenSprintName} interval={0} {...xAxisProps} />
              <YAxis unit="%" domain={PRODUCTIVITY_Y_DOMAIN} />
              <RTooltip content={<ProductivityStackTooltip />} wrapperStyle={{ zIndex: 50 }} />
              <Legend />
              <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" strokeOpacity={0.9} label={{ value: '100%', position: 'right', fontSize: 10, fontWeight: 600, fill: '#64748b' }} />
              {stack.devNames.map((name, idx) => (
                <Bar key={name} dataKey={name} stackId="prod" fill={devStackColor(idx)} />
              ))}
            </ComposedChart>
          ) : (
            <ComposedChart data={prod ?? []} margin={{ top: 24, right: 36, left: 0, bottom: crowded ? 28 : 8 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="sprint" tickFormatter={shortenSprintName} interval={0} {...xAxisProps} />
              <YAxis unit="%" domain={PRODUCTIVITY_Y_DOMAIN} />
              <RTooltip content={<LabeledTrendTooltip />} wrapperStyle={{ zIndex: 50 }} />
              <Legend />
              <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" strokeOpacity={0.9} label={{ value: '100%', position: 'right', fontSize: 10, fontWeight: 600, fill: '#64748b' }} />
              {names.map((name, idx) => (
                <Bar key={name} dataKey={name} fill={CHART_COLORS[idx % CHART_COLORS.length]}>
                  <LabelList dataKey={name} position="top" formatter={(v: any) => v == null ? '' : `${v}%`} style={{ fontSize: 11, fontWeight: 600 }} />
                </Bar>
              ))}
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </Box>
      <GraphNote report={report} chartId="productivity" />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 'auto', pt: 1 }}>
        {showStacked
          ? <>Each segment = a developer's share of delivered SP; the stack totals the sprint productivity %. {scopeFootnote(scope)}</>
          : <>Delivered ÷ planned story points × 100, per sprint. 100% = plan met. {scopeFootnote(scope)}</>}
        {omittedNames.length > 0 && (
          <> {omittedNames.join(', ')} {omittedNames.length === 1 ? 'has' : 'have'} no tracked commitment, so no plan % applies —
          see Velocity Trend for delivered SP.</>
        )}
      </Typography>
      {names.length === 0 && !showStacked && (
        <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
          No project on this slide has a tracked commitment to measure against — see Velocity Trend for delivered SP.
        </Alert>
      )}
    </Paper>
  );
}

function DefectChart({ report, filter, scope = DEFAULT_SCOPE, crowded = false }: { report: any; filter: ProjectFilterState; scope?: Scope; crowded?: boolean }) {
  const def = buildDefectSeries(report, filter.visibleIds, scope);
  const names = ProjectNames(report, filter.visibleIds);
  const xAxisProps = { ...(crowded ? { angle: -30, textAnchor: 'end' as const, height: 50 } : {}), ...kanbanXAxisPadding(report, filter.visibleIds) };
  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Quality }}>
        Defect Density (%)
      </Typography>
      <Box sx={{ height: crowded ? 340 : 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={def} margin={{ top: 24, right: 36, left: 0, bottom: crowded ? 28 : 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sprint" tickFormatter={shortenSprintName} interval={0} {...xAxisProps} />
            <YAxis unit="%" />
            <RTooltip content={<DefectDensityTooltip />} wrapperStyle={{ zIndex: 50 }} />
            <Legend />
            {names.map((name, idx) => (
              <Area key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[idx % CHART_COLORS.length]} fill={CHART_COLORS[idx % CHART_COLORS.length]} fillOpacity={0.3}>
                <LabelList dataKey={name} position="top" formatter={(v: any) => v == null ? '' : `${v}%`} style={{ fontSize: 11, fontWeight: 600 }} />
              </Area>
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <GraphNote report={report} chartId="defect-density" />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 'auto', pt: 1 }}>
        Bugs raised ÷ delivered story points × 100, per sprint. Lower is better. {scopeFootnote(scope)}
      </Typography>
    </Paper>
  );
}

function ReopenChart({ report, filter, scope = DEFAULT_SCOPE, crowded = false }: { report: any; filter: ProjectFilterState; scope?: Scope; crowded?: boolean }) {
  const data = buildReopenSeries(report, filter.visibleIds, scope);
  const names = ProjectNames(report, filter.visibleIds);
  const xAxisProps = { ...(crowded ? { angle: -30, textAnchor: 'end' as const, height: 50 } : {}), ...kanbanXAxisPadding(report, filter.visibleIds) };
  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Quality }}>
        Reopen Ratio (%)
      </Typography>
      <Box sx={{ height: crowded ? 340 : 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 24, right: 36, left: 0, bottom: crowded ? 28 : 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sprint" tickFormatter={shortenSprintName} interval={0} {...xAxisProps} />
            <YAxis unit="%" />
            <RTooltip content={<LabeledTrendTooltip />} wrapperStyle={{ zIndex: 50 }} />
            <Legend />
            {names.map((name, idx) => (
              <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={2} dot connectNulls>
                <LabelList dataKey={name} position="top" formatter={(v: any) => v == null ? '' : `${v}%`} style={{ fontSize: 11, fontWeight: 600 }} />
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Box>
      <GraphNote report={report} chartId="reopen-ratio" />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 'auto', pt: 1 }}>
        Reopened ÷ delivered tickets × 100, per sprint. Lower is better. {scopeFootnote(scope)}
      </Typography>
    </Paper>
  );
}

// Invalid Bugs — count (not %) of items flagged not-genuine per sprint because the
// ticket carried an exclusion label (Invalid-Reopen / Bad-Data / Scope-Change).
// Surfaced as a testing-quality signal. (Internal id stays 'invalid-reopens' and the
// data field stays invalidReopenCount for backward compatibility.)
function InvalidReopenChart({ report, filter, scope = DEFAULT_SCOPE, crowded = false }: { report: any; filter: ProjectFilterState; scope?: Scope; crowded?: boolean }) {
  const data = buildInvalidReopenSeries(report, filter.visibleIds, scope);
  const names = ProjectNames(report, filter.visibleIds);
  const xAxisProps = { ...(crowded ? { angle: -30, textAnchor: 'end' as const, height: 50 } : {}), ...kanbanXAxisPadding(report, filter.visibleIds) };
  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Quality }}>
        Invalid Bugs (count)
      </Typography>
      <Box sx={{ height: crowded ? 340 : 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 36, left: 0, bottom: crowded ? 28 : 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sprint" tickFormatter={shortenSprintName} interval={0} {...xAxisProps} />
            <YAxis allowDecimals={false} />
            <RTooltip formatter={(v: any) => v == null ? '—' : `${v}`} />
            <Legend />
            {names.map((name, idx) => (
              <Bar key={name} dataKey={name} fill={CHART_COLORS[idx % CHART_COLORS.length]}>
                <LabelList dataKey={name} position="top" formatter={(v: any) => (v == null || v === 0) ? '' : `${v}`} style={{ fontSize: 11, fontWeight: 600 }} />
              </Bar>
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <GraphNote report={report} chartId="invalid-reopens" />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 'auto', pt: 1 }}>
        Bugs ruled not genuine — Jira Root Cause "Invalid Bug", "Bad Data" or "Incomplete Requirement" (or an invalid-bug label), per sprint. Lower is better. {scopeFootnote(scope)}
      </Typography>
    </Paper>
  );
}

// Production Bugs (count): raw count of production-escaped bugs identified per
// sprint (no rate). Count-bar template mirrors InvalidReopenChart.
// Small table listing the Jira tickets behind a chart's numbers, one row per
// project x sprint that has tickets. `keyField` selects which qualityMetrics key
// array to read (prodBugKeys / prodBugsWorkedKeys / uatReopenedKeys). Keys link to
// Jira when the project's base URL is available.
function TicketListTable({ report, filter, scope = DEFAULT_SCOPE, keyField, label }: { report: any; filter: ProjectFilterState; scope?: Scope; keyField: string; label: string }) {
  const trend = report.trendData || {};
  const multi = filter.visibleIds.length > 1;
  const rows: Array<{ project: string; sprint: string; base: string | null; keys: string[] }> = [];
  for (const pid of filter.visibleIds) {
    const proj = trend[String(pid)];
    if (!proj) continue;
    const base = proj.jiraBaseUrl ?? null;
    for (const s of (proj.sprints || [])) {
      const q = scopedTrendSprint(s, scope).qualityMetrics as any;
      const keys: string[] = q?.[keyField] ?? [];
      if (Array.isArray(keys) && keys.length) rows.push({ project: proj.projectName, sprint: s.name, base, keys });
    }
  }
  if (rows.length === 0) return null;
  const totalTickets = rows.reduce((t, r) => t + r.keys.length, 0);
  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{ mt: 1.5, bgcolor: 'transparent', '&::before': { display: 'none' } }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon fontSize="small" />}
        sx={{ minHeight: 32, px: 0, '& .MuiAccordionSummary-content': { my: 0 } }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {label} ({totalTickets})
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        <Table size="small" sx={{ '& th, & td': { fontSize: 11, py: 0.4, px: 1, verticalAlign: 'top' } }}>
          <TableHead>
            <TableRow>
              {multi && <TableCell sx={{ fontWeight: 700 }}>Project</TableCell>}
              <TableCell sx={{ fontWeight: 700 }}>Sprint</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>Tickets</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.project}-${r.sprint}-${i}`}>
                {multi && <TableCell>{r.project}</TableCell>}
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{shortenSprintName(r.sprint)}</TableCell>
                <TableCell>
                  {r.keys.map((k, j) => (
                    <span key={k}>
                      {j > 0 ? ', ' : ''}
                      {r.base ? <a href={`${r.base}/browse/${k}`} target="_blank" rel="noreferrer" style={{ color: '#1565c0', textDecoration: 'none' }}>{k}</a> : k}
                    </span>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AccordionDetails>
    </Accordion>
  );
}

function ProdBugsChart({ report, filter, scope = DEFAULT_SCOPE, crowded = false }: { report: any; filter: ProjectFilterState; scope?: Scope; crowded?: boolean }) {
  const data = buildProdBugsSeries(report, filter.visibleIds, scope);
  const names = ProjectNames(report, filter.visibleIds);
  const xAxisProps = { ...(crowded ? { angle: -30, textAnchor: 'end' as const, height: 50 } : {}), ...kanbanXAxisPadding(report, filter.visibleIds) };
  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Quality }}>
        Production Bugs Worked (count + SP)
      </Typography>
      <Box sx={{ height: crowded ? 340 : 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 36, left: 0, bottom: crowded ? 28 : 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sprint" tickFormatter={shortenSprintName} interval={0} {...xAxisProps} />
            <YAxis allowDecimals={false} />
            <RTooltip content={<LabeledTrendTooltip />} wrapperStyle={{ zIndex: 50 }} />
            <Legend />
            {names.map((name, idx) => [
              // Valid (bottom) + invalid (top) stacked per project.
              <Bar key={`${name}-v`} dataKey={name} name={name} stackId={name} fill={CHART_COLORS[idx % CHART_COLORS.length]}>
                <LabelList dataKey={`${name}__vlabel`} position="top" style={{ fontSize: 11, fontWeight: 600 }} />
              </Bar>,
              <Bar key={`${name}-i`} dataKey={`${name}__invalid`} name={names.length > 1 ? `${name} · invalid` : 'Invalid (Bad Data / Invalid Bug)'} stackId={name} fill={INVALID_BUG_COLOR}>
                <LabelList dataKey={`${name}__ilabel`} position="top" style={{ fontSize: 10, fontWeight: 600, fill: INVALID_BUG_COLOR }} />
              </Bar>,
            ])}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <GraphNote report={report} chartId="prod-bugs-count" />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 'auto', pt: 1 }}>
        Prod bugs (Environment = Prod) worked on the board this sprint, whenever created. Stacked: valid + invalid (Root Cause "Bad Data" / "Invalid Bug" / "Incomplete Requirement"). {scopeFootnote(scope)}
      </Typography>
      <TicketListTable report={report} filter={filter} scope={scope} keyField="prodBugsWorkedKeys" label="Production bugs worked (valid)" />
      <TicketListTable report={report} filter={filter} scope={scope} keyField="prodBugsWorkedInvalidKeys" label="Invalid production bugs (Bad Data / Invalid Bug / Incomplete Requirement)" />
    </Paper>
  );
}

// UAT Reopens (count): tickets that reached UAT and were reopened/rejected
// (wasUatRejected) per sprint. Count-bar template mirrors InvalidReopenChart.
function UatReopensChart({ report, filter, scope = DEFAULT_SCOPE, crowded = false }: { report: any; filter: ProjectFilterState; scope?: Scope; crowded?: boolean }) {
  const data = buildUatReopensSeries(report, filter.visibleIds, scope);
  const names = ProjectNames(report, filter.visibleIds);
  const xAxisProps = { ...(crowded ? { angle: -30, textAnchor: 'end' as const, height: 50 } : {}), ...kanbanXAxisPadding(report, filter.visibleIds) };
  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Quality }}>
        UAT Reopens (count)
      </Typography>
      <Box sx={{ height: crowded ? 340 : 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 36, left: 0, bottom: crowded ? 28 : 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sprint" tickFormatter={shortenSprintName} interval={0} {...xAxisProps} />
            <YAxis allowDecimals={false} />
            <RTooltip formatter={(v: any) => v == null ? '—' : `${v}`} />
            <Legend />
            {names.map((name, idx) => (
              <Bar key={name} dataKey={name} fill={CHART_COLORS[idx % CHART_COLORS.length]}>
                <LabelList dataKey={name} position="top" formatter={(v: any) => (v == null || v === 0) ? '' : `${v}`} style={{ fontSize: 11, fontWeight: 600 }} />
              </Bar>
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <GraphNote report={report} chartId="uat-reopens-count" />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 'auto', pt: 1 }}>
        Tickets sent back from UAT to QA/Dev (UAT rejection) this sprint. Lower is better. {scopeFootnote(scope)}
      </Typography>
      <TicketListTable report={report} filter={filter} scope={scope} keyField="uatReopenedKeys" label="UAT-reopened tickets" />
    </Paper>
  );
}

function LeakageChart({ report, filter, scope = DEFAULT_SCOPE, crowded = false }: { report: any; filter: ProjectFilterState; scope?: Scope; crowded?: boolean }) {
  const data = buildLeakageSeries(report, filter.visibleIds, scope);
  const names = ProjectNames(report, filter.visibleIds);
  const xAxisProps = { ...(crowded ? { angle: -30, textAnchor: 'end' as const, height: 50 } : {}), ...kanbanXAxisPadding(report, filter.visibleIds) };
  return (
    <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Quality }}>
        Defect Leakage (%)
      </Typography>
      <Box sx={{ height: crowded ? 340 : 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 36, left: 0, bottom: crowded ? 28 : 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="sprint" tickFormatter={shortenSprintName} interval={0} {...xAxisProps} />
            <YAxis unit="%" />
            <RTooltip content={<LabeledTrendTooltip />} wrapperStyle={{ zIndex: 50 }} />
            <Legend />
            {names.map((name, idx) => (
              <Area key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[idx % CHART_COLORS.length]} fill={CHART_COLORS[idx % CHART_COLORS.length]} fillOpacity={0.3} connectNulls>
                <LabelList dataKey={name} position="top" formatter={(v: any) => v == null ? '' : `${v}%`} style={{ fontSize: 11, fontWeight: 600 }} />
              </Area>
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
      <GraphNote report={report} chartId="defect-leakage" />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 'auto', pt: 1 }}>
        Prod bugs (Environment = Prod) logged in the sprint window ÷ all valid bugs logged × 100. Counted by creation date, project-wide. Lower is better. {scopeFootnote(scope)}
      </Typography>
      <TicketListTable report={report} filter={filter} scope={scope} keyField="prodBugKeys" label="Production bugs logged (leakage)" />
    </Paper>
  );
}

// Shown in WSR (Kanban) mode in place of Productivity / Defect / Dev Velocity —
// none of those metrics are available without sprint scorecards. Always
// rendered full-width below the throughput chart.
function WsrUnavailableNotice() {
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom color="text.secondary">
        Productivity %, Defect Density and Developer Velocity are not available
      </Typography>
      <Typography variant="body2" color="text.secondary">
        These metrics require story-point planning and bug-tracking fields that aren't captured in the weekly status reports for this account. The ticket-throughput trend above is the executive-level indicator for these projects.
      </Typography>
    </Paper>
  );
}

/**
 * Renders the Current Sprint data-point card for a project whose drilldown
 * includes an in-flight sprint. Sourced from DailyBoardSnapshot.sprintBurndown.
 * Deliberately not a chart: stakeholders should read "current status," not
 * project completion from a mid-flight bar.
 */
function InFlightSprintCard({ inFlight }: { inFlight: any }) {
  const isKanban = inFlight.type === 'kanban';
  const onTrack = (inFlight.onTrackStatus || '').toLowerCase();
  // Single neutral RAG chip — On Track / At Risk / Critical text on a tinted
  // background. Replaces the prior MUI color="info"/color="warning" chips and
  // the colored pipeline bar that the user found too busy.
  const ragColor = onTrack === 'on-track' ? '#2e7d32'
    : onTrack === 'at-risk' ? '#ed6c02'
    : onTrack === 'critical' ? '#c62828'
    : '#546e7a';
  const ragLabel = onTrack === 'on-track' ? 'On Track'
    : onTrack === 'at-risk' ? 'At Risk'
    : onTrack === 'critical' ? 'Critical'
    // On-the-go assignment model -- sprint pace deliberately not scored.
    : onTrack === 'not-tracked' ? 'Pace Not Tracked'
    : null;

  const hasBurndown = !isKanban && inFlight.snapshotDate != null;
  const reopenedTickets = inFlight.reopenedTickets ?? 0;
  const subBugsLogged = inFlight.subBugsLogged;
  const headerTitle = isKanban ? 'Current Board Status' : 'Current Sprint';
  // 'v2-sprint' — both lane tickets and SP come from the V2 sprint scope
  // (numbers reconcile). 'board' — lane tickets are from the whole board
  // (Kanban, or a scrum snapshot too old to carry per-lane V2 ticket counts).
  const scopeLabel: 'v2-sprint' | 'board' = inFlight.scopeLabel ?? (isKanban ? 'board' : 'v2-sprint');
  const showSp = !isKanban;

  // One row per lane. Tickets and SP both sourced together (V2-sprint scope
  // when available) so In Review = 1 ticket / 1 SP — no scope mismatch.
  const lanes: Array<{ label: string; tickets: number; sp: number }> = [
    { label: 'TODO',        tickets: inFlight.ticketsByLane?.todo       || 0, sp: inFlight.pipelineSP?.todo       || 0 },
    { label: 'In Progress', tickets: inFlight.ticketsByLane?.inProgress || 0, sp: inFlight.pipelineSP?.inProgress || 0 },
    { label: 'In Review',   tickets: inFlight.ticketsByLane?.inReview   || 0, sp: inFlight.pipelineSP?.review     || 0 },
    { label: 'QA',          tickets: inFlight.ticketsByLane?.qa         || 0, sp: inFlight.pipelineSP?.qa         || 0 },
    { label: 'UAT',         tickets: inFlight.ticketsByLane?.uat        || 0, sp: inFlight.pipelineSP?.uat        || 0 },
    { label: 'Blocked',     tickets: inFlight.ticketsByLane?.blocked    || 0, sp: inFlight.pipelineSP?.blocked    || 0 },
    { label: 'Reopened',    tickets: inFlight.ticketsByLane?.reopened   || 0, sp: 0 },
    { label: 'Done',        tickets: inFlight.ticketsByLane?.done       || 0, sp: showSp ? (inFlight.deliveredSP || 0) : 0 },
  ];
  const visibleLanes = lanes.filter(l => l.tickets > 0 || (showSp && l.sp > 0));

  return (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: hasBurndown || isKanban ? 1.25 : 0 }}>
        <Typography variant="subtitle1" fontWeight={700}>{headerTitle}</Typography>
        {!isKanban && inFlight.sprintName && (
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary' }}>{inFlight.sprintName}</Typography>
        )}
        {isKanban && inFlight.boardName && (
          <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'text.primary' }}>{inFlight.boardName}</Typography>
        )}
        {ragLabel && (
          <Box component="span" sx={{
            display: 'inline-block', px: 0.9, py: 0.15, borderRadius: 0.75,
            fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5,
            color: ragColor, border: `1px solid ${ragColor}`, bgcolor: `${ragColor}10`,
          }}>{ragLabel.toUpperCase()}</Box>
        )}
        {hasBurndown && inFlight.daysTotal != null && (
          <Typography variant="caption" color="text.secondary">
            · {inFlight.startDate} → {inFlight.endDate} · Day {inFlight.daysElapsed} of {inFlight.daysTotal} ({inFlight.daysRemaining} {inFlight.daysRemaining === 1 ? 'day' : 'days'} left)
          </Typography>
        )}
      </Box>

      {!isKanban && !hasBurndown && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          Current sprint data unavailable — last DSR didn't include this sprint. Run a daily sync to populate live status.
        </Alert>
      )}

      {hasBurndown && (
        <Table size="small" sx={{ mb: 0.75, width: '100%', '& td, & th': { py: 0.5 }, '& td:first-of-type': { pr: 4, whiteSpace: 'nowrap', width: '40%' } }}>
          <TableBody>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary' }}>Story Points (V2)</TableCell>
              <TableCell>
                Delivered <strong>{inFlight.deliveredSP}/{inFlight.plannedSP}</strong> ({inFlight.completionPctSP}%) · Remaining <strong>{inFlight.remainingSP}</strong>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell sx={{ color: 'text.secondary' }}>Tickets (V2)</TableCell>
              <TableCell>
                Done <strong>{inFlight.ticketsCompleted}/{inFlight.ticketsTotal}</strong>{inFlight.ticketsRemaining > 0 && <> · Remaining <strong>{inFlight.ticketsRemaining}</strong></>}
              </TableCell>
            </TableRow>
            {(inFlight.bugsRaised || 0) > 0 && (
              <TableRow>
                <TableCell sx={{ color: 'text.secondary' }}>Bugs raised</TableCell>
                <TableCell>
                  <strong>{inFlight.bugsRaised}</strong>
                  {' '}({inFlight.topLevelBugs} top-level + {inFlight.subBugsRaised} sub-bug)
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {visibleLanes.length > 0 && (
        <Table size="small" sx={{ width: '100%', '& td, & th': { py: 0.4 } }}>
          <TableHead>
            <TableRow sx={{ '& th': { color: 'text.secondary', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 } }}>
              <TableCell>Lane</TableCell>
              <TableCell align="right">Tickets</TableCell>
              {showSp && <TableCell align="right">SP</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleLanes.map(l => (
              <TableRow key={l.label}>
                <TableCell>{l.label}</TableCell>
                <TableCell align="right">{l.tickets}</TableCell>
                {showSp && <TableCell align="right">{l.sp}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {(reopenedTickets > 0 || subBugsLogged != null) && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          <strong>Quality:</strong>
          {reopenedTickets > 0 && <> Reopened {reopenedTickets} tkt{reopenedTickets === 1 ? '' : 's'}</>}
          {reopenedTickets > 0 && subBugsLogged != null && ' · '}
          {subBugsLogged != null && <>Sub-bugs logged {subBugsLogged}</>}
        </Typography>
      )}

      {(hasBurndown || isKanban) && inFlight.snapshotDate && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, fontStyle: 'italic' }}>
          Data as of {inFlight.snapshotDate}. Scope: {scopeLabel === 'v2-sprint' ? 'V2 team only.' : 'Whole board.'}
          {isKanban ? ' Live board snapshot.' : ' Mid-sprint snapshot — values will change before sprint close.'}
        </Typography>
      )}
    </Paper>
  );
}

function DrilldownSlide({ d, scopeCtx, showInFlight = true }: { d: any; scopeCtx: SlideScopeCtx; showInFlight?: boolean }) {
  const scope = scopeCtx.scope;
  // `m`/`q` are the imported FACTS — used by the per-sprint breakdown table and
  // all charts, which must stay faithful to imported data. `mEd`/`qEd` layer the
  // presenter's manual headline overrides on top and are used ONLY for the
  // high-level Delivery-card totals. `edited` marks which fields were adjusted.
  const { m, q } = scopedDrilldown(d, scope);
  const { m: mEd, q: qEd, edited } = applyHeadlineOverride(m, q, d.metricsOverrideByScope?.[scope]);
  const adj = (...fields: string[]) => (fields.some(f => edited.has(f)) ? ' *' : '');
  const { team, teamBySprint: teamBySprintScoped } = scopedTeam(d, scope);
  const isWsr = m.dataSource === 'wsr';
  const isPerf = m.dataSource === 'perf';
  const perSprint: any[] = Array.isArray(m.perSprint) ? m.perSprint : [];
  const showPerSprint = isPerf && perSprint.length > 1;
  const inFlight = d.inFlightSprint || null;
  // When there is no completed sprint in the window, the per-sprint table,
  // combined totals card, and team table are all driven by zero/empty data
  // and would confuse the audience. Suppress them and let the in-flight card
  // tell the whole story for the project.
  const noCompleted = !!d.noCompletedSprintInWindow;
  // Range-mode "intended sprint not synced" state — a predecessor was excluded
  // for marginal overlap, so there is no meaningful sprint data. Suppress the
  // empty tables/trends (same as noCompleted) and show a warning banner instead.
  const coverageWarning: string | null = d.windowCoverageWarning || null;
  const suppressTables = noCompleted || !!coverageWarning;
  // Layout: pair the narrow Delivery card with a companion to fill a two-column
  // row. Current Sprint ON → header full-width on top, then [Delivery | Current
  // Sprint]. Current Sprint OFF → [Narrative header | Delivery]. Suppressed
  // states (no completed sprint / coverage warning) stay stacked.
  const showCard = !!(inFlight && showInFlight);
  const pairDelivery = !suppressTables;
  // When the Current Sprint card is toggled off, drop the narrative sentence that
  // points at it (only this template field ever references that exact phrase).
  const displayNarrative = showInFlight
    ? (d.narrative || '—')
    : (String(d.narrative || '').replace(/\s*[^.]*Current Sprint card[^.]*\./g, '').trim() || '—');

  const headerCard = (
    <Paper sx={{ p: 2, borderLeft: `6px solid ${SECTION_COLORS.Drilldown}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h6" fontWeight={700}>{d.projectName}</Typography>
        {(() => {
          const effective = d.healthOverride ?? d.health ?? 'Green';
          return (
            <Chip size="small" label={effective} color={healthColor(effective) as any}
              sx={{ fontWeight: 700 }} />
          );
        })()}
      </Box>
      <Typography variant="caption" color="text.secondary">{d.sprintName}</Typography>
      <Typography sx={{ mt: 1.5, lineHeight: 1.7 }}>{displayNarrative}</Typography>
      {isPerf && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, fontWeight: 600 }}>
          {scopeFootnote(scope)}
        </Typography>
      )}
      {isPerf && !suppressTables && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, fontStyle: 'italic' }}>
          Reopens count parent stories sent back to development; many sub-bugs are fixed without reopening their parent (the parent stays in QA), which is why bug counts can be much higher than reopen counts.
        </Typography>
      )}
    </Paper>
  );
  const inFlightCard = showCard ? <InFlightSprintCard inFlight={inFlight} /> : null;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {/* Header full-width when the Current Sprint card is shown (it becomes the
          left column of the pair otherwise), or when tables are suppressed. */}
      {(showCard || !pairDelivery) && headerCard}

      {noCompleted && (
        <Alert severity="info" variant="outlined">
          No completed sprint in this window — showing current sprint status only. Tables, combined totals, and team data will appear once a sprint in this window closes.
        </Alert>
      )}

      {coverageWarning && (
        <Alert severity="warning" variant="outlined">
          {coverageWarning}
        </Alert>
      )}

      {showPerSprint && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" gutterBottom>Per-Sprint Breakdown</Typography>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                <TableCell><strong>Sprint</strong></TableCell>
                <TableCell align="right"><strong>Planned (SP)</strong></TableCell>
                <TableCell align="right"><strong>Delivered (SP)</strong></TableCell>
                <TableCell align="right"><strong>Spillover (SP / tickets)</strong></TableCell>
                <TableCell align="right"><strong>Scope Added (SP / tickets)</strong></TableCell>
                <TableCell align="right"><strong>Reopens (count / %)</strong></TableCell>
                <TableCell align="right"><strong>Bugs (QA / prod)</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {perSprint.map((p: any, i: number) => (
                <TableRow key={p.syncId ?? i}>
                  <TableCell>{p.sprintName}</TableCell>
                  <TableCell align="right">{p.planned != null ? p.planned : naSpan()}</TableCell>
                  <TableCell align="right">{p.actual}</TableCell>
                  <TableCell align="right">{p.spillovers} / {p.spilloverCount}</TableCell>
                  <TableCell align="right">{p.scopeAddedSP} / {p.scopeAddedCount}</TableCell>
                  <TableCell align="right">{p.reopenedCount} / {p.reopenRatePct}%</TableCell>
                  <TableCell align="right">{p.bugsRaised} / {p.prodBugsEscaped}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {/* Two-column pair: [Narrative | Delivery] when the Current Sprint card is
          off, or [Delivery | Current Sprint] when it's on. Collapses to one column
          on narrow screens. */}
      {pairDelivery && (
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, alignItems: 'stretch' }}>
        {!showCard && headerCard}
        <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>
          {isPerf
            ? `${showPerSprint ? 'Combined Totals' : 'Delivery'} — ${perSprint.map((p: any) => p.sprintName).join(' + ') || d.sprintName}`
            : isWsr ? 'Delivery (Weekly)' : 'Sprint Metrics'}
        </Typography>
        {(() => {
          // Metrics as a responsive grid of label-over-value cells so the card
          // fills its width (half-width when paired, full-width otherwise) instead
          // of a narrow left-hugging table that leaves the card half-empty. Spillover
          // is shown only for a single completed sprint (per-sprint by nature); the
          // Per-Sprint Breakdown above carries the multi-sprint detail.
          const hasCommitment = mEd.metricKind !== 'throughput';
          const metrics: Array<{ label: string; value: React.ReactNode }> = isPerf
            ? [
                {
                  label: 'Capacity (SP planned)',
                  value: mEd.capacity != null ? `${mEd.capacity}${adj('capacity')}` : naSpan(),
                },
                { label: 'Delivered (SP)', value: `${mEd.actual ?? 0}${adj('actual')}` },
                { label: 'Delivered (tickets)', value: `${mEd.deliveredCount ?? 0}${adj('deliveredCount')}` },
                ...(!showPerSprint ? [{
                  label: hasCommitment ? 'Spillover' : 'Still Open at Cycle End',
                  value: `${mEd.spillovers ?? 0} SP · ${mEd.spilloverCount ?? 0} tickets${mEd.spilloverPct != null ? ` (${mEd.spilloverPct}%)` : ''}${adj('spillovers', 'spilloverCount')}`,
                }] : []),
                (() => {
                  const { net, addedSP, removedSP, hasRemoved } = netScopeChange(mEd);
                  const editedMark = adj('scopeAddedSP', 'scopeAddedCount', 'removedSp', 'removedCount');
                  return {
                    label: 'Net Scope Change',
                    value: (
                      <>
                        <Box component="span">{`${formatNetScope(net)} SP${editedMark}`}</Box>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 400 }}>
                          {hasRemoved
                            ? `(scope add ${addedSP} SP − scope removed ${removedSP} SP)`
                            : `(scope add ${addedSP} SP · ${mEd.scopeAddedCount ?? 0} tickets, ${mEd.scopeCreepPct ?? 0}%)`}
                        </Typography>
                      </>
                    ),
                  };
                })(),
                ...(mEd.reEstimatedSp != null ? [{ label: 'SP updated (mid-sprint)', value: `${mEd.reEstimatedSp > 0 ? '+' : ''}${mEd.reEstimatedSp ?? 0} SP${adj('reEstimatedSp')}` }] : []),
                { label: 'Reopens', value: `${mEd.reopenedCount ?? 0} (${mEd.reopenRatePct ?? 0}%)${adj('reopenedCount')}` },
                { label: 'Bugs raised (QA)', value: `${qEd.validBugs ?? 0}${adj('validBugs')}` },
              ]
            : isWsr
            ? [
                { label: 'Tickets Completed', value: `${m.ticketsCompleted ?? 0}` },
                { label: 'Avg Active Tickets', value: `${m.avgActiveTickets ?? 0}` },
                { label: 'Max Blocked', value: `${m.maxBlockedTickets ?? 0}` },
                { label: 'Weeks Covered', value: `${m.weeksCovered ?? 0}` },
              ]
            : [
                { label: 'Capacity', value: `${m.capacity ?? '—'}` },
                { label: 'Planned', value: `${m.planned ?? '—'}` },
                { label: 'Actual', value: `${m.actual ?? '—'}` },
                { label: 'Rework %', value: `${m.reworkPct ?? '—'}` },
                { label: 'Carryover %', value: `${m.carryoverPct ?? '—'}` },
              ];
          return (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', columnGap: 3, rowGap: 1.5, mt: 0.5 }}>
              {metrics.map(mi => (
                <Box key={mi.label}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{mi.label}</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{mi.value}</Typography>
                </Box>
              ))}
            </Box>
          );
        })()}
        {isWsr && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Source: Weekly Status Reports — ticket counts from weekly status snapshots (no story points).
          </Typography>
        )}
        {isPerf && showPerSprint && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Capacity, Delivered, Scope Added, Removed, and Reopens are summed across the {perSprint.length} completed sprints in window. Spillover is per-sprint by nature — see the Per-Sprint Breakdown above for each closed sprint's unfinished work.
          </Typography>
        )}
        {isPerf && edited.size > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, fontStyle: 'italic' }}>
            * Manually adjusted for this presentation. Charts, the per-sprint breakdown, and team tables reflect the imported data.
          </Typography>
        )}
        </Paper>
        {showCard && inFlightCard}
      </Box>
      )}

      {/* Suppressed states (no completed sprint / coverage warning) keep the
          in-flight card full-width — there's no Delivery card to pair it with. */}
      {!pairDelivery && inFlightCard}

      {!suppressTables && (() => {
        // Per-sprint team breakdown — when the window covers 2+ closed sprints
        // and the backend supplied a per-sprint split, render one Team paper
        // per sprint. Single-sprint windows (or older presentations without
        // teamBySprint) fall back to the aggregated `team` array.
        const teamBySprint: any[] = Array.isArray(teamBySprintScoped) ? teamBySprintScoped : [];
        const useSplit = teamBySprint.length > 1 && teamBySprint.some(s => Array.isArray(s.team) && s.team.length > 0);
        if (useSplit) {
          return teamBySprint
            .filter(s => Array.isArray(s.team) && s.team.length > 0)
            .map(s => (
              <TeamMembersPaper
                key={s.syncId}
                title={`Team — ${s.sprintName}`}
                team={s.team}
                v2Only={isPerf && scope === 'v2'}
                hasCommitment={m.metricKind !== 'throughput'}
              />
            ));
        }
        if (team.length > 0) {
          return (
            <TeamMembersPaper
              title={isPerf && perSprint.length === 1 ? `Team — ${perSprint[0].sprintName}` : 'Team'}
              team={team}
              v2Only={isPerf && scope === 'v2'}
              hasCommitment={m.metricKind !== 'throughput'}
            />
          );
        }
        return null;
      })()}

      {/* Per-developer Velocity / Reopen / Carryover sparklines for this
          project. Rendered full-width here (rather than crammed into the shared
          Trends slide) so each project's data has room to breathe. */}
      {!suppressTables && <IndividualPerformanceTrends d={d} scope={scope} />}

    </Box>
  );
}

/**
 * Renders the dev / QA split team table inside a Paper. Extracted from
 * DrilldownSlide so the same layout can be used once for the aggregated team
 * or N times when we have a per-sprint breakdown.
 */
function TeamMembersPaper({ title, team, v2Only, hasCommitment = true }: { title: string; team: any[]; v2Only?: boolean; hasCommitment?: boolean }) {
  const isQa = (t: any) => String(t.role || '').toLowerCase() === 'qa';
  const devs = team.filter(t => !isQa(t));
  const qas = team.filter(isQa);
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        {title}
        {v2Only && <Chip size="small" label="V2 Team only" variant="outlined" sx={{ ml: 1, fontSize: 10, height: 18 }} />}
      </Typography>

      {/* Developers and QA side by side — the two tables have different columns,
          so they stay independent tables in adjacent columns rather than merging.
          Falls back to a single full-width column when only one group is present
          or on narrow screens. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: devs.length > 0 && qas.length > 0 ? '1fr 1fr' : '1fr' }, gap: 2, alignItems: 'start' }}>
      {devs.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, mb: 0.5 }}>
            Developers ({devs.length})
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                <TableCell><strong>Name</strong></TableCell>
                <TableCell align="right"><strong>{hasCommitment ? 'Planned (SP)' : 'Still Open (SP)'}</strong></TableCell>
                <TableCell align="right"><strong>Delivered (SP)</strong></TableCell>
                {hasCommitment && <TableCell align="right"><strong>Spillover (SP)</strong></TableCell>}
                <TableCell align="right"><strong>Reopens</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {devs.map((t, i) => (
                <TableRow key={i}>
                  <TableCell>{t.name}</TableCell>
                  <TableCell align="right">{hasCommitment ? (t.planned ?? '—') : (t.spillover ?? '—')}</TableCell>
                  <TableCell align="right">{t.delivered ?? '—'}</TableCell>
                  {hasCommitment && <TableCell align="right">{t.spillover ?? '—'}</TableCell>}
                  <TableCell align="right">{t.reopens ?? 0}{t.reopenRatePct != null && ` (${t.reopenRatePct}%)`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            {hasCommitment
              ? 'Planned / Delivered / Spillover are story points pulled from the sprint scorecard.'
              : 'This project has no tracked commitment, so there is no "planned" figure — "Still Open (SP)" is the developer’s SP still open when the cycle ended.'}
            {' '}Reopens count tickets returned to the developer for rework (subbug or QA rejection),
            shown with rate as % of delivered.
          </Typography>
        </Box>
      )}

      {qas.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, mb: 0.5 }}>
            QA ({qas.length})
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f7f9fc' }}>
                <TableCell><strong>Name</strong></TableCell>
                <TableCell align="right"><strong>Tickets Tested (SP)</strong></TableCell>
                <TableCell align="right"><strong>SP Delivered</strong></TableCell>
                <TableCell align="right"><strong>Bugs Raised</strong></TableCell>
                <TableCell align="right"><strong>Invalid Bugs</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {qas.map((t, i) => (
                <TableRow key={i}>
                  <TableCell>{t.name}</TableCell>
                  <TableCell align="right">{t.ticketsTested ?? 0}{t.spTested != null ? ` (${t.spTested} SP)` : ''}</TableCell>
                  <TableCell align="right">{t.spDelivered ?? '—'}</TableCell>
                  <TableCell align="right">{t.bugsRaised ?? 0}</TableCell>
                  <TableCell align="right">{t.invalidBugsRaised ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            Tickets Tested = tickets this QA member moved out of QA (to UAT or Done) during the sprint; the SP in
            parentheses is the story-point weight of those tickets.
            SP Delivered = story points of dev tickets this QA member was assigned and completed themselves (QA
            members occasionally pick up development work) — not counted in the developer delivery totals.
            Bugs Raised = defects logged by the QA owner during the sprint, including both top-level Bugs and Sub-bugs (rework defects).
            Invalid Bugs = subset of Bugs Raised flagged as not a real defect (Root Cause 'Invalid Bug', 'Bad Data' or 'Incomplete Requirement', or an invalid-bug label).
            Production-escape is not tracked at project level — the data isn't reliably attributable to a sprint window or QA owner.
          </Typography>
        </Box>
      )}
      </Box>
    </Paper>
  );
}

/**
 * Developer Velocity — compact row layout. One row per V2 developer:
 *   Name (180px) | wide sparkline | latest SP value (right-aligned)
 *
 * Designed to be intentionally factual: single neutral colour, alphabetical
 * order, no team-average overlay, no min/max highlights, no judgemental
 * colouring. Y-axis is shared across rows (with 15% headroom + nice-tick
 * rounding so spikes never touch the row boundary), unless the backend
 * flagged an outlier — in which case we switch to per-row Y-scale and add
 * a small caption so the reader knows.
 */
interface DeveloperMetricBarChartProps {
  sprints: SprintRef[];
  // Already participation-filtered and label-ready — see developerParticipation.ts.
  developers: MetricRow[];
  globalMax: number;
  unit: 'SP' | '%';
}

// First name only — keeps the X-axis readable when a team has many developers.
const firstName = (full: string) => (full || '').trim().split(/\s+/)[0] || full;

/**
 * Grouped bar chart comparing developers across the last N sprints. Powers
 * Developer Velocity (SP), Reopen Ratio (%), and Carryover Ratio (%): one X-axis
 * group per developer, one coloured bar per sprint, value labels on top, and a
 * sprint legend at the bottom.
 *
 * - Single shared Y-axis (0…globalMax) so developers are directly comparable.
 * - A sprint with no value plots as a 0-height bar (recharts needs a number),
 *   but its LABEL is blank — a measured zero prints "0" instead, so the two are
 *   distinguishable. See barLabelFor in developerParticipation.ts.
 * - Full value labels are suppressed once the chart gets dense so the numbers
 *   don't overlap; measured zeros are always labelled regardless of density,
 *   since they print into empty space where no bar exists.
 */
function DeveloperMetricBarChart({ sprints, developers, globalMax, unit }: DeveloperMetricBarChartProps) {
  if (sprints.length === 0 || developers.length === 0) return null;

  const dense = developers.length >= 6;
  const showLabels = developers.length * sprints.length <= 20;

  const sprintLabels = sprints.map(s => shortenSprintName(s.sprintName));
  const data = developers.map(dev => {
    const row: Record<string, any> = { developer: firstName(dev.name), fullName: dev.name };
    sprints.forEach((s, i) => {
      row[sprintLabels[i]] = dev.valuesBySync[String(s.syncId)] ?? 0;
      // Companion field: the plotted value is 0 for both "no data" and a real
      // zero, so the label text cannot be derived from it. Mirrors the
      // `__vlabel` precedent used by the trend charts above.
      row[sprintLabels[i] + LABEL_SUFFIX] = barLabelFor(dev, s.syncId, unit, showLabels);
    });
    return row;
  });

  const maxBarSize = dense ? 14 : 22;
  const unitSuffix = unit === '%' ? '%' : ' SP';

  return (
    <ResponsiveContainer width="100%" height={dense ? 300 : 260}>
      <BarChart data={data} margin={{ top: 18, right: 12, left: -8, bottom: 4 }} barCategoryGap="22%" barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="developer" tick={{ fontSize: 11 }} interval={0} />
        <YAxis tick={{ fontSize: 10 }} domain={[0, globalMax > 0 ? globalMax : 'auto']} allowDecimals={false} />
        <RTooltip
          contentStyle={{ borderRadius: 8, fontSize: 12 }}
          formatter={(val: any) => `${val}${unitSuffix}`}
          labelFormatter={(lbl: any, payload: any) => payload?.[0]?.payload?.fullName ?? lbl}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {sprintLabels.map((label, i) => (
          <Bar
            key={label}
            dataKey={label}
            fill={CHART_COLORS[i % CHART_COLORS.length]}
            radius={[3, 3, 0, 0]}
            maxBarSize={maxBarSize}
            isAnimationActive={false}
          >
            {/* Always rendered — the density gate lives inside barLabelFor so a
                measured zero survives it. */}
            <LabelList
              dataKey={label + LABEL_SUFFIX}
              position="top"
              style={{ fontSize: 9, fontWeight: 600, fill: '#546e7a' }}
            />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function PanelTitleWithRule({
  title, caption, tooltip,
}: { title: string; caption: string; tooltip: string }) {
  return (
    <Box sx={{ mb: 0.5 }}>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography variant="subtitle2" sx={{ color: '#37474f' }}>{title}</Typography>
        <Tooltip title={tooltip} arrow placement="top">
          <InfoOutlinedIcon sx={{ fontSize: 14, color: '#90a4ae', cursor: 'help' }} />
        </Tooltip>
      </Stack>
      <Typography sx={{ color: '#78909c', fontSize: 11, lineHeight: 1.3, display: 'block' }}>
        {caption}
      </Typography>
    </Box>
  );
}

/**
 * Drill-down sub-section: per-developer sparkline panels for a single project —
 * Velocity, Reopen Ratio, and Carryover Ratio. When trend data is available all
 * three tile across the slide; when only Velocity is available (Kanban project
 * or older presentation without `developerTrends` baked in) the lone panel is
 * capped so it doesn't stretch the full slide width. Returns null when the
 * project has no developer data at all.
 */
function IndividualPerformanceTrends({ d, scope = DEFAULT_SCOPE }: { d: any; scope?: Scope }) {
  const { developerVelocity: vel, developerTrends: tr } = scopedDeveloperTrends(d, scope);
  const scopeLbl = scopeShortLabel(scope);
  // Drops developers who only brushed the project (see developerParticipation.ts)
  // and pre-renders bar labels so a measured zero reads differently from no data.
  const view = buildIndividualTrendsView(vel, tr);
  if (!view) return null;
  const velHas = view.velocityRows.length > 0;
  const trHas = view.reopenRows.length > 0;
  if (!velHas && !trHas) return null;

  // Adaptive layout: a grouped bar chart with many developers on the X-axis needs
  // room, so once the team hits 6+ developers each metric chart gets its own full
  // width row. Smaller teams keep the compact multi-up (3-across) layout.
  // Driven by the POST-filter count, so hiding people also loosens the layout.
  const oneChartPerRow = view.devCount >= 6;

  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ color: SECTION_COLORS.Velocity }}>
          Individual Performance Trends (last 5 closed sprints, {scopeLbl})
        </Typography>
        {view.hiddenNames.length > 0 && (
          // Names live in the tooltip only — the presenter can answer "where's
          // X?" without those names appearing on a customer's screen.
          <Tooltip
            title={`Not shown (active in fewer than ${view.minActiveSprints} of the last ${view.sprints.length} sprints): ${view.hiddenNames.join(', ')}`}
            arrow
            placement="top"
          >
            <InfoOutlinedIcon sx={{ fontSize: 14, color: '#90a4ae', cursor: 'help' }} />
          </Tooltip>
        )}
      </Stack>
      <Typography sx={{ color: '#78909c', fontSize: 11, lineHeight: 1.3, display: 'block', mb: 1 }}>
        {participationCaption(view)}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          // Large team → one full-width chart per row. Small team → tile the three
          // metric charts across the slide (up to 3-across via auto-fit). Velocity
          // only (no trends on this project) is capped so the lone chart doesn't
          // stretch the full slide width.
          gridTemplateColumns: oneChartPerRow
            ? 'minmax(0, 1fr)'
            : (trHas ? 'repeat(auto-fit, minmax(420px, 1fr))' : 'minmax(0, 720px)'),
          gap: 2,
        }}
      >
        {velHas && (
          <Box>
            <PanelTitleWithRule
              title="Developer Velocity (SP)"
              caption={`SP delivered per developer per sprint (${scopeLbl}).`}
              tooltip="Sum of Story Points on tickets the developer moved to Done in the sprint. Tickets resolved on resolutiondate inside the sprint window count even if the status is 'Closed' instead of 'Done'. Sub-bugs are excluded — those count under QA quality."
            />
            <DeveloperMetricBarChart
              sprints={view.sprints}
              developers={view.velocityRows}
              globalMax={view.maxSp}
              unit="SP"
            />
          </Box>
        )}
        {trHas && (
          <>
            <Box>
              <PanelTitleWithRule
                title="Reopen Ratio (%)"
                caption="Reopens ÷ SP delivered. Excludes parent tickets labeled Invalid-Reopen / Bad-Data / Scope-Change."
                tooltip="A story is 'reopened' when (a) it has at least one valid sub-bug AND was moved back to DEV, OR (b) status flipped from Done back to a non-Done state within the sprint. Each of Invalid-Reopen / Bad-Data / Scope-Change on the parent subtracts one reopen event; case and separators are normalised, so BadData matches, but a longer label such as Scope-Change-Approved does not. Other Jira labels on the parent are ignored."
              />
              <DeveloperMetricBarChart
                sprints={view.sprints}
                developers={view.reopenRows}
                globalMax={view.maxReopenPct}
                unit="%"
              />
            </Box>
            <Box>
              <PanelTitleWithRule
                title="Carryover Ratio (%)"
                caption={`Carried-over SP ÷ (planned SP + scope-creep SP). ${scopeLbl}.`}
                tooltip="Carried-over SP = sum of SP on the developer's tickets that ended the sprint in a non-Done status with the developer still assigned. Sub-bugs are excluded. Denominator includes both originally planned SP and mid-sprint scope additions (wasScopeChange). Returns blank when the denominator is 0."
              />
              <DeveloperMetricBarChart
                sprints={view.sprints}
                developers={view.carryoverRows}
                globalMax={view.maxCarryoverPct}
                unit="%"
              />
            </Box>
          </>
        )}
      </Box>
    </Paper>
  );
}

function DiscussionSlide({ report }: { report: any }) {
  const dp: string[] = report.discussionPoints || [];
  // SlideScaler vertically centers content shorter than the stage (so short
  // slides don't leave dead space at the bottom) — great for multi-card grids,
  // but a single short card ends up floating mid-screen. Reserving a tall
  // minHeight here (well past any realistic card height) pushes this slide
  // past SlideScaler's "fits" threshold, so it top-aligns like every other
  // slide instead, while the card itself stays compact.
  return (
    <Box sx={{ minHeight: 640 }}>
      <Paper sx={{ p: 2.5, borderLeft: `4px solid ${SECTION_COLORS.Team}` }}>
        <ExpandableList
          items={dp}
          max={8}
          bulletChar="→"
          bulletColor={SECTION_COLORS.Team}
          emptyText="No discussion points recorded."
          modalTitle="All Discussion Points"
        />
      </Paper>
    </Box>
  );
}

// ===== Merged slides ===================================================
//
// HighlightsRisksActionsSlide collapses what used to be two separate slides
// ("Highlights & Risks" and "Action Items & Tech") into ONE 2x2-quadrant screen:
//
//   Achievements          | Blockers & Risks
//   Action Items          | Technical Recommendations
//
// Each quadrant uses ExpandableList / RiskList so only a short list shows inline
// (top 3) with a "View all" modal for the rest — this keeps the slide dense
// instead of leaving large blank areas when a section is sparse.
function HighlightsRisksActionsSlide({ report }: { report: any }) {
  const h = report.keyHighlights || {};
  const achievements: string[] = h.achievements || [];
  const blockerBullets: string[] = h.blockers || [];
  const capacityNotes: string[] = h.capacityNotes || [];
  const risks: any[] = report.risks || [];

  const items: any[] = report.actionItemsSnapshot || [];
  // Technical Recommendations is an optional quadrant — switched off per
  // presentation (Step 4) via hiddenCharts['tech-recommendations']. When off,
  // Action Items spans the whole bottom row instead of leaving a blank cell.
  const showTech = !isChartHidden(report.hiddenCharts, 'tech-recommendations');
  const recs: string[] = showTech ? (report.techRecommendations || []) : [];
  const itemStrings = items.map(a => {
    const due = a.dueDate ? ` — due ${a.dueDate}` : '';
    const owner = a.owner ? ` (${a.owner})` : '';
    const status = a.status ? ` [${a.status}]` : '';
    return `[${a.projectName}] ${a.title}${owner}${status}${due}`;
  });

  const quadrant = { p: 2, display: 'flex', flexDirection: 'column' } as const;

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
      {/* Top-left: Achievements */}
      <Paper sx={{ ...quadrant, borderLeft: `4px solid ${SECTION_COLORS.Highlights}` }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Highlights }}>
          Achievements
        </Typography>
        <ExpandableList
          items={achievements}
          max={3}
          bulletChar="✓"
          bulletColor={SECTION_COLORS.Highlights}
          groupByProject
          emptyText="No achievements captured."
          modalTitle="All Achievements"
        />
        {capacityNotes.length > 0 && (
          <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px dashed #cfd8dc' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
              Capacity Notes
            </Typography>
            <Box sx={{ mt: 0.75 }}>
              <ExpandableList items={capacityNotes} max={2} bulletChar="•" bulletColor="#455a64" modalTitle="All Capacity Notes" />
            </Box>
          </Box>
        )}
      </Paper>

      {/* Top-right: Blockers & Risks */}
      <Paper sx={{ ...quadrant, borderLeft: `4px solid ${SECTION_COLORS.Risks}`, bgcolor: '#fffafa' }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Risks }}>
          Blockers & Risks
        </Typography>
        {blockerBullets.length > 0 && (
          <Box sx={{ mb: blockerBullets.length > 0 && risks.length > 0 ? 1.5 : 0 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
              Top Blockers
            </Typography>
            <Box sx={{ mt: 0.75 }}>
              <ExpandableList items={blockerBullets} max={3} bulletChar="⚠" bulletColor={SECTION_COLORS.Risks} groupByProject modalTitle="All Blockers" />
            </Box>
          </Box>
        )}
        {risks.length > 0 && (
          <Box sx={{ mt: blockerBullets.length > 0 ? 1.5 : 0 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
              Open Risks ({risks.length})
            </Typography>
            <Box sx={{ mt: 0.75 }}>
              <RiskList risks={risks} max={3} bulletColor={SECTION_COLORS.Risks} modalTitle="All Open Risks" />
            </Box>
          </Box>
        )}
        {blockerBullets.length === 0 && risks.length === 0 && (
          <Typography color="text.secondary" variant="body2">No blockers or risks captured.</Typography>
        )}
      </Paper>

      {/* Bottom-left: Action Items (full-width when Tech Recommendations is off) */}
      <Paper sx={{ ...quadrant, borderLeft: `4px solid ${SECTION_COLORS.Actions}`, ...(showTech ? {} : { gridColumn: '1 / -1' }) }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Actions }}>
          Action Items {items.length > 0 && <Typography component="span" variant="caption" color="text.secondary">({items.length} open)</Typography>}
        </Typography>
        <ExpandableList
          items={itemStrings}
          max={3}
          bulletChar="▸"
          bulletColor={SECTION_COLORS.Actions}
          groupByProject
          emptyText="No open action items."
          modalTitle="All Action Items"
        />
      </Paper>

      {/* Bottom-right: Technical Recommendations (optional) */}
      {showTech && (
        <Paper sx={{ ...quadrant, borderLeft: `4px solid ${SECTION_COLORS.Tech}` }}>
          <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Tech }}>
            Technical Recommendations
          </Typography>
          <ExpandableList
            items={recs}
            max={3}
            bulletChar="•"
            bulletColor={SECTION_COLORS.Tech}
            emptyText="No recommendations captured."
            modalTitle="All Recommendations"
          />
        </Paper>
      )}
    </Box>
  );
}

// TrendsSlide combines the velocity, productivity, defect-density and
// developer-velocity charts into one slide. Scrum mode uses a 2-per-row grid
// (4 cards). WSR/Kanban mode has only the throughput chart available, so we
// stack vertically with a single full-width unavailability notice.
// A subset (not all) of the visible projects have no perf sync, so their
// Productivity/Defect/Reopen/etc series are simply absent from the charts
// below rather than the whole slide collapsing. Names them so a reader
// doesn't mistake "no bars for this project" for "this project had zero."
function PartialWsrNotice({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <Paper sx={{ p: 1.5, bgcolor: '#fafafa' }}>
      <Typography variant="caption" color="text.secondary">
        Productivity, Defect Density and Developer Velocity are not shown for {names.join(', ')}
        {names.length === 1 ? ' — no' : ' — neither has a'} synced Kanban span or Jira sprint yet.
        The Weekly Throughput chart above still includes {names.length === 1 ? 'it' : 'them'}.
      </Typography>
    </Paper>
  );
}

function TrendsSlide({ report, filter, scopeCtx }: { report: any; filter: ProjectFilterState; scopeCtx: SlideScopeCtx }) {
  const wsrMode = allTrendsFromWsr(report, filter.visibleIds);
  const scope = scopeCtx.scope;
  const velocityViewMode = scopeCtx.velocityViewMode ?? 'normalized';
  const onVelocityViewModeChange = scopeCtx.onVelocityViewModeChange ?? (() => {});
  const hc: Record<string, boolean> | undefined = report.hiddenCharts;
  if (wsrMode) {
    return (
      <Box sx={{ display: 'grid', gap: 2 }}>
        {!isChartHidden(hc, 'velocity-trend') && (
          <VelocityTrendSlide
            report={report} filter={filter} scope={scope}
            viewMode={velocityViewMode} onViewModeChange={onVelocityViewModeChange}
          />
        )}
        <WsrUnavailableNotice />
      </Box>
    );
  }
  // Per-developer sparklines (Velocity / Reopen / Carryover) now live inside
  // each project's Drill-down slide via <IndividualPerformanceTrends />. The
  // Trends slide keeps the three team-aggregated charts only. The scope toggle
  // lives in the slide header bar (always visible while scrolling the charts).
  // With >2 projects each chart's x-axis crams every project's sprints onto a
  // shared axis, so go 2-per-row (wider charts, taller, angled labels) instead
  // of the compact 3-per-row used for 1-2 projects.
  const crowded = filter.visibleIds.length > 2;
  const partialWsrNames = ProjectNames(report, wsrProjectIds(report, filter.visibleIds));
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: crowded
            ? 'repeat(auto-fit, minmax(560px, 1fr))'
            : 'repeat(auto-fit, minmax(420px, 1fr))',
          gap: 2,
          // alignItems defaults to 'stretch' so cells in the same row share a
          // height. Each Paper internally uses display: 'flex'; flexDirection:
          // 'column' to push the caption to the bottom.
        }}
      >
        {!isChartHidden(hc, 'velocity-trend') && (
          <VelocityTrendSlide
            report={report} filter={filter} scope={scope} crowded={crowded}
            viewMode={velocityViewMode} onViewModeChange={onVelocityViewModeChange}
          />
        )}
        {!isChartHidden(hc, 'productivity') && !isKanbanPresentation(report, filter.visibleIds) && <ProductivityChart report={report} filter={filter} scope={scope} crowded={crowded} />}
        {!isChartHidden(hc, 'defect-density') && <DefectChart report={report} filter={filter} scope={scope} crowded={crowded} />}
        {!isChartHidden(hc, 'reopen-ratio') && <ReopenChart report={report} filter={filter} scope={scope} crowded={crowded} />}
        {!isChartHidden(hc, 'invalid-reopens') && <InvalidReopenChart report={report} filter={filter} scope={scope} crowded={crowded} />}
        {!isChartHidden(hc, 'defect-leakage') && <LeakageChart report={report} filter={filter} scope={scope} crowded={crowded} />}
        {!isChartHidden(hc, 'prod-bugs-count') && <ProdBugsChart report={report} filter={filter} scope={scope} crowded={crowded} />}
        {!isChartHidden(hc, 'uat-reopens-count') && <UatReopensChart report={report} filter={filter} scope={scope} crowded={crowded} />}
      </Box>
      <PartialWsrNotice names={partialWsrNames} />
    </Box>
  );
}

// ===== Skip-empty helpers ==============================================

function hasHighlightsOrRisks(report: any): boolean {
  const h = report.keyHighlights || {};
  return (h.achievements?.length || 0) > 0
      || (h.blockers?.length || 0) > 0
      || (h.capacityNotes?.length || 0) > 0
      || (report.risks?.length || 0) > 0;
}

function hasActionsOrTech(report: any): boolean {
  // Tech recommendations only count when the optional quadrant is enabled —
  // otherwise a presentation whose sole bottom-row content is hidden tech recs
  // would produce a near-empty slide.
  const techCounts = !isChartHidden(report.hiddenCharts, 'tech-recommendations')
    && (report.techRecommendations?.length || 0) > 0;
  return (report.actionItemsSnapshot?.length || 0) > 0 || techCounts;
}

function hasTrendData(report: any, visibleIds: number[]): boolean {
  const trend = report.trendData || {};
  return visibleIds.some(pid => (trend[String(pid)]?.sprints?.length || 0) > 0);
}

function hasDiscussion(report: any): boolean {
  return (report.discussionPoints?.length || 0) > 0;
}

// Optional read-only Team Capacity table (Name / Sprint / Planned Leaves /
// Unplanned Leaves / Story Points Delivered). Populated in the editor; shown as
// its own slide when the 'team-capacity' item is enabled and has rows.
function TeamCapacitySlide({ report }: { report: any }) {
  const rows: any[] = Array.isArray(report?.teamCapacityRows) ? report.teamCapacityRows : [];
  const fmt = (v: any) => (v === null || v === undefined || v === '' ? '—' : v);
  // Kanban rows are per cycle/week and carry the period's working days.
  const kanban = rows.some(r => r.workingDays != null);
  return (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom sx={{ color: SECTION_COLORS.Team }}>
        Team Capacity
      </Typography>
      <Table size="small" sx={{ '& th, & td': { whiteSpace: 'normal' }, '& th': { fontWeight: 700, bgcolor: '#f5f7fa', wordBreak: 'normal', overflowWrap: 'normal' }, '& td': { wordBreak: 'normal', overflowWrap: 'break-word' } }}>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>{kanban ? 'Cycle' : 'Sprint'}</TableCell>
            {kanban && <TableCell align="center">Working Days</TableCell>}
            <TableCell align="center">Planned Leaves</TableCell>
            <TableCell align="center">Unplanned Leaves</TableCell>
            {kanban && <TableCell align="center">Available Days</TableCell>}
            <TableCell align="center">Story Points Delivered</TableCell>
            {/* Carry Over SP column hidden for now (data field retained). */}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && (
            <TableRow><TableCell colSpan={7}><Typography variant="caption" color="text.secondary">No team capacity rows entered yet.</Typography></TableCell></TableRow>
          )}
          {rows.map((r, i) => (
            <TableRow key={i}>
              <TableCell>{fmt(r.name)}</TableCell>
              <TableCell>{fmt(r.sprint)}</TableCell>
              {kanban && <TableCell align="center">{fmt(r.workingDays)}</TableCell>}
              <TableCell align="center">{fmt(r.plannedLeaves)}</TableCell>
              <TableCell align="center">{fmt(r.unplannedLeaves)}</TableCell>
              {kanban && <TableCell align="center">{r.workingDays == null ? '—' : Math.max(0, (r.workingDays ?? 0) - (r.plannedLeaves ?? 0) - (r.unplannedLeaves ?? 0))}</TableCell>}
              <TableCell align="center">{fmt(r.storyPointsDelivered)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

export function buildSlides(report: any, filter: ProjectFilterState): SlideDef[] {
  const drilldown: any[] = report.perProjectDrilldown || [];
  const visibleDrilldowns = drilldown.filter((d: any) => !filter.hidden.has(d.projectId));
  const totalDrilldowns = visibleDrilldowns.length;

  const slides: SlideDef[] = [];

  // Overview is always shown - it carries the executive summary and KPI tiles.
  slides.push({
    id: 'overview', name: 'Delivery Overview', color: SECTION_COLORS.Overview,
    icon: <DashboardIcon sx={{ fontSize: 20 }} />,
    scoped: anyScopeData(drilldown),
    render: (r, _f, sc) => <OverviewSlide report={r} scopeCtx={sc} />,
  });

  // Highlights/Risks and Action-Items/Tech merged into one 2x2-quadrant slide so
  // sparse sections don't leave a half-empty screen each.
  if (hasHighlightsOrRisks(report) || hasActionsOrTech(report)) {
    slides.push({
      id: 'highlights-actions', name: 'Highlights, Risks & Actions', color: SECTION_COLORS.Highlights,
      icon: <WarningIcon sx={{ fontSize: 20 }} />,
      render: (r) => <HighlightsRisksActionsSlide report={r} />,
    });
  }

  if (hasTrendData(report, filter.visibleIds)) {
    slides.push({
      id: 'trends', name: 'Trends', color: SECTION_COLORS.Velocity,
      icon: <ShowChartIcon sx={{ fontSize: 20 }} />,
      scoped: trendsScoped(report, filter.visibleIds),
      render: (r, f, sc) => <TrendsSlide report={r} filter={f} scopeCtx={sc} />,
    });
  }

  if (!isChartHidden(report.hiddenCharts, 'team-capacity')) {
    slides.push({
      id: 'team-capacity', name: 'Team Capacity', color: SECTION_COLORS.Team,
      icon: <GroupIcon sx={{ fontSize: 20 }} />,
      render: (r) => <TeamCapacitySlide report={r} />,
    });
  }

  if (Array.isArray(report.customSections) && report.customSections.length > 0) {
    // Paginate by grid footprint (see paginateSections) so a slide never spills
    // onto a third row and never leaves a gap with content on the next slide.
    const pages = paginateSections(report.customSections);
    pages.forEach((pageSections, idx) => {
      slides.push({
        id: pages.length > 1 ? `additional-insights-${idx + 1}` : 'additional-insights',
        name: pages.length > 1 ? `Additional Insights (${idx + 1} of ${pages.length})` : 'Additional Insights',
        color: SECTION_COLORS.Insights,
        icon: <InsightsIcon sx={{ fontSize: 20 }} />,
        render: () => <InsightsSlide sections={pageSections} />,
      });
    });
  }

  // Current Sprint (in-flight) card visibility. Multi-project presentations
  // always show it; single-project honors the per-presentation setting stored
  // in hiddenCharts under 'current-sprint' (default shown).
  const multiProject = (report.perProjectDrilldown?.length ?? 0) > 1;
  const showInFlight = multiProject || !isChartHidden(report.hiddenCharts, 'current-sprint');

  visibleDrilldowns.forEach((d, idx) => {
    slides.push({
      id: `drilldown-${d.projectId ?? d.projectName}`,
      name: totalDrilldowns > 1
        ? `${d.projectName} — Drilldown (${idx + 1} of ${totalDrilldowns})`
        : `${d.projectName} — Drilldown`,
      color: SECTION_COLORS.Drilldown,
      icon: <GroupIcon sx={{ fontSize: 20 }} />,
      scoped: hasScopeData(d),
      render: (_r, _f, sc) => <DrilldownSlide d={d} scopeCtx={sc} showInFlight={showInFlight} />,
    });
  });

  if (hasDiscussion(report)) {
    slides.push({
      id: 'discussion', name: 'Additional Discussion Points', color: SECTION_COLORS.Team,
      icon: <FactCheckIcon sx={{ fontSize: 20 }} />,
      render: (r) => <DiscussionSlide report={r} />,
    });
  }

  return slides;
}

export { healthColor };
