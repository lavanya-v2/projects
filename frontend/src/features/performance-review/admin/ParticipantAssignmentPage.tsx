import { useMemo, useState } from 'react';
import {
  Alert, Autocomplete, Box, Chip, CircularProgress, MenuItem, Paper, Stack, Table,
  TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { useAccount } from '../../../context/UseAccount';
import { useCycles, useCycleParticipants, useEligibleReviewers, useUpdateParticipant } from '../hooks';
import { useAdminAllUsers } from '../../admin/users/hooks';
import type { CycleParticipant, EligibleReviewer } from '../types';

const NAVY = '#002e5b';

const REVIEWER_ROLES = new Set(['superuser', 'admin', 'manager', 'lead']);

/**
 * Per-person reviewer assignment.
 *
 * This is the screen that makes cross-project people workable: a person who
 * contributed to several in-scope projects still gets exactly ONE reviewer, named
 * here, rather than one review per project. Auto-assignment (at cycle open)
 * resolves the unambiguous cases — a single lead with access to the person's
 * dominant project; everything else is left blank for a superuser to decide,
 * deliberately, rather than guessed at.
 */
export function ParticipantAssignmentPage() {
  const { activeAccount } = useAccount();
  const [cycleId, setCycleId] = useState<number | null>(null);

  const { data: cycles = [] } = useCycles(activeAccount?.id);
  const { data: participants = [], isLoading } = useCycleParticipants(cycleId);
  const { data: allUsers = [] } = useAdminAllUsers();
  const updateParticipant = useUpdateParticipant();

  // The account-wide list — every active lead/manager/admin/superuser — is the
  // fallback for a participant the scoped endpoint has nothing for (e.g. nobody
  // in the account happens to have permission on their contributing projects
  // yet), so a row is never left with zero options at all.
  const fallbackReviewers = useMemo(
    () => allUsers.filter(u => u.isActive && REVIEWER_ROLES.has(u.roleName)),
    [allUsers],
  );
  const reviewerById = useMemo(() => new Map(allUsers.map(u => [u.id, u])), [allUsers]);

  // The list is newest-period-first, so the raw first entry is usually a future
  // cycle nobody has opened yet — zero participants, nothing to assign. Default
  // to the cycle actually in progress instead.
  const defaultCycle = useMemo(
    () => cycles.find((c: any) => c.status === 'open') ?? cycles[0],
    [cycles],
  );
  const effectiveCycleId = cycleId ?? defaultCycle?.id ?? null;
  const { data: eligibleByMember = {} } = useEligibleReviewers(effectiveCycleId);
  const selectedCycle = cycles.find((c: any) => c.id === effectiveCycleId);
  const locked = selectedCycle && ['locked', 'published', 'archived'].includes(selectedCycle.status);

  const unassignedCount = participants.filter(p => !p.reviewerUserId && !p.isExcluded).length;

  const nameOf = (p: CycleParticipant) =>
    p.teamMember ? `${p.teamMember.firstName} ${p.teamMember.lastName}` : `#${p.teamMemberId}`;

  if (!activeAccount) {
    return <Alert severity="info" sx={{ fontSize: 13 }}>Select an account to assign reviewers.</Alert>;
  }

  return (
    <Box>
      <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY, mb: 0.5 }}>
        Reviewer Assignment
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2.5 }}>
        Who reviews whom this period. Assignment defaulted automatically where exactly one lead had
        access to a person's main project; everything else needs a decision here. Each dropdown only
        lists people who actually have access to that person's project(s) — pick from there.
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2.5 }}>
        <TextField
          select size="small" label="Review period" sx={{ minWidth: 260 }}
          value={effectiveCycleId ?? ''} disabled={cycles.length === 0}
          onChange={e => setCycleId(Number(e.target.value))}
        >
          {cycles.map((c: any) => (
            <MenuItem key={c.id} value={c.id}>{c.periodLabel} — {c.status}</MenuItem>
          ))}
        </TextField>
        {isLoading && <CircularProgress size={18} />}
        {unassignedCount > 0 && (
          <Chip size="small" color="warning" label={`${unassignedCount} unassigned`} sx={{ fontSize: 11 }} />
        )}
      </Stack>

      {locked && (
        <Alert severity="info" sx={{ mb: 2, fontSize: 13 }}>
          This period is {selectedCycle!.status} — assignments can no longer be changed.
        </Alert>
      )}

      {cycles.length === 0 && (
        <Alert severity="info" sx={{ fontSize: 13 }}>No review periods exist for this account yet.</Alert>
      )}

      {selectedCycle?.status === 'scheduled' && !isLoading && participants.length === 0 && (
        <Alert severity="info" sx={{ fontSize: 13 }}>
          <strong>{selectedCycle.periodLabel}</strong> hasn't been opened yet, so there is nobody to
          assign a reviewer to — opening is what pulls in delivery data and works out who participated.
          Go to <strong>Cycle Administration</strong>, select this period, and click
          <strong> Open period</strong> first. (If you don't want to run this period at all, open Cycle
          Administration and use <strong>Cancel period</strong> instead.)
        </Alert>
      )}

      {participants.length > 0 && (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontSize: 12 }}>Team member</TableCell>
                <TableCell sx={{ fontSize: 12 }}>Category</TableCell>
                <TableCell sx={{ fontSize: 12 }}>Projects contributed</TableCell>
                <TableCell sx={{ fontSize: 12 }}>Reviewer</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {participants.map(p => {
                const currentReviewer = p.reviewerUserId ? reviewerById.get(p.reviewerUserId) ?? null : null;
                const scoped = eligibleByMember[p.teamMemberId] ?? [];
                // Fall back to the full account-wide list only when the scoped
                // one is empty — never leave a row with nothing to pick from.
                const options: EligibleReviewer[] = scoped.length > 0 ? scoped : fallbackReviewers;
                return (
                  <TableRow key={p.id} hover={!p.isExcluded}
                    sx={p.isExcluded ? { opacity: 0.5 } : undefined}>
                    <TableCell sx={{ fontSize: 13 }}>
                      {nameOf(p)}
                      {p.isExcluded && (
                        <Tooltip title={p.exclusionReason ?? 'Excluded from this cycle'}>
                          <Chip size="small" label="excluded" sx={{ ml: 1, height: 18, fontSize: 10 }} />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12.5, color: '#6b7280' }}>{p.memberCategory}</TableCell>
                    <TableCell sx={{ fontSize: 12.5, color: '#6b7280' }}>
                      {p.contributingProjectIds.length}
                    </TableCell>
                    <TableCell sx={{ minWidth: 240 }}>
                      <Autocomplete
                        size="small" disabled={locked || p.isExcluded}
                        options={options}
                        value={currentReviewer}
                        getOptionLabel={(u: any) => `${u.firstName} ${u.lastName} (${u.roleName})`}
                        isOptionEqualToValue={(a: any, b: any) => a.id === b.id}
                        onChange={(_, v) =>
                          updateParticipant.mutate({ participantId: p.id, reviewerUserId: v ? v.id : null })
                        }
                        renderInput={params => (
                          <TextField {...params} placeholder="Not assigned"
                            error={!currentReviewer && !p.isExcluded} />
                        )}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Paper>
      )}

      {updateParticipant.isError && (
        <Alert severity="error" sx={{ mt: 2, fontSize: 13 }}>
          Could not update the reviewer assignment.
        </Alert>
      )}
    </Box>
  );
}

export default ParticipantAssignmentPage;
