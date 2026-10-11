import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Autocomplete, FormControl, InputLabel,
  Select, MenuItem, CircularProgress,
  Box,
} from '@mui/material';
import { useAdminAddProjectMember } from '../../../projects/hooks';
import { PROJECT_ROLES, DEFAULT_PROJECT_ROLE } from '../../constants';
import type { User } from '../../../users/types';
import { closeOnEscapeOnly, DialogCloseButton } from '../../../../../shared/components/dialogHelpers';

interface AddProjectMemberDialogProps {
  open: boolean;
  projectId: number | null;
  projectName: string;
  availableMembers: User[];
  estimationType?: 'story_points' | 'hours';
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

/** Add an existing team member to a specific project with a chosen role. */
export const AddProjectMemberDialog = ({
  open,
  projectId,
  projectName,
  availableMembers,
  estimationType,
  onClose,
  onSuccess,
  onError,
}: AddProjectMemberDialogProps) => {
  const addMember = useAdminAddProjectMember();
  const [selected, setSelected] = useState<User | null>(null);
  const [role, setRole] = useState(DEFAULT_PROJECT_ROLE);
  const [dailyCapacity, setDailyCapacity] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const isHours = estimationType === 'hours';

  useEffect(() => {
    if (open) {
      setSelected(null);
      setRole(DEFAULT_PROJECT_ROLE);
      setDailyCapacity('');
    }
  }, [open]);

  const handleSave = async () => {
    if (!selected || projectId == null) return;
    setSaving(true);
    try {
      await addMember.mutateAsync({
        projectId, teamMemberId: selected.id, role,
        dailyCapacityHours: isHours ? (dailyCapacity === '' ? null : Number(dailyCapacity)) : undefined,
      });
      onSuccess('Member added');
      onClose();
    } catch (err) {
      const errorWithResponse = err as { response?: { data?: { message?: string  } };};
      onError(errorWithResponse.response?.data?.message || 'Add failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={closeOnEscapeOnly(onClose)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Add Team Member{projectName ? ` to ${projectName}` : ''}
        <DialogCloseButton onClick={onClose} />
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{display:'grid', gap:2, pt:1}}>
          <Autocomplete
            options={availableMembers}
            getOptionLabel={(m: User) => `${m.firstName} ${m.lastName} (${m.email})`}
            value={selected}
            onChange={(_, v) => setSelected(v)}
            renderInput={(params) => <TextField {...params} label="Team Member" required />}
          />
          <FormControl fullWidth>
            <InputLabel>Role in Project</InputLabel>
            <Select value={role} label="Role in Project" onChange={e => setRole(e.target.value)}>
              {PROJECT_ROLES.map(r => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {isHours && (
            <TextField
              label="Daily Capacity (hours)"
              type="number"
              value={dailyCapacity}
              onChange={e => setDailyCapacity(e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value) || 0))}
              inputProps={{ step: 0.5, min: 0 }}
              helperText="Hours/day for this member on this project. Blank = project default (or 8)."
              fullWidth
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!selected || saving}>
          {saving ? <CircularProgress size={18} /> : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
