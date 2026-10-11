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
  Replay as ReplayIcon,
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
import { TrendsDownloadButton } from './TrendsDownloadButton';
import { shortenPeriodLabel } from '../../shared/utils/periodLabel';

// ── Health config ─────────────────────────────────────────────────────────

const HEALTH_CONFIG = {
  green: { color: '#2e7d32', bg: '#e8f5e9', label: 'Healthy', tooltip: '< 10% reopen rate' },
  amber: { color: '#ed6c02', bg: '#fff8e1', label: 'Needs Attention', tooltip: '10-20% reopen rate' },
  red:   { color: '#d32f2f', bg: '#ffebee', label: 'At Risk', tooltip: '> 20% reopen rate' },
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

function ReopenTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <Paper elevation={3} sx={{ p: 1.5, fontSize: 12 }}>
      <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{d.fullName}</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <span>Reopen Ratio</span><strong>{d.reopenRatio}%</strong>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <span>Reopened / Total</span><strong>{d.reopenedStoryCount} / {d.totalStoryCount}</strong>
      </Box>
      {d.invalidReopenCount > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
          <span>Invalid (excluded)</span><strong>{d.invalidReopenCount}</strong>
        </Box>
      )}
    </Paper>
  );
}

// ── All-Projects Row ──────────────────────────────────────────────────────

