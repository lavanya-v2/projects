import { useState } from 'react';
import {
  Alert, Box, Button, Chip, Collapse, Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import {
  HistoryRounded, ExpandMoreRounded, ExpandLessRounded, OpenInNewRounded,
} from '@mui/icons-material';
import { OUTCOME_COLORS, OUTCOME_LABELS, type CarriedPoint, type CarryForward, type RetroOutcome } from './types';

const RANK_COLORS: Record<number, string> = { 1: '#f9a825', 2: '#90a4ae', 3: '#8d6e63' };
const OUTCOMES: RetroOutcome[] = ['DONE', 'STILL_OPEN', 'DROPPED'];

/** Action Item / Risk statuses that mean the work is finished. */
const CLOSED_STATUSES = new Set(['Closed', 'Discarded', 'DONE']);

interface Props {
  data: CarryForward;
  onSetOutcome: (itemId: number, outcome: RetroOutcome, note?: string) => void;
  onConvert?: (point: CarriedPoint) => void;
  busy?: boolean;
}

/**
 * What the last retro agreed, and what came of it.
 *
 * Without this the top 3 is written down once and never looked at again — the
 * failure mode where a team agrees the same thing every sprint and nobody
 * notices. Putting it at the top of the next retro makes "review the last one"
 * the default opening move rather than something the facilitator must remember.
 *
 * Linked Action Item / Risk status is read live on the server, so what is shown
 * here is the real current state of the work, not a snapshot taken at
 * conversion time.
 */
export default function CarryForwardPanel({ data, onSetOutcome, onConvert, busy }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');

  // Nothing to review on a project's very first retro.
  if (!data.previousBoard || data.points.length === 0) return null;

  const reviewed = data.points.filter(p => p.outcome !== null).length;
  const canReviewAny = data.points.some(p => p.canSetOutcome);

  const submitOutcome = (point: CarriedPoint, outcome: RetroOutcome) => {
    if (noteFor === point.id) {
      onSetOutcome(point.id, outcome, noteText.trim() || undefined);
      setNoteFor(null);
      setNoteText('');
    } else {
      onSetOutcome(point.id, outcome);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="carry-forward-panel">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: expanded ? 1.5 : 0 }}>
        <HistoryRounded fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Since your last retro
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {data.previousBoard.title} · {data.previousBoard.meetingDate}
        </Typography>
        <Chip
          size="small"
          label={`${reviewed}/${data.points.length} reviewed`}
          sx={{ height: 20, fontSize: 11 }}
          data-testid="carry-forward-reviewed-count"
        />
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" onClick={() => setExpanded(e => !e)} data-testid="carry-forward-toggle">
          {expanded ? <ExpandLessRounded fontSize="small" /> : <ExpandMoreRounded fontSize="small" />}
        </Button>
      </Box>

      <Collapse in={expanded}>
        {canReviewAny && reviewed < data.points.length && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            Start by asking the team what happened to these. Marking them keeps an honest record,
            including the ones nobody got to.
          </Alert>
        )}

        {data.points.map(point => (
          <Box
            key={point.id}
            data-testid={`carried-point-${point.id}`}
            sx={{
              display: 'flex', flexDirection: 'column', gap: 0.75, mb: 1, p: 1.25,
              borderLeft: `4px solid ${RANK_COLORS[point.topPickRank ?? 1] ?? '#90a4ae'}`,
              bgcolor: 'action.hover', borderRadius: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Chip
                size="small"
                label={`#${point.topPickRank}`}
                sx={{
                  height: 22, fontWeight: 700, color: '#fff',
                  bgcolor: RANK_COLORS[point.topPickRank ?? 1] ?? '#90a4ae',
                }}
              />
              <Typography variant="body2" sx={{ flexGrow: 1 }}>{point.content}</Typography>

              {point.outcome && (
                <Chip
                  size="small"
                  label={OUTCOME_LABELS[point.outcome]}
                  data-testid={`carried-outcome-${point.id}`}
                  sx={{ height: 22, fontWeight: 600, color: '#fff', bgcolor: OUTCOME_COLORS[point.outcome] }}
                />
              )}
            </Box>

            {/* Live status of whatever this became. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              {point.linked ? (
                <Chip
                  size="small"
                  variant="outlined"
                  icon={<OpenInNewRounded sx={{ fontSize: 13 }} />}
                  data-testid={`carried-linked-${point.id}`}
                  label={
                    point.linked.status === null
                      ? `${point.linked.type === 'RISK' ? 'Risk' : 'Action'} #${point.linked.refId} · no longer available`
                      : `${point.linked.type === 'RISK' ? 'Risk' : 'Action'} #${point.linked.refId} · ${point.linked.status}`
                  }
                  sx={{
                    height: 22, fontSize: 11,
                    borderColor: point.linked.status && CLOSED_STATUSES.has(point.linked.status)
                      ? '#2e7d32' : undefined,
                  }}
                />
              ) : (
                <>
                  <Typography variant="caption" color="text.secondary" data-testid={`carried-unlinked-${point.id}`}>
                    No action was created for this
                  </Typography>
                  {point.canSetOutcome && onConvert && (
                    <Button
                      size="small"
                      onClick={() => onConvert(point)}
                      data-testid={`carried-convert-${point.id}`}
                    >
                      Convert now
                    </Button>
                  )}
                </>
              )}
            </Box>

            {point.outcomeNote && (
              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                “{point.outcomeNote}”{point.outcomeBy ? ` — ${point.outcomeBy}` : ''}
              </Typography>
            )}

            {point.canSetOutcome && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                <Stack direction="row" spacing={0.75}>
                  {OUTCOMES.map(o => (
                    <Button
                      key={o}
                      size="small"
                      disabled={busy}
                      variant={point.outcome === o ? 'contained' : 'outlined'}
                      data-testid={`set-outcome-${o}-${point.id}`}
                      onClick={() => submitOutcome(point, o)}
                      sx={{
                        minWidth: 0, px: 1, fontSize: 11,
                        ...(point.outcome === o ? { bgcolor: OUTCOME_COLORS[o] } : {}),
                      }}
                    >
                      {OUTCOME_LABELS[o]}
                    </Button>
                  ))}
                </Stack>
                <Tooltip title="Add a note explaining what happened">
                  <Button
                    size="small"
                    sx={{ fontSize: 11 }}
                    data-testid={`carried-note-toggle-${point.id}`}
                    onClick={() => {
                      setNoteFor(noteFor === point.id ? null : point.id);
                      setNoteText(point.outcomeNote ?? '');
                    }}
                  >
                    {point.outcomeNote ? 'Edit note' : 'Add note'}
                  </Button>
                </Tooltip>
              </Box>
            )}

            <Collapse in={noteFor === point.id}>
              <TextField
                fullWidth
                size="small"
                multiline
                minRows={2}
                placeholder="What happened? Why was it dropped?"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                inputProps={{ maxLength: 2000, 'data-testid': `carried-note-input-${point.id}` }}
                helperText="Pick an outcome above to save the note with it."
                sx={{ mt: 0.5 }}
              />
            </Collapse>
          </Box>
        ))}
      </Collapse>
    </Paper>
  );
}
