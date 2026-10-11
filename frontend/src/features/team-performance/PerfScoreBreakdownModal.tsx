import { useMemo } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from '@mui/material';
import { usePerfTicketFacts } from './hooks';
import { metricVal } from './perfFormatters';
import { effectiveQualityRate, qualityBandLabel, qaRatingHex } from './perfColors';
import { NON_DELIVERABLE_PARENT_TYPES } from './perfConstants';

interface Props {
  projectId: number;
  syncId: number;
  score: any;
  sprintStartDate?: string;
  sprintEndDate?: string;
  /** False for a Kanban board with no tracked commitment. There is no plan to
   *  measure against there, so the denominator is named for what it actually is
   *  (delivered + carried) rather than "SP Planned". Defaults true so the
   *  sprint wording is untouched. */
  hasCommitment?: boolean;
  onClose: () => void;
}

const num = (v: any): number => Number(v ?? 0);
const r1 = (n: number): number => Math.round(n * 10) / 10;
const fmtHrs = (v: any) => (v != null ? `${Number(v).toFixed(1)}h` : '—');

/**
 * One derivation step: a human formula, the same formula with the actual
 * numbers substituted (monospace), and the resulting value. This is the whole
 * point of the modal — every derived number shows the exact math behind it.
 */
function Step({
  label,
  formula,
  substitution,
  result,
  resultColor,
  note,
}: {
  label: string;
  formula: string;
  substitution: string;
  result: string;
  resultColor?: string;
  note?: string;
}) {
  return (
    <Box sx={{ mb: 1.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{label}</Typography>
        <Typography sx={{ fontSize: 15, fontWeight: 800, color: resultColor ?? '#0f172a', whiteSpace: 'nowrap' }}>
          {result}
        </Typography>
      </Box>
      <Typography sx={{ fontSize: 11.5, color: '#64748b', mt: 0.25 }}>{formula}</Typography>
      <Box
        sx={{
          mt: 0.5,
          px: 1,
          py: 0.5,
          bgcolor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 1,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12,
          color: '#334155',
          overflowX: 'auto',
        }}
      >
        {substitution}
      </Box>
      {note && (
        <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 0.5, fontStyle: 'italic' }}>{note}</Typography>
      )}
    </Box>
  );
}

