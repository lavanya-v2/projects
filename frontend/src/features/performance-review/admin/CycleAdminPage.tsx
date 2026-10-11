import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import {
  PlayArrowRounded, LockRounded, PublicRounded, RefreshRounded, WarningAmberRounded,
  CheckCircleRounded, LockOpenRounded, EventBusyRounded, InfoOutlined,
} from '@mui/icons-material';
import { useAccount } from '../../../context/UseAccount';
import {
  useCycles, useCycleSources, useUpdateCycleSource, useCycleScores,
  useTransitionCycle, useRecomputeCycle,
} from '../hooks';
import { STATUS_LEGEND } from '../statusLegend';
import type { CycleSource, CycleStatus, ReviewMemberScoreRow } from '../types';

const NAVY = '#002e5b';
const GREEN = '#4caf50';
const AMBER = '#ff9800';

const NEXT_STATUS: Partial<Record<CycleStatus, CycleStatus>> = {
  scheduled: 'open',
  open: 'locked',
  locked: 'published',
};

const STATUS_ACTION_LABEL: Record<string, string> = {
  open: 'Open period',
  locked: 'Lock period',
  published: 'Publish to leads and members',
};

const STATUS_CHIP: Record<CycleStatus, { bg: string; fg: string }> = {
  scheduled: { bg: '#eef2f7', fg: '#374151' },
  open: { bg: '#e3f2fd', fg: '#0d47a1' },
  locked: { bg: '#fff4e5', fg: '#8a5300' },
  published: { bg: '#e8f5e9', fg: '#1b5e20' },
  archived: { bg: '#f3f4f6', fg: '#9ca3af' },
};

/**
 * Cycle administration: open, lock, publish; the source attachment audit; and the
 * scores overview.
 *
 * Every transition here is a superuser action, deliberately — there is no
 * scheduler. `published` in particular can never be undone through this screen:
 * it is the step that makes composite scores and lead reviews visible to the
 * people being reviewed.
 */
