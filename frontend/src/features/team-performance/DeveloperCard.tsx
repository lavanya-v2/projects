import {
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Tooltip,
  Typography,
} from '@mui/material';
import { Rocket, WarningAmber } from '@mui/icons-material';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { barFill, deliveryColor } from './perfColors';
import { LOW_SP_THRESHOLD } from './perfConstants';
import { PipelineChips } from './PipelineChips';

/** Developer card for Trends view — shows BarChart for past sprints */
export function DeveloperCard({ card }: { card: any }) {
  const sprints: any[] = card.completedSprints ?? [];
  const avg = card.averages;
  const cur = card.currentSprint;

  const chartData = sprints.map(s => ({
    label: s.sprintName.split(' ').pop() ?? s.sprintName,
    planned: s.spPlanned,
    done: s.spDone,
    pct: s.deliveryPct,
    fullName: s.sprintName,
    spilloverCount: s.spilloverCount,
    spilloverSp: s.spilloverSp,
  }));

  const hasLowSpSprint = sprints.some(s => (s.spDone ?? 0) <= LOW_SP_THRESHOLD);
  const curLowSp = cur && (cur.spDone ?? 0) <= LOW_SP_THRESHOLD;

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        ...(hasLowSpSprint || curLowSp ? { borderColor: '#f57c00', borderWidth: 2 } : {}),
      }}
    >
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            {card.displayName}
          </Typography>
          {(hasLowSpSprint || curLowSp) && (
            <Tooltip title={`One or more sprints had ${LOW_SP_THRESHOLD} SP or fewer delivered`}>
              <WarningAmber sx={{ fontSize: 15, color: '#f57c00' }} />
            </Tooltip>
          )}
        </Box>
        {sprints.length > 0 && (
          <Chip
            label={`Avg ${avg.deliveryPct}%`}
            color={deliveryColor(avg.deliveryPct)}
            size="small"
          />
        )}
      </Box>

      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        {sprints.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No completed sprint data.
          </Typography>
        ) : (
          <>
            <Typography
              variant="caption"
              color="text.secondary"
              fontWeight={600}
              sx={{ display: 'block', mb: 0.5 }}
            >
              Past {sprints.length} sprint{sprints.length > 1 ? 's' : ''} — SP Planned vs Done
            </Typography>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={chartData} barGap={2} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 9, paddingTop: 2 }} />
                <ChartTooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(value: any, name: any) => [`${value} SP`, name]}
                  labelFormatter={(_: any, payload: readonly any[]) => {
                    const e = payload?.[0]?.payload;
                    return e ? `${e.fullName} — ${e.pct}% delivered` : '';
                  }}
                />
                <Bar dataKey="planned" name="Planned" fill="#90caf9" radius={[2, 2, 0, 0]} barSize={16} />
                <Bar dataKey="done" name="Done" radius={[2, 2, 0, 0]} barSize={16}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={barFill(entry.pct)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {sprints.some(s => s.spilloverCount > 0) && (
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                {sprints
                  .filter(s => s.spilloverCount > 0)
                  .map(s => (
                    <Tooltip
                      key={s.sprintId}
                      title={`${s.sprintName}: ${s.spilloverCount} ticket(s) spilled over (${s.spilloverSp} SP)`}
                    >
                      <Chip
                        label={`${s.sprintName.split(' ').pop() ?? s.sprintName}: ${s.spilloverCount}`}
                        size="small"
                        sx={{ fontSize: 10, height: 18, bgcolor: '#fff3e0', color: '#e65100' }}
                      />
                    </Tooltip>
                  ))}
              </Box>
            )}
          </>
        )}

        {cur && <Divider sx={{ my: 1 }} />}
        {cur && (
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <Rocket sx={{ fontSize: 13, color: '#1976d2' }} />
              <Typography variant="caption" fontWeight={700} color="primary">
                Current: {cur.sprintName}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography
                variant="caption"
                color={curLowSp ? 'warning.dark' : 'text.secondary'}
                fontWeight={curLowSp ? 700 : undefined}
              >
                {cur.spDone} / {cur.spPlanned} SP
                {curLowSp && ' low SP'}
              </Typography>
              <Chip
                label={`${cur.deliveryPct}%`}
                color={deliveryColor(cur.deliveryPct)}
                size="small"
                sx={{ fontSize: 10, height: 18 }}
              />
            </Box>
            {cur.breakdown && <PipelineChips bd={cur.breakdown} compact />}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
