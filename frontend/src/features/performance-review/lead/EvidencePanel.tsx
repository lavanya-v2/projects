import { Alert, Box, Divider, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import { LockRounded, InfoOutlined } from '@mui/icons-material';
import type { LeadReview } from '../types';

const NAVY = '#002e5b';
const AMBER = '#ff9800';

/** Labels for the raw counters, so the panel is readable without a data dictionary. */
const METRIC_LABELS: Record<string, string> = {
  spPlanned: 'Story points planned',
  spDone: 'Story points delivered',
  spRework: 'Story points reworked',
  deliveredCount: 'Tickets delivered',
  reopenedCount: 'Tickets reopened',
  deliveryPct: 'Delivery %',
  reworkFactor: 'Rework %',
  reopenRate: 'Reopen rate %',
  executionScore: 'Execution score',
  ticketsTested: 'Tickets tested',
  clearedSp: 'Story points cleared through QA',
  uatFailedSp: 'Story points failed in UAT',
  inSprintBugs: 'Bugs caught in-sprint',
  inSprintEligible: 'Bugs eligible to catch in-sprint',
  qualityRate: 'QA risk rate (lower is better)',
};

/**
 * The performance data behind the score.
 *
 * Before submission this reads from the live cycle score; afterwards it reads the
 * frozen snapshot. That distinction is stated on screen, because "which numbers am
 * I looking at?" is exactly the question an appraisal dispute turns on.
 */
export function EvidencePanel({ review }: { review: LeadReview }) {
  const e = review.evidenceSnapshot ?? {};
  const frozen = !!e.capturedAt;
  const aggregates = Object.entries(e.aggregates ?? {}).filter(([, v]) => v !== null && v !== undefined);

  if (!frozen && !e.systemScore) {
    return (
      <Alert severity="info" sx={{ fontSize: 13 }}>
        The delivery figures for this person are gathered from their synced sprints. They will be
        frozen into this review when you submit it, so what you rated against stays on record.
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Alert
        severity={frozen ? 'success' : 'info'}
        icon={frozen ? <LockRounded /> : <InfoOutlined />}
        sx={{ fontSize: 13 }}
      >
        {frozen ? (
          <>
            Frozen on {new Date(e.capturedAt!).toLocaleString()}. These are the figures this review was
            rated against and they will not change, even if the underlying sprints are re-synced.
          </>
        ) : (
          <>Live figures. They will be frozen into the review when you submit.</>
        )}
      </Alert>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap>
          <Stat label="System score" value={e.systemScore == null ? '—' : Number(e.systemScore).toFixed(1)}
            hint="The delivery half of the composite, normalised to 0-100." />
          <Divider orientation="vertical" flexItem />
          <Stat label="Data coverage" value={e.systemCoverage == null ? '—' : `${Number(e.systemCoverage).toFixed(0)}%`}
            hint="How much of the expected delivery evidence was actually available for this person." />
          <Divider orientation="vertical" flexItem />
          <Stat label="Category" value={e.memberCategory ?? '—'}
            hint="Which scoring formula applied — developer or QA — based on where most of the work was." />
          <Divider orientation="vertical" flexItem />
          <Stat label="Period" value={e.cycle?.periodLabel ?? '—'}
            hint={e.cycle ? `${e.cycle.startDate} to ${e.cycle.endDate}` : 'Review period'} />
        </Stack>

        {e.systemPresent === false && (
          <Alert severity="warning" sx={{ mt: 2, fontSize: 12.5 }}>
            There was not enough delivery data to score this person — below the volume floor, or no
            confirmed identity link. That is reported as insufficient data, never as a low score.
            Weight your rating accordingly.
          </Alert>
        )}
      </Paper>

      {(e.approximations?.length || e.overridesApplied?.length || e.overridesRejected?.length) && (
        <Paper variant="outlined" sx={{ p: 2, borderColor: AMBER }}>
          <Typography sx={{ fontWeight: 600, fontSize: 13, color: '#8a5300', mb: 1 }}>
            Qualifications on this data
          </Typography>
          {e.approximations?.map(a => (
            <Typography key={a} sx={{ fontSize: 12, color: '#6b7280' }}>• {a}</Typography>
          ))}
          {!!e.overridesApplied?.length && (
            <Typography sx={{ fontSize: 12, color: '#6b7280' }}>
              • Manual corrections applied to: {e.overridesApplied.join(', ')}
            </Typography>
          )}
          {!!e.overridesRejected?.length && (
            <Typography sx={{ fontSize: 12, color: '#b71c1c' }}>
              • Corrections REFUSED as out of range and not applied: {e.overridesRejected.join(', ')}
            </Typography>
          )}
        </Paper>
      )}

      {aggregates.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 13, color: NAVY, mb: 1 }}>
            Delivery totals for the period
          </Typography>
          <Table size="small">
            <TableBody>
              {aggregates.map(([k, v]) => (
                <TableRow key={k}>
                  <TableCell sx={{ fontSize: 12.5, border: 0, py: 0.4 }}>
                    {METRIC_LABELS[k] ?? k}
                  </TableCell>
                  <TableCell align="right" sx={{ fontSize: 12.5, fontWeight: 600, border: 0, py: 0.4 }}>
                    {typeof v === 'number' ? Math.round(v * 10) / 10 : String(v)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {!!e.sources?.length && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 13, color: NAVY, mb: 0.5 }}>
            Sprints that fed these totals
          </Typography>
          <Typography sx={{ fontSize: 12, color: '#6b7280', mb: 1 }}>
            Totals are summed across every sprint in the period, including across projects —
            {' '}{(e.contributingProjectIds ?? []).length} project(s) contributed.
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 11.5 }}>Sprint</TableCell>
                  <TableCell sx={{ fontSize: 11.5 }}>Project</TableCell>
                  <TableCell sx={{ fontSize: 11.5 }} align="right">SP planned</TableCell>
                  <TableCell sx={{ fontSize: 11.5 }} align="right">SP done</TableCell>
                  <TableCell sx={{ fontSize: 11.5 }} align="right">QA risk rate</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[...e.sources]
                  // Grouped by project, then chronologically — otherwise several
                  // projects' sprints interleave in whatever order the scorer
                  // happened to process them.
                  .sort((a, b) =>
                    (a.projectName ?? '').localeCompare(b.projectName ?? '') ||
                    (a.startDate ?? '').localeCompare(b.startDate ?? ''),
                  )
                  .map(s => (
                    // Keyed by sourceId (the actual attachment), never array index —
                    // two sprints from the same project must render as two distinct
                    // rows, not collapse into one under React's reconciliation.
                    <TableRow key={s.sourceId}>
                      <TableCell sx={{ fontSize: 12 }}>
                        {s.periodLabel ?? '—'}
                        {s.startDate && s.endDate && (
                          <Typography component="span" sx={{ fontSize: 10.5, color: '#9ca3af', ml: 0.75 }}>
                            {s.startDate} – {s.endDate}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{s.projectName ?? `Project ${s.projectId}`}</TableCell>
                      <TableCell sx={{ fontSize: 12 }} align="right">{s.spPlanned ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: 12 }} align="right">{s.spDone ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: 12 }} align="right">
                        {s.qualityRate === -1 ? 'insufficient' : s.qualityRate ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      )}

      {e.template && (
        <Typography sx={{ fontSize: 11.5, color: '#9ca3af' }}>
          Answered against {e.template.name} v{e.template.version}
          {' '}({e.template.items?.length ?? 0} competencies, scale {e.template.ratingScaleMin}–{e.template.ratingScaleMax}).
        </Typography>
      )}
    </Stack>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Tooltip title={hint}>
      <Box>
        <Typography sx={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </Typography>
        <Typography sx={{ fontSize: 20, fontWeight: 700, color: NAVY, lineHeight: 1.3 }}>{value}</Typography>
      </Box>
    </Tooltip>
  );
}

export default EvidencePanel;
