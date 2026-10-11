import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import {
  CheckCircleRounded, WarningAmberRounded, ArrowUpwardRounded, ArrowDownwardRounded,
  RemoveRounded, StarRounded,
} from '@mui/icons-material';
import { useMyReviews, useMyReview, useAcknowledgeReview } from '../hooks';
import { EvidencePanel } from '../lead/EvidencePanel';
import { ScoreTrendChart, COLOR_COMPOSITE, COLOR_SYSTEM, COLOR_LEAD } from '../shared/ScoreTrendChart';

const NAVY = '#002e5b';
// Status colors, matching the health palette used elsewhere in Team Performance.
const GREEN = '#2e7d32';
const RED = '#d32f2f';

const TREND_ICON = {
  improved: <ArrowUpwardRounded sx={{ fontSize: 14, color: GREEN }} />,
  declined: <ArrowDownwardRounded sx={{ fontSize: 14, color: RED }} />,
  flat: <RemoveRounded sx={{ fontSize: 14, color: '#9ca3af' }} />,
  na: null,
} as const;

/**
 * The member's own performance review — read-only, since beginning.
 *
 * Every number here is scoped server-side to the caller's own team member record
 * and to published reviews only; there is nothing here to select or browse into
 * someone else's data. The full drill-down on a selected period is the same
 * evidence the lead rated against, not a summary of it.
 */
