import { Box, Chip, Paper, Stack, Typography } from '@mui/material';
import { WarningAmberRounded, CheckCircleRounded } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { usePendingReviewStatus } from '../performance-review/hooks';
import { PATHS } from '../../routes/paths';

const NAVY = '#002e5b';
const AMBER = '#8a5300';

/**
 * A small, dashboard-sized nudge — the viewer's own latest rating and whether
 * a review is pending, plus (when they're also a reviewer) how many of their
 * own assignments are unstarted. Renders nothing for the majority of viewers
 * who have no performance-review involvement at all, rather than an empty
 * card — this dashboard is not performance-review-specific.
 */
export function PendingReviewCard() {
  const { data } = usePendingReviewStatus();
  const navigate = useNavigate();

  if (!data || (!data.member && !data.lead)) return null;

  return (
    <Paper sx={{ p: 2.5, borderRadius: 3, border: '1px solid #e2e8f0', mb: 3.25 }}>
      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap alignItems="center">
        {data.member && (
          <Box
            sx={{ cursor: 'pointer' }}
            onClick={() => navigate(data.member!.hasPendingReview ? PATHS.TEAM_REVIEWS : PATHS.MY_PERFORMANCE_REVIEW)}
          >
            <Typography sx={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Your performance review
            </Typography>
            {data.member.hasPendingReview ? (
              <Chip
                size="small" icon={<WarningAmberRounded fontSize="inherit" />}
                label={`Pending for ${data.member.pendingCycle?.periodLabel ?? 'this period'} — follow up with your lead`}
                sx={{ mt: 0.5, fontSize: 12, bgcolor: '#fff4e5', color: AMBER, fontWeight: 600 }}
              />
            ) : data.member.latestPublished ? (
              <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mt: 0.25 }}>
                <Typography sx={{ fontSize: 22, fontWeight: 700, color: NAVY }}>
                  {Number(data.member.latestPublished.compositeScore ?? 0).toFixed(1)}
                </Typography>
                <Typography sx={{ fontSize: 12, color: '#6b7280' }}>
                  {data.member.latestPublished.periodLabel}
                </Typography>
              </Stack>
            ) : (
              <Typography sx={{ fontSize: 13, color: '#6b7280', mt: 0.5 }}>No published review yet</Typography>
            )}
          </Box>
        )}

        {data.lead && data.lead.pendingCount > 0 && (
          <Box sx={{ cursor: 'pointer' }} onClick={() => navigate(PATHS.TEAM_REVIEWS)}>
            <Typography sx={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              As a reviewer
            </Typography>
            <Chip
              size="small" icon={<WarningAmberRounded fontSize="inherit" />}
              label={`${data.lead.pendingCount} review${data.lead.pendingCount === 1 ? '' : 's'} still pending for ${data.lead.cycle?.periodLabel ?? 'this period'}`}
              sx={{ mt: 0.5, fontSize: 12, bgcolor: '#fff4e5', color: AMBER, fontWeight: 600 }}
            />
          </Box>
        )}

        {data.lead && data.lead.pendingCount === 0 && (
          <Box>
            <Typography sx={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              As a reviewer
            </Typography>
            <Chip
              size="small" icon={<CheckCircleRounded fontSize="inherit" />}
              label="All caught up"
              sx={{ mt: 0.5, fontSize: 12, bgcolor: '#e8f5e9', color: '#1b5e20' }}
            />
          </Box>
        )}
      </Stack>
    </Paper>
  );
}

export default PendingReviewCard;
