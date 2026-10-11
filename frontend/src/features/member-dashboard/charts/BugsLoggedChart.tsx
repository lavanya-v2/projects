import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { COLORS, SimpleTooltip, barValueLabel, shortSprint } from './chartCommon';

interface Props {
  data: { sprintName: string; bugs: number; subBugs: number }[];
}

export function BugsLoggedChart({ data }: Props) {
  const chartData = data.map(d => ({ label: shortSprint(d.sprintName), bugs: d.bugs, subBugs: d.subBugs }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} barGap={4} margin={{ top: 20, right: 16, left: -12, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: COLORS.axis }} />
        <YAxis tick={{ fontSize: 10, fill: COLORS.axis }} allowDecimals={false} domain={[0, 'auto']} />
        <ChartTooltip content={<SimpleTooltip />} cursor={{ fill: 'rgba(241,90,36,.06)' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {/* Two series per sprint, side by side (not stacked) — still uncluttered
            enough for on-bar values. */}
        <Bar dataKey="bugs" name="Bugs" fill={COLORS.orange} radius={[6, 6, 0, 0]} maxBarSize={32}>
          {barValueLabel('bugs')}
        </Bar>
        <Bar dataKey="subBugs" name="Sub-bugs" fill={COLORS.subBug} radius={[6, 6, 0, 0]} maxBarSize={32}>
          {barValueLabel('subBugs')}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