export function PerfScoreBreakdownModal({ projectId, syncId, score, sprintStartDate, sprintEndDate, hasCommitment = true, onClose }: Props) {
  // On a Kanban board this denominator is not a plan — it is simply what the
  // developer delivered plus what they still had open. Name it accordingly.
  // Deliberately NOT "SP Done + In Flight": this denominator is spPlanned, whose
  // carried portion omits points for a ticket already counted in an earlier
  // cycle. The SP In Flight column includes those, so the two legitimately
  // differ — naming them alike would invite a false reconciliation.
  const scopeLabel = hasCommitment ? 'SP Planned' : 'SP Done + Carried';
  const isDev = score.memberCategory !== 'qa';

  // Member facts drive the QA quality intermediates (clearedSP / uatFailedSP /
  // in-sprint catch) that are not persisted on the score row. All-sync facts
  // give the current-sprint key set needed to classify a bug's parent as
  // in-sprint. Both are cached (same query keys as the ticket drilldown).
  const memberFactsQ = usePerfTicketFacts(projectId, syncId, score.jiraLoginId);
  const allFactsQ = usePerfTicketFacts(projectId, syncId);
  const loading = memberFactsQ.isLoading || (!isDev && allFactsQ.isLoading);
  const error = memberFactsQ.isError || (!isDev && allFactsQ.isError);

  const qa = useMemo(() => {
    if (isDev) return null;
    const facts = (memberFactsQ.data ?? []) as any[];
    const allFacts = (allFactsQ.data ?? []) as any[];
    const currentKeys = new Set(allFacts.map((f: any) => f.jiraKey));

    const tested = facts.filter((f: any) => f.qaTesterJiraId === score.jiraLoginId);
    const clearedSP = tested.reduce((a: number, f: any) => a + num(f.storyPoints), 0);
    const uatFailed = tested.filter((f: any) => f.wasUatRejected);
    const uatFailedSP = uatFailed.reduce((a: number, f: any) => a + num(f.storyPoints), 0);

    const raised = facts.filter((f: any) => {
      if (f.reporterJiraId !== score.jiraLoginId) return false;
      if (!(f.issueType ?? '').toLowerCase().includes('bug')) return false;
      if (!sprintStartDate || !sprintEndDate) return true;
      if (!f.jiraCreatedAt) return false;
      const created = new Date(f.jiraCreatedAt).toISOString().slice(0, 10);
      return created >= sprintStartDate && created <= sprintEndDate;
    });
    // Mirrors isInCycleCatchEligible in performanceSyncService.ts: a bug parented
    // to an Epic (or with an unknown parent type) can't be judged on in-cycle
    // catch, so it drops out of the ratio entirely instead of scoring as a miss.
    const catchEligible = raised.filter((f: any) =>
      f.parentKey && f.parentIssueType && !NON_DELIVERABLE_PARENT_TYPES.has(String(f.parentIssueType).toLowerCase()));
    const inSprint = catchEligible.filter((f: any) => currentKeys.has(f.parentKey));

    const passRate = clearedSP > 0 ? 1 - uatFailedSP / clearedSP : 1;
    const inSprintCatch = catchEligible.length > 0 ? inSprint.length / catchEligible.length : 1;
    const composite = 0.7 * passRate + 0.3 * inSprintCatch;
    const testedCount = tested.length;
    const computedQr = testedCount < 5 ? -1 : r1((1 - composite) * 100);

    return {
      testedCount, clearedSP, uatFailed, uatFailedSP,
      raisedCount: raised.length, inSprintCount: inSprint.length,
      catchEligibleCount: catchEligible.length,
      passRate, inSprintCatch, composite, computedQr,
    };
  }, [isDev, memberFactsQ.data, allFactsQ.data, score.jiraLoginId, sprintStartDate, sprintEndDate]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Score Breakdown
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {score.displayName} &middot; {isDev ? 'Developer' : 'QA'}
          {score.isOverridden && (
            <Chip label="overridden" size="small" sx={{ ml: 1, fontSize: 9, height: 16, bgcolor: '#fff3e0', color: '#e65100' }} />
          )}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {loading && (
          <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box>
        )}
        {error && <Alert severity="error">Failed to load ticket facts for the breakdown.</Alert>}

        {!loading && !error && score.isOverridden && (
          <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
            This member has manual overrides. The math below reflects the computed values from ticket facts; the table may show overridden numbers.
          </Alert>
        )}

        {/* ── Developer ─────────────────────────────────────────────── */}
        {!loading && !error && isDev && (() => {
          const spDone = num(metricVal(score, 'spDone'));
          const spPlanned = num(metricVal(score, 'spPlanned'));
          const spRework = num(metricVal(score, 'spRework'));
          const dp = num(metricVal(score, 'deliveryPct'));
          const rr = num(metricVal(score, 'reworkFactor'));
          const exec = num(metricVal(score, 'executionScore'));
          const reopened = num(metricVal(score, 'reopenedCount'));
          const reopenPct = num(metricVal(score, 'reopenRatePct'));
          const cycle = metricVal(score, 'avgCycleTimeHours');
          return (
            <>
              <Step
                label="Execution Score"
                formula="Delivery% × 0.8 + (100 − Rework%) × 0.2  (higher is better)"
                substitution={`${dp}% × 0.8 + (100 − ${rr}%) × 0.2 = ${exec}`}
                result={String(exec)}
                resultColor="#1565c0"
              />
              <Divider sx={{ my: 1.5 }} />
              <Step
                label="Delivery %"
                formula={`SP Done / ${scopeLabel} × 100`}
                substitution={`${spDone} / ${spPlanned} × 100 = ${dp}%`}
                result={`${dp}%`}
                note={hasCommitment ? undefined
                  : 'Kanban has no commitment, so this is the share of work touched in the cycle that was finished in it — not delivery against a plan. "Carried" here excludes points already counted in an earlier cycle, so it can be lower than the SP In Flight column.'}
              />
              <Step
                label="Rework %"
                formula={`SP Rework / ${scopeLabel} × 100  (lower is better)`}
                substitution={`${spRework} / ${spPlanned} × 100 = ${rr}%`}
                result={`${rr}%`}
                note="Rework SP = story points on this developer's tickets reopened or bounced back from QA / UAT."
              />
              <Step
                label="Reopen Rate"
                formula="Reopened tickets / delivered tickets × 100"
                substitution={`${reopened} reopened → ${reopenPct}%`}
                result={`${reopenPct}%`}
              />
              <Step
                label="Cycle Time"
                formula="Avg hours from In Progress to first QA handoff"
                substitution={`avg = ${fmtHrs(cycle)}`}
                result={fmtHrs(cycle)}
              />
            </>
          );
        })()}

        {/* ── QA ────────────────────────────────────────────────────── */}
        {!loading && !error && !isDev && qa && (() => {
          const qrStored = effectiveQualityRate(metricVal(score, 'qualityRate'), metricVal(score, 'ticketsTestedCount'));
          const band = qualityBandLabel(qrStored);
          const bandColor = qrStored == null || Number(qrStored) < 0 ? '#64748b' : qaRatingHex(Number(qrStored));
          const bp = (metricVal(score, 'bugsByPriority') ?? {}) as any;
          const weighted = num(metricVal(score, 'weightedBugScore'));
          const tested = num(metricVal(score, 'ticketsTestedCount'));
          const prodEsc = num(metricVal(score, 'prodBugsEscaped'));
          const escPct = num(metricVal(score, 'bugEscapeRatePct'));
          const insufficient = qa.testedCount < 5;
          return (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Quality Rating</Typography>
                <Box sx={{ flex: 1 }} />
                <Chip label={band} size="small" sx={{ fontWeight: 700, color: '#fff', bgcolor: bandColor }} />
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: bandColor }}>
                  {qrStored == null || Number(qrStored) < 0 ? 'N/A' : qa.computedQr}
                </Typography>
              </Box>

              {insufficient ? (
                <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
                  Only {qa.testedCount} ticket{qa.testedCount === 1 ? '' : 's'} tested (minimum 5). Quality is shown as N/A —
                  too small a sample to rate. The inputs are still shown below.
                </Alert>
              ) : (
                <Step
                  label="Quality Rating (risk, lower is better)"
                  formula="(1 − composite) × 100,   composite = 0.70 × UAT pass rate + 0.30 × in-sprint catch"
                  substitution={
                    `composite = 0.70 × ${r1(qa.passRate * 100) / 100} + 0.30 × ${r1(qa.inSprintCatch * 100) / 100} = ${r1(qa.composite * 100) / 100}\n` +
                    `rating = (1 − ${r1(qa.composite * 100) / 100}) × 100 = ${qa.computedQr}`
                  }
                  result={String(qa.computedQr)}
                  resultColor={bandColor}
                />
              )}

              <Divider sx={{ my: 1.5 }} />

              <Step
                label="UAT Pass Rate (70% weight)"
                formula="1 − (SP of cleared tickets rejected in UAT / SP of all cleared tickets)"
                substitution={`1 − ${qa.uatFailedSP} / ${qa.clearedSP} = ${r1(qa.passRate * 100) / 100}`}
                result={`${Math.round(qa.passRate * 100)}%`}
                note={
                  qa.uatFailed.length > 0
                    ? `UAT-rejected tickets: ${qa.uatFailed.map((f: any) => f.jiraKey).join(', ')}`
                    : 'No cleared tickets bounced back from UAT.'
                }
              />
              <Step
                label="In-Sprint Catch (30% weight)"
                formula="Bugs raised against a current-sprint story / bugs that can be judged (Epic-parented bugs excluded)"
                substitution={qa.catchEligibleCount > 0
                  ? `${qa.inSprintCount} / ${qa.catchEligibleCount} = ${r1(qa.inSprintCatch * 100) / 100}`
                  : `no judgeable bugs (${qa.raisedCount} raised, all parented to an Epic or unlinked) = 1 (default)`}
                result={`${Math.round(qa.inSprintCatch * 100)}%`}
              />

              <Divider sx={{ my: 1.5 }} />

              <Step
                label="Weighted Bug Score"
                formula="Critical × 3 + High × 2 + Medium × 1.5 + Low × 1"
                substitution={`${num(bp.critical)}×3 + ${num(bp.high)}×2 + ${num(bp.medium)}×1.5 + ${num(bp.low)}×1 = ${weighted}`}
                result={String(weighted)}
              />
              <Step
                label="Escape %"
                formula="Confirmed production bugs / tickets tested × 100  (display only — not in Quality)"
                substitution={`${prodEsc} / ${tested} × 100 = ${escPct}%`}
                result={`${escPct}%`}
              />
              <Step
                label="Tested / QA Cycle"
                formula="Tickets signed off through QA · avg hours in the QA lane"
                substitution={`tested = ${qa.testedCount} · QA cycle = ${fmtHrs(metricVal(score, 'avgQaCycleTimeHours'))}`}
                result={String(qa.testedCount)}
              />

              <Typography sx={{ fontSize: 11, color: '#94a3b8', mt: 1, fontStyle: 'italic' }}>
                New Bugs counts on-board bugs only; off-board bugs are excluded from these figures.
              </Typography>
            </>
          );
        })()}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
