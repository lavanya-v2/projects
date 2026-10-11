import {
  Dialog,
  DialogTitle,
  DialogContent,
  Typography,
  FormControl,
  Select,
  MenuItem,
  DialogActions,
  Button,
  CircularProgress,
  Grid,
  IconButton,
} from "@mui/material";
import type { Dispatch, SetStateAction } from "react";
import type { TeamPerformanceSprint } from "./types";
import CloseIcon from "@mui/icons-material/Close";

interface Props {
  title: string;
  message: string;
  closeButtonText: string;
  ActionButtonColor: "error" | "primary";
  jiraSprints: TeamPerformanceSprint[];
  syncSprintPickId: number | "";
  syncTriggerLoading: boolean;
  sprintsLoading: boolean;
  handleTriggerSprintSync: () => void;
  setSyncSprintPickId: (e: number | "") => void;
  setShowAlert: Dispatch<SetStateAction<boolean>>;
  onClose: () => void;
}

export function SprintSyncDialog({
  title,
  message,
  closeButtonText,
  ActionButtonColor,
  jiraSprints,
  syncSprintPickId,
  syncTriggerLoading,
  sprintsLoading,
  handleTriggerSprintSync,
  setSyncSprintPickId,
  setShowAlert,
  onClose,
}: Props) {
  return (
    <>
      <Dialog
        open
        aria-modal="true"
        role="dialog"
        onClose={() => setShowAlert(false)}
        maxWidth="xs"
        fullWidth
      >
        <Grid container justifyContent="space-between">
          <DialogTitle>{title}</DialogTitle>
          <IconButton onClick={() => onClose()} role="button">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Grid>

        <DialogContent>
          <Typography variant="body2">{message}</Typography>
          <FormControl size="small" fullWidth>
            <Select
              value={syncSprintPickId}
              onChange={(e) => setSyncSprintPickId(e.target.value as number)}
              displayEmpty
            >
              <MenuItem value="">
                <em>Select a sprint</em>
              </MenuItem>
              {jiraSprints
                .filter((s) => s.state !== "active")
                .map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
            </Select>
          </FormControl>
          {jiraSprints.filter((s) => s.state !== "active").length === 0 &&
            !sprintsLoading && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 1, display: "block" }}
              >
                No closed sprints found for this project.
              </Typography>
            )}
        </DialogContent>
        <DialogActions>
          <Button
            variant="text"
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            {closeButtonText}
          </Button>
          <Button
            variant="contained"
            disabled={!syncSprintPickId || syncTriggerLoading}
            color={ActionButtonColor}
            onClick={handleTriggerSprintSync}
            startIcon={
              syncTriggerLoading ? (
                <CircularProgress size={16} color="inherit" />
              ) : undefined
            }
          >
            {syncTriggerLoading ? 'Queuing…' : 'Sync'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
