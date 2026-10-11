import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent, LinearProgress,
  MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material';
import { EditRounded, VisibilityRounded } from '@mui/icons-material';
import { useAccount } from '../../../context/UseAccount';
import { useCycles, useReviewAssignments, useOpenReview } from '../hooks';
import { LeadReviewForm, StatusChip } from './LeadReviewForm';
import { TeamMemberProfile } from './TeamMemberProfile';
import type { ReviewAssignment } from '../types';

const NAVY = '#002e5b';

/**
 * The lead's worklist for a review cycle.
 *
 * Shows only the people assigned to the signed-in reviewer — a lead drafting
 * privately is the point, so other leads' in-progress reviews are not listed.
 * Managers and superusers see everyone.
 */
export function LeadReviewWorkspace() {
  const { activeAccount } = useAccount();
  const [cycleId, setCycleId] = useState<number | null>(null);
  const [openFor, setOpenFor] = useState<{ reviewId: number; name: string } | null>(null);
  const [profileFor, setProfileFor] = useState<number | null>(null);

  const { data: cycles = [], isLoading: cyclesLoading } = useCycles(activeAccount?.id);
  const { data: assignments = [], isLoading } = useReviewAssignments(cycleId);
  const openReview = useOpenReview();

  // Default to the most recent cycle that is actually open for review.
  const defaultCycle = useMemo(
    () => cycles.find((c: any) => c.status === 'open') ?? cycles[0],
    [cycles],
  );
  const effectiveCycleId = cycleId ?? defaultCycle?.id ?? null;
  if (cycleId === null && defaultCycle) setCycleId(defaultCycle.id);

  const selectedCycle = cycles.find((c: any) => c.id === effectiveCycleId);

  const counts = useMemo(() => {
    const done = assignments.filter(a => a.review?.status === 'published').length;
    const submitted = assignments.filter(a => a.review?.status === 'submitted').length;
    const started = assignments.filter(a => a.review?.status === 'draft').length;
    return { done, submitted, started, total: assignments.length };
  }, [assignments]);

  const openRow = (a: ReviewAssignment) => {
    const name = a.teamMember ? `${a.teamMember.firstName} ${a.teamMember.lastName}` : `#${a.teamMemberId}`;
    if (a.review) {
      setOpenFor({ reviewId: a.review.id, name });
      return;
    }
    openReview.mutate(
      { cycleId: effectiveCycleId!, teamMemberId: a.teamMemberId },
      { onSuccess: detail => setOpenFor({ reviewId: detail.review.id, name }) },
    );
  };

  if (!activeAccount) {
    return <Alert severity="info" sx={{ fontSize: 13 }}>Select an account to see your reviews.</Alert>;
  }

  return (
    <Box>
      <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY, mb: 0.5 }}>
        Team Reviews
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2.5 }}>
        Your periodic review of each person assigned to you. Drafts are private until you publish —
        the member sees nothing before then.
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2.5 }}>
        <TextField
          select size="small" label="Review period" sx={{ minWidth: 260 }}
          value={effectiveCycleId ?? ''} disabled={cyclesLoading || cycles.length === 0}
          onChange={e => setCycleId(Number(e.target.value))}
        >
          {cycles.map((c: any) => (
            <MenuItem key={c.id} value={c.id}>
              {c.periodLabel} — {c.status}
            </MenuItem>
          ))}
        </TextField>
        {(isLoading || openReview.isPending) && <CircularProgress size={18} />}
      </Stack>

      {cycles.length === 0 && !cyclesLoading && (
        <Alert severity="info" sx={{ fontSize: 13 }}>
          No review periods exist for this account yet. A superuser creates them under
          Administration → Performance Review.
        </Alert>
      )}

      {selectedCycle && selectedCycle.status === 'scheduled' && (
        <Alert severity="warning" sx={{ mb: 2, fontSize: 13 }}>
          This period has not been opened yet, so there is nothing to review. A superuser opens it
          once the period's delivery data has settled.
        </Alert>
      )}

      {assignments.length > 0 && (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
            <Chip size="small" label={`${counts.total} assigned`} sx={{ fontSize: 11 }} />
            <Chip size="small" label={`${counts.started} in draft`} sx={{ fontSize: 11, bgcolor: '#eef2f7' }} />
            <Chip size="small" label={`${counts.submitted} submitted`} sx={{ fontSize: 11, bgcolor: '#fff4e5', color: '#8a5300' }} />
            <Chip size="small" label={`${counts.done} published`} sx={{ fontSize: 11, bgcolor: '#e8f5e9', color: '#1b5e20' }} />
          </Stack>
          <LinearProgress
            variant="determinate"
            value={counts.total === 0 ? 0 : (counts.done / counts.total) * 100}
            sx={{ mb: 2.5, height: 6, borderRadius: 3 }}
          />

          <Paper variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 12 }}>Team member</TableCell>
                  <TableCell sx={{ fontSize: 12 }}>Assessed as</TableCell>
                  <TableCell sx={{ fontSize: 12 }}>Projects</TableCell>
                  <TableCell sx={{ fontSize: 12 }}>Status</TableCell>
                  <TableCell sx={{ fontSize: 12 }} align="right">Score</TableCell>
                  <TableCell sx={{ fontSize: 12 }} align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {assignments.map(a => {
                  const name = a.teamMember
                    ? `${a.teamMember.firstName} ${a.teamMember.lastName}`
                    : `#${a.teamMemberId}`;
                  const published = a.review?.status === 'published';
                  return (
                    <TableRow key={a.participantId} hover>
                      <TableCell sx={{ fontSize: 13 }}>
                        <Tooltip title="View this person's full history, including other teams">
                          <Box
                            component="span"
                            sx={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                            onClick={() => setProfileFor(a.teamMemberId)}
                          >
                            {name}
                          </Box>
                        </Tooltip>
                        {a.review?.acknowledgedAt && (
                          <Tooltip title={`Acknowledged on ${new Date(a.review.acknowledgedAt).toLocaleDateString()}`}>
                            <Chip size="small" label="seen" sx={{ ml: 1, height: 18, fontSize: 10 }} />
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12.5, color: '#6b7280' }}>{a.memberCategory}</TableCell>
                      <TableCell sx={{ fontSize: 12.5, color: '#6b7280' }}>
                        <Tooltip title="Work from every in-scope project is summed into one review">
                          <span>{a.contributingProjectIds.length}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        {a.review
                          ? <StatusChip status={a.review.status} version={a.review.version} />
                          : <Chip size="small" label="Not started" sx={{ fontSize: 11 }} />}
                      </TableCell>
                      <TableCell align="right" sx={{ fontSize: 13, fontWeight: 600 }}>
                        {a.review?.normalizedScore != null
                          ? Number(a.review.normalizedScore).toFixed(1)
                          : '—'}
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          startIcon={published ? <VisibilityRounded /> : <EditRounded />}
                          onClick={() => openRow(a)}
                          disabled={openReview.isPending}
                        >
                          {published ? 'View' : a.review ? 'Continue' : 'Start'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}

      {assignments.length === 0 && !isLoading && selectedCycle?.status !== 'scheduled' && (
        <Alert severity="info" sx={{ fontSize: 13 }}>
          Nobody is assigned to you for this period. A superuser assigns reviewers when the period is
          opened.
        </Alert>
      )}

      {openReview.isError && (
        <Alert severity="error" sx={{ mt: 2, fontSize: 13 }}>
          {(openReview.error as any)?.response?.data?.message ?? 'Could not open the review.'}
        </Alert>
      )}

      <Dialog open={!!openFor} onClose={() => setOpenFor(null)} fullWidth maxWidth="md">
        <DialogContent sx={{ p: 3 }}>
          {openFor && (
            <LeadReviewForm
              reviewId={openFor.reviewId}
              memberName={openFor.name}
              onClose={() => setOpenFor(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {profileFor && (
        <TeamMemberProfile teamMemberId={profileFor} onClose={() => setProfileFor(null)} />
      )}
    </Box>
  );
}

export default LeadReviewWorkspace;
