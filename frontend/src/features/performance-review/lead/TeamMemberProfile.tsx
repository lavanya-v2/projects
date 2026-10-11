import { useMemo } from 'react';
import {
  Alert, Box, Chip, CircularProgress, Dialog, DialogContent, Divider, Paper,
  Stack, Tooltip, Typography,
} from '@mui/material';
import { LockRounded, StarRounded, CheckCircleRounded, WarningAmberRounded } from '@mui/icons-material';
import { useTeamMemberHistory } from '../hooks';
import { ScoreTrendChart, COLOR_COMPOSITE, COLOR_SYSTEM, COLOR_LEAD } from '../shared/ScoreTrendChart';
import type { HistoryCycle } from '../types';

const NAVY = '#002e5b';

/**
 * A lead's view of one team member across every review period they have ever
 * been part of — including periods before they joined this lead's team, or
 * under a different lead.
 *
 * The confidentiality boundary is enforced server-side, not here: a period
 * authored by a different lead arrives with `review.redacted: true` and
 * literally no narrative/rating fields in the payload. This component never
 * has anything to hide for those periods — there is nothing to accidentally
 * render.
 */
export function TeamMemberProfile({ teamMemberId, onClose }: { teamMemberId: number; onClose: () => void }) {
  const { data, isLoading, isError, error } = useTeamMemberHistory(teamMemberId);

  const chartData = useMemo(
    () =>
      (data?.cycles ?? []).map(c => ({
        period: c.periodLabel,
        cycleId: c.cycleId,
        Composite: c.score?.compositeScore ?? null,
        System: c.score?.systemScore ?? null,
        Lead: c.score?.leadScore ?? null,
      })),
    [data],
  );

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogContent sx={{ p: 3 }}>
        {isLoading && <CircularProgress size={22} />}

        {isError && (
          <Alert severity={(error as any)?.response?.status === 403 ? 'warning' : 'error'} sx={{ fontSize: 13 }}>
            {(error as any)?.response?.status === 403
              ? "You can only view the history of people currently assigned to you."
              : 'Could not load this person\'s history.'}
          </Alert>
        )}

        {data && (
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY, mb: 0.5 }}>
              {data.teamMember.firstName} {data.teamMember.lastName}
            </Typography>
            <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2.5 }}>
              Every review period this person has been part of, across any team. Periods reviewed by
              someone else show only the numbers — the narrative and ratings stay with that reviewer.
            </Typography>

            {data.cycles.length === 0 ? (
              <Alert severity="info" sx={{ fontSize: 13 }}>
                No review history yet for this person.
              </Alert>
            ) : (
              <>
                <ScoreTrendChart
                  data={chartData}
                  caption="Solid segments are periods you reviewed; dashed periods belong to another lead — hover for the number only."
                />

                <Stack spacing={2}>
                  {[...data.cycles].reverse().map(cycle => (
                    <CycleCard key={cycle.cycleId} cycle={cycle} />
                  ))}
                </Stack>
              </>
            )}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CycleCard({ cycle }: { cycle: HistoryCycle }) {
  const s = cycle.score;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 13 }}>{cycle.periodLabel}</Typography>
        <Chip
          size="small"
          label={cycle.status}
          sx={{ fontSize: 10.5, bgcolor: '#eef2f7', color: '#374151' }}
        />
      </Stack>

      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        <Stat label="Composite" value={fmt(s?.compositeScore)} color={COLOR_COMPOSITE} />
        <Stat label="System" value={fmt(s?.systemScore)} color={COLOR_SYSTEM} />
        <Stat label="Lead" value={fmt(s?.leadScore)} color={COLOR_LEAD} />
        {s && (
          <Chip
            size="small"
            icon={s.isProvisional ? <WarningAmberRounded fontSize="inherit" /> : <CheckCircleRounded fontSize="inherit" />}
            label={s.isProvisional ? 'Provisional' : `${Math.round(s.overallCoverage ?? 0)}% coverage`}
            sx={{
              fontSize: 11, alignSelf: 'center',
              bgcolor: s.isProvisional ? '#fff8e1' : '#e8f5e9',
              color: s.isProvisional ? '#8a5300' : '#1b5e20',
            }}
          />
        )}
      </Stack>

      {!cycle.review && (
        <Typography sx={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>
          Not reviewed this period.
        </Typography>
      )}

      {cycle.review?.redacted && (
        <Tooltip title="This review was written by a different lead — its narrative and ratings are confidential to that reviewer relationship.">
          <Alert
            severity="info" icon={<LockRounded fontSize="inherit" />}
            sx={{ fontSize: 12, py: 0.25, bgcolor: '#f3f4f6', color: '#4b5563' }}
          >
            Reviewed by {cycle.review.reviewerName ?? 'another team lead'} — details are confidential.
          </Alert>
        </Tooltip>
      )}

      {cycle.review && !cycle.review.redacted && (
        <Box>
          <Divider sx={{ my: 1 }} />
          <Typography sx={{ fontSize: 11.5, color: '#9ca3af', mb: 0.75 }}>
            Reviewed by {cycle.review.reviewerName ?? 'you'}
          </Typography>
          {cycle.review.strengths && (
            <Typography sx={{ fontSize: 12.5, mb: 0.5 }}>
              <strong>Strengths:</strong> {cycle.review.strengths}
            </Typography>
          )}
          {cycle.review.improvements && (
            <Typography sx={{ fontSize: 12.5, mb: 0.5 }}>
              <strong>Improve:</strong> {cycle.review.improvements}
            </Typography>
          )}
          {cycle.review.ratings.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
              {cycle.review.ratings.filter(r => !r.na && r.rating != null).map(r => (
                <Tooltip key={r.templateItemId} title={r.comment ?? ''}>
                  <Chip
                    size="small" icon={<StarRounded sx={{ fontSize: 13 }} />}
                    label={r.rating} sx={{ fontSize: 10.5, height: 20 }}
                  />
                </Tooltip>
              ))}
            </Stack>
          )}
        </Box>
      )}
    </Paper>
  );
}

function fmt(v: number | null | undefined): string {
  return v == null ? '—' : Number(v).toFixed(1);
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 10.5, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 16, fontWeight: 700, color }}>{value}</Typography>
    </Box>
  );
}

export default TeamMemberProfile;
