import {
  Box,
  Card,
  CardContent,
  Chip,
  Typography,
} from '@mui/material';
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { shortenPeriodLabel } from '../../shared/utils/periodLabel';

/** Kanban QA card — bugs raised + tickets tested per period. */
export function KanbanQaCard({ card }: { card: any }) {
  const periods: any[] = card.periods ?? [];

  const chartData = periods.map((p: any) => ({
    // Was splitting on an en-dash ('–') that cycleLabel never emits (it uses a
    // plain ASCII hyphen), so the full label landed unshortened on an 8px axis.
    xLabel: shortenPeriodLabel(p.label),
    fullLabel: p.label,
    bugs: p.bugsRaised,
    tested: p.ticketsTested,
  }));

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <Box
        sx={{
          px: 2,
          py: 1.5,
          bgcolor: '#f5f5f5',
          borderBottom: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="subtitle2" fontWeight={700}>
          {card.displayName}
        </Typography>
        <Chip
          label={`~${card.avgTestedPerPeriod} tested/period`}
          size="small"
          color="success"
          variant="outlined"
        />
      </Box>

      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        {periods.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No QA activity in this range.
          </Typography>
        ) : (
          <>
            <Typography
              variant="caption"
              color="text.secondary"
              fontWeight={600}
              sx={{ display: 'block', mb: 0.5 }}
            >
              Bugs raised &amp; tickets tested per period
            </Typography>
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <XAxis dataKey="xLabel" tick={{ fontSize: 8 }} interval={0} />
                <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                <ChartTooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(value: any, name: any) =>
                    name === 'bugs'
                      ? [`${value}`, 'Bugs raised']
                      : [`${value}`, 'Tickets tested']
                  }
                  labelFormatter={(_: any, payload: readonly any[]) => {
                    const e = payload?.[0]?.payload;
                    return e ? e.fullLabel : '';
                  }}
                />
                <Bar dataKey="tested" name="tested" fill="#26a69a" radius={[2, 2, 0, 0]} barSize={14} />
                <Bar dataKey="bugs" name="bugs" fill="#7e57c2" radius={[2, 2, 0, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Avg: <strong>{card.avgBugsPerPeriod}</strong> bugs &nbsp;·&nbsp;{' '}
              <strong>{card.avgTestedPerPeriod}</strong> tested per period
            </Typography>
          </>
        )}
      </CardContent>
    </Card>
  );
}
