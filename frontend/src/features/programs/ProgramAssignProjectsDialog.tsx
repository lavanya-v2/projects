import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAssignProjectsToProgram } from './hooks';
import type { Program } from './types';
import { Dialog, DialogTitle, DialogContent, Alert, Typography, Box, FormControlLabel, Checkbox, Chip, DialogActions, Button } from '@mui/material';
import ConfirmationDialog from '../../shared/components/ConfirmationDialog';

interface ProjectLite {
  id: number;
  name: string;
  code: string;
  accountId?: number;
  programId?: number | null;
  account?: { id: number };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  program: Program;
  /** All projects (admin list). Filter happens inside. */
  allProjects: ProjectLite[];
}

export const ProgramAssignProjectsDialog: React.FC<Props> = ({
  open,
  onClose,
  onSuccess,
  program,
  allProjects,
}) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [initialSelected, setInitialSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const assignMutation = useAssignProjectsToProgram();
  const [showAlert, setShowAlert] = useState(false);

  const hasInitialized = useRef(false);

  // Projects available for this account: those in same account, either unassigned
  // or already in this program.
  const candidates = useMemo(() => {
    return allProjects.filter(p => {
      const acctId = p.accountId ?? p.account?.id;
      if (acctId !== program.accountId) return false;
      if (p.programId == null) return true;
      if (p.programId === program.id) return true;
      return false;
    });
  }, [allProjects, program]);

  // Create a callback that only depends on what it truly needs
  const initializeSelection = useCallback(() => {
    // Pre-select projects already in this program
    const initial = new Set<number>();
    candidates.forEach(p => {
      if (p.programId === program.id) initial.add(p.id);
    });
    setSelected(initial);
    setInitialSelected(initial);
    setError(null);
  }, [candidates, program.id]);

  useEffect(() => {
    if (open && !hasInitialized.current) {
      initializeSelection();
      hasInitialized.current = true;
    }
  }, [open, initializeSelection]);

  // Reset the flag when dialog closes
  useEffect(() => {
    if (!open) {
      hasInitialized.current = false;
    }
  }, [open]);

  const toggle = (projectId: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleSave = () => {
    setShowAlert(true);
  };

  const handleConfirm = async () => {
    setError(null);
    try {
      const currentlyInProgram = candidates.filter(p => p.programId === program.id).map(p => p.id);
      const desired = Array.from(selected);

      const toAssign = desired.filter(id => !currentlyInProgram.includes(id));
      const toUnassign = currentlyInProgram.filter(id => !desired.includes(id));

      if (toAssign.length > 0) {
        await assignMutation.mutateAsync({
          programId: program.id,
          projectIds: toAssign,
          action: 'assign',
        });
      }
      if (toUnassign.length > 0) {
        await assignMutation.mutateAsync({
          programId: program.id,
          projectIds: toUnassign,
          action: 'unassign',
        });
      }
      onSuccess();
    } catch (err: unknown) {
      let message = 'Failed to update project assignments';
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const response = (err as { response?: { data?: { error?: string } } }).response;
        message = response?.data?.error || message;
      }
      setError(message);
    }
    finally {
      setShowAlert(false);
    }
  };

  const saving = assignMutation.isPending;
  const otherProgramProjects = allProjects.filter(p => {
    const acctId = p.accountId ?? p.account?.id;
    return acctId === program.accountId && p.programId != null && p.programId !== program.id;
  });

  const message = selected.size === 0 ? ' This will also delete the associated program action items.' : '';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Assign Projects — {program.name}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Select the projects in this program. Each project can only belong to one program at a time.
        </Typography>

        {candidates.length === 0 ? (
          <Alert severity="info">No projects in this account are available to assign.</Alert>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {candidates.map(p => (
              <FormControlLabel
                key={p.id}
                control={
                  <Checkbox
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                }
                label={`${p.name} (${p.code})`}
              />
            ))}
          </Box>
        )}

        {otherProgramProjects.length > 0 && (
          <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid #e0e0e0' }}>
            <Typography variant="caption" color="text.secondary">
              Already assigned to another program (not selectable here):
            </Typography>
            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {otherProgramProjects.map(p => (
                <Chip key={p.id} label={`${p.name} (${p.code})`} size="small" variant="outlined" />
              ))}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={selected.size < initialSelected.size ? handleSave : handleConfirm} variant="contained" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>

      {showAlert && selected.size < initialSelected.size && (
        <ConfirmationDialog
          title="Confirm Delete?"
          message={`Are you sure you want to delete ${initialSelected.size - selected.size} project(s)? ${message}`}
          action="Delete"
          closeButtonText="Cancel"
          ActionButtonColor="error"
          confirm={handleConfirm}
          setShowAlert={setShowAlert}
          onClose={() => {
            setShowAlert(false);
            onClose();
          }}
        />
      )}
    </Dialog>
  );
};
