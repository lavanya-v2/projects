import { Paper, Typography, Box } from '@mui/material';
import { LabelList } from 'recharts';
import { shortenPeriodLabel } from '../../../shared/utils/periodLabel';

export const COLORS = {
  indigo: '#4f46e5',
  orange: '#f15a24',
  green: '#10b981',
  reopen: '#ff9800',
  carryover: '#f59e0b',
  subBug: '#fdba8c',
  axis: '#64748b',
  grid: '#eef2f7',
};

// Slice palette for "other" teammates in contribution pies (the "You" slice is
// coloured separately). Cycles if there are more teammates than colours.
export const OTHER_SLICE_COLORS = ['#94a3b8', '#cbd5e1', '#64b5f6', '#90caf9', '#b0bec5', '#e2e8f0', '#a5b4fc'];

// Sprint/cycle/week label shortening lives in shared/utils/periodLabel.ts --
// see there for why (this used to take the trailing whitespace token, which
// collapsed every Kanban cycle/week label ending in a bare year to "2026").
export const shortSprint = shortenPeriodLabel;

/**
 * On-bar value label for uncluttered charts (at most two series per X value,
 * never stacked) — reading the number off the Y axis is guesswork otherwise.
 * Returns a real <LabelList> element because recharts inspects the element type
 * of a <Bar>'s children; a wrapper component would not be recognised.
 * Zeros/nulls render nothing rather than a "0" floating over an empty column.
 */
export function barValueLabel(dataKey: string) {
  return (
    <LabelList
      dataKey={dataKey}
      position="top"
      style={{ fontSize: 11, fontWeight: 600, fill: COLORS.axis }}
      formatter={(v: any) => (v == null || v === 0 ? '' : `${v}`)}
    />
  );
}

export function SimpleTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <Paper elevation={3} sx={{ p: 1.5, fontSize: 12 }}>
      <Typography sx={{ fontWeight: 700, fontSize: 13, mb: 0.5 }}>{label}</Typography>
      {payload.map((p: any) => (
        <Box key={p.dataKey} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>{p.value}</strong>
        </Box>
      ))}
    </Paper>
  );
}
