import { IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

/**
 * Shared dialog behaviour for forms and other dialogs holding unsaved work.
 *
 * MUI closes a Dialog on a backdrop click by default, so a stray click beside the modal discards
 * whatever the user was part-way through entering. These helpers make dismissal deliberate: only
 * Escape or an explicit close control, never an accidental click outside.
 */

/**
 * Wraps an `onClose` handler so backdrop clicks are ignored while Escape still closes.
 *
 * Pass to `Dialog.onClose`; MUI supplies the reason as the second argument.
 */
export const closeOnEscapeOnly =
  (onClose: () => void) =>
  (_event: unknown, reason?: string): void => {
    if (reason !== 'backdropClick') {
      onClose();
    }
  };

interface DialogCloseButtonProps {
  onClick: () => void;
  /** Disable while an operation is in flight so the dialog cannot be closed mid-save. */
  disabled?: boolean;
}

/**
 * Close control for the top-right corner of a dialog. Render inside `<DialogTitle>`; it positions
 * against the dialog paper, so it does not disturb the title's own layout.
 */
export const DialogCloseButton = ({ onClick, disabled }: DialogCloseButtonProps) => (
  <IconButton
    aria-label="Close"
    onClick={onClick}
    disabled={disabled}
    size="small"
    sx={{ position: 'absolute', right: 8, top: 8, color: 'text.secondary' }}
  >
    <CloseIcon fontSize="small" />
  </IconButton>
);