export function CycleAdminPage({ initialCycleId }: { initialCycleId?: number | null } = {}) {
  const { activeAccount } = useAccount();
  const [cycleId, setCycleId] = useState<number | null>(initialCycleId ?? null);
  const [confirmAction, setConfirmAction] = useState<CycleStatus | null>(null);
  const [excludeTarget, setExcludeTarget] = useState<CycleSource | null>(null);
  const [excludeReason, setExcludeReason] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Always include historical/catch-up periods here — this screen exists to
  // manage one specific cycle (reached via a row click in Review Cycles),
  // never to browse by default, so hiding pre-setup periods (a list-browsing
  // default) must not also hide the very cycle this screen was opened for.
  const { data: cycles = [], isLoading: cyclesLoading } = useCycles(activeAccount?.id, undefined, true);
  // Newest-period-first, so the raw first entry is usually a future cycle
  // nobody has opened yet. Default to whichever cycle is actually in progress.
  const defaultCycle = useMemo(
    () => cycles.find((c: any) => c.status === 'open') ?? cycles[0],
    [cycles],
  );
  const effectiveCycleId = cycleId ?? defaultCycle?.id ?? null;
  const cycle = cycles.find((c: any) => c.id === effectiveCycleId);

  const { data: sources = [], isLoading: sourcesLoading } = useCycleSources(effectiveCycleId);
  const { data: scores = [], isLoading: scoresLoading } = useCycleScores(effectiveCycleId);
  const transition = useTransitionCycle();
  const recompute = useRecomputeCycle();
  const updateSource = useUpdateCycleSource();

  const sourcesByProject = useMemo(() => {
    const map = new Map<number, CycleSource[]>();
    for (const s of sources) map.set(s.projectId, [...(map.get(s.projectId) ?? []), s]);
    return map;
  }, [sources]);

  const scoreStats = useMemo(() => {
    const provisional = scores.filter(s => s.isProvisional).length;
    const avgCoverage =
      scores.length === 0 ? 0 : scores.reduce((sum, s) => sum + (s.overallCoverage ?? 0), 0) / scores.length;
    return { total: scores.length, provisional, avgCoverage };
  }, [scores]);

  const nextStatus = cycle ? NEXT_STATUS[cycle.status as CycleStatus] : undefined;

  const doTransition = (toStatus: CycleStatus) =>
    transition.mutate(
      { cycleId: effectiveCycleId!, toStatus },
      { onSuccess: () => setConfirmAction(null) },
    );

  // A never-opened period has no sources, participants or scores yet, so
  // cancelling it is safe and permanent — it just marks the period archived
  // rather than deleting the row, so there's still a record it was skipped
  // on purpose rather than simply missing.
  const doCancel = () =>
    transition.mutate(
      { cycleId: effectiveCycleId!, toStatus: 'archived' },
      { onSuccess: () => setConfirmCancel(false) },
    );

  const doExclude = () => {
    if (!excludeTarget) return;
    updateSource.mutate(
      { cycleId: effectiveCycleId!, sourceId: excludeTarget.id, excluded: true, reason: excludeReason },
      { onSuccess: () => { setExcludeTarget(null); setExcludeReason(''); } },
    );
  };

  if (!activeAccount) {
    return <Alert severity="info" sx={{ fontSize: 13 }}>Select an account to administer review cycles.</Alert>;
  }

  return (
    <Box>
      <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY, mb: 0.5 }}>
        Cycle Administration
      </Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2.5 }}>
        Open a period once its delivery data has settled, lock it when reviews are done, and publish
        to make scores and reviews visible. Publishing cannot be undone from here. The actions available
        depend on which period is selected below — pick a "scheduled" one to open or cancel it, an
        "open" one to lock it, and so on.
      </Typography>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2.5 }}>
        {/* Reached by clicking a specific row in Review Cycles — no need to
            re-pick from a dropdown here, that's exactly the period already
            selected. The picker only appears if this screen is ever reached
            without one (not the case today, kept as a fallback). */}
        {initialCycleId ? (
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: NAVY }}>
            {cycle?.periodLabel ?? (cyclesLoading ? 'Loading…' : `#${effectiveCycleId}`)}
          </Typography>
        ) : (
          <TextField
            select size="small" label="Review period" sx={{ minWidth: 260 }}
            value={effectiveCycleId ?? ''} disabled={cyclesLoading || cycles.length === 0}
            onChange={e => setCycleId(Number(e.target.value))}
          >
            {cycles.map((c: any) => (
              <MenuItem key={c.id} value={c.id}>{c.periodLabel} — {c.status}</MenuItem>
            ))}
          </TextField>
        )}
        {cycle && (
          <Tooltip title={STATUS_LEGEND}>
            <Chip
              size="small" label={cycle.status}
              sx={{ fontSize: 11, fontWeight: 600, ...STATUS_CHIP[cycle.status as CycleStatus] }}
            />
          </Tooltip>
        )}
        {(sourcesLoading || scoresLoading) && <CircularProgress size={18} />}
      </Stack>

      {cycles.length === 0 && !cyclesLoading && (
        <Alert severity="info" sx={{ fontSize: 13 }}>
          No review periods exist for this account yet. Use "+ Add a project" from Review Cycles to run
          the setup wizard, which generates and opens the first one.
        </Alert>
      )}

      {cycle && (
        <>
          <Paper variant="outlined" sx={{ p: 2, mb: 2.5 }}>
            <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap alignItems="center">
              <Stat label="Window" value={`${cycle.startDate} → ${cycle.endDate}`} />
              <Stat
                label="Weights" value={`${cycle.weightSystem} / ${cycle.weightLead} / ${cycle.weightCustomer}`}
                hint={
                  `System / Lead / Customer, snapshotted when this cycle opened. ` +
                  `How the score is built: performance data = 85% delivery execution ` +
                  `(planned vs. delivered story points, penalized for rework) + 15% low ` +
                  `reopen rate, from completed sprints. Lead score = the lead's competency ` +
                  `ratings, or 100 (flagged Provisional) if not submitted yet. ` +
                  `Composite = ${cycle.weightSystem}% data + ${cycle.weightLead}% lead.`
                }
              />
              <Stat label="Scored" value={String(scoreStats.total)} />
              <Stat
                label="Provisional"
                value={String(scoreStats.provisional)}
                hint="Scores missing a factor or built on thin coverage — never treat these as final."
                color={scoreStats.provisional > 0 ? AMBER : GREEN}
              />
              <Stat
                label="Avg coverage" value={`${scoreStats.avgCoverage.toFixed(0)}%`}
                hint="How complete the average score is across both factors — 100% needs a confirmed identity link with sprint data AND a submitted lead review. Below 60% (or any factor missing entirely) is flagged Provisional."
              />

              <Box sx={{ flexGrow: 1 }} />

              <Stack direction="row" spacing={1}>
                <Tooltip title="Re-run scoring against the current attached sources — safe on an unlocked cycle">
                  <span>
                    <Button
                      size="small" variant="outlined" startIcon={<RefreshRounded />}
                      disabled={cycle.status === 'published' || cycle.status === 'archived' || recompute.isPending}
                      onClick={() => recompute.mutate(effectiveCycleId!)}
                    >
                      Recompute
                    </Button>
                  </span>
                </Tooltip>

                {nextStatus && (
                  <Button
                    size="small" variant="contained"
                    startIcon={
                      nextStatus === 'open' ? <PlayArrowRounded /> :
                      nextStatus === 'locked' ? <LockRounded /> : <PublicRounded />
                    }
                    sx={{
                      bgcolor: nextStatus === 'published' ? GREEN : NAVY,
                      '&:hover': { bgcolor: nextStatus === 'published' ? '#3d8b40' : '#001f3d' },
                    }}
                    onClick={() => setConfirmAction(nextStatus)}
                  >
                    {STATUS_ACTION_LABEL[nextStatus]}
                  </Button>
                )}
                {cycle.status === 'locked' && (
                  <Button size="small" variant="text" startIcon={<LockOpenRounded />}
                    onClick={() => doTransition('open')}>
                    Re-open
                  </Button>
                )}
                {cycle.status === 'scheduled' && (
                  <Tooltip title="This period was never opened — nothing depends on it, so cancelling just removes it from the plan.">
                    <Button size="small" variant="text" color="error" startIcon={<EventBusyRounded />}
                      onClick={() => setConfirmCancel(true)}>
                      Cancel period
                    </Button>
                  </Tooltip>
                )}
              </Stack>
            </Stack>

            {recompute.isSuccess && (
              <Alert severity="success" sx={{ mt: 1.5, fontSize: 12.5 }} onClose={() => recompute.reset()}>
                Scores recomputed against the current sources.
              </Alert>
            )}
          </Paper>

          {/* ── Source attachment audit ────────────────────────────────────── */}
          <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.25 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14, color: NAVY }}>
              Sources feeding this period
            </Typography>
            <Tooltip title="Every completed sprint whose delivery data was pulled into this period's scores. Exclude one (with a reason) to drop its data and recompute — use this if a sprint's sync was bad.">
              <InfoOutlined sx={{ fontSize: 15, color: '#9ca3af' }} />
            </Tooltip>
          </Stack>
          <Typography sx={{ fontSize: 12, color: '#6b7280', mb: 1 }}>
            The completed sprints behind this period's scores, grouped by project.
          </Typography>
          {[...sourcesByProject.entries()].map(([projectId, projSources]) => (
            <Paper key={projectId} variant="outlined" sx={{ p: 1.5, mb: 1.5 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 1 }}>
                {projSources[0].project?.name ?? `Project ${projectId}`}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontSize: 11.5 }}>Sprint</TableCell>
                    <TableCell sx={{ fontSize: 11.5 }}>Attached</TableCell>
                    <TableCell sx={{ fontSize: 11.5 }}>Status</TableCell>
                    <TableCell sx={{ fontSize: 11.5 }} align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {projSources.map(s => (
                    <TableRow key={s.id}>
                      <TableCell sx={{ fontSize: 12.5 }}>
                        <Typography sx={{ fontSize: 12.5, fontWeight: 500 }}>
                          {s.sync?.sprintName ?? s.sync?.periodLabel ?? s.sourceType}
                        </Typography>
                        {s.sync && (
                          <Typography sx={{ fontSize: 11, color: '#9ca3af' }}>
                            {s.sync.startDate} → {s.sync.endDate}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12.5 }}>{s.attachedBy}</TableCell>
                      <TableCell sx={{ fontSize: 12.5 }}>
                        {s.excluded ? (
                          <Tooltip title={s.exclusionReason ?? ''}>
                            <Chip size="small" label="excluded" sx={{ fontSize: 10, bgcolor: '#fdecea', color: '#611a15' }} />
                          </Tooltip>
                        ) : (
                          <Chip size="small" label="included" sx={{ fontSize: 10, bgcolor: '#e8f5e9', color: '#1b5e20' }} />
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {cycle.status !== 'published' && cycle.status !== 'archived' && (
                          s.excluded ? (
                            <Button size="small"
                              onClick={() => updateSource.mutate({
                                cycleId: effectiveCycleId!, sourceId: s.id, excluded: false,
                              })}>
                              Re-include
                            </Button>
                          ) : (
                            <Button size="small" color="warning" onClick={() => setExcludeTarget(s)}>
                              Exclude
                            </Button>
                          )
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          ))}
          {sources.length === 0 && !sourcesLoading && (
            <Alert severity="info" sx={{ fontSize: 13, mb: 2 }}>
              No sprints have attached to this period yet. Open the period to attach completed sprints
              automatically.
            </Alert>
          )}

          {/* ── Scores overview ─────────────────────────────────────────────── */}
          {scores.length > 0 && (
            <>
              <Typography sx={{ fontWeight: 600, fontSize: 14, color: NAVY, mt: 3, mb: 1 }}>
                Composite scores
              </Typography>
              <Paper variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontSize: 12 }}>Team member</TableCell>
                      <TableCell sx={{ fontSize: 12 }} align="right">System</TableCell>
                      <TableCell sx={{ fontSize: 12 }} align="right">Lead</TableCell>
                      <TableCell sx={{ fontSize: 12 }} align="right">Composite</TableCell>
                      <TableCell sx={{ fontSize: 12 }} align="right">Coverage</TableCell>
                      <TableCell sx={{ fontSize: 12 }}>Trend</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {scores.map((s: ReviewMemberScoreRow) => (
                      <TableRow key={s.id}>
                        <TableCell sx={{ fontSize: 13 }}>
                          {s.teamMember ? `${s.teamMember.firstName} ${s.teamMember.lastName}` : `#${s.teamMemberId}`}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: 12.5 }}>
                          {s.systemScore != null ? Number(s.systemScore).toFixed(1) : '—'}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: 12.5 }}>
                          {s.leadPresent ? Number(s.leadScore).toFixed(1) : (
                            <Tooltip title="No submitted review yet — defaults to 100 and marks the score provisional">
                              <span style={{ color: '#9ca3af' }}>—</span>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: 13, fontWeight: 700 }}>
                          {s.compositeScore != null ? Number(s.compositeScore).toFixed(1) : '—'}
                        </TableCell>
                        <TableCell align="right">
                          <Chip
                            size="small"
                            label={`${s.overallCoverage != null ? Math.round(s.overallCoverage) : 0}%`}
                            sx={{
                              fontSize: 11,
                              bgcolor: s.isProvisional ? '#fff4e5' : '#e8f5e9',
                              color: s.isProvisional ? '#8a5300' : '#1b5e20',
                            }}
                            icon={s.isProvisional ? <WarningAmberRounded fontSize="inherit" /> : <CheckCircleRounded fontSize="inherit" />}
                          />
                        </TableCell>
                        <TableCell sx={{ fontSize: 12.5 }}>
                          {s.trendDirection === 'na' ? '—' :
                            s.trendDirection === 'improved' ? `▲ ${s.trendDelta}` :
                            s.trendDirection === 'declined' ? `▼ ${s.trendDelta}` : 'flat'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </>
          )}
        </>
      )}

      {/* Confirm the transition, especially publish which cannot be undone here. */}
      <Dialog open={!!confirmAction} onClose={() => setConfirmAction(null)}>
        <DialogTitle sx={{ fontSize: 16 }}>
          {confirmAction && STATUS_ACTION_LABEL[confirmAction]}?
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13 }}>
            {confirmAction === 'published' ? (
              <>This makes composite scores and published lead reviews visible to every member in this
                cycle. It cannot be undone from this screen.
                {scoreStats.provisional > 0 && (
                  <Alert severity="warning" sx={{ mt: 1.5, fontSize: 12.5 }}>
                    {scoreStats.provisional} of {scoreStats.total} scores are still provisional —
                    built on a missing factor or thin coverage. Publishing now will show those numbers
                    to their subjects as they stand.
                  </Alert>
                )}
              </>
            ) : confirmAction === 'locked' ? (
              'This recomputes every score one final time and then freezes them — inputs will no longer refresh even if delivery data is re-synced.'
            ) : (
              'This attaches completed sprints, freezes the participant roster, assigns reviewers where unambiguous, and computes the first scores.'
            )}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setConfirmAction(null)}>Cancel</Button>
          <Button
            size="small" variant="contained" disabled={transition.isPending}
            sx={{ bgcolor: confirmAction === 'published' ? GREEN : NAVY }}
            onClick={() => confirmAction && doTransition(confirmAction)}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Cancelling a never-opened period is permanent, but nothing depends on it. */}
      <Dialog open={confirmCancel} onClose={() => setConfirmCancel(false)}>
        <DialogTitle sx={{ fontSize: 16 }}>Cancel this period?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13 }}>
            {cycle?.periodLabel} ({cycle?.startDate} → {cycle?.endDate}) will be marked cancelled and
            removed from active use. It was never opened, so no delivery data, participants or scores
            are attached to it — this is safe. It stays visible in the period list, greyed out, as a
            record that it was skipped on purpose rather than simply missing.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setConfirmCancel(false)}>Back</Button>
          <Button size="small" variant="contained" color="error" disabled={transition.isPending}
            onClick={doCancel}>
            Cancel period
          </Button>
        </DialogActions>
      </Dialog>

      {/* Excluding a sprint changes an HR score, so a reason is required. */}
      <Dialog open={!!excludeTarget} onClose={() => setExcludeTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontSize: 16 }}>
          Exclude {excludeTarget?.sync?.sprintName ?? 'this sprint'}?
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth multiline minRows={2} autoFocus sx={{ mt: 1 }}
            label="Why is this sprint being excluded?" value={excludeReason}
            onChange={e => setExcludeReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setExcludeTarget(null)}>Cancel</Button>
          <Button size="small" color="warning" variant="contained"
            disabled={excludeReason.trim().length < 3 || updateSource.isPending}
            onClick={doExclude}>
            Exclude
          </Button>
        </DialogActions>
      </Dialog>

      {(transition.isError || updateSource.isError) && (
        <Alert severity="error" sx={{ mt: 2, fontSize: 13 }}>
          {(transition.error as any)?.response?.data?.message ??
            (updateSource.error as any)?.response?.data?.message ??
            'The action could not be completed.'}
        </Alert>
      )}
    </Box>
  );
}

function Stat({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  const content = (
    <Box>
      <Typography sx={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 16, fontWeight: 700, color: color ?? NAVY }}>{value}</Typography>
    </Box>
  );
  return hint ? <Tooltip title={hint}>{content}</Tooltip> : content;
}

export default CycleAdminPage;
