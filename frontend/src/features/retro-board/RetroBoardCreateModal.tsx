/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  IconButton, MenuItem, Switch, TextField, Typography,
} from '@mui/material';
import { DeleteOutlineRounded, AddRounded } from '@mui/icons-material';
import { useProjects } from '../auth/hooks';
import { useCreateRetroBoard } from './hooks';
import {
  RETRO_LANE_TEMPLATES, TEMPLATE_LABELS, LANE_PALETTE, MIN_LANES, MAX_LANES,
  type RetroLaneTemplateKey,
} from './laneTemplates';
import { MAX_VOTES_PER_USER } from './voteGuidance';
import type { RetroBoard } from './types';
import { useAccount } from '../../context/UseAccount';
import { DatePicker, LocalizationProvider, TimePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';

interface Props {
  onClose: () => void;
  onCreated: (board: RetroBoard) => void;
}

export default function RetroBoardCreateModal({ onClose, onCreated }: Props) {
  const { activeAccount } = useAccount();
  const projectsQuery = useProjects(activeAccount?.id);
  const createBoard = useCreateRetroBoard();

  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState(new Date().toISOString().slice(0, 10));
  const [meetingTime, setMeetingTime] = useState<Dayjs | null>(dayjs().set('hour', 10).set('minute', 0).set('second',0));
  const [template, setTemplate] = useState<RetroLaneTemplateKey>('WENT_WELL');
  const [customLanes, setCustomLanes] = useState<string[]>(['Went Well', 'Can Be Better', 'Actions']);
  const [allowAnonymous, setAllowAnonymous] = useState(true);
  const [votingEnabled, setVotingEnabled] = useState(true);
  const [votesPerUser, setVotesPerUser] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const formatDueDate = (dateValue: string | null | undefined) => {
    return dateValue ? dayjs(dateValue) : null;
  };
  
  const handleDateChange = (date: dayjs.Dayjs | null) => {
    const setDueDate = date ? date.toISOString() : ''
    const today = dayjs().subtract(1, "day");
      const threeMonthsFromNow = dayjs().add(3, "month");
      if (date?.isAfter(threeMonthsFromNow)) {
        setError("Meeting date should be within 3 months");
      } else if (date?.isBefore(today)) {
        setError("Meeting date cannot be past date");
      } else {
        setError("");
      }
    setMeetingDate(setDueDate);
  };

  const buttonDisabled = !projectId || !title.trim() || !meetingDate || !meetingTime;

  const submit = async () => {
    setError(null);
    if (!projectId) { setError('Select a project'); return; }
    if (!title.trim()) { setError('Give the retro a title'); return; }
    if (!meetingTime) { setError('Select a meeting time'); return; }
    if (!meetingDate) { setError('Select a meeting date'); return; }

    const lanes = template === 'CUSTOM'
      ? customLanes
          .map((name, i) => ({ name: name.trim(), order: i, color: LANE_PALETTE[i % LANE_PALETTE.length] }))
          .filter(l => l.name)
      : undefined;

    if (template === 'CUSTOM' && (!lanes || lanes.length < MIN_LANES)) {
      setError(`Custom boards need at least ${MIN_LANES} named lanes`);
      return;
    }

    try {
      const board = await createBoard.mutateAsync({
        projectId: parseInt(projectId), title: title.trim(), meetingDate,  meetingTime: meetingTime.format('HH:mm:ss'),
        laneTemplate: template, lanes, allowAnonymous, votingEnabled,
        // Sent regardless of votingEnabled: zeroing it here meant that later
        // re-enabling voting silently produced an unlimited budget.
        votesPerUser,
      });
      onCreated(board);
    } catch (e: any) {
      setError(e?.response?.data?.error ?? 'Could not create the retro board');
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New retro board</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            select fullWidth size="small" label="Project" value={projectId}
            onChange={e => setProjectId(e.target.value)}
            inputProps={{ 'data-testid': 'retro-project' }}
          >
            {(projectsQuery.data ?? []).map((p: any) => (
              <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>
            ))}
          </TextField>

          <TextField
            fullWidth size="small" label="Title" placeholder="Sprint 42 Retro"
            value={title} onChange={e => setTitle(e.target.value)}
            inputProps={{ maxLength: 255, 'data-testid': 'retro-title' }}
          />

          <Box sx={{ display: 'flex', gap: 2 }}>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DatePicker
                label="Meeting date"
                value={formatDueDate(meetingDate)}
                onChange={(date)=> handleDateChange(date)}
                views={['year', 'month', 'day']}
                slotProps={{ textField: { size: 'small' } }}
                sx={{ minWidth: 300 }} 
                minDate = {dayjs()}
                maxDate = {dayjs().add(3, "month")} />
            </LocalizationProvider>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <TimePicker
                label="Meeting time"
                value={meetingTime}
                onChange={(time)=> setMeetingTime(time) }
                slotProps={{ textField: { size: 'small' } }}
                sx={{ minWidth: 150}} />
            </LocalizationProvider>
          </Box>

          <TextField
            select fullWidth size="small" label="Lanes" value={template}
            onChange={e => setTemplate(e.target.value as RetroLaneTemplateKey)}
          >
            {(Object.keys(TEMPLATE_LABELS) as RetroLaneTemplateKey[]).map(k => (
              <MenuItem key={k} value={k}>{TEMPLATE_LABELS[k]}</MenuItem>
            ))}
          </TextField>

          {template !== 'CUSTOM' && (
            <Typography variant="caption" color="text.secondary">
              {RETRO_LANE_TEMPLATES[template as Exclude<RetroLaneTemplateKey, 'CUSTOM'>]
                .map(l => l.name).join('  ·  ')}
            </Typography>
          )}

          {template === 'CUSTOM' && (
            <Box>
              {customLanes.map((name, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
                  <TextField
                    fullWidth size="small" label={`Lane ${i + 1}`} value={name}
                    onChange={e => setCustomLanes(l => l.map((v, j) => (j === i ? e.target.value : v)))}
                    inputProps={{ maxLength: 60 }}
                  />
                  <IconButton
                    size="small" disabled={customLanes.length <= MIN_LANES}
                    onClick={() => setCustomLanes(l => l.filter((_, j) => j !== i))}
                  >
                    <DeleteOutlineRounded fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              <Button
                size="small" startIcon={<AddRounded />} disabled={customLanes.length >= MAX_LANES}
                onClick={() => setCustomLanes(l => [...l, ''])}
              >
                Add lane
              </Button>
            </Box>
          )}

          <FormControlLabel
            control={<Switch checked={allowAnonymous} onChange={e => setAllowAnonymous(e.target.checked)} />}
            label={<Typography variant="body2">Allow anonymous items</Typography>}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: -1.5 }}>
            When someone posts anonymously we do not record who they are — not hidden, not stored.
            In a small team, remember that a short list of participants is itself a clue.
          </Typography>

          <FormControlLabel
            control={<Switch checked={votingEnabled} onChange={e => setVotingEnabled(e.target.checked)} />}
            label={<Typography variant="body2">Enable voting</Typography>}
          />
          {votingEnabled && (
            <>
              <TextField
                size="small" type="number" label="Votes per person" sx={{ maxWidth: 200 }}
                value={votesPerUser}
                onChange={e =>
                  setVotesPerUser(Math.min(MAX_VOTES_PER_USER, Math.max(0, parseInt(e.target.value) || 0)))
                }
                inputProps={{ min: 0, max: MAX_VOTES_PER_USER }}
                helperText="0 means unlimited"
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
                3-6 suits most retros. Votes are scarce on purpose — if everyone can vote for
                most items, the top 3 stops standing out. You can change this from Settings once
                you see how many items the team adds.
              </Typography>
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained" onClick={submit} disabled={createBoard.isPending || !!buttonDisabled || Boolean(error)}
          data-testid="retro-create-submit"
        >
          {createBoard.isPending ? 'Creating…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
