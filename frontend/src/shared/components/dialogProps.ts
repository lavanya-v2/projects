type DialogCloseReason = 'backdropClick' | 'escapeKeyDown';

/**
 * Returns an MUI Dialog onClose handler that ignores backdrop clicks and ESC
 * key presses, so users don't lose in-progress edits to accidental misclicks.
 * Explicit closes (e.g. a Cancel button calling onClose() directly, or any
 * other reason value) still close the dialog.
 */
export function preventAccidentalDialogClose(onClose: () => void) {
  return (_event: object, reason: DialogCloseReason) => {
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
    onClose();
  };
}

/**
 * sx snippet that gives a scrollable element a thicker, grey, easy-to-grab
 * scrollbar. Applied to DialogContent so users don't have to aim at the
 * default thin native scrollbar — reduces accidental clicks onto the backdrop.
 */
export const VISIBLE_SCROLLBAR_SX = {
  '&::-webkit-scrollbar': { width: 10, height: 10 },
  '&::-webkit-scrollbar-track': { background: '#f5f5f5' },
  '&::-webkit-scrollbar-thumb': { background: '#bdbdbd', borderRadius: 5 },
  '&::-webkit-scrollbar-thumb:hover': { background: '#9e9e9e' },
  scrollbarWidth: 'thin' as const,
  scrollbarColor: '#bdbdbd #f5f5f5',
};
