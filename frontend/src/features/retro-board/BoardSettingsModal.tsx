/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Switch, TextField, Typography,
} from '@mui/material';
import { useUpdateRetroBoard } from './hooks';
import { suggestVotes, MAX_VOTES_PER_USER } from './voteGuidance';
import type { RetroBoard } from './types';

interface Props {
  board: RetroBoard;
  itemCount: number;
  /** Highest number of votes any one participant has already spent. */
  maxVotesSpent: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/**
 * Facilitator settings, editable while the retro is running.
 *
 * This exists mainly for the vote budget. The right number depends on how many
 * items the team produces, which nobody knows at creation time — so fixing it
 * up front forced the lead to guess and then live with it. Everything here
 * freezes once the board is completed, enforced server-side by the 'configure'
 * access mode.
 */
export default function BoardSettingsModal({ board, itemCount, maxVotesSpent, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(board.title);
  const [meetingDate, setMeetingDate] = useState(board.meetingDate);
  const [meetingTime, setMeetingTime] = useState(board.meetingTime?.slice(0, 5) ?? '10:00');
  const [allowAnonymous, setAllowAnonymous] = useState(board.allowAnonymous);
  const [votingEnabled, setVotingEnabled] = useState(board.votingEnabled);
  const [votesPerUser, setVotesPerUser] = useState(board.votesPerUser);
  const [error, setError] = useState<string | null>(null);

  const updateBoard = useUpdateRetroBoard();
  const suggested = suggestVotes(itemCount);
  const lowersBelowSpent = votesPerUser > 0 && votesPerUser < maxVotesSpent;

  const save = async () => {
    setError(null);
    if (!title.trim()) { setError('Title is required'); return; }
    try {
      await updateBoard.mutateAsync({
        boardId: board.id,
        data: {
          title: title.trim(),
          meetingDate,
          meetingTime,
          allowAnonymous,
          votingEnabled,
          votesPerUser,
        },
      });
      onSaved('Board settings updated');
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not save settings');
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Board settings</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            fullWidth size="small" label="Title" value={title}
            onChange={e => setTitle(e.target.value)}
            inputProps={{ maxLength: 255, 'data-testid': 'settings-title' }}
          />

          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              fullWidth size="small" type="date" label="Meeting date"
              InputLabelProps={{ shrink: true }}
              value={meetingDate} onChange={e => setMeetingDate(e.target.value)}
            />
            <TextField
              fullWidth size="small" type="time" label="Meeting time"
              InputLabelProps={{ shrink: true }}
              value={meetingTime} onChange={e => setMeetingTime(e.target.value)}
            />
          </Box>

          <FormControlLabel
            control={
              <Switch checked={allowAnonymous} onChange={e => setAllowAnonymous(e.target.checked)} />
            }
            label={<Typography variant="body2">Allow anonymous items</Typography>}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
            Turning this off only affects new items. Anything already posted anonymously stays
            anonymous — we never recorded who wrote it.
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={votingEnabled}
                onChange={e => setVotingEnabled(e.target.checked)}
                inputProps={{ 'data-testid': 'settings-voting-toggle' } as never}
              />
            }
            label={<Typography variant="body2">Enable voting</Typography>}
          />

          {votingEnabled && (
            <>
              <TextField
                size="small" type="number" label="Votes per person" sx={{ maxWidth: 220 }}
                value={votesPerUser}
                onChange={e =>
                  setVotesPerUser(Math.min(MAX_VOTES_PER_USER, Math.max(0, parseInt(e.target.value) || 0)))
                }
                inputProps={{ min: 0, max: MAX_VOTES_PER_USER, 'data-testid': 'settings-votes' }}
                helperText="0 means unlimited"
              />

              <Alert severity="info" data-testid="settings-vote-suggestion">
                {itemCount === 0
                  ? 'Set this once the team has added their items — the right number depends on how many there are.'
                  : `${itemCount} item${itemCount === 1 ? '' : 's'} on the board — about ${suggested} votes each keeps the top 3 distinct.`}
                {itemCount > 0 && votesPerUser !== suggested && (
                  <Button
                    size="small" sx={{ ml: 1 }}
                    data-testid="settings-apply-suggestion"
                    onClick={() => setVotesPerUser(suggested)}
                  >
                    Use {suggested}
                  </Button>
                )}
              </Alert>

              {lowersBelowSpent && (
                <Alert severity="warning" data-testid="settings-lower-warning">
                  Someone has already spent {maxVotesSpent} votes. Lowering the limit to {votesPerUser} keeps
                  their existing votes, but they cannot vote again until they remove enough to get under it.
                </Alert>
              )}
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained" onClick={save} disabled={updateBoard.isPending}
          data-testid="settings-save"
        >
          {updateBoard.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
