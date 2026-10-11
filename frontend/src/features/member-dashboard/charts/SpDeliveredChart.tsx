import {
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { COLORS, SimpleTooltip, barValueLabel, shortSprint } from './chartCommon';
import type { TrendPoint } from '../types';

interface Props {
  data: TrendPoint[];
  avg: number;
}

export function SpDeliveredChart({ data, avg }: Props) {
  const chartData = data.map(d => ({ label: shortSprint(d.sprintName), sprintName: d.sprintName, value: d.value }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 20, right: 16, left: -12, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.axis }} />
        <YAxis tick={{ fontSize: 10, fill: COLORS.axis }} domain={[0, 'auto']} />
        <ChartTooltip content={<SimpleTooltip />} cursor={{ fill: 'rgba(79,70,229,.06)' }} />
        <Bar dataKey="value" name="Story Points" fill={COLORS.indigo} radius={[6, 6, 0, 0]} maxBarSize={46}>
          {barValueLabel('value')}
        </Bar>
        {avg > 0 && (
          <ReferenceLine
            y={avg}
            stroke="#ef4444"
            strokeDasharray="6 5"
            label={{ value: `avg ${avg}`, position: 'right', fill: '#ef4444', fontSize: 11 }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
