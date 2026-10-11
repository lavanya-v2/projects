import { Paper, Typography } from '@mui/material';
import {
  Line, LineChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip,
  XAxis, YAxis,
} from 'recharts';

// Categorical trio, validated for CVD separation and normal-vision distinction
// against a light surface (dataviz skill, validate_palette.js — all checks pass).
// Shared so a member's own trend and a lead's view of someone else's trend never
// drift into different colors for the same three series.
export const COLOR_COMPOSITE = '#1565c0';
export const COLOR_SYSTEM = '#00897b';
export const COLOR_LEAD = '#ef6c00';

export interface TrendPoint {
  /** null renders as a blank tick — a period genuinely without a resolved label. */
  period: string | null;
  cycleId: number;
  Composite: number | null;
  System: number | null;
  Lead: number | null;
}

/**
 * The composite/system/lead trend line, since the beginning.
 *
 * Used by both a member's own view and a lead's view of someone else's history —
 * extracted so the two never render the same three series in different colors or
 * with different click behaviour.
 */
export function ScoreTrendChart({
  data,
  onSelectCycle,
  caption = 'Click a point on the Composite line to see that period in full below.',
}: {
  data: TrendPoint[];
  onSelectCycle?: (cycleId: number) => void;
  caption?: string;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e0e4ea' }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={{ stroke: '#e0e4ea' }} />
          <ChartTooltip
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
            formatter={(value: any) => (value == null ? '—' : Number(value).toFixed(1))}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone" dataKey="Composite" stroke={COLOR_COMPOSITE} strokeWidth={2.5}
            dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls
            onClick={(p: any) => onSelectCycle && p?.payload?.cycleId && onSelectCycle(p.payload.cycleId)}
            style={{ cursor: onSelectCycle ? 'pointer' : undefined }}
          />
          <Line type="monotone" dataKey="System" stroke={COLOR_SYSTEM} strokeWidth={1.5}
            dot={{ r: 2.5 }} strokeDasharray="4 3" connectNulls />
          <Line type="monotone" dataKey="Lead" stroke={COLOR_LEAD} strokeWidth={1.5}
            dot={{ r: 2.5 }} strokeDasharray="4 3" connectNulls />
        </LineChart>
      </ResponsiveContainer>
      {caption && (
        <Typography sx={{ fontSize: 11, color: '#9ca3af', mt: 1 }}>{caption}</Typography>
      )}
    </Paper>
  );
}

export default ScoreTrendChart;
