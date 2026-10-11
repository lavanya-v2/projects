/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Alert,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  MenuItem,
  IconButton,
  Chip,
  FormControlLabel,
  Checkbox,
  Select,
  OutlinedInput,
  InputLabel,
  FormControl,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  useProgramOwners,
  useAddProgramOwner,
  useRemoveProgramOwner,
  useSetPrimaryProgramOwner,
} from './hooks';
import type { Program, ProgramOwner } from './types';
import type { User, UsersApiResponse } from '../admin/users/types';
import ConfirmationDialog from '../../shared/components/ConfirmationDialog';
import { useUsers } from "../admin/users/hooks";

interface Props {
  open: boolean;
  onClose: () => void;
  program: Program;
}

export const ProgramOwnersDialog: React.FC<Props> = ({
  open,
  onClose,
  program,
}) => {
  const { data: users = [] } = useUsers();
  const usersData = (users as UsersApiResponse)?.data || [];
  const ownersQuery = useProgramOwners(open ? program.id : null);
  const owners = ownersQuery.data ?? [];

  const addOwner = useAddProgramOwner();
  const removeOwner = useRemoveProgramOwner();
  const setPrimary = useSetPrimaryProgramOwner();

  const [pickerUserId, setPickerUserId] = useState<number | "">("");
  const [makePrimary, setMakePrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [action, setAction] = useState('');
  const [updatedOwner, setUpdatedOwner] = useState<ProgramOwner | null>(null);
  const [primaryOwnerChangeConfirmation, setPrimaryOwnerChangeConfirmation] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState('');

  const ownerUserIds = useMemo(() => new Set(owners.map(o => o.userId)), [owners]);
  const selectableUsers = useMemo(
    () => usersData.filter((u) => u.isActive !== false && !ownerUserIds.has(u.id)),
    [users, ownerUserIds],
  );

  const handleAdd = async () => {
    setAction('Update');
    if (!pickerUserId) return;
    setError(null);
    try {
      await addOwner.mutateAsync({
        programId: program.id,
        userId: Number(pickerUserId),
        isPrimary: makePrimary,
      });
      setPickerUserId("");
      setMakePrimary(false);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to add owner'));
    } finally {
      setPrimaryOwnerChangeConfirmation(false);
    }
  };

  const handleRemove = async (userId: number) => {
    setError(null);
    try {
      await removeOwner.mutateAsync({ programId: program.id, userId });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to remove owner'));
    } finally {
      setPrimaryOwnerChangeConfirmation(false);
    }
  };

  const handleSetPrimary = async (userId: number) => {
    setError(null);
    try {
      await setPrimary.mutateAsync({ programId: program.id, userId });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to set primary owner'));
    } finally {
      setPrimaryOwnerChangeConfirmation(false);
    }
  };

  const handleConfirm = () => {
    setAction('Update');
    if (updatedOwner !== null) {
      return !updatedOwner.isPrimary && handleSetPrimary(updatedOwner.userId);
    }
  }

  const handlePrimaryOwner = (u: User) => {
    const user = { id: u.id, user: { ...u, email: u.userId }, userId: u.id, isPrimary: false };
    setUpdatedOwner(user);
    setAction("Update");
    setConfirmationMessage(`Are you sure you want to update primary owner as ${u?.firstName} ${u?.lastName} ?`);
  }

  const handleClose = () => {
    setPrimaryOwnerChangeConfirmation(false);
  }

  const getErrorMessage = (err: unknown, fallback: string) => {
    if (!err) return fallback;
    if (typeof err === 'string') return err;
    if (err instanceof Error && err.message) return err.message;
    const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
    return anyErr?.response?.data?.error ?? anyErr?.message ?? fallback;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Owners — {program.name}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Owners (managers) can view and generate program reports. Mark one as
          Primary; others act as backup.
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ display: "block" }}>
            <InputLabel id="owner-select-label">Add Owner</InputLabel>
            <Select
              sx={{ width: 320, marginRight: 2 }}
              size="small"
              labelId="owner-select-label"
              aria-describedby="owner-helper-text"
              id="owner-select"
              value={pickerUserId === "" ? "" : String(pickerUserId)}
              onChange={(e) =>
                setPickerUserId(
                  e.target.value === "" ? "" : Number(e.target.value),
                )
              }
              input={<OutlinedInput label="Add owner" />}
              MenuProps={{
                PaperProps: {
                  sx: {
                    maxWidth: 320,
                    maxHeight: 260,
                  },
                },
              }}
            >
              <MenuItem value="">
                <em>Select a user…</em>
              </MenuItem>
              {selectableUsers.map((u) => (
                <MenuItem key={u.id} value={String(u.id)} onClick={() => handlePrimaryOwner(u)}>
                  {u.firstName} {u.lastName} {u.email ? `(${u.email})` : ""}
                </MenuItem>
              ))}
            </Select>
            <FormControlLabel
              control={
                <Checkbox
                  checked={makePrimary}
                  onChange={e => {
                    setMakePrimary(e.target.checked);
                    setAction("Update");
                    setConfirmationMessage(`Are you sure you want to update primary owner as ${updatedOwner?.user?.firstName} ${updatedOwner?.user?.lastName} ?`);
                  }
                  }
                />
              }
              label="Primary"
            />
            <Button onClick={() => makePrimary ? setPrimaryOwnerChangeConfirmation(true) : handleAdd()} disabled={!pickerUserId || addOwner.isPending} variant="contained">
              {addOwner.isPending ? 'Adding…' : 'Add'}
            </Button>
          </FormControl>
        </Box>

        <Table size="small" sx={{ mb: 3 }}>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell align="center">Primary</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {owners.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography variant="body2" color="text.secondary">
                    No owners assigned.
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {owners.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  {o.user
                    ? `${o.user.firstName} ${o.user.lastName}`
                    : `User ${o.userId}`}
                  {o.isPrimary && (
                    <Chip
                      label="Primary"
                      color="primary"
                      size="small"
                      sx={{ ml: 1 }}
                    />
                  )}
                </TableCell>
                <TableCell>{o.user?.email ?? ""}</TableCell>
                <TableCell align="center">
                  <IconButton
                    size="small"
                    onClick={() => {
                      setAction('Update');
                      setPrimaryOwnerChangeConfirmation(true);
                      setUpdatedOwner(o);
                      setConfirmationMessage(`Are you sure you want to update primary owner as ${o?.user?.firstName} ${o?.user?.lastName} ?`);
                    }
                    }
                    disabled={o.isPrimary}
                    title={o.isPrimary ? "Already primary" : "Make primary"}
                  >
                    {o.isPrimary ? (
                      <StarIcon fontSize="small" color="primary" />
                    ) : (
                      <StarBorderIcon fontSize="small" />
                    )}
                  </IconButton>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" onClick={() => {
                    setUpdatedOwner(o);
                    setPrimaryOwnerChangeConfirmation(true);
                    setAction('Delete');
                    setConfirmationMessage(`Are you sure to delete ${(o.user?.firstName)} ${o.user?.lastName} from owners(managers) list`)
                  }}
                    disabled={o.isPrimary}
                    title="Remove owner">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {primaryOwnerChangeConfirmation && (
        <ConfirmationDialog
          title="Are you sure?"
          action={action}
          closeButtonText="Cancel"
          ActionButtonColor="error"
          message={confirmationMessage}
          confirm={() => {
            if (action === 'Update') {
              return makePrimary ? handleAdd() : handleConfirm();
            }
            // Delete action: use updatedOwner's userId if available
            if (updatedOwner) return handleRemove(updatedOwner.userId);
            return undefined;
          }}
          setShowAlert={setPrimaryOwnerChangeConfirmation}
          onClose={handleClose}
        />
      )}

    </Dialog >
  );
};
