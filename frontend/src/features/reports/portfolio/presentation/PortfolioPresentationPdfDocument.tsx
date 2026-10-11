import { forwardRef } from 'react';
import dayjs from 'dayjs';
import { Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, Paper } from '@mui/material';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
  ComposedChart, Area, BarChart, Bar, LabelList, ReferenceLine,
} from 'recharts';
import { shortenSprintName, sprintWorkingDays } from './sprintLabel';
import {
  LABEL_SUFFIX,
  barLabelFor,
  buildIndividualTrendsView,
  participationCaption,
  type MetricRow,
  type SprintRef,
} from './developerParticipation';
import { isChartHidden, isKanbanPresentation } from './trendCharts';
import { CustomSectionsPdfBlock } from '../../shared/customSections/CustomSectionPdf';
import RichTextView from '../../../../shared/components/RichTextView';
import { paginateSections } from '../../shared/customSections/types';
import {
  type Scope, DEFAULT_SCOPE, scopeFootnote, scopeShortLabel,
  scopedDrilldown, scopedTrendSprint, scopedTeam, scopedDeveloperTrends, hasScopeData,
  applyHeadlineOverride, netScopeChange, formatNetScope,
} from './scope';

interface Props {
  report: any;
  liveReport: any;
  visibleProjectIds: number[];
  // Per-slide scope selection from the on-screen presentation, so the PDF is
  // WYSIWYG. Keyed by slide id ('overview', 'trends', 'drilldown-<projectId>').
  // Missing keys default to V2.
  slideScopes?: Record<string, Scope>;
  // Raw SP vs sprint-length-normalized view of the Velocity Trend chart, from
  // the on-screen toggle, so the PDF matches whatever the presenter selected.
  velocityViewMode?: 'raw' | 'normalized';
}

const CHART_COLORS = ['#1565c0', '#2e7d32', '#e65100', '#6a1b9a', '#00695c'];


// First name only — keeps the X-axis readable for larger teams.
const pdfFirstName = (full: string) => (full || '').trim().split(/\s+/)[0] || full;

