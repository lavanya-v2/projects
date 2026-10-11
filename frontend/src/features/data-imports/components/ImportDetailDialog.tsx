/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, Typography, Alert,
  Table, TableHead, TableBody, TableRow, TableCell, Chip, LinearProgress, TablePagination, Tooltip,
} from '@mui/material';
import { Download } from '@mui/icons-material';
import { client } from '../../../api/client';
import { closeOnEscapeOnly, DialogCloseButton } from '../../../shared/components/dialogHelpers';

interface Props {
  open: boolean;
  projectId: number;
  importId: number | null;
  onClose: () => void;
  onError: (msg: string) => void;
}

interface WorkItemRow {
  id: number;
  extId: string;
  title: string;
  type: string;
  status: string;
  priority?: string;
  assigneeEmail: string;
  storyPoints?: number | null;
  sprintName?: string | null;
  sprintStart?: string | null;
  sprintEnd?: string | null;
  createdAtSource: string;
  updatedAtSource: string;
  /** Epic/Feature holding other rows in this file — listed here, but left out of the metrics. */
  isContainer?: boolean;
}

interface RowsResponse {
  import: {
    id: number;
    originalFilename?: string;
    createdAt: string;
    mode: string;
    status: string;
    conflictStrategy?: string;
    rowCount: number;
    errorMessage?: string;
    storagePath?: string;
    fileSize?: number;
  };
  page: number;
  pageSize: number;
  total: number;
  rows: WorkItemRow[];
  validationReport?: { errors?: any[]; coercions?: any[] } | null;
}

const fmtBytes = (bytes?: number) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Shows exactly what a given upload contained. Works for every past upload, not just the latest --
 * previously the row-level data was not visible anywhere in the app.
 */
export const ImportDetailDialog = ({ open, projectId, importId, onClose, onError }: Props) => {
  const [data, setData] = useState<RowsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const load = useCallback(async () => {
    if (!importId) return;
    setBusy(true);
    try {
      const res = await client.get<RowsResponse>(
        `/datasource/projects/${projectId}/imports/${importId}/rows`,
        { params: { page: page + 1, pageSize } },
      );
      setData(res.data);
    } catch (e: any) {
      onError(e?.response?.data?.error || e?.message || 'Failed to load import rows');
    } finally {
      setBusy(false);
    }
  }, [projectId, importId, page, pageSize, onError]);

  useEffect(() => {
    if (open && importId) load();
  }, [open, importId, load]);

  useEffect(() => {
    if (!open) { setData(null); setPage(0); }
  }, [open]);

  const download = async () => {
    if (!importId) return;
    try {
      const res = await client.get(`/datasource/projects/${projectId}/imports/${importId}/file`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data?.import.originalFilename || `import-${importId}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      onError(
        e?.response?.status === 410
          ? 'The original file for this import was not retained. Files are kept for uploads made from now on.'
          : e?.response?.data?.error || e?.message || 'Download failed',
      );
    }
  };

  const errors = data?.validationReport?.errors ?? [];
  const coercions = data?.validationReport?.coercions ?? [];

  return (
    <Dialog open={open} onClose={closeOnEscapeOnly(onClose)} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ pb: 1, pr: 6 }}>
        <DialogCloseButton onClick={onClose} />
        Uploaded data
        {data && (
          <Typography variant="body2" color="text.secondary">
            {data.import.originalFilename ?? 'Unnamed file'} · {new Date(data.import.createdAt).toLocaleString()}
            {data.import.fileSize ? ` · ${fmtBytes(data.import.fileSize)}` : ''}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        {busy && <LinearProgress sx={{ mb: 1 }} />}

        {data?.import.status === 'failed' && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {data.import.errorMessage || 'This import failed.'}
          </Alert>
        )}

        {data && (
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip size="small" label={`${data.total} rows`} />
            <Chip
              size="small"
              label={data.import.mode === 'strict' ? 'strict' : 'best-effort'}
              color={data.import.mode === 'strict' ? 'success' : 'warning'}
            />
            {data.import.conflictStrategy && (
              <Chip size="small" label={`applied as ${data.import.conflictStrategy}`} />
            )}
            {errors.length > 0 && <Chip size="small" color="error" label={`${errors.length} validation errors`} />}
            {coercions.length > 0 && <Chip size="small" color="warning" label={`${coercions.length} coercions`} />}
          </Box>
        )}

        {coercions.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Some values were adjusted while importing — for example units stripped from story points.
            The originals are recorded against each row.
          </Alert>
        )}

        {data && data.rows.length === 0 && !busy && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            This import contains no rows.
          </Typography>
        )}

        {data && data.rows.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Title</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Assignee</TableCell>
                  <TableCell align="right">SP</TableCell>
                  <TableCell>Sprint</TableCell>
                  <TableCell>Updated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map(r => (
                  <TableRow key={r.id} hover>
                    <TableCell>{r.extId}</TableCell>
                    <TableCell sx={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <Tooltip title={r.title}><span>{r.title}</span></Tooltip>
                    </TableCell>
                    <TableCell>
                      {r.type}
                      {r.isContainer && (
                        <Tooltip title="Holds other tickets in this file. Its effort sits on its children, so it is not counted as a work item in the metrics.">
                          <Chip size="small" variant="outlined" label="container" sx={{ ml: 0.5 }} />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>{r.status}</TableCell>
                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.assigneeEmail || '—'}
                    </TableCell>
                    {/* A blank here is the visible symptom of an unmapped Story Points column. */}
                    <TableCell align="right">{r.storyPoints ?? '—'}</TableCell>
                    <TableCell>{r.sprintName || 'No Sprint'}</TableCell>
                    <TableCell>{new Date(r.updatedAtSource).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={data.total}
              page={page}
              rowsPerPage={pageSize}
              rowsPerPageOptions={[25, 50, 100, 200]}
              onPageChange={(_, p) => setPage(p)}
              onRowsPerPageChange={e => { setPageSize(parseInt(e.target.value, 10)); setPage(0); }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button startIcon={<Download />} onClick={download} disabled={!data}>
          Download original file
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};
