import { useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Table, TableHead, TableBody, TableRow, TableCell,
  IconButton, Tooltip, Box, Typography, CircularProgress,
  Alert,
} from '@mui/material';
import {
  DeleteOutline as DeleteOutlineIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { usePerfSyncHistory, useDeletePerfSync } from '../../team-performance/hooks';
import { useRefreshPortfolioPresentation } from './hooks';
import { preventAccidentalDialogClose, VISIBLE_SCROLLBAR_SX } from '../../../shared/components/dialogProps';
import { useFullscreenContainer } from './presentation/FullscreenContainerContext';

interface TrendSprint {
  name: string;
  startDate?: string;
  endDate?: string;
}
interface TrendDataEntry {
  projectName: string;
  sprints: TrendSprint[];
}

interface VisibleProject {
  projectId: number;
  projectName: string;
}

interface Props {
  open: boolean;
  presentationId: number;
  visibleProjects: VisibleProject[];
  trendData: Record<string, TrendDataEntry>;
  onClose: () => void;
  onRefreshed: (refreshed: any) => void;
}

interface ResolvedRow {
  trend: TrendSprint;
  liveSyncId: number | null;
}

// Renders one project's slice of the trend (the same 5 sprints the chart uses).
// Each trend row is matched to a live PerfSprintSync so we can offer delete;
// rows whose underlying sync was already purged show a "Refresh to clear" hint.
function ProjectSection({
  project,
  trendSprints,
  removingSyncId,
  onDelete,
}: {
  project: VisibleProject;
  trendSprints: TrendSprint[];
  removingSyncId: number | null;
  onDelete: (projectId: number, syncId: number, sprintName: string, projectName: string) => void;
}) {
  const { data, isLoading, error } = usePerfSyncHistory(project.projectId);

  const rows: ResolvedRow[] = useMemo(() => {
    if (!Array.isArray(trendSprints) || trendSprints.length === 0) return [];
    const live = Array.isArray(data) ? data : [];
    return trendSprints.map(t => {
      const match = live.find((s: any) =>
        s.sprintName === t.name && (!t.startDate || s.startDate === t.startDate)
      );
      return { trend: t, liveSyncId: match?.id ?? null };
    });
  }, [trendSprints, data]);

  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        {project.projectName}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ my: 1 }}>Failed to load sprint data.</Alert>
      )}

      {trendSprints.length === 0 && !isLoading && !error && (
        <Typography variant="caption" color="text.secondary">
          This project's trend is sourced from weekly reports, not perf syncs. Sprint-level cleanup isn't applicable — use Refresh to recompute.
        </Typography>
      )}

      {trendSprints.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: '#f7f9fc' }}>
              <TableCell sx={{ width: '38%' }}><strong>Sprint</strong></TableCell>
              <TableCell><strong>Period</strong></TableCell>
              <TableCell align="right" sx={{ width: 80 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${project.projectId}-${r.trend.name}-${i}`}>
                <TableCell>{r.trend.name}</TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {r.trend.startDate ?? '?'} → {r.trend.endDate ?? '?'}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  {isLoading ? (
                    <CircularProgress size={14} />
                  ) : r.liveSyncId != null ? (
                    <Tooltip title="Delete this sprint sync">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={removingSyncId === r.liveSyncId}
                          onClick={() =>
                            onDelete(
                              project.projectId,
                              r.liveSyncId as number,
                              r.trend.name,
                              project.projectName,
                            )
                          }
                        >
                          {removingSyncId === r.liveSyncId
                            ? <CircularProgress size={14} color="error" />
                            : <DeleteOutlineIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  ) : (
                    <Tooltip title="Underlying sync was already removed; click Refresh to clear from the chart">
                      <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                        already removed
                      </Typography>
                    </Tooltip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}

export function ManageTrendSprintsDialog({
  open, presentationId, visibleProjects, trendData, onClose, onRefreshed,
}: Props) {
  const container = useFullscreenContainer();
  const deleteSyncMutation = useDeletePerfSync();
  const refreshMutation = useRefreshPortfolioPresentation();

  const [removingSyncId, setRemovingSyncId] = useState<number | null>(null);
  const [pending, setPending] = useState<{
    projectId: number; syncId: number; sprintName: string; projectName: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<{ severity: 'success' | 'error'; message: string } | null>(null);

  const onDelete = (projectId: number, syncId: number, sprintName: string, projectName: string) => {
    setPending({ projectId, syncId, sprintName, projectName });
  };

  const confirm = async () => {
    if (!pending) return;
    setRemovingSyncId(pending.syncId);
    try {
      await deleteSyncMutation.mutateAsync({ projectId: pending.projectId, syncId: pending.syncId });
      const refreshed = await refreshMutation.mutateAsync(presentationId);
      onRefreshed(refreshed);
      setFeedback({ severity: 'success', message: `Removed "${pending.sprintName}" from ${pending.projectName}.` });
    } catch (e: any) {
      setFeedback({ severity: 'error', message: e?.response?.data?.error ?? e?.message ?? 'Failed to remove sprint' });
    } finally {
      setRemovingSyncId(null);
      setPending(null);
    }
  };

  const refreshOnly = async () => {
    try {
      const refreshed = await refreshMutation.mutateAsync(presentationId);
      onRefreshed(refreshed);
      setFeedback({ severity: 'success', message: 'Trend data refreshed from live system data.' });
    } catch (e: any) {
      setFeedback({ severity: 'error', message: e?.response?.data?.error ?? e?.message ?? 'Failed to refresh' });
    }
  };

  return (
    <>
      <Dialog open={open} onClose={preventAccidentalDialogClose(onClose)} maxWidth="md" fullWidth container={container} sx={{ zIndex: 1500 }}>
        <DialogTitle>Manage trend sprints</DialogTitle>
        <DialogContent dividers sx={VISIBLE_SCROLLBAR_SX}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
              The last 5 completed sprints driving each project's trend chart. Remove a foreign sprint, or refresh from live data if you've already cleaned it up.
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={refreshMutation.isPending ? <CircularProgress size={14} /> : <RefreshIcon />}
              disabled={refreshMutation.isPending}
              onClick={refreshOnly}
              sx={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
            >
              {refreshMutation.isPending ? 'Refreshing…' : 'Refresh from system'}
            </Button>
          </Box>

          {feedback && (
            <Alert severity={feedback.severity} onClose={() => setFeedback(null)} sx={{ mb: 2 }}>
              {feedback.message}
            </Alert>
          )}

          {visibleProjects.length === 0 && (
            <Typography color="text.secondary">No projects in scope.</Typography>
          )}

          {visibleProjects.map(p => (
            <ProjectSection
              key={p.projectId}
              project={p}
              trendSprints={trendData[String(p.projectId)]?.sprints ?? []}
              removingSyncId={removingSyncId}
              onDelete={onDelete}
            />
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={pending !== null}
        onClose={() => removingSyncId === null && setPending(null)}
        maxWidth="xs"
        fullWidth
        container={container}
        sx={{ zIndex: 1600 }}
      >
        <DialogTitle>Remove sprint?</DialogTitle>
        <DialogContent>
          <Typography>
            Permanently delete <strong>{pending?.sprintName}</strong> ({pending?.projectName})?
            All member scores and ticket facts for this sync will be removed.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={removingSyncId !== null}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={confirm}
            disabled={removingSyncId !== null}
            startIcon={removingSyncId !== null ? <CircularProgress size={14} color="inherit" /> : undefined}
          >
            {removingSyncId !== null ? 'Removing…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
