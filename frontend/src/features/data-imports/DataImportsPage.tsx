/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, TextField, MenuItem, Button, Paper, Typography, Alert,
  Table, TableHead, TableBody, TableRow, TableCell, IconButton, Tooltip, Chip,
  CircularProgress,
  TableContainer,
  TablePagination,
} from '@mui/material';
import { CloudUpload, Delete as DeleteIcon, Refresh, Visibility, Download, Replay, Insights, Tune } from '@mui/icons-material';
import { useFetchProjects } from '../auth/hooks';
import { client } from '../../api/client';
import type { Project } from '../../types';
import { ExcelUploadDialog } from './components/ExcelUploadDialog';
import { ImportDetailDialog } from './components/ImportDetailDialog';
import { SprintManagerDialog } from './components/SprintManagerDialog';
import ConfirmationDialog from '../../shared/components/ConfirmationDialog';

interface ExcelImport {
  id: number;
  projectId: number;
  template: 'scrum' | 'kanban';
  mode: 'strict' | 'best_effort';
  status: 'pending' | 'applied' | 'rejected' | 'failed';
  reportDate?: string;
  periodStart?: string;
  periodEnd?: string;
  rowCount: number;
  historyCount: number;
  hasHistory: boolean;
  originalFilename?: string;
  uploadedBy?: number;
  createdAt: string;
  conflictStrategy?: 'merge' | 'replace';
  errorMessage?: string;
  storagePath?: string;
  fileSize?: number;
  /** Mapping that parsed this upload. Older than the active one means the rows are stale. */
  templateMappingId?: number | null;
  templateMappingVersion?: number | null;
}

interface ImportListResponse {
  imports: ExcelImport[];
  activeTemplateMappingId: number | null;
  totalImports: number | null
}

const statusColor = (status: ExcelImport['status']) => {
  if (status === 'applied') return 'success';
  if (status === 'failed' || status === 'rejected') return 'error';
  return 'default';
};

const fmtBytes = (bytes?: number) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface DataImportsPageProps {
  accounts: any[];
  selectedAccount?: any;
}

