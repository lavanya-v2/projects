import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControlLabel, Paper, Rating, Stack, Step, StepLabel,
  Stepper, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import {
  StarRounded, StarBorderRounded, CheckCircleRounded, WarningAmberRounded,
  LockRounded, HistoryRounded,
} from '@mui/icons-material';
import {
  useLeadReview, useSaveLeadReview, useSubmitLeadReview, usePublishLeadReview, useReviseLeadReview,
} from '../hooks';
import type { CompetencyItem, RatingInput } from '../types';
import { EvidencePanel } from './EvidencePanel';

const NAVY = '#002e5b';
const GREEN = '#4caf50';

/** Mirrors MIN_EXTREME_COMMENT_LENGTH on the server. */
const MIN_EXTREME_COMMENT = 20;
/** Mirrors MIN_COMMENT_LENGTH on the server. */
const MIN_COMMENT = 3;

const STEPS = ['Competencies', 'Narrative', 'Performance data', 'Review & publish'];

/**
 * The lead's review form.
 *
 * The justification rules are enforced server-side; this surfaces them as the lead
 * types rather than failing at submit. A lead who discovers at the end that four
 * comments are too short will write four throwaway sentences — showing the
 * requirement at the point of rating is what actually produces usable justifications.
 */
export function LeadReviewForm({
  reviewId,
  memberName,
  onClose,
}: {
  reviewId: number;
  memberName: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useLeadReview(reviewId);
  const save = useSaveLeadReview();
  const submit = useSubmitLeadReview();
  const publish = usePublishLeadReview();
  const revise = useReviseLeadReview();

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Record<number, RatingInput>>({});
  const [strengths, setStrengths] = useState('');
  const [improvements, setImprovements] = useState('');
  const [overall, setOverall] = useState('');
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseReason, setReviseReason] = useState('');
  const hydrated = useRef(false);

  const review = data?.review;
  const template = data?.template;
  const items = useMemo(
    () => (template?.items ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder),
    [template],
  );
  const readOnly = review?.status === 'published' || review?.status === 'superseded';

  useEffect(() => {
    if (!data || hydrated.current) return;
    const seeded: Record<number, RatingInput> = {};
    for (const r of data.ratings) {
      seeded[r.templateItemId] = {
        templateItemId: r.templateItemId,
        rating: r.rating,
        textValue: r.textValue,
        comment: r.comment,
        na: r.na,
      };
    }
    setDraft(seeded);
    setStrengths(data.review.strengths ?? '');
    setImprovements(data.review.improvements ?? '');
    setOverall(data.review.overallComment ?? '');
    hydrated.current = true;
  }, [data]);

  const patch = (itemId: number, next: Partial<RatingInput>) =>
    setDraft(prev => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { templateItemId: itemId }), ...next },
    }));

  const persist = () =>
    save.mutate({
      reviewId,
      strengths,
      improvements,
      overallComment: overall,
      ratings: Object.values(draft),
    });

  /**
   * Local mirror of the server's rule, so the requirement is visible while the
   * lead is still thinking about this competency.
   */
  const commentProblem = (item: CompetencyItem, answer?: RatingInput): string | null => {
    if (item.inputType !== 'rating') return null;
    if (!answer || answer.na || answer.rating === null || answer.rating === undefined) return null;

    const comment = (answer.comment ?? '').trim();
    if (comment.length < MIN_COMMENT) return 'A written justification is required';

    const isExtreme =
      !!template &&
      (answer.rating === template.ratingScaleMin || answer.rating === template.ratingScaleMax);
    if (isExtreme && comment.length < MIN_EXTREME_COMMENT) {
      return `A rating at the edge of the scale needs a specific justification (${comment.length}/${MIN_EXTREME_COMMENT} characters)`;
    }
    return null;
  };

  if (isLoading || !data) return <CircularProgress size={22} />;

  const problems = data.validation.problems;
  const ready = data.validation.ready;

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY }}>{memberName}</Typography>
        <StatusChip status={review!.status} version={review!.version} />
        {readOnly && (
          <Chip size="small" icon={<LockRounded />} label="Record — not editable"
            sx={{ fontSize: 11, bgcolor: '#eef2f7' }} />
        )}
      </Stack>
      <Typography sx={{ fontSize: 12, color: '#6b7280', mb: 2 }}>
        {template?.name} v{template?.version} · scale {template?.ratingScaleMin}–{template?.ratingScaleMax}
        {review!.supersedesReviewId && ` · supersedes review #${review!.supersedesReviewId}`}
      </Typography>

      {review!.revisionReason && (
        <Alert severity="info" icon={<HistoryRounded />} sx={{ mb: 2, fontSize: 13 }}>
          <strong>Revision reason:</strong> {review!.revisionReason}
        </Alert>
      )}

      <Stepper activeStep={step} sx={{ mb: 3 }}>
        {STEPS.map((label, i) => (
          <Step key={label} completed={i < step}>
            <StepLabel sx={{ cursor: 'pointer' }} onClick={() => setStep(i)}>
              <Typography sx={{ fontSize: 12.5 }}>{label}</Typography>
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* ── 1. Competencies ──────────────────────────────────────────────── */}
      {step === 0 && (
        <Stack spacing={2}>
          {items.map(item => {
            const answer = draft[item.id];
            const problem = commentProblem(item, answer);
            return (
              <Paper key={item.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                  <Box>
                    {item.section && (
                      <Typography sx={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        {item.section}
                      </Typography>
                    )}
                    <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{item.label}</Typography>
                    {item.description && (
                      <Typography sx={{ fontSize: 12, color: '#6b7280' }}>{item.description}</Typography>
                    )}
                  </Box>
                  {item.inputType === 'rating' && (
                    <Tooltip title={`Weight ${item.weight} — how much this competency counts toward the score`}>
                      <Chip size="small" label={`×${item.weight}`} sx={{ fontSize: 11 }} />
                    </Tooltip>
                  )}
                </Stack>

                {item.inputType === 'rating' ? (
                  <Box sx={{ mt: 1.5 }}>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Rating
                        value={answer?.rating ?? null}
                        max={template!.ratingScaleMax}
                        disabled={readOnly || answer?.na}
                        icon={<StarRounded fontSize="inherit" />}
                        emptyIcon={<StarBorderRounded fontSize="inherit" />}
                        onChange={(_, v) => patch(item.id, { rating: v })}
                      />
                      {answer?.rating != null && (
                        <Typography sx={{ fontSize: 12, color: '#6b7280' }}>
                          {template!.ratingScaleLabels?.[String(answer.rating)] ?? `${answer.rating} of ${template!.ratingScaleMax}`}
                        </Typography>
                      )}
                      <Box sx={{ flexGrow: 1 }} />
                      <FormControlLabel
                        control={
                          <Switch size="small" checked={!!answer?.na} disabled={readOnly}
                            onChange={e => patch(item.id, { na: e.target.checked, rating: null })} />
                        }
                        label={<Typography sx={{ fontSize: 12 }}>Not applicable</Typography>}
                      />
                    </Stack>

                    {!answer?.na && (
                      <TextField
                        fullWidth multiline minRows={2} size="small" sx={{ mt: 1.5 }}
                        label="Why this rating?"
                        placeholder="Point to something specific — a piece of work, a behaviour, an outcome."
                        value={answer?.comment ?? ''}
                        disabled={readOnly}
                        error={!!problem}
                        helperText={
                          problem ??
                          'Recorded with the rating and shown to the member when published.'
                        }
                        onChange={e => patch(item.id, { comment: e.target.value })}
                      />
                    )}
                  </Box>
                ) : (
                  <TextField
                    fullWidth multiline minRows={2} size="small" sx={{ mt: 1.5 }}
                    label={item.label} value={answer?.textValue ?? ''} disabled={readOnly}
                    onChange={e => patch(item.id, { textValue: e.target.value })}
                  />
                )}
              </Paper>
            );
          })}
        </Stack>
      )}

      {/* ── 2. Narrative ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <Stack spacing={2}>
          <TextField
            fullWidth multiline minRows={4} label="Strengths" value={strengths} disabled={readOnly}
            onChange={e => setStrengths(e.target.value)}
            helperText="What went well this period. The member reads this verbatim."
          />
          <TextField
            fullWidth multiline minRows={4} label="Areas to improve" value={improvements} disabled={readOnly}
            onChange={e => setImprovements(e.target.value)}
            helperText="Be specific enough to act on."
          />
          <TextField
            fullWidth multiline minRows={3} label="Overall comment (optional)" value={overall}
            disabled={readOnly} onChange={e => setOverall(e.target.value)}
          />
        </Stack>
      )}

      {/* ── 3. Performance data ──────────────────────────────────────────── */}
      {step === 2 && <EvidencePanel review={review!} />}

      {/* ── 4. Review & publish ──────────────────────────────────────────── */}
      {step === 3 && (
        <Stack spacing={2}>
          {problems.length > 0 ? (
            <Alert severity="warning" icon={<WarningAmberRounded />} sx={{ fontSize: 13 }}>
              <strong>Not ready to submit.</strong>
              <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2.5 }}>
                {problems.map(p => <li key={p}>{p}</li>)}
              </Box>
            </Alert>
          ) : (
            <Alert severity="success" icon={<CheckCircleRounded />} sx={{ fontSize: 13 }}>
              Complete. Submitting freezes the performance figures shown on the previous step as the
              evidence behind this review.
            </Alert>
          )}

          {review!.normalizedScore !== null && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography sx={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Lead review score
              </Typography>
              <Typography sx={{ fontSize: 28, fontWeight: 700, color: NAVY }}>
                {Number(review!.normalizedScore).toFixed(1)}
              </Typography>
              <Typography sx={{ fontSize: 12, color: '#6b7280' }}>
                Weighted across the rated competencies, mapped to 0–100.
              </Typography>
            </Paper>
          )}

          {review!.status === 'published' && (
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Published{review!.publishedAt ? ` on ${new Date(review!.publishedAt).toLocaleDateString()}` : ''}.
              {review!.acknowledgedAt
                ? ` Acknowledged by the member on ${new Date(review!.acknowledgedAt).toLocaleDateString()}.`
                : ' Not yet acknowledged by the member.'}
              <br />
              A published review cannot be edited. Correcting it creates a new version and keeps this one.
            </Alert>
          )}
        </Stack>
      )}

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <Divider sx={{ my: 2.5 }} />
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Button size="small" disabled={step === 0} onClick={() => setStep(s => s - 1)}>Back</Button>
        {step < STEPS.length - 1 ? (
          <Button
            size="small" variant="contained" sx={{ bgcolor: NAVY, '&:hover': { bgcolor: '#001f3d' } }}
            onClick={() => { if (!readOnly) persist(); setStep(s => s + 1); }}
          >
            Next
          </Button>
        ) : (
          <>
            {review!.status === 'draft' && (
              <Button
                size="small" variant="contained" disabled={!ready || submit.isPending}
                sx={{ bgcolor: NAVY, '&:hover': { bgcolor: '#001f3d' } }}
                onClick={() => submit.mutate(reviewId)}
              >
                Submit
              </Button>
            )}
            {review!.status === 'submitted' && (
              <Button
                size="small" variant="contained" disabled={publish.isPending}
                sx={{ bgcolor: GREEN, '&:hover': { bgcolor: '#3d8b40' } }}
                onClick={() => publish.mutate(reviewId)}
              >
                Publish to member
              </Button>
            )}
            {review!.status === 'published' && (
              <Button size="small" variant="outlined" color="warning" onClick={() => setReviseOpen(true)}>
                Correct this review
              </Button>
            )}
          </>
        )}

        {!readOnly && (
          <Button size="small" variant="text" disabled={save.isPending} onClick={persist}>
            Save draft
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {(save.isPending || submit.isPending || publish.isPending) && <CircularProgress size={18} />}
        {save.isSuccess && !save.isPending && (
          <Typography sx={{ fontSize: 12, color: GREEN }}>Saved</Typography>
        )}
        <Button size="small" onClick={onClose}>Close</Button>
      </Stack>

      {submit.isError && (
        <Alert severity="error" sx={{ mt: 2, fontSize: 13 }}>
          {(submit.error as any)?.response?.data?.problems?.join(' · ') ??
            (submit.error as any)?.response?.data?.message ??
            'Could not submit the review.'}
        </Alert>
      )}

      {/* Correcting a published review is a deliberate, explained act. */}
      <Dialog open={reviseOpen} onClose={() => setReviseOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontSize: 16 }}>Correct a published review</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2 }}>
            The published review stays on record exactly as the member saw it. This creates a new
            version carrying the current answers forward, which you can edit and publish again. The
            reason below is kept with both.
          </Typography>
          <TextField
            fullWidth multiline minRows={3} autoFocus label="Why does this need correcting?"
            value={reviseReason} onChange={e => setReviseReason(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setReviseOpen(false)}>Cancel</Button>
          <Button
            size="small" variant="contained" color="warning"
            disabled={reviseReason.trim().length < MIN_COMMENT || revise.isPending}
            onClick={() =>
              revise.mutate(
                { reviewId, reason: reviseReason },
                { onSuccess: () => { setReviseOpen(false); setReviseReason(''); onClose(); } },
              )
            }
          >
            Create revision
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export function StatusChip({ status, version }: { status: string; version?: number }) {
  const style: Record<string, { bg: string; fg: string; label: string }> = {
    draft: { bg: '#eef2f7', fg: '#374151', label: 'Draft' },
    submitted: { bg: '#fff4e5', fg: '#8a5300', label: 'Submitted' },
    published: { bg: '#e8f5e9', fg: '#1b5e20', label: 'Published' },
    superseded: { bg: '#f3f4f6', fg: '#9ca3af', label: 'Superseded' },
    withdrawn: { bg: '#fdecea', fg: '#611a15', label: 'Withdrawn' },
  };
  const s = style[status] ?? style.draft;
  return (
    <Chip
      size="small"
      label={version && version > 1 ? `${s.label} · v${version}` : s.label}
      sx={{ fontSize: 11, fontWeight: 600, bgcolor: s.bg, color: s.fg }}
    />
  );
}

export default LeadReviewForm;
