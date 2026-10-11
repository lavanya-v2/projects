import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, FormControl, InputLabel, Select, MenuItem, CircularProgress, TextField,
  Box,
} from '@mui/material';
import { useAdminUpdateProjectMemberRole } from '../../../projects/hooks';
import { PROJECT_ROLES, DEFAULT_PROJECT_ROLE } from '../../constants';
import { closeOnEscapeOnly, DialogCloseButton } from '../../../../../shared/components/dialogHelpers';

interface EditProjectRoleDialogProps {
  open: boolean;
  projectId: number | null;
  memberId: number | null;
  currentRole: string;
  currentDailyCapacity?: number | null;
  estimationType?: 'story_points' | 'hours';
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

/** Edit a team member's role within a specific project. */
export const EditProjectRoleDialog = ({
  open,
  projectId,
  memberId,
  currentRole,
  currentDailyCapacity,
  estimationType,
  onClose,
  onSuccess,
  onError,
}: EditProjectRoleDialogProps) => {
  const updateRole = useAdminUpdateProjectMemberRole();
  const [role, setRole] = useState(DEFAULT_PROJECT_ROLE);
  const [dailyCapacity, setDailyCapacity] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const isHours = estimationType === 'hours';

  useEffect(() => {
    if (open) {
      setRole(currentRole || DEFAULT_PROJECT_ROLE);
      setDailyCapacity(currentDailyCapacity != null ? Number(currentDailyCapacity) : '');
    }
  }, [open, currentRole, currentDailyCapacity]);

  const handleSave = async () => {
    if (projectId == null || memberId == null) return;
    setSaving(true);
    try {
      await updateRole.mutateAsync({
        projectId, teamMemberId: memberId, role,
        dailyCapacityHours: isHours ? (dailyCapacity === '' ? null : Number(dailyCapacity)) : undefined,
      });
      onSuccess('Role updated');
      onClose();
    } catch (err) {
      const errorWithResponse = err as { response?: { data?: { message?: string  } };};
      onError(errorWithResponse.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={closeOnEscapeOnly(onClose)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        Edit Project Role
        <DialogCloseButton onClick={onClose} />
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{display:'grid', gap:2, pt:1 }}>
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
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={18} /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
