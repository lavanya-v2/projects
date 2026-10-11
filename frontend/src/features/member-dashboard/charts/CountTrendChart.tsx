import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { COLORS, SimpleTooltip, barValueLabel, shortSprint } from './chartCommon';
import type { TrendPoint } from '../types';

interface Props {
  data: TrendPoint[];
  color: string;
  name: string;
}

/** Generic per-sprint count bar chart (reopens, carryovers, tickets tested). */
export function CountTrendChart({ data, color, name }: Props) {
  const chartData = data.map(d => ({ label: shortSprint(d.sprintName), value: d.value }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 20, right: 16, left: -12, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.axis }} />
        <YAxis tick={{ fontSize: 10, fill: COLORS.axis }} allowDecimals={false} domain={[0, 'auto']} />
        <ChartTooltip content={<SimpleTooltip />} cursor={{ fill: 'rgba(100,116,139,.08)' }} />
        <Bar dataKey="value" name={name} fill={color} radius={[6, 6, 0, 0]} maxBarSize={46}>
          {barValueLabel('value')}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
