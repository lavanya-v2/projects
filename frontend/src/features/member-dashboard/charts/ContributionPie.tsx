import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip } from 'recharts';
import { Paper, Typography, Box } from '@mui/material';
import { OTHER_SLICE_COLORS } from './chartCommon';
import type { Contribution } from '../types';

interface Props {
  contribution: Contribution;
  accentColor: string; // colour for the "You" slice
}

function PieTooltip({ active, payload, total }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
  return (
    <Paper elevation={3} sx={{ p: 1.5, fontSize: 12 }}>
      <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{d.name}</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
        <span>Contribution</span><strong>{d.value} ({pct}%)</strong>
      </Box>
    </Paper>
  );
}

export function ContributionPie({ contribution, accentColor }: Props) {
  // "You" first, then others by descending value.
  const slices = [...contribution.slices].sort((a, b) => {
    if (a.isYou !== b.isYou) return a.isYou ? -1 : 1;
    return b.value - a.value;
  });
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let otherIdx = 0;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          cx="42%"
          cy="50%"
          outerRadius={90}
          innerRadius={42}
          paddingAngle={2}
          label={({ percent }: any) => `${Math.round((percent ?? 0) * 100)}%`}
          labelLine={false}
        >
          {slices.map((s, i) => (
            <Cell
              key={i}
              fill={s.isYou ? accentColor : OTHER_SLICE_COLORS[otherIdx++ % OTHER_SLICE_COLORS.length]}
              stroke="#fff"
              strokeWidth={2}
            />
          ))}
        </Pie>
        <ChartTooltip content={<PieTooltip total={total} />} />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          wrapperStyle={{ fontSize: 12 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