export function MyPerformanceReview() {
  const { data, isLoading } = useMyReviews();
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'consolidated'>('single');
  const [ackTarget, setAckTarget] = useState<{ reviewId: number } | null>(null);
  const [ackComment, setAckComment] = useState('');
  const acknowledge = useAcknowledgeReview();

  const trend = data?.trend ?? [];
  const chartData = useMemo(
    () =>
      trend.map(t => ({
        period: t.periodLabel,
        cycleId: t.cycleId,
        Composite: t.composite,
        System: t.systemScore,
        Lead: t.leadScore,
        isProvisional: t.isProvisional,
      })),
    [trend],
  );

  const latest = trend.length > 0 ? trend[trend.length - 1] : null;
  const detailCycleId = selectedCycleId ?? latest?.cycleId ?? null;

  if (isLoading) return <CircularProgress size={22} />;

  if (!data?.teamMember) {
    return (
      <Alert severity="info" sx={{ fontSize: 13 }}>
        We could not match your login to a team roster record, so there is nothing to show yet. If
        you believe this is wrong, contact your account admin.
      </Alert>
    );
  }

  if (trend.length === 0) {
    return (
      <Alert severity="info" sx={{ fontSize: 13 }}>
        No published review yet. Once your lead completes and publishes a review for a period, it
        will appear here.
      </Alert>
    );
  }

  return (
    <Box>
      <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY, mb: 0.5 }}>
        My Review
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2.5 }}>
        Every period your lead has published, since the beginning. Scores blend your delivery data
        with your lead's review — hover a point for the breakdown.
      </Typography>

      {/* ── Trend since the beginning ────────────────────────────────────── */}
      <ScoreTrendChart data={chartData} onSelectCycle={id => { setSelectedCycleId(id); setViewMode('single'); }} />

      {/* ── View toggle ──────────────────────────────────────────────────── */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <ToggleButtonGroup
          size="small" exclusive value={viewMode}
          onChange={(_, v) => v && setViewMode(v)}
          sx={{ '& .MuiToggleButton-root': { fontSize: 12, textTransform: 'none', px: 1.5 } }}
        >
          <ToggleButton value="single">Single period</ToggleButton>
          <ToggleButton value="consolidated">All periods together</ToggleButton>
        </ToggleButtonGroup>

        {viewMode === 'single' && (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {trend.map(t => (
              <Chip
                key={t.cycleId}
                size="small"
                label={t.periodLabel ?? `#${t.cycleId}`}
                onClick={() => setSelectedCycleId(t.cycleId)}
                icon={t.isProvisional ? <WarningAmberRounded sx={{ fontSize: 14 }} /> : undefined}
                sx={{
                  fontSize: 11.5,
                  bgcolor: t.cycleId === detailCycleId ? NAVY : '#eef2f7',
                  color: t.cycleId === detailCycleId ? '#fff' : '#374151',
                  fontWeight: t.cycleId === detailCycleId ? 600 : 400,
                }}
              />
            ))}
          </Stack>
        )}
      </Stack>

      {/* ── Single-period detail, with full evidence drill-down ─────────── */}
      {viewMode === 'single' && detailCycleId && (
        <PeriodDetail
          cycleId={detailCycleId}
          trendPoint={trend.find(x => x.cycleId === detailCycleId) ?? null}
          showEvidence
          onAcknowledge={reviewId => setAckTarget({ reviewId })}
        />
      )}

      {/* ── Consolidated view: every published period, full narrative and ──
          ratings stacked together — no new blended score, purely a display
          of what already exists on the single-period screen, all at once.
          The full sprint-level evidence drill-down stays a single-period
          feature (linked from each card) to keep this page light. ────────── */}
      {viewMode === 'consolidated' && (
        <Stack spacing={2.5}>
          {[...trend].reverse().map(t => (
            <PeriodDetail
              key={t.cycleId}
              cycleId={t.cycleId}
              trendPoint={t}
              showEvidence={false}
              onAcknowledge={reviewId => setAckTarget({ reviewId })}
            />
          ))}
        </Stack>
      )}

      <Dialog open={!!ackTarget} onClose={() => setAckTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontSize: 16 }}>Acknowledge this review</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth multiline minRows={3} autoFocus sx={{ mt: 1 }}
            label="Comment (optional)" value={ackComment} onChange={e => setAckComment(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setAckTarget(null)}>Cancel</Button>
          <Button
            size="small" variant="contained" disabled={acknowledge.isPending}
            sx={{ bgcolor: NAVY }}
            onClick={() =>
              ackTarget && acknowledge.mutate(
                { reviewId: ackTarget.reviewId, comment: ackComment || null },
                { onSuccess: () => { setAckTarget(null); setAckComment(''); } },
              )
            }
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** One period's full detail — the same content whether reached via the single-period chips or stacked in the consolidated view. */
function PeriodDetail({
  cycleId, trendPoint, showEvidence, onAcknowledge,
}: {
  cycleId: number;
  trendPoint: { periodLabel: string | null; trendDirection: 'improved' | 'declined' | 'flat' | 'na'; trendDelta: number | null } | null;
  showEvidence: boolean;
  onAcknowledge: (reviewId: number) => void;
}) {
  const { data: detail, isLoading } = useMyReview(cycleId);

  if (isLoading) return <CircularProgress size={20} />;
  if (!detail) return null;

  return (
    <Stack spacing={2.5}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        {!showEvidence && trendPoint?.periodLabel && (
          <Typography sx={{ fontWeight: 600, fontSize: 13, color: NAVY, mb: 1.5 }}>
            {trendPoint.periodLabel}
          </Typography>
        )}
        <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap alignItems="center">
          <Stat label="Composite" value={fmt(detail.score?.compositeScore)} color={COLOR_COMPOSITE} big />
          <Divider orientation="vertical" flexItem />
          <Stat label="Performance data" value={fmt(detail.score?.systemScore)} color={COLOR_SYSTEM} />
          <Stat label="Lead review" value={fmt(detail.score?.leadScore)} color={COLOR_LEAD} />
          <Divider orientation="vertical" flexItem />
          <Box>
            <Typography sx={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Coverage
            </Typography>
            <Chip
              size="small"
              icon={detail.score?.isProvisional ? <WarningAmberRounded fontSize="inherit" /> : <CheckCircleRounded fontSize="inherit" />}
              label={detail.score?.isProvisional ? 'Provisional' : 'Complete'}
              sx={{
                fontSize: 11, mt: 0.5,
                bgcolor: detail.score?.isProvisional ? '#fff8e1' : '#e8f5e9',
                color: detail.score?.isProvisional ? '#8a5300' : '#1b5e20',
              }}
            />
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {trendPoint && trendPoint.trendDirection !== 'na' && (
            <Tooltip title="Change from the previous period">
              <Stack direction="row" spacing={0.5} alignItems="center">
                {TREND_ICON[trendPoint.trendDirection]}
                <Typography sx={{ fontSize: 13 }}>{trendPoint.trendDelta}</Typography>
              </Stack>
            </Tooltip>
          )}
        </Stack>

        {detail.score?.isProvisional && (
          <Alert severity="warning" sx={{ mt: 1.5, fontSize: 12.5 }}>
            This period's score is provisional — one of the factors was missing or based on limited
            data when it was computed. It may still be updated.
          </Alert>
        )}
      </Paper>

      {/* Lead's narrative — exactly what was published. */}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14, color: NAVY, mb: 1.5 }}>
          Your lead's review
          {detail.reviewer && (
            <Typography component="span" sx={{ fontSize: 12, color: '#6b7280', ml: 1, fontWeight: 400 }}>
              — {detail.reviewer.firstName} {detail.reviewer.lastName}
            </Typography>
          )}
        </Typography>

        {detail.review.strengths && (
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#1b5e20' }}>Strengths</Typography>
            <Typography sx={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{detail.review.strengths}</Typography>
          </Box>
        )}
        {detail.review.improvements && (
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#8a5300' }}>Areas to improve</Typography>
            <Typography sx={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{detail.review.improvements}</Typography>
          </Box>
        )}
        {detail.review.overallComment && (
          <Box sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Overall</Typography>
            <Typography sx={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{detail.review.overallComment}</Typography>
          </Box>
        )}

        <Divider sx={{ my: 1.5 }} />

        {(detail.template?.items ?? []).filter(i => i.inputType === 'rating').map(item => {
          const rating = detail.ratings.find(r => r.templateItemId === item.id);
          if (!rating || rating.na) return null;
          return (
            <Box key={item.id} sx={{ mb: 1.25 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{item.label}</Typography>
                <Stack direction="row">
                  {Array.from({ length: detail.template!.ratingScaleMax }).map((_, i) => (
                    <StarRounded key={i} sx={{
                      fontSize: 15,
                      color: i < (rating.rating ?? 0) ? COLOR_LEAD : '#e0e4ea',
                    }} />
                  ))}
                </Stack>
              </Stack>
              {rating.comment && (
                <Typography sx={{ fontSize: 12.5, color: '#6b7280', mt: 0.25 }}>{rating.comment}</Typography>
              )}
            </Box>
          );
        })}

        {!detail.review.acknowledgedAt ? (
          <Box sx={{ mt: 2 }}>
            <Button size="small" variant="contained" sx={{ bgcolor: NAVY, '&:hover': { bgcolor: '#001f3d' } }}
              onClick={() => onAcknowledge(detail.review.id)}>
              Acknowledge this review
            </Button>
            <Typography sx={{ fontSize: 11.5, color: '#9ca3af', mt: 0.5 }}>
              Confirms you've seen it. Optional to add a comment of your own.
            </Typography>
          </Box>
        ) : (
          <Alert severity="success" sx={{ mt: 2, fontSize: 12.5 }}>
            Acknowledged on {new Date(detail.review.acknowledgedAt).toLocaleDateString()}.
            {detail.review.acknowledgementComment && ` "${detail.review.acknowledgementComment}"`}
          </Alert>
        )}
      </Paper>

      {/* Full drill-down: the same evidence the lead rated against. */}
      {showEvidence && (
        <Box>
          <Typography sx={{ fontWeight: 600, fontSize: 14, color: NAVY, mb: 1 }}>
            The performance data behind this review
          </Typography>
          <EvidencePanel review={detail.review} />
        </Box>
      )}
    </Stack>
  );
}

function fmt(v: number | null | undefined): string {
  return v == null ? '—' : Number(v).toFixed(1);
}

function Stat({ label, value, color, big }: { label: string; value: string; color: string; big?: boolean }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: big ? 26 : 18, fontWeight: 700, color }}>{value}</Typography>
    </Box>
  );
}

export default MyPerformanceReview;
