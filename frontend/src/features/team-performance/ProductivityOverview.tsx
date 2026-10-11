import { useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Switch,
  FormControlLabel,
  Typography,
  Skeleton,
  Tooltip,
} from '@mui/material';
import {
  ArrowUpward,
  ArrowDownward,
  Remove as NeutralIcon,
  TrendingUp,
  FiberManualRecord as DotIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Link as RouterLink } from 'react-router-dom';
import { useProductivityOverview, useLegacySprintView } from './useProductivityOverview';
import type { ProjectProductivity } from './useProductivityOverview';
import { TrendsDownloadButton } from './TrendsDownloadButton';
import { shortenPeriodLabel } from '../../shared/utils/periodLabel';
import { PATHS } from '../../routes/paths';

// ── Health config ─────────────────────────────────────────────────────────

const HEALTH_CONFIG = {
  green: { color: '#2e7d32', bg: '#e8f5e9', label: 'Healthy', tooltip: '80%+ delivery' },
  amber: { color: '#ed6c02', bg: '#fff8e1', label: 'Needs Attention', tooltip: '60-80% delivery' },
  red:   { color: '#d32f2f', bg: '#ffebee', label: 'At Risk', tooltip: '<60% delivery' },
} as const;

function HealthDot({ health, metricKind }: { health: 'green' | 'amber' | 'red'; metricKind?: 'percent' | 'throughput' }) {
  const cfg = HEALTH_CONFIG[health];
  const tip = metricKind === 'throughput' ? 'vs own average' : cfg.tooltip;
  return (
    <Tooltip title={`${cfg.label} (${tip})`}>
      <DotIcon sx={{ fontSize: 12, color: cfg.color }} />
    </Tooltip>
  );
}

// ── Trend helpers ──────────────────────────────────────────────────────────

const TREND_CONFIG = {
  up:      { color: '#2e7d32', bg: '#e8f5e9', Icon: ArrowUpward,  label: 'Up' },
  down:    { color: '#d32f2f', bg: '#ffebee', Icon: ArrowDownward, label: 'Down' },
  neutral: { color: '#757575', bg: '#f5f5f5', Icon: NeutralIcon,   label: 'Flat' },
} as const;

function TrendPill({ trend, trendPct }: { trend: 'up' | 'down' | 'neutral'; trendPct: number }) {
  const cfg = TREND_CONFIG[trend];
  const Icon = cfg.Icon;
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.3,
      px: 1, py: 0.25, borderRadius: 2, fontSize: 11, fontWeight: 700,
      bgcolor: cfg.bg, color: cfg.color, whiteSpace: 'nowrap',
    }}>
      <Icon sx={{ fontSize: 14 }} />
      {trendPct > 0 ? '+' : ''}{trendPct}%
    </Box>
  );
}

// Sprint/cycle/week label shortening lives in shared/utils/periodLabel.ts --
// see there for why (this used to take the trailing whitespace token, which
// collapsed every Kanban cycle/week label ending in a bare year to "2026").
const shortSprint = shortenPeriodLabel;

// ── Custom chart tooltip ───────────────────────────────────────────────────

function ProductivityTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <Paper elevation={3} sx={{ p: 1.5, fontSize: 12 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{d.fullName}</Typography>
        {d.syncType && (
          <Chip
            label={d.syncType === 'kanban' ? 'Cycle' : 'Sprint'}
            size="small"
            sx={{
              fontSize: 9, height: 16, fontWeight: 700,
              bgcolor: d.syncType === 'kanban' ? '#ede7f6' : '#e3f2fd',
              color: d.syncType === 'kanban' ? '#5e35b1' : '#1565c0',
            }}
          />
        )}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <span>{d.isThroughput ? 'SP Completed' : 'Productivity'}</span>
        <strong>{d.isThroughput ? `${d.spDone} SP` : `${d.productivity}%`}</strong>
      </Box>
      {!d.isThroughput && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
          <span>SP Done / Planned</span><strong>{d.spDone} / {d.spPlanned}</strong>
        </Box>
      )}
      {d.periodDays != null && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
          <span>Period length</span><strong>{d.periodDays} day{d.periodDays === 1 ? '' : 's'}</strong>
        </Box>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <span>Developers</span><strong>{d.devCount}</strong>
      </Box>
    </Paper>
  );
}

// ── All-Projects Row (horizontal bars) ─────────────────────────────────────

function ProjectRow({ project, maxByKind, accountId }: { project: ProjectProductivity; maxByKind: { percent: number; throughput: number }; accountId: number }) {
  // Opt-in legacy view: a project that switched Scrum -> Kanban mid-history
  // shows its live (Kanban/throughput) row by default; this lets a viewer
  // manually switch to see the pre-cutover Scrum percent-based numbers
  // instead, without changing the default for anyone else. Manual only --
  // no auto-hide once enough Kanban cycles accumulate (by design, see plan).
  const [showLegacy, setShowLegacy] = useState(false);
  const legacyQuery = useLegacySprintView(showLegacy ? project.projectId : null);

  const display: ProjectProductivity = (showLegacy && legacyQuery.data)
    ? { ...project, ...legacyQuery.data, isKanbanProject: false }
    : project;

  const kind = display.metricKind ?? 'percent';
  const unit = kind === 'throughput' ? ' SP' : '%';
  const periodWord = display.isKanbanProject ? 'span' : 'sprint';
  const maxProd = maxByKind[kind] || 1;
  const curPct = maxProd > 0 && display.currentProductivity != null
    ? (display.currentProductivity / maxProd) * 100 : 0;
  const avgPct = maxProd > 0 && display.avgProductivity != null
    ? (display.avgProductivity / maxProd) * 100 : 0;

  return (
    <Box
      data-testid={`trends-project-row-${project.projectId}`}
      data-sync-id={display.sprints[0]?.syncId ?? ''}
      data-health={display.health}
      sx={{
        display: 'flex', alignItems: 'center', px: 2.5, py: 0.75, gap: 0,
        '&:hover': { bgcolor: '#f8f9fb' }, transition: 'background 0.1s',
      }}
    >
      {/* Label */}
      <Box sx={{ width: 210, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box data-testid="trends-row-health" data-health={display.health} sx={{ display: 'inline-flex' }}>
          <HealthDot health={display.health} metricKind={kind} />
        </Box>
        <Tooltip title={project.accountName} placement="left">
          <Typography data-testid="trends-row-name" sx={{
            fontSize: 12, fontWeight: 600, color: '#333',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 145,
          }}>
            {project.projectName}
          </Typography>
        </Tooltip>
        {display.isKanbanProject && (
          <Chip label="Kanban" size="small"
            sx={{ fontSize: 9, height: 18, bgcolor: '#ede7f6', color: '#5e35b1', fontWeight: 700 }} />
        )}
        {showLegacy && (
          <Chip label="Scrum (legacy)" size="small"
            sx={{ fontSize: 9, height: 18, bgcolor: '#e3f2fd', color: '#1565c0', fontWeight: 700 }} />
        )}
        <Chip label={shortSprint(display.sprints[0]?.sprintName ?? '')} size="small"
          data-testid="trends-row-sprint"
          sx={{ fontSize: 9, height: 18, bgcolor: '#f5f5f5', color: '#999' }} />
        {project.isKanbanProject && project.hasLegacySprintHistory && (
          <Tooltip title={showLegacy ? 'Back to current (Kanban) view' : 'View old Scrum-era data for this project'}>
            <IconButton
              size="small"
              data-testid="trends-row-legacy-toggle"
              onClick={() => setShowLegacy(v => !v)}
              sx={{ p: 0.25 }}
            >
              <HistoryIcon sx={{ fontSize: 15, color: showLegacy ? '#1565c0' : '#999' }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Bars */}
      <Box sx={{ flex: 1, height: 32, position: 'relative', bgcolor: '#fafafa', borderRadius: 1 }}>
        {showLegacy && legacyQuery.isLoading && (
          <Typography sx={{ fontSize: 10, color: '#999', p: 0.5 }}>Loading Scrum history…</Typography>
        )}
        {showLegacy && !legacyQuery.isLoading && !legacyQuery.data && (
          <Typography sx={{ fontSize: 10, color: '#999', p: 0.5 }}>No Scrum-era history found for this project.</Typography>
        )}
        {(!showLegacy || legacyQuery.data) && (
        <Box sx={{ position: 'absolute', top: 2, left: 0, right: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {/* Avg bar */}
          <Tooltip title={`Prior ${periodWord} avg: ${display.avgProductivity ?? 0}${unit}`}>
            <Box
              data-testid="trends-row-avg"
              data-value={display.avgProductivity ?? ''}
              sx={{
                height: 13, borderRadius: '3px',
                background: 'linear-gradient(90deg, #90caf9, #64b5f6)',
                width: `${avgPct}%`, minWidth: display.avgProductivity != null ? 2 : 0,
                position: 'relative',
              }}
            >
              {avgPct > 8 && (
                <Typography sx={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 10, fontWeight: 700, color: '#fff',
                }}>
                  {display.avgProductivity}{unit}
                </Typography>
              )}
            </Box>
          </Tooltip>
          {/* Current bar — colored by health (absolute productivity) */}
          <Tooltip title={`Current: ${display.currentProductivity ?? 0}${unit}`}>
            <Box
              data-testid="trends-row-current"
              data-value={display.currentProductivity ?? ''}
              sx={{
                height: 13, borderRadius: '3px',
                background: display.health === 'green'
                  ? 'linear-gradient(90deg, #43a047, #66bb6a)'
                  : display.health === 'amber'
                    ? 'linear-gradient(90deg, #ed6c02, #ffb74d)'
                    : 'linear-gradient(90deg, #e53935, #ef5350)',
                width: `${curPct}%`, minWidth: display.currentProductivity != null ? 2 : 0,
                position: 'relative',
              }}
            >
              {curPct > 8 && (
                <Typography sx={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 10, fontWeight: 700, color: '#fff',
                }}>
                  {display.currentProductivity}{unit}
                </Typography>
              )}
            </Box>
          </Tooltip>
        </Box>
        )}
      </Box>

      {/* Right metrics — width must fit sp(44) + devs(44) + TrendPill(~70) +
          download button(~34) + 3 gaps(8 each) + pl(16) ≈ 230px minimum — see the
          matching comment in ReopenRatioTrend.tsx for why a narrower width clips
          the leftmost stat instead of visibly overflowing. */}
      <Box sx={{ width: 250, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, pl: 2 }}>
        <Box data-testid="trends-row-sp" sx={{ textAlign: 'center', minWidth: 44 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>{display.sprints[0]?.spDone ?? 0}</Typography>
          <Typography sx={{ fontSize: 8, color: '#999', textTransform: 'uppercase' }}>SP</Typography>
        </Box>
        <Box data-testid="trends-row-devs" sx={{ textAlign: 'center', minWidth: 44 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>{display.sprints[0]?.devCount ?? 0}</Typography>
          <Typography sx={{ fontSize: 8, color: '#999', textTransform: 'uppercase' }}>Devs</Typography>
        </Box>
        <Box data-testid="trends-row-trend" data-trend={display.trend} data-trend-pct={display.trendPct}>
          <TrendPill trend={display.trend} trendPct={display.trendPct} />
        </Box>
        <TrendsDownloadButton accountId={accountId} projectId={project.projectId} tooltip={`Download ${project.projectName}'s trends`} />
      </Box>
    </Box>
  );
}

// ── Single-Project Chart (5 sprints vertical bars) ─────────────────────────

function SingleProjectChart({ project }: { project: ProjectProductivity }) {
  const isThroughput = project.metricKind === 'throughput';
  const unit = isThroughput ? ' SP' : '%';
  const periodWord = project.isKanbanProject ? 'span' : 'sprint';
  const sprints = [...project.sprints].reverse();
  // Mixed-era history (a project that switched Scrum -> Kanban mid-stream) blends
  // both period types into this same 5-bar chart -- bars are otherwise identical
  // width/color regardless of a 15-day sprint vs a 5-day cycle underneath, so tag
  // each one explicitly rather than leaving it ambiguous.
  const hasMixedEra = new Set(sprints.map(s => s.syncType)).size > 1;
  const chartData = sprints.map((s, i) => ({
    label: shortSprint(s.sprintName),
    fullName: s.sprintName,
    productivity: s.productivity,
    value: isThroughput ? s.spDone : s.productivity,
    isThroughput,
    spDone: s.spDone,
    spPlanned: s.spPlanned,
    devCount: s.devCount,
    syncType: s.syncType,
    periodDays: s.periodDays,
    isCurrent: i === sprints.length - 1,
  }));

  const avgProductivity = project.avgProductivity;
  const hCfg = HEALTH_CONFIG[project.health];

  // Recharts XAxis custom tick — renders the period label plus a small
  // Sprint/Cycle tag underneath. Closes over chartData (via index) since
  // XAxis tick payloads don't carry the full row, only the label value.
  const EraAwareTick = ({ x, y, payload }: any) => {
    const row = chartData[payload?.index];
    const isKanbanPeriod = row?.syncType === 'kanban';
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={12} textAnchor="middle" fontSize={11} fill="#333">{payload?.value}</text>
        <text
          x={0} y={0} dy={26} textAnchor="middle" fontSize={9} fontWeight={700}
          fill={isKanbanPeriod ? '#5e35b1' : '#1565c0'}
        >
          {isKanbanPeriod ? 'CYCLE' : 'SPRINT'}
        </text>
      </g>
    );
  };

  return (
    <Box data-testid={`trends-single-chart-${project.projectId}`} data-sprint-count={chartData.length}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HealthDot health={project.health} metricKind={project.metricKind} />
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography variant="subtitle1" fontWeight={700}>{project.projectName}</Typography>
              {project.isKanbanProject && (
                <Chip label="Kanban" size="small"
                  sx={{ fontSize: 9, height: 18, bgcolor: '#ede7f6', color: '#5e35b1', fontWeight: 700 }} />
              )}
            </Box>
            <Typography variant="caption" color="text.secondary">
              {project.accountName} — Last {sprints.length} completed {project.isKanbanProject ? 'spans' : 'sprints'}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip label={hCfg.label} size="small"
            sx={{ bgcolor: hCfg.bg, color: hCfg.color, fontWeight: 700, fontSize: 11 }} />
          <TrendPill trend={project.trend} trendPct={project.trendPct} />
        </Box>
      </Box>

      {/* Full sync history (uncapped, all eras) lives in Board View -- this
          chart only ever shows the last 5. */}
      <Box sx={{ mb: 1 }}>
        <RouterLink
          to={`${PATHS.TEAM_PERFORMANCE_SPRINT}?projectId=${project.projectId}`}
          style={{ fontSize: 12, color: '#1976d2', textDecoration: 'none' }}
        >
          View full sync history in Board View →
        </RouterLink>
      </Box>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={hasMixedEra ? 258 : 240}>
        <BarChart data={chartData} barGap={4} margin={{ top: 20, right: 20, left: -10, bottom: hasMixedEra ? 18 : 0 }}>
          <XAxis
            dataKey="label"
            tick={hasMixedEra ? <EraAwareTick /> : { fontSize: 11 }}
            height={hasMixedEra ? 34 : undefined}
          />
          <YAxis tick={{ fontSize: 10 }} domain={[0, 'auto']} unit={isThroughput ? '' : '%'} />
          <ChartTooltip content={<ProductivityTooltip />} />
          {avgProductivity != null && (
            <ReferenceLine
              y={avgProductivity}
              stroke="#ff9800"
              strokeDasharray="6 3"
              strokeWidth={2}
              label={{
                value: `Avg: ${avgProductivity}${unit}`,
                position: 'right',
                fill: '#ff9800',
                fontSize: 11,
                fontWeight: 700,
              }}
            />
          )}
          <Bar dataKey="value" name={isThroughput ? 'SP Completed' : 'Productivity'} radius={[4, 4, 0, 0]} barSize={40}>
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.isCurrent ? '#1976d2' : '#90caf9'}
              />
            ))}
            {/* Single series per sprint, so the value fits on the bar. `unit`
                is ' SP' in throughput mode and '%' otherwise. */}
            <LabelList
              dataKey="value"
              position="top"
              style={{ fontSize: 11, fontWeight: 600 }}
              formatter={(v: any) => (v == null ? '' : `${v}${unit}`)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2.5, mt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
          <Box sx={{ width: 12, height: 10, borderRadius: '2px', bgcolor: '#90caf9' }} /> Historical
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
          <Box sx={{ width: 12, height: 10, borderRadius: '2px', bgcolor: '#1976d2' }} /> Current {periodWord}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
          <Box sx={{ width: 16, height: 0, borderTop: '2px dashed #ff9800' }} /> Prior {periodWord} avg
        </Box>
      </Box>
    </Box>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface Props {
  accountId: number | '';
}

export function ProductivityOverview({ accountId }: Props) {
  const [v2Only, setV2Only] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');

  const { data, isLoading, error } = useProductivityOverview(v2Only, accountId);
  const projects = data?.projects ?? [];

  const [sortBy, setSortBy] = useState<'name' | 'prod-desc' | 'prod-asc' | 'trend-desc' | 'trend-asc'>('name');
  const sorted = [...projects].sort((a, b) => {
    switch (sortBy) {
      case 'prod-desc': return (b.currentProductivity ?? 0) - (a.currentProductivity ?? 0);
      case 'prod-asc':  return (a.currentProductivity ?? 0) - (b.currentProductivity ?? 0);
      case 'trend-desc': return b.trendPct - a.trendPct;
      case 'trend-asc':  return a.trendPct - b.trendPct;
      default: return a.projectName.localeCompare(b.projectName);
    }
  });

  const selectedProject = projects.find(p => p.projectId === selectedProjectId);
  const greens = projects.filter(p => p.health === 'green').length;
  const ambers = projects.filter(p => p.health === 'amber').length;
  const reds = projects.filter(p => p.health === 'red').length;

  return (
    <Paper data-testid="trends-productivity" sx={{ mb: 3 }}>
      {/* Header */}
      <Box sx={{
        px: 3, py: 2,
        background: 'linear-gradient(90deg, #f5f7ff 0%, #ffffff 100%)',
        borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
      }}>
        <TrendingUp sx={{ color: 'primary.main', fontSize: 22 }} />
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
          Productivity Trends
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
          SP Done / SP Planned
        </Typography>

        {/* Team-only toggle */}
        <FormControlLabel
          control={
            <Switch size="small" checked={v2Only} onChange={(_, v) => setV2Only(v)}
              inputProps={{ 'aria-label': 'Team toggle', 'data-testid': 'trends-v2-toggle' } as any}
            />
          }
          label={<Typography sx={{ fontSize: 12, fontWeight: 600 }}>{v2Only ? 'Team Only' : 'All Members'}</Typography>}
          sx={{ mr: 1 }}
        />

        {/* Project selector */}
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <Select
            displayEmpty
            value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value as number | '')}
            data-testid="trends-project-select"
            sx={{ fontSize: 13 }}
          >
            <MenuItem value="">All Projects</MenuItem>
            {projects.map(p => (
              <MenuItem key={p.projectId} value={p.projectId}>{p.projectName}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {projects.length === 1 && (
          <TrendsDownloadButton accountId={accountId as number} projectId={projects[0].projectId} label={`Download ${projects[0].projectName}`} />
        )}
        {projects.length > 1 && (
          <TrendsDownloadButton accountId={accountId as number} label="Download All Projects" />
        )}
      </Box>

      {/* Formula explanation */}
      <Box sx={{ px: 3, py: 1.5, bgcolor: '#f8f9fa', borderBottom: '1px solid', borderColor: 'divider', fontSize: 11, color: '#666', lineHeight: 1.85 }}>
        <div>
          <strong>Sprint projects</strong> &mdash; Productivity = <strong>SP Done / SP Planned</strong> (%), measured against the committed sprint scope.
          Health: <span style={{ color: '#2e7d32' }}>Green</span> &ge;80%, <span style={{ color: '#ed6c02' }}>Amber</span> 60&ndash;79%, <span style={{ color: '#d32f2f' }}>Red</span> &lt;60%.
        </div>
        <div>
          <strong>Kanban projects</strong> (tagged) &mdash; no commitment target, so Productivity = <strong>SP completed per span</strong> (throughput).
          Health is relative to the project&apos;s <strong>own rolling average</strong> of prior spans: <span style={{ color: '#2e7d32' }}>Green</span> &ge; avg, <span style={{ color: '#ed6c02' }}>Amber</span> &ge;70% of avg, <span style={{ color: '#d32f2f' }}>Red</span> below.
        </div>
        <div>
          <strong>Prior avg</strong> = mean of all sprints/spans before the most recent &nbsp;&bull;&nbsp;
          <strong>Trend</strong>: Up (&gt;5% above avg), Down (&gt;5% below avg), Flat (within &plusmn;5%).
        </div>
      </Box>

      {/* Loading */}
      {isLoading && (
        <Box sx={{ p: 3 }}>
          <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
        </Box>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ m: 2 }}>
          Failed to load productivity data: {(error as Error).message}
        </Alert>
      )}

      {/* No account selected */}
      {!accountId && (
        <Box data-testid="trends-no-account" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">Select an account to view productivity trends.</Typography>
        </Box>
      )}

      {/* Content */}
      {!isLoading && !error && !!accountId && projects.length === 0 && (
        <Box data-testid="trends-no-data" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No sprint-based projects with synced data found.</Typography>
        </Box>
      )}

      {!isLoading && !error && projects.length > 0 && (
        <>
          {/* ── Single Project View ─────────────────────────────────── */}
          {selectedProject && (
            <Box sx={{ p: 3 }}>
              <SingleProjectChart project={selectedProject} />
            </Box>
          )}

          {/* ── All Projects View ───────────────────────────────────── */}
          {!selectedProject && (
            <>
              {/* Summary chips + sort */}
              <Box data-testid="trends-summary-chips" sx={{ px: 3, pt: 2, pb: 1, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Chip
                  icon={<DotIcon sx={{ fontSize: 10, color: '#2e7d32 !important' }} />}
                  label={`${greens} Healthy`}
                  size="small" data-testid="trends-summary-chip-green" data-count={greens}
                  sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 700 }}
                />
                <Chip
                  icon={<DotIcon sx={{ fontSize: 10, color: '#ed6c02 !important' }} />}
                  label={`${ambers} Attention`}
                  size="small" data-testid="trends-summary-chip-amber" data-count={ambers}
                  sx={{ bgcolor: '#fff8e1', color: '#ed6c02', fontWeight: 700 }}
                />
                <Chip
                  icon={<DotIcon sx={{ fontSize: 10, color: '#d32f2f !important' }} />}
                  label={`${reds} At Risk`}
                  size="small" data-testid="trends-summary-chip-red" data-count={reds}
                  sx={{ bgcolor: '#ffebee', color: '#d32f2f', fontWeight: 700 }}
                />
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ fontSize: 11, color: '#888', mr: 0.5 }}>Sort:</Typography>
                <Select size="small" value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                  sx={{ fontSize: 11, '& .MuiSelect-select': { py: 0.5 } }}>
                  <MenuItem value="name">Name</MenuItem>
                  <MenuItem value="prod-desc">Productivity (High-Low)</MenuItem>
                  <MenuItem value="prod-asc">Productivity (Low-High)</MenuItem>
                  <MenuItem value="trend-desc">Trend (High-Low)</MenuItem>
                  <MenuItem value="trend-asc">Trend (Low-High)</MenuItem>
                </Select>
              </Box>

              {/* Legend */}
              <Box sx={{ px: 3, pb: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#90caf9' }} /> Prior Sprint Avg
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#43a047' }} /> Healthy (80%+)
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#ed6c02' }} /> Attention (60-79%)
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#e53935' }} /> At Risk (&lt;60%)
                </Box>
              </Box>

              {/* Project rows */}
              <Box sx={{ pb: 2 }}>
                {(() => {
                  // Separate max per metric kind so SP-throughput rows and %-rows
                  // don't distort each other's bar widths.
                  const valuesFor = (kind: 'percent' | 'throughput') =>
                    projects.filter(x => (x.metricKind ?? 'percent') === kind)
                      .flatMap(x => [x.currentProductivity ?? 0, x.avgProductivity ?? 0]);
                  const maxOf = (vals: number[]) => (vals.length > 0 ? Math.max(...vals) : 1) * 1.15 || 1;
                  const maxByKind = { percent: maxOf(valuesFor('percent')), throughput: maxOf(valuesFor('throughput')) };
                  return sorted.map((p, i) => (
                    <Box key={p.projectId}>
                      <ProjectRow project={p} maxByKind={maxByKind} accountId={accountId as number} />
                      {i < sorted.length - 1 && <Box sx={{ mx: 2.5, borderBottom: '1px solid #f5f5f5' }} />}
                    </Box>
                  ));
                })()}
              </Box>
            </>
          )}
        </>
      )}
    </Paper>
  );
}
