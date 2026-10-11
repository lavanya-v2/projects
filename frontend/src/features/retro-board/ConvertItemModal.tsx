import { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { useConvertToActionItem, useConvertToRisk, useConvertCarriedPoint } from './hooks';
import type { RetroBoard } from './types';
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';

const ACTION_ITEM_CATEGORIES = [
  'Task', 'Follow-up', 'Decision Required', 'Issue', 'Risk & Mitigation', 'Dependency',
];
const RISK_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

interface Props {
  /**
   * Widened from RetroItem to the fields this form actually reads, so a
   * CarriedPoint from a previous retro can use the same dialog.
   */
  item: { id: number; content: string; isAnonymous: boolean };
  board: RetroBoard;
  /**
   * Set when the item was carried forward from an EARLIER retro. It switches
   * submission to the carry-forward route, which authorises against the board
   * being facilitated now rather than the frozen board that owns the item.
   */
  carried?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}

/**
 * Optional follow-up capture. Nothing here happens automatically — the
 * facilitator decides, per item, whether a retro point deserves tracked work.
 */
export default function ConvertItemModal({ item, board, carried, onClose, onDone }: Props) {
  const [tab, setTab] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(item.content.slice(0, 200));
  const [category, setCategory] = useState('Task');
  const [owner, setOwner] = useState('');
  const [dueDate, setDueDate] = useState<dayjs.Dayjs | null>(null);

  const [priority, setPriority] = useState('MEDIUM');
  const [source, setSource] = useState('INTERNAL');
  const [notifiedDate, setNotifiedDate] = useState<dayjs.Dayjs | null>(null);

  const toActionItem = useConvertToActionItem();
  const toRisk = useConvertToRisk();
  const toCarried = useConvertCarriedPoint();
  const saving = toActionItem.isPending || toRisk.isPending || toCarried.isPending;

  const submit = async () => {
    setError(null);
    try {
      const actionItemData = {
        title: title.trim(), category, owner: owner.trim(), dueDate: dueDate || null,
      };
      const riskData = {
        title: title.trim(), description: item.content, priority, source, notifiedDate,
      };

      if (tab === 0 && !title.trim()) { setError('Title is required'); return; }
      if (tab === 0 && !owner.trim()) { setError('Owner is required'); return; }
      if (tab === 0 && !category.trim()) { setError('category is required'); return; }

      if (tab === 1 && !title.trim()) { setError('Title is required'); return; }
      if (tab === 1 && !notifiedDate) { setError('Notified date is required'); return; }

      if (carried) {
        // The carry-forward route replies with the refreshed panel rather than
        // the created record, so there is no id to quote back.
        await toCarried.mutateAsync({
          boardId: board.id, itemId: item.id,
          target: tab === 0 ? 'action-item' : 'risk',
          data: tab === 0 ? actionItemData : riskData,
        });
        onDone(tab === 0 ? 'Created action item' : 'Created risk');
      } else if (tab === 0) {
        const res = await toActionItem.mutateAsync({
          itemId: item.id, boardId: board.id, data: actionItemData,
        });
        onDone(`Created action item #${res.actionItem.id}`);
      } else {
        const res = await toRisk.mutateAsync({
          itemId: item.id, boardId: board.id, data: riskData,
        });
        onDone(`Created risk #${res.risk.id}`);
      }
      onClose();
    } catch (e: unknown) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Conversion failed');
    }
  };

  const DateHandler = (
    date: dayjs.Dayjs | null,
    type: "action" | "risk"
  ) => {
    const today = dayjs().subtract(1, "day");
    const threeMonthsFromNow = dayjs().add(3, "month");
    if (date?.isAfter(threeMonthsFromNow)) {
      setError("Due date should be within 3 months");
    } else if (date?.isBefore(today)) {
      setError("Due date cannot be past date");
    } else {
      setError("");
    }
    if (type === 'action') {
      setDueDate(date);
    } else {
      setNotifiedDate(date);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create follow-up work</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This copies the retro point into tracked work on <strong>{board.projectName ?? 'this project'}</strong>.
          The retro item itself stays exactly as agreed.
          {carried && ' It was agreed in an earlier retro, which stays frozen — only the link to this new work is recorded.'}
        </Typography>

        {item.isAnonymous && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This item was posted anonymously. The new record will be credited to you as facilitator —
            we have no record of who raised it.
          </Alert>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="Action Item" data-testid="tab-action-item" />
          <Tab label="Risk" data-testid="tab-risk" />
        </Tabs>

        <TextField
          fullWidth size="small" label="Title" sx={{ mb: 2 }}
          value={title} onChange={e => {setTitle(e.target.value); setError(null)} }
          inputProps={{ maxLength: 500, 'data-testid': 'convert-title' }}
        />

        {tab === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField select fullWidth size="small" label="Category"
              value={category} onChange={e => setCategory(e.target.value)}>
              {ACTION_ITEM_CATEGORIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
            <TextField fullWidth size="small" label="Owner"
              value={owner} onChange={e => {setOwner(e.target.value); setError(null);}}
              inputProps={{ 'data-testid': 'convert-owner' }} />
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DatePicker
                label="Due Date"
                value={dueDate ? dayjs(dueDate) : null}
                onChange={(date) => DateHandler(date, 'action')}
                minDate={dayjs()}
                maxDate={dayjs().add(3, "month")}
                views={["year", "month", "day"]}
                slotProps={{ textField: { size: 'small' } }}
              />
            </LocalizationProvider>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField select fullWidth size="small" label="Priority"
              value={priority} onChange={e => setPriority(e.target.value)}>
              {RISK_PRIORITIES.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </TextField>
            <TextField select fullWidth size="small" label="Source"
              value={source} onChange={e => setSource(e.target.value)}>
              <MenuItem value="INTERNAL">Internal</MenuItem>
              <MenuItem value="CLIENT">Client</MenuItem>
            </TextField>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DatePicker
                label="Notified date"
                value={notifiedDate ? dayjs(notifiedDate) : null}
                onChange={(date) => DateHandler(date, 'risk')}
                minDate={dayjs()}
                maxDate={dayjs().add(3, "month")}
                views={["year", "month", "day"]}
                slotProps={{ textField: { size: 'small' } }}
              />
            </LocalizationProvider>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving || Boolean(error)} onClick={submit} data-testid="convert-submit">
          {saving ? 'Creating…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
