import type { ReactNode } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, CircularProgress } from '@mui/material';
import { closeOnEscapeOnly, DialogCloseButton } from '../../../../../shared/components/dialogHelpers';

interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Generic delete-confirmation dialog. One place for all four delete flows. */
export const ConfirmDeleteDialog = ({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDeleteDialogProps) => (
  <Dialog open={open} onClose={closeOnEscapeOnly(onClose)} maxWidth="xs" fullWidth>
    <DialogTitle sx={{ pr: 6 }}>
      {title}
      <DialogCloseButton onClick={onClose} />
    </DialogTitle>
    <DialogContent>
      {typeof message === 'string' ? <Typography>{message}</Typography> : message}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="contained" color="error" onClick={onConfirm} disabled={loading}>
        {loading ? <CircularProgress size={18} /> : confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);