function ProjectRow({ project, maxVal, accountId }: { project: ProjectQualityTrends; maxVal: number; accountId: number }) {
  const rr = project.reopenRatio;
  const currentVal = rr.current ?? 0;
  const avgVal = rr.avg ?? 0;
  const curPct = maxVal > 0 ? (currentVal / maxVal) * 100 : 0;
  const avgPct = maxVal > 0 ? (avgVal / maxVal) * 100 : 0;

  return (
    <Box
      data-testid={`trends-project-row-${project.projectId}`}
      data-sync-id={project.sprints[0]?.syncId ?? ''}
      data-health={rr.health}
      sx={{
        display: 'flex', alignItems: 'center', px: 2.5, py: 0.75, gap: 0,
        '&:hover': { bgcolor: '#f8f9fb' }, transition: 'background 0.1s',
      }}
    >
      <Box sx={{ width: 210, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box data-testid="trends-row-health" data-health={rr.health} sx={{ display: 'inline-flex' }}>
          <HealthDot health={rr.health} />
        </Box>
        <Tooltip title={project.accountName} placement="left">
          <Typography data-testid="trends-row-name" sx={{
            fontSize: 12, fontWeight: 600, color: '#333',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 145,
          }}>
            {project.projectName}
          </Typography>
        </Tooltip>
        {project.isKanbanProject && (
          <Chip label="Kanban" size="small"
            sx={{ fontSize: 9, height: 18, bgcolor: '#ede7f6', color: '#5e35b1', fontWeight: 700 }} />
        )}
        <Chip label={shortSprint(project.sprints[0]?.sprintName ?? '')} size="small"
          data-testid="trends-row-sprint"
          sx={{ fontSize: 9, height: 18, bgcolor: '#f5f5f5', color: '#999' }} />
      </Box>

      <Box sx={{ flex: 1, height: 32, position: 'relative', bgcolor: '#fafafa', borderRadius: 1 }}>
        <Box sx={{ position: 'absolute', top: 2, left: 0, right: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Tooltip title={`Prior Sprint Avg: ${avgVal}%`}>
            <Box
              data-testid="trends-row-avg"
              data-value={rr.avg ?? ''}
              sx={{
                height: 13, borderRadius: '3px',
                background: 'linear-gradient(90deg, #ce93d8, #e1bee7)',
                width: `${avgPct}%`, minWidth: avgVal > 0 ? 2 : 0,
                position: 'relative',
              }}
            >
              {avgPct > 8 && (
                <Typography sx={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 10, fontWeight: 700, color: '#fff',
                }}>{avgVal}%</Typography>
              )}
            </Box>
          </Tooltip>
          <Tooltip title={`Current: ${currentVal}%`}>
            <Box
              data-testid="trends-row-current"
              data-value={rr.current ?? ''}
              sx={{
                height: 13, borderRadius: '3px',
                background: rr.health === 'green'
                  ? 'linear-gradient(90deg, #43a047, #66bb6a)'
                  : rr.health === 'amber'
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
                }}>{currentVal}%</Typography>
              )}
            </Box>
          </Tooltip>
        </Box>
      </Box>

      {/* width must fit reopened(50) + total(44) + invalid(44) + TrendPill(~70) +
          download button(~34) + 4 gaps(8 each) + pl(16) ≈ 290px of minimum content —
          a narrower fixed width here clips the leftmost ("Reopened") stat first,
          since justifyContent:'flex-end' pushes overflow out to the left. */}
      <Box sx={{ width: 300, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, pl: 2 }}>
        <Box data-testid="trends-row-secondary" data-field="reopenedStoryCount" sx={{ textAlign: 'center', minWidth: 50 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>{project.sprints[0]?.reopenedStoryCount ?? 0}</Typography>
          <Typography sx={{ fontSize: 8, color: '#999', textTransform: 'uppercase' }}>Reopened</Typography>
        </Box>
        <Box data-testid="trends-row-total" sx={{ textAlign: 'center', minWidth: 44 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>{project.sprints[0]?.totalStoryCount ?? 0}</Typography>
          <Typography sx={{ fontSize: 8, color: '#999', textTransform: 'uppercase' }}>Total</Typography>
        </Box>
        <Tooltip title="Reopens disregarded this sprint via exclusion labels (Invalid-Reopen / Bad-Data / Scope-Change; case and separators normalised)">
          <Box data-testid="trends-row-invalid" data-field="invalidReopenCount" sx={{ textAlign: 'center', minWidth: 44 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, color: (project.sprints[0]?.invalidReopenCount ?? 0) > 0 ? '#ed6c02' : 'inherit' }}>{project.sprints[0]?.invalidReopenCount ?? 0}</Typography>
            <Typography sx={{ fontSize: 8, color: '#999', textTransform: 'uppercase' }}>Invalid</Typography>
          </Box>
        </Tooltip>
        <Box data-testid="trends-row-trend" data-trend={rr.trend} data-trend-pct={rr.trendPct}>
          <TrendPill trend={rr.trend} trendPct={rr.trendPct} />
        </Box>
        <TrendsDownloadButton accountId={accountId} projectId={project.projectId} tooltip={`Download ${project.projectName}'s trends`} />
      </Box>
    </Box>
  );
}

// ── Single-Project Chart ──────────────────────────────────────────────────

function SingleProjectChart({ project }: { project: ProjectQualityTrends }) {
  const rr = project.reopenRatio;
  const sprints = [...project.sprints].reverse();
  const chartData = sprints.map((s, i) => ({
    label: shortSprint(s.sprintName),
    fullName: s.sprintName,
    reopenRatio: s.reopenRatio,
    reopenedStoryCount: s.reopenedStoryCount,
    totalStoryCount: s.totalStoryCount,
    invalidReopenCount: s.invalidReopenCount ?? 0,
    isCurrent: i === sprints.length - 1,
  }));

  const hCfg = HEALTH_CONFIG[rr.health];
  const spanWord = project.isKanbanProject ? 'span' : 'sprint';
  const historyHasReopens = sprints.some(s => (s.reopenRatio ?? 0) > 0);
  const showZeroCurrentNote = (rr.current ?? 0) === 0 && historyHasReopens;

  return (
    <Box data-testid={`trends-single-chart-${project.projectId}`} data-sprint-count={chartData.length}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HealthDot health={rr.health} />
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
          <TrendPill trend={rr.trend} trendPct={rr.trendPct} />
        </Box>
      </Box>

      {showZeroCurrentNote && (
        <Typography data-testid="trends-zero-current-note" variant="caption"
          sx={{ display: 'block', mb: 1, color: '#888', fontStyle: 'italic' }}>
          Latest {spanWord}: 0 reopens — earlier {spanWord}s had reopens; see per-{spanWord} history below.
        </Typography>
      )}

      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} barGap={4} margin={{ top: 20, right: 20, left: -10, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 10 }} domain={[0, 'auto']} unit="%" />
          <ChartTooltip content={<ReopenTooltip />} />
          {rr.avg != null && (
            <ReferenceLine
              y={rr.avg}
              stroke="#ff9800"
              strokeDasharray="6 3"
              strokeWidth={2}
              label={{
                value: `Avg: ${rr.avg}%`,
                position: 'right',
                fill: '#ff9800',
                fontSize: 11,
                fontWeight: 700,
              }}
            />
          )}
          <Bar dataKey="reopenRatio" name="Reopen Ratio" radius={[4, 4, 0, 0]} barSize={40}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.isCurrent ? '#9c27b0' : '#ce93d8'} />
            ))}
            {/* Single series per sprint, so the value fits on the bar. */}
            <LabelList
              dataKey="reopenRatio"
              position="top"
              style={{ fontSize: 11, fontWeight: 600 }}
              formatter={(v: any) => (v == null ? '' : `${v}%`)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2.5, mt: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
          <Box sx={{ width: 12, height: 10, borderRadius: '2px', bgcolor: '#ce93d8' }} /> Historical
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
          <Box sx={{ width: 12, height: 10, borderRadius: '2px', bgcolor: '#9c27b0' }} /> Current Sprint
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

export function ReopenRatioTrend({ accountId }: Props) {
  const [v2Only, setV2Only] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | ''>('');

  const { data, isLoading, error } = useQualityTrends(v2Only, accountId);
  const projects = data?.projects ?? [];

  const [sortBy, setSortBy] = useState<'name' | 'val-desc' | 'val-asc' | 'trend-desc' | 'trend-asc'>('name');
  const sorted = [...projects].sort((a, b) => {
    switch (sortBy) {
      case 'val-desc': return (b.reopenRatio.current ?? 0) - (a.reopenRatio.current ?? 0);
      case 'val-asc':  return (a.reopenRatio.current ?? 0) - (b.reopenRatio.current ?? 0);
      case 'trend-desc': return b.reopenRatio.trendPct - a.reopenRatio.trendPct;
      case 'trend-asc':  return a.reopenRatio.trendPct - b.reopenRatio.trendPct;
      default: return a.projectName.localeCompare(b.projectName);
    }
  });

  const selectedProject = projects.find(p => p.projectId === selectedProjectId);
  const greens = projects.filter(p => p.reopenRatio.health === 'green').length;
  const ambers = projects.filter(p => p.reopenRatio.health === 'amber').length;
  const reds = projects.filter(p => p.reopenRatio.health === 'red').length;

  return (
    <Paper data-testid="trends-reopen" sx={{ mb: 3 }}>
      <Box sx={{
        px: 3, py: 2,
        background: 'linear-gradient(90deg, #f3e5f5 0%, #ffffff 100%)',
        borderBottom: '1px solid', borderColor: 'divider',
        display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
      }}>
        <ReplayIcon sx={{ color: '#9c27b0', fontSize: 22 }} />
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
          Reopen Ratio Trends
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
          Reopened Tickets / Total (Stories + Bugs)
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

        {projects.length === 1 && (
          <TrendsDownloadButton accountId={accountId as number} projectId={projects[0].projectId} label={`Download ${projects[0].projectName}`} />
        )}
        {projects.length > 1 && (
          <TrendsDownloadButton accountId={accountId as number} label="Download All Projects" />
        )}
      </Box>

      <Box sx={{ px: 3, py: 1.5, bgcolor: '#f8f9fa', borderBottom: '1px solid', borderColor: 'divider', fontSize: 11, color: '#666', lineHeight: 1.8 }}>
        <strong>Reopen Ratio</strong> = Reopened tickets / Total tickets (%), counting Stories and standalone Bugs (Sub-bugs are excluded) &nbsp;&bull;&nbsp;
        A ticket counts as &ldquo;reopened&rdquo; when its status moves from a QA / UAT / Done lane back to a Dev / In-Progress lane within the sprint &mdash; regardless of any intermediate statuses it passes through on the way (e.g. Blocked, Backlog, or a Reopened lane). This is detected from the ticket&rsquo;s own status history; a logged sub-bug that sent its parent back to dev also counts (whichever applies) &nbsp;&bull;&nbsp;
        <strong>Reopen exclusions (labels)</strong>: any of <code>Invalid-Reopen</code>, <code>Bad-Data</code>, <code>Scope-Change</code> subtracts ONE reopen event. Case and separators are normalised, so <code>BadData</code> and <code>bad_data</code> match &mdash; but a longer label that merely starts with one of them does not, so <code>Scope-Change-Approved</code> never excludes. Multiple distinct labels stack. A ticket with 2 reopen events + 1 exclusion label is still counted (net = 1); with 2 events + 2 labels, it is not (net = 0). Other Jira labels are ignored &nbsp;&bull;&nbsp;
        <strong>Prior Sprint Avg</strong> = Average of all sprints before the most recent &nbsp;&bull;&nbsp;
        <strong>Trend</strong>: Up (&gt;5% above avg), Down (&gt;5% below), Flat (within +/-5%) &nbsp;&bull;&nbsp;
        <strong>Health</strong>: <span style={{ color: '#2e7d32' }}>Green</span> (&lt; 10%), <span style={{ color: '#ed6c02' }}>Amber</span> (10-20%), <span style={{ color: '#d32f2f' }}>Red</span> (&gt; 20%) &nbsp;&bull;&nbsp;
        Lower is better &mdash; high reopen rates indicate incomplete development or insufficient testing
      </Box>

      {isLoading && (
        <Box sx={{ p: 3 }}>
          <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 1 }} />
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ m: 2 }}>
          Failed to load reopen ratio data: {(error as Error).message}
        </Alert>
      )}

      {!accountId && (
        <Box data-testid="trends-no-account" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">Select an account to view reopen ratio trends.</Typography>
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
                  <MenuItem value="val-desc">Reopen Rate (High-Low)</MenuItem>
                  <MenuItem value="val-asc">Reopen Rate (Low-High)</MenuItem>
                  <MenuItem value="trend-desc">Trend (High-Low)</MenuItem>
                  <MenuItem value="trend-asc">Trend (Low-High)</MenuItem>
                </Select>
              </Box>

              <Box sx={{ px: 3, pb: 1, display: 'flex', gap: 2, alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#ce93d8' }} /> Prior Sprint Avg
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#43a047' }} /> Healthy (&lt; 10%)
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#ed6c02' }} /> Attention (10-20%)
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 11, color: '#666' }}>
                  <Box sx={{ width: 14, height: 8, borderRadius: '2px', bgcolor: '#e53935' }} /> At Risk (&gt; 20%)
                </Box>
              </Box>

              <Box sx={{ pb: 2 }}>
                {(() => {
                  const allVals = projects.flatMap(x => [x.reopenRatio.current ?? 0, x.reopenRatio.avg ?? 0]);
                  const maxVal = (allVals.length > 0 ? Math.max(...allVals) : 1) * 1.15 || 1;
                  return sorted.map((p, i) => (
                    <Box key={p.projectId}>
                      <ProjectRow project={p} maxVal={maxVal} accountId={accountId as number} />
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
