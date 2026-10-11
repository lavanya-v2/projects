import type { Dispatch, SetStateAction } from "react";
import { Dialog, IconButton, Button, Grid, DialogTitle, Typography, DialogContent, DialogActions } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

interface Props {
  title: string;
  message: string;
  action: string;
  closeButtonText: string;
  ActionButtonColor: "error" | "primary"
  confirm: () => void;
  setShowAlert: Dispatch<SetStateAction<boolean>>;
  onClose: () => void;
}

const ConfirmationDialog: React.FC<Props> = ({ title, message, action, closeButtonText, ActionButtonColor, confirm, setShowAlert, onClose }) => {
  return (
    <Dialog
      open
      aria-modal="true"
      role="dialog"
      onClose={() => setShowAlert(false)}
      maxWidth="xs" fullWidth
    >
      <Grid container justifyContent="space-between">
        <DialogTitle>{title}</DialogTitle>
        <IconButton onClick={() => onClose()} role="button">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Grid>

      <DialogContent dividers>
        <Typography variant="body2">
          {message}
        </Typography>
      </DialogContent>

      <DialogActions>
        <Button variant="text" type="button" aria-label="Close dialog" onClick={onClose}>
          {closeButtonText}
        </Button>
        <Button
          variant="contained"
          color={ActionButtonColor}
          onClick={confirm}
          style={{ width: 'auto', textTransform: 'none' }}
        >
          {action}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmationDialog;