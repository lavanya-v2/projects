import { useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  FormControl,
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
  SecurityOutlined,
  FiberManualRecord as DotIcon,
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
import { useQualityTrends } from './useQualityTrends';
import type { ProjectQualityTrends } from './useQualityTrends';
import { shortenPeriodLabel } from '../../shared/utils/periodLabel';

// ── Health config ─────────────────────────────────────────────────────────

const HEALTH_CONFIG = {
  green: { color: '#2e7d32', bg: '#e8f5e9', label: 'Healthy', tooltip: '0-1 prod bugs' },
  amber: { color: '#ed6c02', bg: '#fff8e1', label: 'Needs Attention', tooltip: '2-3 prod bugs' },
  red:   { color: '#d32f2f', bg: '#ffebee', label: 'At Risk', tooltip: '4+ prod bugs' },
} as const;

function HealthDot({ health }: { health: 'green' | 'amber' | 'red' }) {
  const cfg = HEALTH_CONFIG[health];
  return (
    <Tooltip title={`${cfg.label} (${cfg.tooltip})`}>
      <DotIcon sx={{ fontSize: 12, color: cfg.color }} />
    </Tooltip>
  );
}

// ── Trend helpers (inverted: up = bad, down = good) ───────────────────────

const TREND_CONFIG_INVERTED = {
  up:      { color: '#d32f2f', bg: '#ffebee', Icon: ArrowUpward,  label: 'Up' },
  down:    { color: '#2e7d32', bg: '#e8f5e9', Icon: ArrowDownward, label: 'Down' },
  neutral: { color: '#757575', bg: '#f5f5f5', Icon: NeutralIcon,   label: 'Flat' },
} as const;

function TrendPill({ trend, trendPct }: { trend: 'up' | 'down' | 'neutral'; trendPct: number }) {
  const cfg = TREND_CONFIG_INVERTED[trend];
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

function LeakageTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <Paper elevation={3} sx={{ p: 1.5, fontSize: 12 }}>
      <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{d.fullName}</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <span>Production Bugs</span><strong>{d.prodBugCount}</strong>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <span>Total Bugs</span><strong>{d.bugCount}</strong>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <span>SP Delivered</span><strong>{d.spDone}</strong>
      </Box>
    </Paper>
  );
}

// ── All-Projects Row ──────────────────────────────────────────────────────

