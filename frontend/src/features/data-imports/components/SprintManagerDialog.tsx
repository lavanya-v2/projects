/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Alert,
  Table, TableHead, TableBody, TableRow, TableCell, Checkbox, TextField, LinearProgress, Autocomplete,
} from '@mui/material';
import { client } from '../../../api/client';
import { closeOnEscapeOnly, DialogCloseButton } from '../../../shared/components/dialogHelpers';

interface Props {
  open: boolean;
  projectId: number;
  onClose: () => void;
  onDone: (msg: string) => void;
}

interface Sprint {
  id: number;
  name: string;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Rename a sprint, or fold several into one.
 *
 * Uploads used to synthesise a sprint name containing the upload time when a file had no Sprint
 * column, so projects accumulated a "Custom Sprint - <timestamp>" per upload. This is how those get
 * consolidated into real sprint names without hand-written SQL.
 */
export const SprintManagerDialog = ({ open, projectId, onClose, onDone }: Props) => {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await client.get<Sprint[]>(`/datasource/projects/${projectId}/sprints`);
      setSprints(res.data ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load sprints');
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) { load(); setSelected([]); setTarget(''); setError(null); }
  }, [open, load]);

  const toggle = (name: string) =>
    setSelected(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));

  const apply = async () => {
    if (selected.length === 0 || !target.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await client.post(`/datasource/projects/${projectId}/sprints/rename`, {
        from: selected,
        to: target.trim(),
      });
      onDone(
        `${res.data.rowsRelabelled} row(s) moved to "${res.data.targetSprint}". Sprint data was recalculated.`,
      );
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Rename failed');
    } finally {
      setBusy(false);
    }
  };

  const autoNamed = sprints.filter(s => /^custom sprint/i.test(s.name));

  return (
    <Dialog open={open} onClose={closeOnEscapeOnly(onClose)} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Rename or merge sprints
        <DialogCloseButton onClick={onClose} disabled={busy} />
      </DialogTitle>
      <DialogContent dividers>
        {busy && <LinearProgress sx={{ mb: 1 }} />}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {autoNamed.length > 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {autoNamed.length} sprint{autoNamed.length === 1 ? '' : 's'} here {autoNamed.length === 1 ? 'was' : 'were'}{' '}
            named automatically from the upload time because the file had no Sprint column. Select them and give
            them their real sprint name.
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Select the sprints to move, then choose the sprint they should become. Tickets keep their data —
          only the sprint they belong to changes.
        </Typography>

        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>Sprint</TableCell>
              <TableCell>Start</TableCell>
              <TableCell>End</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sprints.map(s => (
              <TableRow key={s.id} hover onClick={() => toggle(s.name)} sx={{ cursor: 'pointer' }}>
                <TableCell padding="checkbox">
                  <Checkbox size="small" checked={selected.includes(s.name)} />
                </TableCell>
                <TableCell>{s.name}</TableCell>
                <TableCell>{s.startDate ?? '—'}</TableCell>
                <TableCell>{s.endDate ?? '—'}</TableCell>
              </TableRow>
            ))}
            {sprints.length === 0 && !busy && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Typography variant="body2" color="text.secondary">No sprints recorded for this project yet.</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <Box sx={{ mt: 2 }}>
          <Autocomplete
            freeSolo
            options={sprints.map(s => s.name)}
            value={target}
            onInputChange={(_, v) => setTarget(v)}
            renderInput={params => (
              <TextField
                {...params}
                size="small"
                label="Rename to"
                placeholder="Existing sprint name, or a new one"
                helperText="Selecting several sprints and one target merges them together."
              />
            )}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={apply} disabled={busy || selected.length === 0 || !target.trim()}>
          {selected.length > 1 ? `Merge ${selected.length} sprints` : 'Rename sprint'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
