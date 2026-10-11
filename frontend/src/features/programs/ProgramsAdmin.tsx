/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable-file */
import { useMemo, useState, useRef } from 'react';
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  IconButton,
  TextField,
  MenuItem,
  TablePagination,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import GroupIcon from '@mui/icons-material/Group';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import { useAdminAccounts } from '../admin/accounts/hooks';
import { useAdminProjects } from '../admin/projects/hooks';
import { useProgramsByAccount, useDeleteProgram } from './hooks';
import { ProgramFormDialog } from './ProgramFormDialog';
import { ProgramAssignProjectsDialog } from './ProgramAssignProjectsDialog';
import { ProgramOwnersDialog } from './ProgramOwnersDialog';
import type { Program } from './types';
import ConfirmationDialog from '../../shared/components/ConfirmationDialog';
import { useAuth } from '../auth/AuthContext';
import ReusableSnackbar from '../../shared/components/ReusableSnackbar';

type DialogState =
  | { kind: 'none' }
  | { kind: 'form'; editing: Program | null }
  | { kind: 'assignProjects'; program: Program }
  | { kind: 'owners'; program: Program }
  | { kind: 'confirmDelete'; program: Program };

const CLOSED: DialogState = { kind: 'none' };

interface ProgResponse {
  success: boolean;
  data: Program[];
  totalItems: number;
}