function ProjectRow({ project, maxVal }: { project: ProjectQualityTrends; maxVal: number }) {
  const dl = project.defectLeakage;
  const currentVal = dl.current ?? 0;
  const avgVal = dl.avg ?? 0;
  const curPct = maxVal > 0 ? (currentVal / maxVal) * 100 : 0;
  const avgPct = maxVal > 0 ? (avgVal / maxVal) * 100 : 0;

  return (
    <Box
      data-testid={`trends-project-row-${project.projectId}`}
      data-sync-id={project.sprints[0]?.syncId ?? ''}
      data-health={dl.health}
      sx={{
        display: 'flex', alignItems: 'center', px: 2.5, py: 0.75, gap: 0,
        '&:hover': { bgcolor: '#f8f9fb' }, transition: 'background 0.1s',
      }}
    >
      <Box sx={{ width: 210, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box data-testid="trends-row-health" data-health={dl.health} sx={{ display: 'inline-flex' }}>
          <HealthDot health={dl.health} />
        </Box>
        <Tooltip title={project.accountName} placement="left">
          <Typography data-testid="trends-row-name" sx={{
            fontSize: 12, fontWeight: 600, color: '#333',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 145,
          }}>
            {project.projectName}
          </Typography>
        </Tooltip>
        <Chip label={shortSprint(project.sprints[0]?.sprintName ?? '')} size="small"
          data-testid="trends-row-sprint"
          sx={{ fontSize: 9, height: 18, bgcolor: '#f5f5f5', color: '#999' }} />
      </Box>

      <Box sx={{ flex: 1, height: 32, position: 'relative', bgcolor: '#fafafa', borderRadius: 1 }}>
        <Box sx={{ position: 'absolute', top: 2, left: 0, right: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Tooltip title={`Prior Sprint Avg: ${avgVal}`}>
            <Box
              data-testid="trends-row-avg"
              data-value={dl.avg ?? ''}
              sx={{
                height: 13, borderRadius: '3px',
                background: 'linear-gradient(90deg, #ffab91, #ffccbc)',
                width: `${avgPct}%`, minWidth: avgVal > 0 ? 2 : 0,
                position: 'relative',
              }}
            >
              {avgPct > 8 && (
                <Typography sx={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 10, fontWeight: 700, color: '#fff',
                }}>{avgVal}</Typography>
              )}
            </Box>
          </Tooltip>
          <Tooltip title={`Current: ${currentVal}`}>
            <Box
              data-testid="trends-row-current"
              data-value={dl.current ?? ''}
              sx={{
                height: 13, borderRadius: '3px',
                background: dl.health === 'green'
                  ? 'linear-gradient(90deg, #43a047, #66bb6a)'
                  : dl.health === 'amber'
                    ? 'linear-gradient(90deg, #ed6c02, #ffb74d)'
                    : 'linear-gradient(90deg, #e53935, #ef5350)',
                width: `${curPct}%`, minWidth: currentVal > 0 ? 2 : 0,
                position: 'relative',
              }}
            >
              {curPct > 8 && (
                <Typography sx={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 10, fontWeight: 700, color: '#fff',
                }}>{currentVal}</Typography>
              )}
            </Box>
          </Tooltip>
        </Box>
      </Box>

      {/* width must fit prodBugCount(50) + TrendPill(~70) + 1 gap(8) + pl(16) ≈
          145px minimum — same clipping bug as the other Trends tabs (see
          ReopenRatioTrend.tsx), fixed here too even though this tab is currently
          hidden, so it doesn't resurface if it's re-enabled. */}
      <Box sx={{ width: 160, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, pl: 2 }}>
        <Box data-testid="trends-row-secondary" data-field="prodBugCount" sx={{ textAlign: 'center', minWidth: 50 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>{project.sprints[0]?.prodBugCount ?? 0}</Typography>
          <Typography sx={{ fontSize: 8, color: '#999', textTransform: 'uppercase' }}>Prod Bugs</Typography>
        </Box>
        <Box data-testid="trends-row-trend" data-trend={dl.trend} data-trend-pct={dl.trendPct}>
          <TrendPill trend={dl.trend} trendPct={dl.trendPct} />
        </Box>
      </Box>
    </Box>
  );
}

// ── Single-Project Chart ──────────────────────────────────────────────────

function SingleProjectChart({ project }: { project: ProjectQualityTrends }) {
  const dl = project.defectLeakage;
  const sprints = [...project.sprints].reverse();
  const chartData = sprints.map((s, i) => ({
    label: shortSprint(s.sprintName),
    fullName: s.sprintName,
    prodBugCount: s.prodBugCount,
    bugCount: s.bugCount,
    spDone: s.spDone,
    isCurrent: i === sprints.length - 1,
  }));

  const hCfg = HEALTH_CONFIG[dl.health];

  return (
    <Box data-testid={`trends-single-chart-${project.projectId}`} data-sprint-count={chartData.length}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HealthDot health={dl.health} />
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>{project.projectName}</Typography>
            <Typography variant="caption" color="text.secondary">
              {project.accountName} — Last {sprints.length} completed sprints
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip label={hCfg.label} size="small"
            sx={{ bgcolor: hCfg.bg, color: hCfg.color, fontWeight: 700, fontSize: 11 }} />
          <TrendPill trend={dl.trend} trendPct={dl.trendPct} />
        </Box>
      </Box>

      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} barGap={4} margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 10 }} domain={[0, 'auto']} allowDecimals={false} />
          <ChartTooltip content={<LeakageTooltip />} />
          {dl.avg != null && (
            <ReferenceLine
              y={dl.avg}
              stroke="#ff9800"
              strokeDasharray="6 3"
              strokeWidth={2}
              label={{
                value: `Avg: ${dl.avg}`,
                position: 'right',
                fill: '#ff9800',
                fontSize: 11,
                fontWeight: 700,
              }}
            />
          )}
          <Bar dataKey="prodBugCount" name="Prod Bugs" radius={[4, 4, 0, 0]} barSize={40}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.isCurrent ? '#e53935' : '#ef9a9a'} />
            ))}
            {/* Single series per sprint. Zero-bug sprints show nothing rather
                than a floating "0" over an empty column. */}
            <LabelList
              dataKey="prodBugCount"
              position="top"
              style={{ fontSize: 11, fontWeight: 600 }}
              formatter={(v: any) => (v == null || v === 0 ? '' : `${v}`)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2.5, mt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
          <Box sx={{ width: 12, height: 10, borderRadius: '2px', bgcolor: '#ef9a9a' }} /> Historical
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
          <Box sx={{ width: 12, height: 10, borderRadius: '2px', bgcolor: '#e53935' }} /> Current Sprint
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
          <Box sx={{ width: 16, height: 0, borderTop: '2px dashed #ff9800' }} /> Prior Sprint Avg
        </Box>
      </Box>
    </Box>
  );
}

