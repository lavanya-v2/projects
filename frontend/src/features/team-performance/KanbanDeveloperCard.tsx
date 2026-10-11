import {
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
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
import { PipelineChips } from './PipelineChips';
import { shortenPeriodLabel } from '../../shared/utils/periodLabel';

/** Kanban developer card */
export function KanbanDeveloperCard({ card }: { card: any }) {
  const periods: any[] = card.periods ?? [];
  const bd = card.currentBreakdown;
  const totalOpen: number = card.totalOpenTickets ?? 0;

  const chartData = periods.map((p: any) => ({
    // Was splitting on an en-dash ('–') that cycleLabel never emits (it uses a
    // plain ASCII hyphen), so the full label landed unshortened on an 8px axis.
    xLabel: shortenPeriodLabel(p.label),
    fullLabel: p.label,
    stories: p.storiesDelivered,
    sp: p.spDelivered,
    reopens: p.reopenedCount ?? 0,
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
          label={`~${card.avgStoriesPerPeriod} tkts/period`}
          size="small"
          color="primary"
          variant="outlined"
        />
      </Box>

      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        {periods.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No delivery data in this range.
          </Typography>
        ) : (
          <>
            <Typography
              variant="caption"
              color="text.secondary"
              fontWeight={600}
              sx={{ display: 'block', mb: 0.5 }}
            >
              Tickets delivered per period
            </Typography>
            <ResponsiveContainer width="100%" height={110}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <XAxis dataKey="xLabel" tick={{ fontSize: 8 }} interval={0} />
                <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                <ChartTooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(value: any, name: any) =>
                    name === 'stories'
                      ? [`${value} tickets`, 'Delivered']
                      : name === 'reopens'
                        ? [`${value}`, 'Re-opens']
                        : [`${value} SP`, 'Story Points']
                  }
                  labelFormatter={(_: any, payload: readonly any[]) => {
                    const e = payload?.[0]?.payload;
                    return e ? e.fullLabel : '';
                  }}
                />
                <Bar dataKey="stories" name="stories" fill="#42a5f5" radius={[2, 2, 0, 0]} barSize={14} />
                <Bar dataKey="reopens" name="reopens" fill="#ef5350" radius={[2, 2, 0, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Avg: <strong>{card.avgStoriesPerPeriod}</strong> tickets &nbsp;·&nbsp;{' '}
              <strong>{card.avgSpPerPeriod}</strong> SP &nbsp;·&nbsp;{' '}
              <strong>{card.avgReopensPerPeriod ?? 0}</strong> re-opens per period
            </Typography>
          </>
        )}

        {totalOpen > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Box>
              <Typography
                variant="caption"
                fontWeight={700}
                color="primary"
                sx={{ display: 'block', mb: 0.5 }}
              >
                Open Work ({totalOpen} ticket{totalOpen !== 1 ? 's' : ''})
              </Typography>
              <PipelineChips bd={bd} compact />
            </Box>
          </>
        )}
        {totalOpen === 0 && periods.length > 0 && (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography variant="caption" color="text.secondary">
              No open tickets currently assigned.
            </Typography>
          </>
        )}
      </CardContent>
    </Card>
  );
}
