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
  Box,
  InputLabel,
  TextField,
} from "@mui/material";
import type { Dispatch, SetStateAction } from "react";
import CloseIcon from "@mui/icons-material/Close";
import type { KanbanCycle } from "./types";
import type { UseQueryResult } from "@tanstack/react-query";

interface Props {
  closeButtonText: string;
  ActionButtonColor: "error" | "primary";
  syncTriggerLoading: boolean;
  cycleSyncEnabled: boolean;
  kanbanUseCustomRange: boolean;
  kanbanSyncFrom: string;
  kanbanSyncTo: string;
  kanbanSyncLabel: string;
  setKanbanSyncFrom: (e: string | "") => void;
  setKanbanSyncTo: (e: string | "") => void;
  setKanbanSyncLabel: (e: string | "") => void;
  handleTriggerKanbanSync: () => void;
  handleTriggerKanbanCycleSync: () => void;
  setKanbanUseCustomRange: (e: boolean) => void;
  kanbanCycles: KanbanCycle[];
  kanbanCyclesQuery: UseQueryResult<KanbanCycle[], Error>;
  selectedCycleIndex: number | "";
  setSelectedCycleIndex: (e: number | "") => void;
  setShowAlert: Dispatch<SetStateAction<boolean>>;
  onClose: () => void;
}

export function KanbanSyncDialog({
  closeButtonText,
  ActionButtonColor,
  syncTriggerLoading,
  cycleSyncEnabled,
  kanbanUseCustomRange,
  kanbanSyncFrom,
  kanbanSyncTo,
  kanbanSyncLabel,
  setKanbanSyncFrom,
  setKanbanSyncTo,
  setKanbanSyncLabel,
  handleTriggerKanbanSync,
  handleTriggerKanbanCycleSync,
  setKanbanUseCustomRange,
  kanbanCycles,
  kanbanCyclesQuery,
  selectedCycleIndex,
  setSelectedCycleIndex,
  setShowAlert,
  onClose,
}: Props) {
  const isCycleSync = cycleSyncEnabled && !kanbanUseCustomRange;
  const title = isCycleSync ? 'Sync Work Cycle' : 'Sync Kanban Period';
  const action = syncTriggerLoading ?  'Queuing…' : 'Sync';


  const isSyncDisabled =
    syncTriggerLoading ||
    (isCycleSync
      ? selectedCycleIndex === ""
      : !kanbanSyncFrom || !kanbanSyncTo);

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
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
            {cycleSyncEnabled && !kanbanUseCustomRange ? (
              <>
                <FormControl size="small" fullWidth>
                  <InputLabel id="kanban-cycle-select-label">Cycle</InputLabel>
                  <Select
                    labelId="kanban-cycle-select-label"
                    label="Cycle"
                    value={selectedCycleIndex}
                    onChange={(e) =>
                      setSelectedCycleIndex(e.target.value as number)
                    }
                  >
                    {kanbanCycles.map((c) => {
                      const synced = c.syncStatus === "done";
                      const inFlight =
                        c.syncStatus === "pending" ||
                        c.syncStatus === "running";
                      const suffix = synced
                        ? " ✓ synced"
                        : inFlight
                          ? " (syncing…)"
                          : c.isComplete
                            ? ""
                            : " (in progress)";
                      return (
                        <MenuItem
                          key={c.index}
                          value={c.index}
                          disabled={synced || inFlight}
                        >
                          {c.label}
                          {suffix}
                        </MenuItem>
                      );
                    })}
                  </Select>
                </FormControl>
                {kanbanCyclesQuery.isLoading && (
                  <Typography variant="caption" color="text.secondary">
                    Loading cycles…
                  </Typography>
                )}
                {!kanbanCyclesQuery.isLoading && kanbanCycles.length === 0 && (
                  <Typography variant="caption" color="text.secondary">
                    No cycles yet — check the cadence start date on the project.
                  </Typography>
                )}
                <Button
                  size="small"
                  sx={{ alignSelf: "flex-start" }}
                  onClick={() => setKanbanUseCustomRange(true)}
                >
                  Use custom date range instead
                </Button>
              </>
            ) : (
              <>
                <TextField
                  type="date"
                  size="small"
                  label="From Date"
                  value={kanbanSyncFrom}
                  onChange={(e) => setKanbanSyncFrom(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
                <TextField
                  type="date"
                  size="small"
                  label="To Date"
                  value={kanbanSyncTo}
                  onChange={(e) => setKanbanSyncTo(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
                <TextField
                  size="small"
                  label="Label (optional)"
                  value={kanbanSyncLabel}
                  onChange={(e) => setKanbanSyncLabel(e.target.value)}
                  placeholder="e.g. Fortnight 1 - Jan 2026"
                  fullWidth
                />
                {cycleSyncEnabled && (
                  <Button
                    size="small"
                    sx={{ alignSelf: "flex-start" }}
                    onClick={() => setKanbanUseCustomRange(false)}
                  >
                    Use configured cycles instead
                  </Button>
                )}
              </>
            )}
          </Box>
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
            disabled={isSyncDisabled}
            color={ActionButtonColor}
            onClick={
              isCycleSync
                ? handleTriggerKanbanCycleSync
                : handleTriggerKanbanSync
            }
            startIcon={
              syncTriggerLoading ? (
                <CircularProgress size={16} color="inherit" />
              ) : undefined
            }
          >
            {action}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