export function ProgramsAdmin() {
  const [page, setPage] = useState(1);
  const limit = 10;
  const { user } = useAuth();
  const isSuperuser = user?.role === 'SUPERUSER' || user?.roleName === 'superuser';
  const { data: accounts = [] } = useAdminAccounts();
  const { data: allProjects = [] } = useAdminProjects();

  const [selectedAccountId, setSelectedAccountId] = useState<number | ''>('');
  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Program | null>(null);
  const [showAlert, setShowAlert] = useState(false);

  const showError = (msg: string) => { setSnackbar({ msg, severity: 'error' }); };
  const showSuccess = (msg: string) => { setSnackbar({ msg, severity: 'success' }); };

  const { data: allProgItems = [], isLoading: loading } = useProgramsByAccount(selectedAccountId === '' ? null : selectedAccountId, page, limit);
  const progItems = allProgItems as ProgResponse;

  const programs = progItems?.data ?? [];
  const totalProgItems = progItems?.totalItems;
  
  const deleteMutation = useDeleteProgram();

  const projectsByProgram = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const p of allProjects as any[]) {
      if (p.programId) {
        if (!map.has(p.programId)) map.set(p.programId, []);
        map.get(p.programId)!.push(p);
      }
    }
    return map;
  }, [allProjects]);

  const persistentMsgRef = useRef<string>('');
  let projects ;
  let force: boolean ;

  if (deleteTarget) {
    projects = projectsByProgram.get(deleteTarget.id)?.length ?? 0;
    force = projects > 0;

    // eslint-disable-next-line 
    persistentMsgRef.current = force
      ? `Deleting ${deleteTarget.name} will permanently remove its ${projects} assigned project(s) and all associated program action items. Do you want to continue?`
      : `Delete Program ${deleteTarget.name}`;
  }

  // eslint-disable-next-line 
  const confirmMsg = persistentMsgRef.current;

  const handleDelete = async () => {
    showError('');
    showSuccess('');
    if(!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ programId: deleteTarget.id, force});
      showSuccess(`Program ${deleteTarget.name} deleted.`);
      setDeleteTarget(null);
      setShowAlert(false);
      if(programs.length === 1){
        setPage(page - 1);
      }
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to delete program');
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Account"
          value={selectedAccountId === '' ? '' : String(selectedAccountId)}
          onChange={(e) => { setSelectedAccountId(e.target.value === '' ? '' : Number(e.target.value)); setPage(1) }}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value=""><em>Select an account…</em></MenuItem>
          {accounts.map((a: any) => (
            <MenuItem key={a.id} value={String(a.id)}>{a.name}</MenuItem>
          ))}
        </TextField>

        <Box sx={{ flexGrow: 1 }} />

        <Button
          variant="contained"
          startIcon={<AddIcon />}
          disabled={!selectedAccountId}
          onClick={() => setDialog({ kind: 'form', editing: null })}
        >
          New Program
        </Button>
      </Box>

       <ReusableSnackbar 
        snackbar={snackbar} 
        setSnackbar={setSnackbar}>
      </ReusableSnackbar>

      {!selectedAccountId ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
          <Typography color="text.secondary">
            Select an account to view its programs.
          </Typography>
        </Paper>
      ) : loading ? (
        <Typography>Loading programs…</Typography>
      ) : (programs.length === 0 && !isSuperuser) ?
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            No program is assigned to you.
          </Typography>
        </Paper> : programs.length === 0 ? (
          <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              No programs configured for this account yet.
            </Typography>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setDialog({ kind: 'form', editing: null })}
            >
              Create the first program
            </Button>
          </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell><strong>Name</strong></TableCell>
                <TableCell><strong>Description</strong></TableCell>
                <TableCell align="center"><strong>Red Threshold</strong></TableCell>
                <TableCell><strong>Projects</strong></TableCell>
                <TableCell align="right"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {programs.map(prog => {
                const assigned = projectsByProgram.get(prog.id) ?? [];
                return (
                  <TableRow key={prog.id} hover>
                    <TableCell>
                      <Typography fontWeight={600}>{prog.name}</Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Typography variant="body2" color="text.secondary" noWrap title={prog.description ?? ''}>
                        {prog.description || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      {prog.redThresholdPercentage != null
                        ? `${prog.redThresholdPercentage}%`
                        : <Typography variant="caption" color="text.secondary">(account default)</Typography>}
                    </TableCell>
                    <TableCell>
                      {assigned.length === 0 ? (
                        <Chip size="small" label="0 projects" />
                      ) : (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {assigned.slice(0, 3).map((p: any) => (
                            <Chip key={p.id} size="small" label={p.name} />
                          ))}
                          {assigned.length > 3 && (
                            <Chip size="small" label={`+${assigned.length - 3} more`} variant="outlined" />
                          )}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        title="Manage projects"
                        onClick={() => setDialog({ kind: 'assignProjects', program: prog })}
                      >
                        <FolderSpecialIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        title="Manage owners"
                        onClick={() => setDialog({ kind: 'owners', program: prog })}
                      >
                        <GroupIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        title="Edit program"
                        onClick={() => setDialog({ kind: 'form', editing: prog })}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        title="Delete program"
                        onClick={() => { setDeleteTarget(prog); setShowAlert(true); }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={totalProgItems}
            page={totalProgItems > 0 ? page - 1 : 0}
            onPageChange={(_, p) => setPage(p+1)}
            rowsPerPage={limit}
            rowsPerPageOptions={[limit]}
          />
        </TableContainer>
      )}
      {showAlert && (
        <ConfirmationDialog
          title="Confirm to Delete Program"
          message={confirmMsg}
          action="Delete"
          closeButtonText="Cancel"
          ActionButtonColor="error"
          confirm={handleDelete}
          setShowAlert={setShowAlert}
          onClose={() => {
            setShowAlert(false);
          }}
        />
      )}

      {dialog.kind === 'form' && (
        <ProgramFormDialog
          open
          editing={dialog.editing}
          accounts={accounts}
          defaultAccountId={selectedAccountId === '' ? undefined : selectedAccountId}
          onClose={() => setDialog(CLOSED)}
          onSuccess={() => {
            showSuccess(dialog.editing ? 'Program updated.' : 'Program created.');
            setDialog(CLOSED);
          }}
        />
      )}

      {dialog.kind === 'assignProjects' && (
        <ProgramAssignProjectsDialog
          open
          program={dialog.program}
          allProjects={allProjects as any[]}
          onClose={() => setDialog(CLOSED)}
          onSuccess={() => {
            showSuccess('Project assignments updated.');
            setDialog(CLOSED);
          }}
        />
      )}

      {dialog.kind === 'owners' && (
        <ProgramOwnersDialog
          open
          program={dialog.program}
          onClose={() => setDialog(CLOSED)}
        />
      )}
    </Box>
  );
}