// ── Main component ────────────────────────────────────────────────────────

interface Props {
  accountId: number | '';
}

export function DefectLeakageTrend({ accountId }: Props) {
  const [v2Only, setV2Only] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');

  const { data, isLoading, error } = useQualityTrends(v2Only, accountId);
  const projects = data?.projects ?? [];

  const [sortBy, setSortBy] = useState<'name' | 'val-desc' | 'val-asc' | 'trend-desc' | 'trend-asc'>('name');
  const sorted = [...projects].sort((a, b) => {
    switch (sortBy) {
      case 'val-desc': return (b.defectLeakage.current ?? 0) - (a.defectLeakage.current ?? 0);
      case 'val-asc':  return (a.defectLeakage.current ?? 0) - (b.defectLeakage.current ?? 0);
      case 'trend-desc': return b.defectLeakage.trendPct - a.defectLeakage.trendPct;
      case 'trend-asc':  return a.defectLeakage.trendPct - b.defectLeakage.trendPct;
      default: return a.projectName.localeCompare(b.projectName);
    }
  });

  const selectedProject = projects.find(p => p.projectId === selectedProjectId);
  const greens = projects.filter(p => p.defectLeakage.health === 'green').length;
  const ambers = projects.filter(p => p.defectLeakage.health === 'amber').length;
  const reds = projects.filter(p => p.defectLeakage.health === 'red').length;

  return (
    <Paper data-testid="trends-leakage" sx={{ mb: 3 }}>
      <Box sx={{
        px: 3, py: 2,
        background: 'linear-gradient(90deg, #fff3e0 0%, #ffffff 100%)',
        borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
      }}>
        <SecurityOutlined sx={{ color: '#e65100', fontSize: 22 }} />
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
          Defect Leakage Trends
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
          Production Bugs per Sprint
        </Typography>

        <FormControlLabel
          control={<Switch size="small" checked={v2Only} onChange={(_, v) => setV2Only(v)}
            inputProps={{ 'aria-label': 'Team toggle', 'data-testid': 'trends-v2-toggle' } as any}
          />}
          label={<Typography sx={{ fontSize: 12, fontWeight: 600 }}>{v2Only ? 'Team Only' : 'All Members'}</Typography>}
          sx={{ mr: 1 }}
        />

        <FormControl size="small" sx={{ minWidth: 200 }}>
          <Select displayEmpty value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value as number | '')}
            data-testid="trends-project-select"
            sx={{ fontSize: 13 }}>
            <MenuItem value="">All Projects</MenuItem>
            {projects.map(p => (
              <MenuItem key={p.projectId} value={p.projectId}>{p.projectName}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Box sx={{ px: 3, py: 1.5, bgcolor: '#f8f9fa', borderBottom: '1px solid', borderColor: 'divider', fontSize: 11, color: '#666', lineHeight: 1.8 }}>
        <strong>Defect Leakage</strong> = Production bugs logged during the sprint (between sprint start and end date) &nbsp;&bull;&nbsp;
        Production bugs are identified from confirmed production defect keys in daily board snapshots &nbsp;&bull;&nbsp;
        <strong>Prior Sprint Avg</strong> = Average of all sprints before the most recent &nbsp;&bull;&nbsp;
        <strong>Trend</strong>: Up (&gt;5% above avg), Down (&gt;5% below), Flat (within +/-5%) &nbsp;&bull;&nbsp;
        <strong>Health</strong>: <span style={{ color: '#2e7d32' }}>Green</span> (0-1 bugs), <span style={{ color: '#ed6c02' }}>Amber</span> (2-3 bugs), <span style={{ color: '#d32f2f' }}>Red</span> (4+ bugs) &nbsp;&bull;&nbsp;
        Lower is better &mdash; production bugs indicate defects escaping QA
      </Box>

      {isLoading && (
        <Box sx={{ p: 3 }}>
          <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ m: 2 }}>
          Failed to load defect leakage data: {(error as Error).message}
        </Alert>
      )}

      {!accountId && (
        <Box data-testid="trends-no-account" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">Select an account to view defect leakage trends.</Typography>
        </Box>
      )}

      {!isLoading && !error && !!accountId && projects.length === 0 && (
        <Box data-testid="trends-no-data" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No sprint-based projects with synced data found.</Typography>
        </Box>
      )}

      {!isLoading && !error && projects.length > 0 && (
        <>
          {selectedProject && (
            <Box sx={{ p: 3 }}>
              <SingleProjectChart project={selectedProject} />
            </Box>
          )}

          {!selectedProject && (
            <>
              <Box data-testid="trends-summary-chips" sx={{ px: 3, pt: 2, pb: 1, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Chip icon={<DotIcon sx={{ fontSize: 10, color: '#2e7d32 !important' }} />}
                  label={`${greens} Healthy`} size="small"
                  data-testid="trends-summary-chip-green" data-count={greens}
                  sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 700 }} />
                <Chip icon={<DotIcon sx={{ fontSize: 10, color: '#ed6c02 !important' }} />}
                  label={`${ambers} Attention`} size="small"
                  data-testid="trends-summary-chip-amber" data-count={ambers}
                  sx={{ bgcolor: '#fff8e1', color: '#ed6c02', fontWeight: 700 }} />
                <Chip icon={<DotIcon sx={{ fontSize: 10, color: '#d32f2f !important' }} />}
                  label={`${reds} At Risk`} size="small"
                  data-testid="trends-summary-chip-red" data-count={reds}
                  sx={{ bgcolor: '#ffebee', color: '#d32f2f', fontWeight: 700 }} />
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ fontSize: 11, color: '#888', mr: 0.5 }}>Sort:</Typography>
                <Select size="small" value={sortBy} onChange={e => setSortBy(e.target.value as any)}
                  sx={{ fontSize: 11, '& .MuiSelect-select': { py: 0.5 } }}>
                  <MenuItem value="name">Name</MenuItem>
                  <MenuItem value="val-desc">Leakage (High-Low)</MenuItem>
                  <MenuItem value="val-asc">Leakage (Low-High)</MenuItem>
                  <MenuItem value="trend-desc">Trend (High-Low)</MenuItem>
                  <MenuItem value="trend-asc">Trend (Low-High)</MenuItem>
                </Select>
              </Box>

              <Box sx={{ px: 3, pb: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#ffab91' }} /> Prior Sprint Avg
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#43a047' }} /> Healthy (0-1)
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#ed6c02' }} /> Attention (2-3)
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#e53935' }} /> At Risk (4+)
                </Box>
              </Box>

              <Box sx={{ pb: 2 }}>
                {(() => {
                  const allVals = projects.flatMap(x => [x.defectLeakage.current ?? 0, x.defectLeakage.avg ?? 0]);
                  const maxVal = (allVals.length > 0 ? Math.max(...allVals) : 1) * 1.15 || 1;
                  return sorted.map((p, i) => (
                    <Box key={p.projectId}>
                      <ProjectRow project={p} maxVal={maxVal} />
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