export const DataImportsPage = ({ accounts, selectedAccount: propAccount }: DataImportsPageProps) => {
  const [selectedAccount, setSelectedAccount] = useState<string>(propAccount?.id ? String(propAccount.id) : '');
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [imports, setImports] = useState<ExcelImport[]>([]);
  /** The project's current mapping; anything parsed under a different one is flagged as stale. */
  const [activeMappingId, setActiveMappingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [detailTarget, setDetailTarget] = useState<number | null>(null);
  const [resubmitting, setResubmitting] = useState<number | null>(null);
  const [sprintMgrOpen, setSprintMgrOpen] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [page, setPage] = useState(1);
  const [totalImports, setTotalImports] = useState(0);
  const limit = 10;
  const fetchProjects = useFetchProjects();
  const navigate = useNavigate();

  useEffect(() => {
    if (propAccount?.id) setSelectedAccount(String(propAccount.id));
  }, [propAccount?.id]);

  // Load Excel-only projects whenever the account changes.
  useEffect(() => {
    const load = async () => {
      if (!selectedAccount) { setProjectList([]); setSelectedProject(''); return; }
      try {
        const acc = accounts.find(a => String(a.id) === String(selectedAccount));
        if (!acc) return;
        const all = await fetchProjects(acc.id);
        const excelOnly = all.filter((p: Project) => p.dataSourceType !== 'jira');
        setProjectList(excelOnly);
        setSelectedProject('');
      } catch (err: any) {
        setError(err?.response?.data?.error || err?.message || 'Failed to load projects');
      }
    };
    load();
  }, [selectedAccount, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadImports = async () => {
    if (!selectedProject) { setImports([]); return; }
    setLoading(true);
    setError('');
    try {
      const res = await client.get<ImportListResponse>(`/datasource/projects/${selectedProject}/excel/imports/${page}/${limit}`);
      setImports(res.data?.imports ?? []);
      setTotalImports(res.data?.totalImports ?? 0);
      setActiveMappingId(res.data?.activeTemplateMappingId ?? null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load imports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadImports(); }, [selectedProject, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      await client.delete(`/datasource/projects/${selectedProject}/imports/${deleteTarget}`);
      setSuccess('Import deleted. Remaining uploads were re-applied, so the sprint data is back to what it would have been without it.');
      setDeleteTarget(null);
      setShowAlert(false);
      loadImports();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to delete');
    }
  };

  const handleDownload = async (imp: ExcelImport) => {
    try {
      const res = await client.get(`/datasource/projects/${selectedProject}/imports/${imp.id}/file`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = imp.originalFilename || `import-${imp.id}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(
        err?.response?.status === 410
          ? 'The original file for this import was not retained. Files are kept for uploads made from now on.'
          : err?.response?.data?.error || err?.message || 'Download failed',
      );
    }
  };

  // Re-applies the retained file against the CURRENT column mapping — the fix path after correcting
  // a mapping, without asking the user to find and upload the file again.
  const handleResubmit = async (imp: ExcelImport) => {
    setResubmitting(imp.id);
    setError('');
    try {
      const res = await client.post(`/datasource/projects/${selectedProject}/imports/${imp.id}/resubmit`, {});
      const rows = res.data?.validation?.rows?.length ?? 0;
      setSuccess(`Resubmitted ${imp.originalFilename ?? 'file'} — ${rows} rows re-imported with the current mapping.`);
      loadImports();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Resubmit failed');
    } finally {
      setResubmitting(null);
    }
  };

  const activeProject = projectList.find(p => String(p.id) === selectedProject);

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Filter row */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center', flexWrap: 'wrap' }}>
        {!propAccount && (
          <TextField
            select size="small" label="Account" value={selectedAccount}
            onChange={e => setSelectedAccount(String(e.target.value))}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value=""><em>Select account</em></MenuItem>
            {accounts.map(acc => (
              <MenuItem key={acc.id} value={String(acc.id)}>{acc.name}</MenuItem>
            ))}
          </TextField>
        )}
        <TextField
          select size="small" label="Excel Project" value={selectedProject}
          onChange={e => setSelectedProject(String(e.target.value))}
          disabled={!selectedAccount || projectList.length === 0}
          sx={{ minWidth: 240 }}
          helperText={selectedAccount && projectList.length === 0 ? 'No Excel-based projects in this account' : ' '}
        >
          <MenuItem value="" disabled>Select project</MenuItem>
          {projectList.map(p => <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>)}
        </TextField>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          startIcon={<CloudUpload />}
          onClick={() => setUploadOpen(true)}
          disabled={!selectedProject}
        >
          {activeProject?.reportingFrequency === 'sprint'
            ? 'Upload Sprint Data'
            : activeProject?.reportingFrequency === 'weekly'
              ? 'Upload Weekly Data'
              : 'Upload Daily Data'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<Tune />}
          disabled={!selectedProject}
          onClick={() => setSprintMgrOpen(true)}
        >
          Manage sprints
        </Button>
        <Button
          variant="outlined"
          startIcon={<Insights />}
          disabled={!selectedProject}
          onClick={() =>
            navigate(`/team-performance/sprint?accountId=${selectedAccount}&projectId=${selectedProject}`)
          }
        >
          View results
        </Button>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={loadImports} disabled={!selectedProject || loading}>
              <Refresh />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* Imports table */}
      <Paper sx={{ p: 0 }}>
        {!selectedProject && (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Select an Excel-based project to view its upload history.
            </Typography>
          </Box>
        )}
        {selectedProject && loading && (
          <Box sx={{ p: 6, textAlign: 'center' }}><CircularProgress /></Box>
        )}
        {selectedProject && !loading && imports.length === 0 && (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No uploads yet for this project. Use the upload button to add one.
            </Typography>
          </Box>
        )}
        {selectedProject && !loading && imports.length > 0 && (
          <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{activeProject?.reportingFrequency === 'sprint' ? 'Sprint Period' : 'Report Date'}</TableCell>
                <TableCell>Mode</TableCell>
                <TableCell align="right">Rows</TableCell>
                <TableCell align="right">History</TableCell>
                <TableCell>File</TableCell>
                <TableCell align="right">Size</TableCell>
                <TableCell>Uploaded</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {imports.map(imp => (
                <TableRow key={imp.id} hover>
                  <TableCell>{imp.reportDate ?? (imp.periodStart && imp.periodEnd ? `${imp.periodStart} – ${imp.periodEnd}` : '—')}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={imp.mode === 'strict' ? 'strict' : 'best-effort'}
                      color={imp.mode === 'strict' ? 'success' : 'warning'}
                    />
                    {/*
                      Parsed under a mapping that has since been replaced. The rows are kept exactly
                      as imported — fixing a mapping does not reach back and re-parse old uploads.
                    */}
                    {!!imp.templateMappingId &&
                      !!activeMappingId &&
                      imp.templateMappingId !== activeMappingId && (
                        <Tooltip title="Imported using an earlier column mapping. These rows are kept as they were imported — re-upload the file to parse it with the current mapping.">
                          <Chip
                            size="small"
                            variant="outlined"
                            color="warning"
                            sx={{ ml: 0.5 }}
                            label={
                              imp.templateMappingVersion
                                ? `mapping v${imp.templateMappingVersion}`
                                : 'older mapping'
                            }
                          />
                        </Tooltip>
                      )}
                  </TableCell>
                  <TableCell align="right">{imp.rowCount}</TableCell>
                  <TableCell align="right">{imp.historyCount}</TableCell>
                  <TableCell sx={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {imp.originalFilename ?? '—'}
                  </TableCell>
                  <TableCell align="right">{fmtBytes(imp.fileSize)}</TableCell>
                  <TableCell>{new Date(imp.createdAt).toLocaleString()}</TableCell>
                  <TableCell>
                    {/* A failed import now leaves a visible row with the reason, not a silent 500. */}
                    <Tooltip title={imp.errorMessage ?? ''}>
                      <Chip size="small" label={imp.status} color={statusColor(imp.status)} />
                    </Tooltip>
                    {imp.errorMessage && (
                      <Typography variant="caption" color="error" display="block" sx={{ maxWidth: 260 }}>
                        {imp.errorMessage}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="View uploaded rows">
                      <IconButton size="small" onClick={() => setDetailTarget(imp.id)}>
                        <Visibility fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={imp.storagePath ? 'Download original file' : 'File not retained for this upload'}>
                      <span>
                        <IconButton size="small" disabled={!imp.storagePath} onClick={() => handleDownload(imp)}>
                          <Download fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip
                      title={
                        imp.storagePath
                          ? 'Re-import this file using the current column mapping'
                          : 'File not retained, so it cannot be resubmitted'
                      }
                    >
                      <span>
                        <IconButton
                          size="small"
                          disabled={!imp.storagePath || resubmitting === imp.id}
                          onClick={() => handleResubmit(imp)}
                        >
                          <Replay fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" onClick={() => { setDeleteTarget(imp.id); setShowAlert(true) }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={totalImports}
            page={totalImports > 0 ? page - 1 : 0}
            onPageChange={(_, p) => setPage(p + 1)}
            rowsPerPage={limit}
            rowsPerPageOptions={[limit]}
          />
          </TableContainer>
        )}
        {showAlert && (
          <ConfirmationDialog
            title="Delete Upload?"
            message="Delete this upload and its retained file? The remaining uploads are re-applied afterwards,so the sprint data returns to what it would have been had this file never been imported."
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
      </Paper>

      {activeProject && (
        <ExcelUploadDialog
          open={uploadOpen}
          projectId={activeProject.id}
          projectName={activeProject.name}
          dataSourceType={activeProject.dataSourceType}
          estimationType={activeProject.estimationType}
          reportingFrequency={activeProject.reportingFrequency}
          onClose={() => setUploadOpen(false)}
          onSuccess={msg => { setSuccess(msg); loadImports(); }}
        />
      )}

      {activeProject && (
        <SprintManagerDialog
          open={sprintMgrOpen}
          projectId={activeProject.id}
          onClose={() => setSprintMgrOpen(false)}
          onDone={msg => { setSuccess(msg); loadImports(); }}
        />
      )}

      {activeProject && (
        <ImportDetailDialog
          open={!!detailTarget}
          projectId={activeProject.id}
          importId={detailTarget}
          onClose={() => setDetailTarget(null)}
          onError={setError}
        />
      )}
    </Box>
  );
};