// Grouped bar chart block for the static PDF. Used for Developer Velocity (SP),
// Reopen Ratio (%), and Carryover Ratio (%). One X-axis group per developer,
// one coloured bar per sprint, value labels on top, sprint legend at the bottom.
// Rows arrive already participation-filtered and label-ready from the shared
// developerParticipation helper, which is also what the on-screen slide uses —
// that is what keeps the PDF and the deck showing the same people. A sprint with
// no value plots as a 0-height bar but carries a blank label, so it stays
// distinguishable from a measured zero. Sized with a fixed-width Box +
// ResponsiveContainer so html2canvas captures it crisply.
function PdfBarChartBlock({
  title, caption, sprints, developers, globalMax, unit,
}: {
  title: string;
  caption?: string;
  sprints: SprintRef[];
  developers: MetricRow[];
  globalMax: number;
  unit: 'SP' | '%';
}) {
  if (sprints.length === 0 || developers.length === 0) return null;
  const dense = developers.length >= 6;
  // Same threshold as the on-screen chart so the two surfaces label identically.
  const showLabels = developers.length * sprints.length <= 20;
  const sprintLabels = sprints.map(s => shortenSprintName(s.sprintName));
  const data = developers.map(dev => {
    const row: Record<string, any> = { developer: pdfFirstName(dev.name) };
    sprints.forEach((s, i) => {
      row[sprintLabels[i]] = dev.valuesBySync[String(s.syncId)] ?? 0;
      row[sprintLabels[i] + LABEL_SUFFIX] = barLabelFor(dev, s.syncId, unit, showLabels);
    });
    return row;
  });
  const maxBarSize = dense ? 16 : 26;
  return (
    <Box sx={{ mb: 1, p: 0.75, border: '1px solid #eceff1', borderRadius: 0.5 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#37474f', mb: caption ? 0 : 0.25 }}>{title}</Typography>
      {caption && (
        <Typography sx={{ fontSize: 7, color: '#78909c', mb: 0.5, lineHeight: 1.3 }}>{caption}</Typography>
      )}
      <Box sx={{ width: '710px', height: dense ? 250 : 210 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 16, right: 12, left: -6, bottom: 4 }} barCategoryGap="22%" barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="developer" tick={{ fontSize: 9 }} interval={0} />
            <YAxis tick={{ fontSize: 9 }} domain={[0, globalMax > 0 ? globalMax : 'auto']} allowDecimals={false} />
            <Legend wrapperStyle={{ fontSize: 9 }} />
            {sprintLabels.map((label, i) => (
              <Bar
                key={label}
                dataKey={label}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                radius={[2, 2, 0, 0]}
                maxBarSize={maxBarSize}
                isAnimationActive={false}
              >
                {/* Always rendered — the unit and the density gate are both
                    baked into the precomputed label, so a measured zero prints
                    even on a dense chart. */}
                <LabelList
                  dataKey={label + LABEL_SUFFIX}
                  position="top"
                  style={{ fontSize: 8, fontWeight: 600, fill: '#546e7a' }}
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </Box>
    </Box>
  );
}

const healthChipColor = (h: string) => {
  if (h === 'Green') return '#2e7d32';
  if (h === 'Amber') return '#f57c00';
  if (h === 'Red') return '#c62828';
  return '#37474f';
};

const priorityBg = (p: string) => {
  if (p === 'CRITICAL' || p === 'HIGH') return '#c62828';
  if (p === 'MEDIUM') return '#f57c00';
  return '#616161';
};

// Plain styled pill — replaces MUI <Chip> in the PDF doc.
// html2canvas was occasionally failing to render text inside MuiChip-label
// (the inner span's color/text was not being captured), leaving solid-colored
// pills with no visible label. A flat <Box> with explicit styles avoids
// MUI's nested CSS structure and renders deterministically.
function Pill({ label, bg, sx }: { label: string; bg: string; sx?: any }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        bgcolor: bg,
        color: 'white',
        fontSize: 9,
        fontWeight: 700,
        px: '6px',
        py: '2px',
        borderRadius: '9px',
        lineHeight: 1.2,
        letterSpacing: 0.2,
        whiteSpace: 'nowrap',
        ...(sx || {}),
      }}
    >
      {label}
    </Box>
  );
}

// Renders "N/A" for a commitment-relative figure (Planned/Capacity) that's
// structurally absent for a Kanban/cadence project with no tracked commitment.
// Mirrors slides.tsx's naSpan() so the WYSIWYG PDF matches the on-screen page.
function naSpan() {
  return <Box component="span" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>N/A</Box>;
}

// Same rationale as slides.tsx's throughputOnlyProjectIds — Kanban/cadence
// projects with no tracked commitment have no plan to divide delivered SP by,
// so they're excluded from the Productivity % chart's legend/series here too.
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

function buildTrendData(report: any, visibleProjectIds: number[], field: 'velocity' | 'productivity' | 'defect' | 'reopen' | 'invalidReopen' | 'leakage' | 'prodBugs' | 'uatReopens', scope: Scope) {
  const trend = report.trendData || {};
  const labels: string[] = [];
  for (const pid of visibleProjectIds) {
    const arr = trend[String(pid)]?.sprints || [];
    for (const s of arr) if (!labels.includes(s.name)) labels.push(s.name);
  }
  return labels.map(label => {
    const row: any = { sprint: label };
    for (const pid of visibleProjectIds) {
      const proj = trend[String(pid)];
      if (!proj) continue;
      const hit = proj.sprints.find((s: any) => s.name === label);
      if (!hit) { row[proj.projectName] = null; continue; }
      const { metrics: sm, qualityMetrics: sq } = scopedTrendSprint(hit, scope);
      const name = proj.projectName;
      const setLabeled = (v: number | null, label: string) => {
        row[name] = v;
        row[`${name}__label`] = v == null ? '' : label;
      };
      if (field === 'velocity') row[name] = sm?.actual ?? null;
      else if (field === 'productivity') {
        let pct: number | null;
        if (sm?.productivityPct != null) pct = sm.productivityPct;
        else { const planned = sm?.planned || 0; const actual = sm?.actual || 0; pct = planned > 0 ? Math.round((actual / planned) * 100) : null; }
        setLabeled(pct, `${pct}% (${sm?.actual ?? 0}/${sm?.planned ?? 0})`);
      } else if (field === 'defect') {
        const pct = sq?.bugDensityPct ?? null;
        setLabeled(pct, `${pct}% (${sq?.validBugs ?? 0}/${sq?.storyPoints ?? 0})`);
        row[`${name}__bugs`] = sq?.validBugs ?? null;
      } else if (field === 'reopen') {
        const pct = sq?.reopenRatePct ?? null;
        setLabeled(pct, `${pct}% (${sq?.reopenedCount ?? 0}/${sq?.deliveredCount ?? 0})`);
      } else if (field === 'invalidReopen') {
        row[name] = sq?.invalidBugCount ?? sq?.invalidReopenCount ?? null;
      } else if (field === 'prodBugs') {
        // Production bugs WORKED in the sprint: stacked valid + invalid.
        const valid = sq?.prodBugsWorked ?? null;
        const invalid = sq?.prodBugsWorkedInvalid ?? null;
        row[name] = valid;
        row[`${name}__invalid`] = invalid;
        row[`${name}__vlabel`] = valid ? `${valid}` : '';
        row[`${name}__ilabel`] = invalid ? `${invalid}` : '';
      } else if (field === 'uatReopens') {
        row[name] = sq?.uatReopenedCount ?? null;
      } else {
        const pct = sq?.leakageRatePct ?? null;
        setLabeled(pct, `${pct}% (${sq?.bugsProd ?? 0}/${sq?.leakageBugsRaised ?? 0})`);
      }
    }
    return row;
  });
}

function projectNames(report: any, visibleProjectIds: number[]): string[] {
  return visibleProjectIds
    .map(pid => report.trendData?.[String(pid)]?.projectName)
    .filter(Boolean);
}

// Plain-text ticket list beneath a chart in the PDF: one row per project x sprint
// that has tickets. `keyField` selects the qualityMetrics key array.
function PdfTicketTable({ report, scope, keyField, label }: { report: any; scope: Scope; keyField: string; label: string }) {
  const trend = report.trendData || {};
  const pids = Object.keys(trend);
  const multi = pids.length > 1;
  const rows: Array<{ project: string; sprint: string; keys: string[] }> = [];
  for (const pid of pids) {
    const proj = trend[pid];
    if (!proj) continue;
    for (const s of (proj.sprints || [])) {
      const q = scopedTrendSprint(s, scope).qualityMetrics as any;
      const keys: string[] = q?.[keyField] ?? [];
      if (Array.isArray(keys) && keys.length) rows.push({ project: proj.projectName, sprint: s.name, keys });
    }
  }
  if (rows.length === 0) return null;
  return (
    <Box sx={{ mt: 0.75 }}>
      <Typography sx={{ fontSize: 9, fontWeight: 700, color: '#6b7a8f', mb: 0.25 }}>{label.toUpperCase()}</Typography>
      <Table size="small" sx={{ '& th, & td': { fontSize: 8, py: 0.2, px: 0.5, verticalAlign: 'top' } }}>
        <TableHead>
          <TableRow>
            {multi && <TableCell sx={{ fontWeight: 700 }}>Project</TableCell>}
            <TableCell sx={{ fontWeight: 700 }}>Sprint</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Tickets</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={`${row.project}-${row.sprint}-${i}`}>
              {multi && <TableCell>{row.project}</TableCell>}
              <TableCell>{shortenSprintName(row.sprint)}</TableCell>
              <TableCell>{row.keys.join(', ')}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

interface VelocityCapacityFlag {
  projectId: number;
  syncId: number;
  sprintName: string;
  reason: string;
}

// Per-project average delivered SP for the Velocity Trend average line, excluding
// presenter-flagged reduced-capacity sprints. Mirrors buildVelocityAverages in
// slides.tsx so the PDF matches the screen.
function buildVelocityAverages(report: any, visibleProjectIds: number[], scope: Scope): { projectName: string; mean: number }[] {
  const trend = report.trendData || {};
  const flags: VelocityCapacityFlag[] = Array.isArray(report.velocityCapacityFlags) ? report.velocityCapacityFlags : [];
  const out: { projectName: string; mean: number }[] = [];
  for (const pid of visibleProjectIds) {
    const proj = trend[String(pid)];
    if (!proj?.projectName) continue;
    const excluded = new Set(flags.filter(f => String(f.projectId) === String(pid)).map(f => String(f.syncId)));
    const values = (proj.sprints || [])
      .filter((s: any) => !excluded.has(String(s.syncId)))
      .map((s: any) => scopedTrendSprint(s, scope).metrics?.actual)
      .filter((v: any) => v != null && Number.isFinite(Number(v)))
      .map((v: any) => Number(v));
    if (values.length >= 2) {
      out.push({ projectName: proj.projectName, mean: Math.round(values.reduce((t: number, v: number) => t + v, 0) / values.length) });
    }
  }
  return out;
}

function velocityExclusionFootnote(report: any, visibleProjectIds: number[]): string {
  const trend = report.trendData || {};
  const flags: VelocityCapacityFlag[] = Array.isArray(report.velocityCapacityFlags) ? report.velocityCapacityFlags : [];
  const visible = new Set(visibleProjectIds.map(String));
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
// "normal" cadence. Mirrors sprintWorkingDaysBaseline in slides.tsx.
function sprintWorkingDaysBaseline(sprints: any[]): number | null {
  const days = (sprints || [])
    .map((s: any) => sprintWorkingDays(s?.startDate, s?.endDate))
    .filter((d: number | null): d is number => d != null && d > 0)
    .sort((a: number, b: number) => a - b);
  if (!days.length) return null;
  return days[Math.floor(days.length / 2)];
}

// Additive "Normalized" velocity series: scales each sprint's delivered SP to
// the project's usual sprint length so a shorter/longer sprint doesn't read as
// a productivity swing. Mirrors buildNormalizedVelocitySeries in slides.tsx.
function buildNormalizedVelocityData(report: any, visibleProjectIds: number[], scope: Scope) {
  const trend = report.trendData || {};
  const labels: string[] = [];
  for (const pid of visibleProjectIds) {
    const arr = trend[String(pid)]?.sprints || [];
    for (const s of arr) if (!labels.includes(s.name)) labels.push(s.name);
  }
  const baselineByPid = new Map<number, number | null>();
  for (const pid of visibleProjectIds) {
    baselineByPid.set(pid, sprintWorkingDaysBaseline(trend[String(pid)]?.sprints || []));
  }
  return labels.map(label => {
    const row: any = { sprint: label };
    for (const pid of visibleProjectIds) {
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

// Mirrors buildNormalizedVelocityAverages in slides.tsx.
function buildNormalizedVelocityAverages(report: any, visibleProjectIds: number[], scope: Scope): { projectName: string; mean: number }[] {
  const trend = report.trendData || {};
  const flags: VelocityCapacityFlag[] = Array.isArray(report.velocityCapacityFlags) ? report.velocityCapacityFlags : [];
  const out: { projectName: string; mean: number }[] = [];
  for (const pid of visibleProjectIds) {
    const proj = trend[String(pid)];
    if (!proj?.projectName) continue;
    const excluded = new Set(flags.filter(f => String(f.projectId) === String(pid)).map(f => String(f.syncId)));
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
      out.push({ projectName: proj.projectName, mean: Math.round(values.reduce((t: number, v: number) => t + v, 0) / values.length) });
    }
  }
  return out;
}

// Mirrors velocityNormalizationFootnote in slides.tsx.
function velocityNormalizationFootnote(report: any, visibleProjectIds: number[], scope: Scope): string {
  const trend = report.trendData || {};
  const parts: string[] = [];
  for (const pid of visibleProjectIds) {
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

function graphNote(report: any, chartId: string): string | null {
  const note = report?.graphNotes?.[chartId];
  return typeof note === 'string' && note.trim() ? note.trim() : null;
}

function PdfGraphNote({ report, chartId }: { report: any; chartId: string }) {
  const note = graphNote(report, chartId);
  if (!note) return null;
  return (
    <Typography sx={{ fontSize: 10, fontStyle: 'italic', fontWeight: 500, color: '#263238', mt: 0.3 }}>
      {note}
    </Typography>
  );
}

export const PortfolioPresentationPdfDocument = forwardRef<HTMLDivElement, Props>(function PortfolioPresentationPdfDocument(
  { report, liveReport, visibleProjectIds, slideScopes = {}, velocityViewMode = 'normalized' }, ref
) {
  const r = liveReport || report;
  const scopeOf = (slideId: string): Scope => slideScopes[slideId] ?? DEFAULT_SCOPE;
  const overviewScope = scopeOf('overview');
  const trendsScope = scopeOf('trends');
  const drilldownScope = (d: any): Scope => scopeOf(`drilldown-${d.projectId ?? d.projectName}`);
  const highlights = r.keyHighlights || {};
  const drilldown: any[] = (r.perProjectDrilldown || []).filter((d: any) => visibleProjectIds.includes(d.projectId));
  // Current Sprint (in-flight) card visibility. Multi-project presentations
  // always show it; single-project honors the per-presentation 'current-sprint'
  // setting in hiddenCharts (default shown).
  const multiProject = (r.perProjectDrilldown?.length ?? 0) > 1;
  const showInFlight = multiProject || !isChartHidden(r.hiddenCharts, 'current-sprint');
  const risks: any[] = r.risks || [];
  const actionItems: any[] = r.actionItemsSnapshot || [];
  // Technical Recommendations can be switched off per presentation (Step 4).
  // Stored in hiddenCharts under 'tech-recommendations'; absent means shown.
  const techRecs: string[] = isChartHidden(r.hiddenCharts, 'tech-recommendations')
    ? []
    : (r.techRecommendations || []);
  const discussion: string[] = r.discussionPoints || [];
  const milestones: any[] = r.milestones || [];
  const momContent: string = r.momContent || '';
  const momAccepted: boolean = r.momStatus === 'accepted';
  const momLockedAt: string | null = r.lockedAt || null;

  // Mirrors the slide's gate: normalization only takes effect when at least one
  // visible sprint would actually be scaled. Otherwise the slide hides the
  // toggle and shows the raw view, so the PDF must drop the "Normalized" badge
  // too rather than labelling an unscaled chart.
  const velocityNormalized = velocityViewMode === 'normalized'
    && velocityNormalizationFootnote(r, visibleProjectIds, trendsScope) !== '';
  const velocityData = velocityNormalized
    ? buildNormalizedVelocityData(r, visibleProjectIds, trendsScope)
    : buildTrendData(r, visibleProjectIds, 'velocity', trendsScope);
  // Kanban/cadence projects with no tracked commitment have no plan to divide
  // delivered SP by — omitted from the Productivity % chart entirely (their SP
  // already renders on Velocity), matching the on-screen slide (slides.tsx).
  const productivityThroughputIds = throughputOnlyProjectIds(r, visibleProjectIds, trendsScope);
  const productivityProjectIds = visibleProjectIds.filter(pid => !productivityThroughputIds.has(pid));
  const productivityNames = projectNames(r, productivityProjectIds);
  const productivityOmittedNames = projectNames(r, visibleProjectIds).filter((_, i) => productivityThroughputIds.has(visibleProjectIds[i]));
  const productivityData = buildTrendData(r, productivityProjectIds, 'productivity', trendsScope);
  const defectData = buildTrendData(r, visibleProjectIds, 'defect', trendsScope);
  const reopenData = buildTrendData(r, visibleProjectIds, 'reopen', trendsScope);
  const invalidReopenData = buildTrendData(r, visibleProjectIds, 'invalidReopen', trendsScope);
  const leakageData = buildTrendData(r, visibleProjectIds, 'leakage', trendsScope);
  const prodBugsData = buildTrendData(r, visibleProjectIds, 'prodBugs', trendsScope);
  const uatReopensData = buildTrendData(r, visibleProjectIds, 'uatReopens', trendsScope);
  const names = projectNames(r, visibleProjectIds);

  return (
    <Box
      ref={ref}
      sx={{
        position: 'absolute',
        left: -99999,
        top: 0,
        width: '794px',
        bgcolor: 'white',
        color: '#1a2332',
        fontFamily: 'Arial, sans-serif',
        px: 3, py: 3,
      }}
    >
      {/* Header */}
      <Box sx={{ bgcolor: '#0d1b2e', color: 'white', p: 2.5, borderRadius: 1, mb: 2 }}>
        <Typography sx={{ fontSize: 11, letterSpacing: 1, opacity: 0.7 }}>DELIVERY PRESENTATION</Typography>
        <Typography sx={{ fontSize: 22, fontWeight: 700, mt: 0.5 }}>{r.title}</Typography>
        <Typography sx={{ fontSize: 12, mt: 0.5, opacity: 0.85 }}>
          {r.account?.name ? `Account: ${r.account.name}  ·  ` : ''}
          Period: {dayjs(r.startDate).format('DD MMM YYYY')} → {dayjs(r.endDate).format('DD MMM YYYY')}  ·  Meeting: {r.meetingDate ? dayjs(r.meetingDate).format('DD MMM YYYY') : '—'}
        </Typography>
        <Box sx={{ mt: 1.25 }}>
          <Pill label={r.health} bg={healthChipColor(r.health)} sx={{ fontSize: 11, px: '10px', py: '3px' }} />
        </Box>
      </Box>

      {/* Executive Summary */}
      {highlights.summary && (
        <Box data-pdf-block="true" sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1565c0', mb: 0.5 }}>EXECUTIVE SUMMARY</Typography>
          <RichTextView value={highlights.summary} sx={{ fontSize: 11, lineHeight: 1.6 }} />
        </Box>
      )}

      {/* Projects Overview */}
      {drilldown.length > 0 && (() => {
        const anyWsr = drilldown.some((d: any) => d?.sprintMetrics?.dataSource === 'wsr');
        const anyPerf = drilldown.some((d: any) => d?.sprintMetrics?.dataSource === 'perf');
        return (
          <Box data-pdf-block="true" sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#1565c0', mb: 0.75 }}>PROJECTS OVERVIEW</Typography>
            {/* width: '100%' + tableLayout: 'fixed' guarantees the table
                obeys the container width regardless of content size. Tight
                cell padding (px: 0.5) reclaims ~200px across 9 columns.
                Abbreviated headers (Plan SP / Del SP / Spill / Scope) and
                shortened sprint labels (4.2 + 5.1 instead of "MAV 2026 Sprint
                4.2 + MAV 2026 Sprint 5.1") keep individual cells narrow. */}
            <Table size="small" sx={{ width: '100%', tableLayout: 'fixed', '& td, & th': { px: 0.5, py: 0.5, wordBreak: 'break-word' } }}>
              <TableHead>
                <TableRow sx={{ bgcolor: '#eef3fa' }}>
                  <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Project</TableCell>
                  <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="center">RAG</TableCell>
                  <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Sprint / Window</TableCell>
                  {anyPerf ? (
                    <>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Plan SP</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Del SP</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Spill</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Net Scope</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Reopens</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Bugs</TableCell>
                    </>
                  ) : anyWsr ? (
                    <>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Tickets Done</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Avg Active</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Max Blocked</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Planned</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Actual</TableCell>
                      <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">Defect %</TableCell>
                    </>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {drilldown.map((d, i) => {
                  const isWsr = d?.sprintMetrics?.dataSource === 'wsr';
                  const isPerf = d?.sprintMetrics?.dataSource === 'perf';
                  const { m: smf, q: sqf } = scopedDrilldown(d, overviewScope);
                  // High-level totals reflect manual per-scope overrides (charts/tables stay factual).
                  const { m: sm, q: sq } = applyHeadlineOverride(smf, sqf, d.metricsOverrideByScope?.[overviewScope]);
                  const isInFlightOnly = !!d?.noCompletedSprintInWindow;
                  const blank = isInFlightOnly ? '—' : null;
                  return (
                    <TableRow key={i}>
                      <TableCell sx={{ fontSize: 10 }}>
                        {d.projectName}
                        {isInFlightOnly && (
                          <Box component="span" sx={{ ml: 0.5 }}>
                            <Pill label="In Progress" bg="#1976d2" sx={{ fontSize: 8 }} />
                          </Box>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        {(() => {
                          const eff = d.healthOverride ?? d.health ?? 'Green';
                          return <Pill label={eff} bg={healthChipColor(eff)} />;
                        })()}
                      </TableCell>
                      <TableCell sx={{ fontSize: 10 }}>
                        {/* Strip "MAV 2026 Sprint" / similar prefix from each
                            sprint label so the cell stays narrow. The sprintName
                            is a " + "-joined list when the window covers ≥2
                            sprints — split, shorten each, rejoin. */}
                        {(d.sprintName || '').split(' + ').map(shortenSprintName).join(' + ')}
                      </TableCell>
                      {anyPerf ? (
                        <>
                          <TableCell sx={{ fontSize: 10 }} align="right">{blank ?? (isPerf ? (sm.planned != null ? sm.planned : naSpan()) : '—')}</TableCell>
                          <TableCell sx={{ fontSize: 10 }} align="right">{blank ?? (isPerf ? (sm.actual ?? 0) : '—')}</TableCell>
                          <TableCell sx={{ fontSize: 10 }} align="right">{blank ?? (isPerf ? `${sm.spillovers ?? 0}/${sm.spilloverCount ?? 0}` : '—')}</TableCell>
                          <TableCell sx={{ fontSize: 10 }} align="right">{blank ?? (isPerf ? formatNetScope(netScopeChange(sm).net) : '—')}</TableCell>
                          <TableCell sx={{ fontSize: 10 }} align="right">{blank ?? (isPerf ? `${sm.reopenedCount ?? 0} (${sm.reopenRatePct ?? 0}%)` : '—')}</TableCell>
                          <TableCell sx={{ fontSize: 10 }} align="right">{blank ?? (isPerf ? (sq.validBugs ?? 0) : '—')}</TableCell>
                        </>
                      ) : anyWsr ? (
                        <>
                          <TableCell sx={{ fontSize: 10 }} align="right">{isWsr ? (sm.ticketsCompleted ?? 0) : (sm.actual ?? '—')}</TableCell>
                          <TableCell sx={{ fontSize: 10 }} align="right">{isWsr ? (sm.avgActiveTickets ?? 0) : '—'}</TableCell>
                          <TableCell sx={{ fontSize: 10 }} align="right">{isWsr ? (sm.maxBlockedTickets ?? 0) : '—'}</TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell sx={{ fontSize: 10 }} align="right">{sm.planned ?? '—'}</TableCell>
                          <TableCell sx={{ fontSize: 10 }} align="right">{sm.actual ?? '—'}</TableCell>
                          <TableCell sx={{ fontSize: 10 }} align="right">{sq.bugDensityPct ?? '—'}</TableCell>
                        </>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <Typography sx={{ fontSize: 9, color: '#6b7a8f', mt: 0.5 }}>
              {anyPerf && drilldown.some(hasScopeData) && `${scopeFootnote(overviewScope)} `}
              {anyPerf && 'Plan SP / Del SP = Planned / Delivered story points. Spill is shown as "SP/tickets". Net Scope = SP added − SP removed mid-sprint. Reopens include rate % of delivered. Delivered, reopen and bug figures match the Board View at the selected scope.'}
              {anyWsr && !anyPerf && 'Weekly Status Report projects show weekly ticket throughput, not story-point commitments.'}
            </Typography>
          </Box>
        );
      })()}

      {/* Achievements */}
      {(highlights.achievements || []).length > 0 && (
        <Box data-pdf-block="true" sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#2e7d32', mb: 0.5 }}>KEY ACHIEVEMENTS</Typography>
          {highlights.achievements.map((a: string, i: number) => (
            <Typography key={i} sx={{ fontSize: 11, mb: 0.25 }}>✓ {a}</Typography>
          ))}
        </Box>
      )}

      {/* Blockers + Risks */}
      {((highlights.blockers || []).length > 0 || risks.length > 0) && (
        <Box data-pdf-block="true" sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#b71c1c', mb: 0.5 }}>BLOCKERS & RISKS</Typography>
          {(highlights.blockers || []).map((b: string, i: number) => (
            <Typography key={`b-${i}`} sx={{ fontSize: 11, mb: 0.25 }}>⚠ {b}</Typography>
          ))}
          {risks.length > 0 && (
            <Table size="small" sx={{ mt: 0.5 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: '#fbe9e7' }}>
                  <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Priority</TableCell>
                  <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Project</TableCell>
                  <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Title</TableCell>
                  <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {risks.map((x, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Pill label={x.priority || '—'} bg={priorityBg(x.priority)} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{x.projectName}</TableCell>
                    <TableCell sx={{ fontSize: 10 }}>
                      <Typography sx={{ fontSize: 10, fontWeight: 600 }}>{x.title}</Typography>
                      {x.description && (
                        <Typography sx={{ fontSize: 9, color: '#555', mt: 0.25 }}>{x.description}</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{x.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Box>
      )}

      {/* Action Items */}
      {actionItems.length > 0 && (
        <Box data-pdf-block="true" sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#6a1b9a', mb: 0.5 }}>ACTION ITEMS</Typography>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f3e5f5' }}>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Scope</TableCell>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Project</TableCell>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Title</TableCell>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Owner</TableCell>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Due</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {actionItems.map((a, i) => (
                <TableRow key={i}>
                  <TableCell sx={{ fontSize: 10 }}>{a.source}</TableCell>
                  <TableCell sx={{ fontSize: 10 }}>{a.projectName}</TableCell>
                  <TableCell sx={{ fontSize: 10 }}>{a.title}</TableCell>
                  <TableCell sx={{ fontSize: 10 }}>{a.owner}</TableCell>
                  <TableCell sx={{ fontSize: 10 }}>{a.status}</TableCell>
                  <TableCell sx={{ fontSize: 10 }}>{a.dueDate || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {/* Tech Recs */}
      {techRecs.length > 0 && (
        <Box data-pdf-block="true" sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#00695c', mb: 0.5 }}>TECH RECOMMENDATIONS</Typography>
          {techRecs.map((t, i) => (
            <Typography key={i} sx={{ fontSize: 11, mb: 0.25 }}>{i + 1}. {t}</Typography>
          ))}
        </Box>
      )}

      {/* Milestones */}
      {milestones.length > 0 && (
        <Box data-pdf-block="true" sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#ef6c00', mb: 0.5 }}>MILESTONES</Typography>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#fff3e0' }}>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Project</TableCell>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Milestone</TableCell>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }} align="right">%</TableCell>
                <TableCell sx={{ fontSize: 10, fontWeight: 700 }}>ETA</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {milestones.map((m, i) => (
                <TableRow key={i}>
                  <TableCell sx={{ fontSize: 10 }}>{m.projectName || '—'}</TableCell>
                  <TableCell sx={{ fontSize: 10 }}>{m.milestone}</TableCell>
                  <TableCell sx={{ fontSize: 10 }}>{m.status}</TableCell>
                  <TableCell sx={{ fontSize: 10 }} align="right">{m.percentComplete}%</TableCell>
                  <TableCell sx={{ fontSize: 10 }}>{m.eta}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {/* Delivery trend chart — titled by data source */}
      {velocityData.length > 0 && !isChartHidden(r.hiddenCharts, 'velocity-trend') && (() => {
        // "all WSR", not "any" -- this chart's data is already project-name-keyed
        // and plots a mixed deck fine; the title should only say "throughput"
        // when that's true for literally everything shown. See the matching fix
        // (and its full rationale) in slides.tsx's allTrendsFromWsr.
        const trendEntries = Object.entries(r.trendData || {}).filter(([pid]) => visibleProjectIds.includes(Number(pid)));
        const anyTrendWsr = trendEntries.length > 0 && trendEntries.every(([, t]: [string, any]) => t?.dataSource === 'wsr');
        const anyTrendScoped = Object.values(r.trendData || {}).some((t: any) =>
          (t?.sprints || []).some((s: any) => s?.metricsByScope?.v2 && s?.metricsByScope?.overall));
        const averages = velocityNormalized
          ? buildNormalizedVelocityAverages(r, visibleProjectIds, trendsScope)
          : buildVelocityAverages(r, visibleProjectIds, trendsScope);
        const avgByName = new Map(averages.map(a => [a.projectName, a.mean]));
        const exclusionNote = velocityExclusionFootnote(r, visibleProjectIds);
        const normalizationNote = velocityNormalized ? velocityNormalizationFootnote(r, visibleProjectIds, trendsScope) : '';
        // On-chart dashed average line only for a single project; otherwise list the
        // averages in the caption so multiple projects don't overlap into clutter.
        const singleProject = names.length === 1;
        const averagesNote = !anyTrendWsr && averages.length
          ? (singleProject
              ? `Dashed line is the average of the sprints shown (avg ${averages[0].mean}).`
              : `Averages over the sprints shown — ${averages.map(a => `${a.projectName} ${a.mean}`).join(', ')}.`)
          : '';
        return (
          <Box data-pdf-block="true" sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0277bd', mb: 0.5 }}>
              {anyTrendWsr ? 'WEEKLY THROUGHPUT — TICKETS COMPLETED' : 'VELOCITY TREND'}
              {!anyTrendWsr && anyTrendScoped && (
                <Box component="span" sx={{ fontSize: 9, fontWeight: 700, color: '#6b7a8f', ml: 1 }}>
                  · Scope: {scopeShortLabel(trendsScope)}
                </Box>
              )}
              {!anyTrendWsr && velocityNormalized && (
                <Box component="span" sx={{ fontSize: 9, fontWeight: 700, color: '#6b7a8f', ml: 1 }}>
                  · Normalized to full sprint length
                </Box>
              )}
            </Typography>
            <Box sx={{ width: '710px', height: 260 }}>
              <ResponsiveContainer>
                <LineChart data={velocityData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="sprint" style={{ fontSize: 10 }} tickFormatter={shortenSprintName} interval={0} />
                  <YAxis style={{ fontSize: 10 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
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
                        label={{ value: `avg ${mean}`, position: 'insideTopRight', fill: color, fontSize: 10, fontWeight: 700 }}
                      />
                    ) : null;
                  })}
                  {names.map((name, idx) => (
                    <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={2} isAnimationActive={false}>
                      <LabelList dataKey={name} position="top" style={{ fontSize: 9, fontWeight: 600 }} />
                    </Line>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Box>
            <PdfGraphNote report={r} chartId="velocity-trend" />
            {averagesNote && (
              <Box sx={{ mt: 0.5, px: 0.75, py: 0.4, bgcolor: '#eef2f6', borderLeft: '3px solid #0277bd', borderRadius: '2px' }}>
                <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: '#0277bd' }}>{averagesNote}</Typography>
              </Box>
            )}
            {exclusionNote && (
              <Typography sx={{ fontSize: 9, color: '#6b7a8f', mt: 0.3 }}>{exclusionNote}</Typography>
            )}
            {normalizationNote && (
              <Typography sx={{ fontSize: 9, color: '#6b7a8f', mt: 0.3 }}>{normalizationNote}</Typography>
            )}
          </Box>
        );
      })()}

      {(() => {
        // Was any() over ALL projects -- one visible project with no perf sync
        // (e.g. a Kanban project with nothing synced yet) suppressed these
        // charts for every OTHER visible project too, discarding real data.
        // Only collapse when every visible project is WSR-sourced; a partial
        // mix instead renders normally (each chart's data is already
        // project-name-keyed and simply carries no series for the WSR ones)
        // plus a footnote naming which projects are missing. Mirrors the fix
        // in slides.tsx's allTrendsFromWsr / PartialWsrNotice.
        const trendEntries = Object.entries(r.trendData || {}).filter(([pid]) => visibleProjectIds.includes(Number(pid)));
        const wsrEntries = trendEntries.filter(([, t]: [string, any]) => t?.dataSource === 'wsr');
        const anyTrendWsr = trendEntries.length > 0 && wsrEntries.length === trendEntries.length;
        if (anyTrendWsr) return null;
        const partialWsrNames = wsrEntries.map(([, t]: [string, any]) => t?.projectName).filter(Boolean);
        return (
          <>
            {productivityData.length > 0 && !isChartHidden(r.hiddenCharts, 'productivity') && !isKanbanPresentation(r, visibleProjectIds) && (
              <Box data-pdf-block="true" sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0277bd', mb: 0.5 }}>PRODUCTIVITY %</Typography>
                <Box sx={{ width: '710px', height: 220 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={productivityData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="sprint" style={{ fontSize: 10 }} tickFormatter={shortenSprintName} interval={0} />
                      <YAxis style={{ fontSize: 10 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {productivityNames.map((name, idx) => (
                        <Bar key={name} dataKey={name} fill={CHART_COLORS[idx % CHART_COLORS.length]} isAnimationActive={false}>
                          <LabelList dataKey={`${name}__label`} position="top" style={{ fontSize: 9, fontWeight: 600 }} />
                        </Bar>
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <PdfGraphNote report={r} chartId="productivity" />
                {productivityOmittedNames.length > 0 && (
                  <Typography sx={{ fontSize: 9, color: 'text.secondary', mt: 0.25 }}>
                    {productivityOmittedNames.join(', ')} {productivityOmittedNames.length === 1 ? 'has' : 'have'} no tracked commitment, so no plan % applies — see Velocity for delivered SP.
                  </Typography>
                )}
              </Box>
            )}

            {defectData.length > 0 && !isChartHidden(r.hiddenCharts, 'defect-density') && (
              <Box data-pdf-block="true" sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#e65100', mb: 0.5 }}>DEFECT DENSITY %</Typography>
                <Box sx={{ width: '710px', height: 220 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={defectData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="sprint" style={{ fontSize: 10 }} tickFormatter={shortenSprintName} interval={0} />
                      <YAxis style={{ fontSize: 10 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {names.map((name, idx) => (
                        <Area key={name} type="monotone" dataKey={name}
                          stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                          fill={CHART_COLORS[idx % CHART_COLORS.length]} fillOpacity={0.3} isAnimationActive={false}>
                          <LabelList dataKey={`${name}__label`} position="top" style={{ fontSize: 9, fontWeight: 600 }} />
                        </Area>
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <PdfGraphNote report={r} chartId="defect-density" />
              </Box>
            )}
            {reopenData.length > 0 && !isChartHidden(r.hiddenCharts, 'reopen-ratio') && (
              <Box data-pdf-block="true" sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#e65100', mb: 0.5 }}>REOPEN RATIO %</Typography>
                <Box sx={{ width: '710px', height: 220 }}>
                  <ResponsiveContainer>
                    <LineChart data={reopenData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="sprint" style={{ fontSize: 10 }} tickFormatter={shortenSprintName} interval={0} />
                      <YAxis style={{ fontSize: 10 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {names.map((name, idx) => (
                        <Line key={name} type="monotone" dataKey={name} stroke={CHART_COLORS[idx % CHART_COLORS.length]} strokeWidth={2} dot connectNulls isAnimationActive={false}>
                          <LabelList dataKey={`${name}__label`} position="top" style={{ fontSize: 9, fontWeight: 600 }} />
                        </Line>
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
                <PdfGraphNote report={r} chartId="reopen-ratio" />
              </Box>
            )}
            {invalidReopenData.length > 0 && !isChartHidden(r.hiddenCharts, 'invalid-reopens') && (
              <Box data-pdf-block="true" sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#b71c1c', mb: 0.5 }}>INVALID BUGS (COUNT)</Typography>
                <Box sx={{ width: '710px', height: 220 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={invalidReopenData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="sprint" style={{ fontSize: 10 }} tickFormatter={shortenSprintName} interval={0} />
                      <YAxis style={{ fontSize: 10 }} allowDecimals={false} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {names.map((name, idx) => (
                        <Bar key={name} dataKey={name} fill={CHART_COLORS[idx % CHART_COLORS.length]} isAnimationActive={false}>
                          <LabelList dataKey={name} position="top" formatter={(v: any) => (v == null || v === 0) ? '' : `${v}`} style={{ fontSize: 9, fontWeight: 600 }} />
                        </Bar>
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <PdfGraphNote report={r} chartId="invalid-reopens" />
              </Box>
            )}
            {leakageData.length > 0 && !isChartHidden(r.hiddenCharts, 'defect-leakage') && (
              <Box data-pdf-block="true" sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#e65100', mb: 0.5 }}>DEFECT LEAKAGE %</Typography>
                <Box sx={{ width: '710px', height: 220 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={leakageData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="sprint" style={{ fontSize: 10 }} tickFormatter={shortenSprintName} interval={0} />
                      <YAxis style={{ fontSize: 10 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {names.map((name, idx) => (
                        <Area key={name} type="monotone" dataKey={name}
                          stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                          fill={CHART_COLORS[idx % CHART_COLORS.length]} fillOpacity={0.3} connectNulls isAnimationActive={false}>
                          <LabelList dataKey={`${name}__label`} position="top" style={{ fontSize: 9, fontWeight: 600 }} />
                        </Area>
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <PdfGraphNote report={r} chartId="defect-leakage" />
                <PdfTicketTable report={r} scope={trendsScope} keyField="prodBugKeys" label="Production bugs logged (leakage)" />
              </Box>
            )}
            {prodBugsData.length > 0 && !isChartHidden(r.hiddenCharts, 'prod-bugs-count') && (
              <Box data-pdf-block="true" sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#b71c1c', mb: 0.5 }}>PRODUCTION BUGS WORKED (VALID + INVALID)</Typography>
                <Box sx={{ width: '710px', height: 220 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={prodBugsData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="sprint" style={{ fontSize: 10 }} tickFormatter={shortenSprintName} interval={0} />
                      <YAxis style={{ fontSize: 10 }} allowDecimals={false} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {names.map((name, idx) => [
                        <Bar key={`${name}-v`} dataKey={name} name={name} stackId={name} fill={CHART_COLORS[idx % CHART_COLORS.length]} isAnimationActive={false}>
                          <LabelList dataKey={`${name}__vlabel`} position="top" style={{ fontSize: 9, fontWeight: 600 }} />
                        </Bar>,
                        <Bar key={`${name}-i`} dataKey={`${name}__invalid`} name={names.length > 1 ? `${name} · invalid` : 'Invalid (Bad Data / Invalid Bug)'} stackId={name} fill="#e57373" isAnimationActive={false}>
                          <LabelList dataKey={`${name}__ilabel`} position="top" style={{ fontSize: 9, fontWeight: 600, fill: '#c62828' }} />
                        </Bar>,
                      ])}
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <PdfGraphNote report={r} chartId="prod-bugs-count" />
                <PdfTicketTable report={r} scope={trendsScope} keyField="prodBugsWorkedKeys" label="Production bugs worked (valid)" />
                <PdfTicketTable report={r} scope={trendsScope} keyField="prodBugsWorkedInvalidKeys" label="Invalid production bugs (Bad Data / Invalid Bug)" />
              </Box>
            )}
            {uatReopensData.length > 0 && !isChartHidden(r.hiddenCharts, 'uat-reopens-count') && (
              <Box data-pdf-block="true" sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#4a148c', mb: 0.5 }}>UAT REOPENS (COUNT)</Typography>
                <Box sx={{ width: '710px', height: 220 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={uatReopensData} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="sprint" style={{ fontSize: 10 }} tickFormatter={shortenSprintName} interval={0} />
                      <YAxis style={{ fontSize: 10 }} allowDecimals={false} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      {names.map((name, idx) => (
                        <Bar key={name} dataKey={name} fill={CHART_COLORS[idx % CHART_COLORS.length]} isAnimationActive={false}>
                          <LabelList dataKey={name} position="top" formatter={(v: any) => (v == null || v === 0) ? '' : `${v}`} style={{ fontSize: 9, fontWeight: 600 }} />
                        </Bar>
                      ))}
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
                <PdfGraphNote report={r} chartId="uat-reopens-count" />
                <PdfTicketTable report={r} scope={trendsScope} keyField="uatReopenedKeys" label="UAT-reopened tickets" />
              </Box>
            )}
            {partialWsrNames.length > 0 && (
              <Box data-pdf-block="true" sx={{ mb: 2, p: 1.2, bgcolor: '#fafafa' }}>
                <Typography sx={{ fontSize: 9, color: '#6b7a8f' }}>
                  Productivity, Defect Density and Developer Velocity are not shown for {partialWsrNames.join(', ')}
                  {partialWsrNames.length === 1 ? ' — no' : ' — neither has a'} synced Kanban span or Jira sprint yet.
                  The Weekly Throughput chart above still includes {partialWsrNames.length === 1 ? 'it' : 'them'}.
                </Typography>
              </Box>
            )}
          </>
        );
      })()}

      {/* Optional Team Capacity table — shown when enabled and populated. */}
      {!isChartHidden(r.hiddenCharts, 'team-capacity') && Array.isArray(r.teamCapacityRows) && r.teamCapacityRows.length > 0 && (
        <Box data-pdf-block="true" sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#455a64', mb: 0.5 }}>TEAM CAPACITY</Typography>
          <Table size="small" sx={{ '& th, & td': { fontSize: 9, py: 0.4 } }}>
            <TableHead>
              <TableRow sx={{ bgcolor: '#eceff1' }}>
                <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{r.teamCapacityRows.some((x: any) => x.workingDays != null) ? 'Cycle' : 'Sprint'}</TableCell>
                {r.teamCapacityRows.some((x: any) => x.workingDays != null) && <TableCell align="center" sx={{ fontWeight: 700 }}>Working Days</TableCell>}
                <TableCell align="center" sx={{ fontWeight: 700 }}>Planned Leaves</TableCell>
                <TableCell align="center" sx={{ fontWeight: 700 }}>Unplanned Leaves</TableCell>
                {r.teamCapacityRows.some((x: any) => x.workingDays != null) && <TableCell align="center" sx={{ fontWeight: 700 }}>Available Days</TableCell>}
                <TableCell align="center" sx={{ fontWeight: 700 }}>Story Points Delivered</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {r.teamCapacityRows.map((row: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>{row.name || '—'}</TableCell>
                  <TableCell>{row.sprint || '—'}</TableCell>
                  {r.teamCapacityRows.some((x: any) => x.workingDays != null) && <TableCell align="center">{row.workingDays ?? '—'}</TableCell>}
                  <TableCell align="center">{row.plannedLeaves ?? '—'}</TableCell>
                  <TableCell align="center">{row.unplannedLeaves ?? '—'}</TableCell>
                  {r.teamCapacityRows.some((x: any) => x.workingDays != null) && <TableCell align="center">{row.workingDays == null ? '—' : Math.max(0, (row.workingDays ?? 0) - (row.plannedLeaves ?? 0) - (row.unplannedLeaves ?? 0))}</TableCell>}
                  <TableCell align="center">{row.storyPointsDelivered ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {/* Additional Insights — user-defined custom tables / charts, paginated by
          grid footprint (paginateSections) so the PDF pages match the on-screen
          slides exactly. Each page is one atomic block; multi-page runs force a
          page break before every page. */}
      {(() => {
        const all: any[] = Array.isArray(r.customSections) ? r.customSections : [];
        if (all.length === 0) return null;
        const pages = paginateSections(all);
        return pages.map((pageSections, idx) => (
          <Box
            key={idx}
            data-pdf-block="true"
            {...(pages.length > 1 ? { 'data-pdf-page-break-before': 'always' } : {})}
          >
            <CustomSectionsPdfBlock
              sections={pageSections}
              heading={pages.length > 1 ? `Additional Insights (${idx + 1} of ${pages.length})` : 'Additional Insights'}
            />
          </Box>
        ));
      })()}

      {/* Drill-down blocks — per-developer Velocity / Reopen / Carryover
          sparklines now live INSIDE each project's drilldown (see below) so
          each project's data has its own breathing room. */}
      {drilldown.map((d, i) => {
        const effHealth = d.healthOverride ?? d.health ?? 'Green';
        const dScope = drilldownScope(d);
        // `m`/`q` = facts (per-sprint breakdown, team, charts). `mEd`/`qEd` layer the
        // manual per-scope overrides for the high-level Delivery summary only.
        const { m, q } = scopedDrilldown(d, dScope);
        const { m: mEd, q: qEd } = applyHeadlineOverride(m, q, d.metricsOverrideByScope?.[dScope]);
        const isWsr = m.dataSource === 'wsr';
        const isPerf = m.dataSource === 'perf';
        const perSprint: any[] = Array.isArray(m.perSprint) ? m.perSprint : [];
        const { team, teamBySprint: teamBySprintScoped } = scopedTeam(d, dScope);
        const teamBySprintArr: any[] = Array.isArray(teamBySprintScoped) ? teamBySprintScoped : [];
        const useTeamSplit = teamBySprintArr.length > 1
            && teamBySprintArr.some((s: any) => Array.isArray(s.team) && s.team.length > 0);
        const inFlight = d?.inFlightSprint || null;
        const noCompleted = !!d?.noCompletedSprintInWindow;
        // Range-mode "intended sprint not synced" — predecessor excluded for
        // marginal overlap; suppress empty tables and show a warning line.
        const coverageWarning: string | null = d?.windowCoverageWarning || null;
        const suppressTables = noCompleted || !!coverageWarning;
        const sprintListLabel = perSprint.length > 0
            ? perSprint.map((p: any) => p.sprintName).join(' + ')
            : (d?.sprintName || '');
        return (
          <Paper key={i} variant="outlined" sx={{ mb: 1.5, p: 1.5, borderLeft: `4px solid ${healthChipColor(effHealth)}` }}>
            <Box data-pdf-block="true">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{d.projectName}</Typography>
                <Pill label={effHealth} bg={healthChipColor(effHealth)} />
                {noCompleted && (
                  <Pill label="In Progress" bg="#1976d2" />
                )}
                {coverageWarning && (
                  <Pill label="Sprint not synced" bg="#b45309" />
                )}
              </Box>
              <Typography sx={{ fontSize: 10, color: '#6b7a8f' }}>{d.sprintName}</Typography>
              <Typography sx={{ fontSize: 11, mt: 0.5, lineHeight: 1.5 }}>{d.narrative}</Typography>
              {isPerf && (
                <Typography sx={{ fontSize: 9, mt: 0.5, fontWeight: 700, color: '#37474f' }}>
                  {scopeFootnote(dScope)}
                </Typography>
              )}
            </Box>

            {inFlight && showInFlight && (() => {
              const isKanban = inFlight.type === 'kanban';
              const showSp = !isKanban;
              const lanes = inFlight.ticketsByLane || {};
              const pSp = inFlight.pipelineSP || {};
              const laneRows = [
                { label: 'TODO',        tickets: lanes.todo       || 0, sp: pSp.todo       || 0 },
                { label: 'In Progress', tickets: lanes.inProgress || 0, sp: pSp.inProgress || 0 },
                { label: 'In Review',   tickets: lanes.inReview   || 0, sp: pSp.review     || 0 },
                { label: 'QA',          tickets: lanes.qa         || 0, sp: pSp.qa         || 0 },
                { label: 'UAT',         tickets: lanes.uat        || 0, sp: pSp.uat        || 0 },
                { label: 'Blocked',     tickets: lanes.blocked    || 0, sp: pSp.blocked    || 0 },
                { label: 'Reopened',    tickets: lanes.reopened   || 0, sp: 0 },
                { label: 'Done',        tickets: lanes.done       || 0, sp: showSp ? (inFlight.deliveredSP || 0) : 0 },
              ].filter(r => r.tickets > 0 || (showSp && r.sp > 0));
              const reopenedTickets = inFlight.reopenedTickets ?? 0;
              const subBugsLogged = inFlight.subBugsLogged;
              const onTrack = (inFlight.onTrackStatus || '').toLowerCase();
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
              const scopeLabel: 'v2-sprint' | 'board' = inFlight.scopeLabel ?? (isKanban ? 'board' : 'v2-sprint');
              return (
                <Box data-pdf-block="true" sx={{ mt: 0.75, p: 1, border: '1px solid #cfd8dc', borderLeft: '3px solid #0277bd', borderRadius: '0 4px 4px 0' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.5 }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#0277bd' }}>
                      {isKanban ? 'Current Board Status' : 'Current Sprint'}
                    </Typography>
                    <Typography sx={{ fontSize: 10, fontWeight: 700 }}>
                      {isKanban ? (inFlight.boardName || '') : (inFlight.sprintName || '')}
                    </Typography>
                    {ragLabel && (
                      <Box component="span" sx={{
                        display: 'inline-block', px: '5px', py: 0,
                        fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4,
                        color: ragColor, border: `1px solid ${ragColor}`, borderRadius: '3px',
                      }}>{ragLabel.toUpperCase()}</Box>
                    )}
                    {!isKanban && inFlight.daysTotal != null && (
                      <Typography sx={{ fontSize: 9, color: '#6b7a8f' }}>
                        · Day {inFlight.daysElapsed} of {inFlight.daysTotal} ({inFlight.daysRemaining} days left)
                      </Typography>
                    )}
                  </Box>
                  {!isKanban && inFlight.snapshotDate && (
                    <Typography sx={{ fontSize: 9.5, mt: 0.25 }}>
                      <strong>Story Points (V2):</strong> Delivered {inFlight.deliveredSP}/{inFlight.plannedSP} ({inFlight.completionPctSP}%) · Remaining {inFlight.remainingSP}
                      {' · '}
                      <strong>Tickets (V2):</strong> Done {inFlight.ticketsCompleted}/{inFlight.ticketsTotal}
                      {inFlight.bugsRaised > 0 && (<> · <strong>Bugs:</strong> {inFlight.bugsRaised} ({inFlight.topLevelBugs} top-level + {inFlight.subBugsRaised} sub-bug)</>)}
                    </Typography>
                  )}
                  {!isKanban && !inFlight.snapshotDate && (
                    <Typography sx={{ fontSize: 10, fontStyle: 'italic', color: '#b45309', mt: 0.25 }}>
                      Current sprint data unavailable — last DSR didn't include this sprint.
                    </Typography>
                  )}
                  {laneRows.length > 0 && (
                    <Table size="small" sx={{ mt: 0.5 }}>
                      <TableHead>
                        <TableRow sx={{ bgcolor: '#f4f7fc' }}>
                          <TableCell sx={{ fontSize: 9, fontWeight: 700 }}>Lane</TableCell>
                          <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Tickets</TableCell>
                          {showSp && <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">SP</TableCell>}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {laneRows.map(r => (
                          <TableRow key={r.label}>
                            <TableCell sx={{ fontSize: 9 }}>{r.label}</TableCell>
                            <TableCell sx={{ fontSize: 9 }} align="right">{r.tickets}</TableCell>
                            {showSp && <TableCell sx={{ fontSize: 9 }} align="right">{r.sp}</TableCell>}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {(reopenedTickets > 0 || subBugsLogged != null) && (
                    <Typography sx={{ fontSize: 9, mt: 0.5 }}>
                      <strong>Quality:</strong>
                      {reopenedTickets > 0 && ` Reopened ${reopenedTickets} tkt${reopenedTickets === 1 ? '' : 's'}`}
                      {reopenedTickets > 0 && subBugsLogged != null && ' · '}
                      {subBugsLogged != null && `Sub-bugs logged ${subBugsLogged}`}
                    </Typography>
                  )}
                  {inFlight.snapshotDate && (
                    <Typography sx={{ fontSize: 9, fontStyle: 'italic', color: '#6b7a8f', mt: 0.5 }}>
                      Data as of {inFlight.snapshotDate}. Scope: {scopeLabel === 'v2-sprint' ? 'V2 team only.' : 'Whole board.'}
                      {isKanban ? ' Live board snapshot.' : ' Mid-sprint snapshot — values will change before sprint close.'}
                    </Typography>
                  )}
                </Box>
              );
            })()}

            {noCompleted && (
              <Typography sx={{ fontSize: 10, fontStyle: 'italic', color: '#6b7a8f', mt: 0.5 }}>
                No completed sprint in this window — only current sprint status shown above.
              </Typography>
            )}

            {coverageWarning && (
              <Typography sx={{ fontSize: 10, fontStyle: 'italic', color: '#b45309', mt: 0.5 }}>
                {coverageWarning}
              </Typography>
            )}

            {!suppressTables && isPerf && perSprint.length > 1 && (
              <Box data-pdf-block="true" sx={{ mt: 0.75 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 700, mb: 0.25 }}>Per-Sprint Breakdown</Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#f4f7fc' }}>
                      <TableCell sx={{ fontSize: 9, fontWeight: 700 }}>Sprint</TableCell>
                      <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Planned</TableCell>
                      <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Delivered</TableCell>
                      <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Spillover</TableCell>
                      <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Scope Added</TableCell>
                      <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Reopens</TableCell>
                      <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Bugs</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {perSprint.map((p: any, j: number) => (
                      <TableRow key={p.syncId ?? j}>
                        <TableCell sx={{ fontSize: 9 }}>{p.sprintName}</TableCell>
                        <TableCell sx={{ fontSize: 9 }} align="right">{p.planned != null ? p.planned : naSpan()}</TableCell>
                        <TableCell sx={{ fontSize: 9 }} align="right">{p.actual}</TableCell>
                        <TableCell sx={{ fontSize: 9 }} align="right">{p.spillovers}/{p.spilloverCount}</TableCell>
                        <TableCell sx={{ fontSize: 9 }} align="right">{p.scopeAddedSP}/{p.scopeAddedCount}</TableCell>
                        <TableCell sx={{ fontSize: 9 }} align="right">{p.reopenedCount} ({p.reopenRatePct}%)</TableCell>
                        <TableCell sx={{ fontSize: 9 }} align="right">{p.bugsRaised}/{p.prodBugsEscaped}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}

            {!suppressTables && (() => {
              // KPI grid mirroring the on-screen DrilldownSlide so the PDF matches
              // the app (WYSIWYG) instead of a dense run-on line. Bugs raised (QA)
              // is folded in as a cell (no separate Quality column). Edit-markers
              // are omitted here — the PDF is the customer-facing artifact.
              const sectionTitle = isPerf
                ? `${perSprint.length > 1 ? 'Combined Totals' : 'Delivery'}${sprintListLabel ? ` — ${sprintListLabel}` : ''}`
                : isWsr ? 'Delivery (Weekly)' : 'Metrics';
              const hasCommitment = mEd.metricKind !== 'throughput';
              const metrics: Array<{ label: string; value: string }> = isPerf
                ? [
                    { label: 'Capacity (SP planned)', value: mEd.capacity != null ? `${mEd.capacity}` : 'N/A' },
                    { label: 'Delivered (SP)', value: `${mEd.actual ?? 0}` },
                    { label: 'Delivered (tickets)', value: `${mEd.deliveredCount ?? 0}` },
                    ...(perSprint.length <= 1 ? [{
                      label: hasCommitment ? 'Spillover' : 'Still Open at Cycle End',
                      value: `${mEd.spillovers ?? 0} SP · ${mEd.spilloverCount ?? 0} tickets${mEd.spilloverPct != null ? ` (${mEd.spilloverPct}%)` : ''}`,
                    }] : []),
                    // Net Scope Change, matching the on-screen Delivery card. The
                    // add/removed breakdown goes inline — a PDF KPI cell renders a
                    // plain string, so there's no caption line to put it on.
                    (() => {
                      const { net, addedSP, removedSP, hasRemoved } = netScopeChange(mEd);
                      return {
                        label: 'Net Scope Change',
                        value: hasRemoved
                          ? `${formatNetScope(net)} SP (add ${addedSP} − removed ${removedSP})`
                          : `${formatNetScope(net)} SP (add ${addedSP} SP · ${mEd.scopeAddedCount ?? 0} tickets, ${mEd.scopeCreepPct ?? 0}%)`,
                      };
                    })(),
                    ...(mEd.reEstimatedSp != null ? [{ label: 'SP updated (mid-sprint)', value: `${mEd.reEstimatedSp > 0 ? '+' : ''}${mEd.reEstimatedSp} SP` }] : []),
                    { label: 'Reopens', value: `${mEd.reopenedCount ?? 0} (${mEd.reopenRatePct ?? 0}%)` },
                    { label: 'Bugs raised (QA)', value: `${qEd.validBugs ?? 0}` },
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
                <Box data-pdf-block="true" sx={{ mt: 1 }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, mb: 0.5 }}>{sectionTitle}</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', columnGap: 2, rowGap: 1 }}>
                    {metrics.map(mi => (
                      <Box key={mi.label}>
                        <Typography sx={{ fontSize: 8.5, color: '#6b7a8f' }}>{mi.label}</Typography>
                        <Typography sx={{ fontSize: 11, fontWeight: 700 }}>{mi.value}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            })()}

            {!suppressTables && isPerf && (() => {
              // Per-sprint team breakdown if available; otherwise fall back to
              // the aggregated `team`. Each table is wrapped in data-pdf-block
              // so the page-break-aware exporter doesn't split a sprint's team
              // table across pages.
              const teamHasCommitment = mEd.metricKind !== 'throughput';
              const renderTable = (key: string, title: string, members: any[]) => (
                <Box key={key} data-pdf-block="true" sx={{ mt: 1 }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, mb: 0.25 }}>{title}</Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#f4f7fc' }}>
                        <TableCell sx={{ fontSize: 9, fontWeight: 700 }}>Name</TableCell>
                        <TableCell sx={{ fontSize: 9, fontWeight: 700 }}>Role</TableCell>
                        <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">{teamHasCommitment ? 'Planned' : 'Still Open'}</TableCell>
                        <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Delivered</TableCell>
                        {teamHasCommitment && <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Spillover</TableCell>}
                        <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Reopens</TableCell>
                        <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Tested (SP)</TableCell>
                        <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">SP Deliv</TableCell>
                        <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Bugs</TableCell>
                        <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Invalid</TableCell>
                        <TableCell sx={{ fontSize: 9, fontWeight: 700 }} align="right">Prod</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {members.map((t: any, j: number) => (
                        <TableRow key={j}>
                          <TableCell sx={{ fontSize: 9 }}>{t.name}</TableCell>
                          <TableCell sx={{ fontSize: 9 }}>{t.role}</TableCell>
                          <TableCell sx={{ fontSize: 9 }} align="right">{teamHasCommitment ? (t.planned ?? '—') : (t.spillover ?? '—')}</TableCell>
                          <TableCell sx={{ fontSize: 9 }} align="right">{t.delivered ?? '—'}</TableCell>
                          {teamHasCommitment && <TableCell sx={{ fontSize: 9 }} align="right">{t.spillover ?? '—'}</TableCell>}
                          <TableCell sx={{ fontSize: 9 }} align="right">{t.reopens ?? 0}</TableCell>
                          <TableCell sx={{ fontSize: 9 }} align="right">{t.ticketsTested != null ? `${t.ticketsTested}${t.spTested != null ? ` (${t.spTested})` : ''}` : '—'}</TableCell>
                          <TableCell sx={{ fontSize: 9 }} align="right">{t.spDelivered ?? '—'}</TableCell>
                          <TableCell sx={{ fontSize: 9 }} align="right">{t.bugsRaised ?? '—'}</TableCell>
                          <TableCell sx={{ fontSize: 9 }} align="right">{t.invalidBugsRaised ?? '—'}</TableCell>
                          <TableCell sx={{ fontSize: 9 }} align="right">{t.prodBugsEscaped ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              );
              if (useTeamSplit) {
                return teamBySprintArr
                  .filter((s: any) => Array.isArray(s.team) && s.team.length > 0)
                  .map((s: any) => renderTable(`team-${s.syncId}`, `Team — ${s.sprintName}`, s.team));
              }
              if (team.length > 0) {
                const title = perSprint.length === 1 ? `Team — ${perSprint[0].sprintName}` : 'Team';
                return renderTable('team-aggregate', title, team);
              }
              return null;
            })()}

            {/* Individual Performance Trends — Velocity / Reopen / Carryover
                sparklines for this project only. Tagged data-pdf-block so the
                slicer keeps the trio together (or snaps the project's whole
                trends section to the next page). */}
            {!suppressTables && (() => {
              const { developerVelocity: dv, developerTrends: tr } = scopedDeveloperTrends(d, dScope);
              const scopeLbl = scopeShortLabel(dScope);
              // Same helper as the on-screen slide, so the PDF shows the same
              // filtered roster in the same order with the same labels.
              const view = buildIndividualTrendsView(dv, tr);
              if (!view) return null;
              const hasVel = view.velocityRows.length > 0;
              const hasTr = view.reopenRows.length > 0;
              if (!hasVel && !hasTr) return null;
              const sprints = view.sprints;
              // Each sparkline panel is its own atomic block so a page break can
              // fall BETWEEN panels instead of pushing the whole trio to the next
              // page (which left ~3/4-page blanks). The section header rides on the
              // first rendered panel's block so it never orphans at a page bottom.
              const panels = [
                hasVel && (
                  <PdfBarChartBlock
                    title="Developer Velocity (SP delivered)"
                    caption={`SP delivered per developer per sprint (${scopeLbl}). Sub-bugs are excluded.`}
                    sprints={sprints}
                    developers={view.velocityRows}
                    globalMax={view.maxSp}
                    unit="SP"
                  />
                ),
                hasTr && (
                  <PdfBarChartBlock
                    title="Reopen Ratio (% of SP delivered)"
                    caption="Reopens ÷ SP delivered. Excludes parent tickets labeled Invalid-Reopen / Bad-Data / Scope-Change (each label subtracts one reopen event)."
                    sprints={sprints}
                    developers={view.reopenRows}
                    globalMax={view.maxReopenPct}
                    unit="%"
                  />
                ),
                hasTr && (
                  <PdfBarChartBlock
                    title="Carryover Ratio (% of planned + scope-creep SP)"
                    caption={`Carried-over SP ÷ (planned SP + scope-creep SP). ${scopeLbl}. Sub-bugs are excluded.`}
                    sprints={sprints}
                    developers={view.carryoverRows}
                    globalMax={view.maxCarryoverPct}
                    unit="%"
                  />
                ),
              ].filter(Boolean);
              return (
                <Box sx={{ mt: 1 }}>
                  {panels.map((panel, pi) => (
                    <Box key={pi} data-pdf-block="true">
                      {pi === 0 && (
                        <>
                          {/* Scope label was hardcoded to V2 here regardless of
                              the presenter's toggle — now follows dScope. */}
                          <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#0277bd', mb: 0.25 }}>
                            INDIVIDUAL PERFORMANCE TRENDS (LAST {sprints.length} CLOSED SPRINTS, {scopeLbl.toUpperCase()})
                          </Typography>
                          <Typography sx={{ fontSize: 7, color: '#78909c', mb: 0.5, lineHeight: 1.3 }}>
                            {participationCaption(view)}
                          </Typography>
                        </>
                      )}
                      {panel}
                    </Box>
                  ))}
                </Box>
              );
            })()}

          </Paper>
        );
      })}

      {/* Discussion points */}
      {discussion.length > 0 && (
        <Box data-pdf-block="true" sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#37474f', mb: 0.5 }}>ADDITIONAL DISCUSSION POINTS</Typography>
          {discussion.map((d, i) => (
            <Typography key={i} sx={{ fontSize: 11, mb: 0.25, whiteSpace: 'pre-wrap' }}>→ {d}</Typography>
          ))}
        </Box>
      )}

      {/* Minutes of Meeting — appended at the end of the PDF when present.
          data-pdf-page-break-before="always" tells the slicer in usePdfExport
          to start a new PDF page exactly at this Box's top, regardless of
          remaining space on the previous page. data-pdf-block keeps the MOM
          container from being split at its top boundary. */}
      {momContent && (
        <Box
          data-pdf-page-break-before="always"
          data-pdf-block="true"
          sx={{ mt: 4, pt: 3, borderTop: '2px solid #0d1b2e' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: '#0d1b2e' }}>
              MINUTES OF MEETING
            </Typography>
            {momAccepted && (
              <Pill
                label={`Accepted & Locked${momLockedAt ? ' on ' + new Date(momLockedAt).toLocaleDateString() : ''}`}
                bg="#2e7d32"
              />
            )}
          </Box>
          <Typography sx={{ fontSize: 10, color: '#6b7a8f', mb: 1.5 }}>
            Generated from meeting notes. Reflects discussion and decisions in the meeting room.
          </Typography>
          <Paper variant="outlined" sx={{ p: 2, bgcolor: '#fafafa' }}>
            <Typography
              sx={{
                fontFamily: 'monospace',
                fontSize: 10.5,
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                color: '#1a1a1a',
              }}
            >
              {momContent}
            </Typography>
          </Paper>
        </Box>
      )}

      {/* No in-body generated-by line: the export stamps
          "Generated by V2Solutions Lens application" into the footer of every
          page (see pdfChrome.ts), so repeating it here would duplicate it. */}
    </Box>
  );
});
