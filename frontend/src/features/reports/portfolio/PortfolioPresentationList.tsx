/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import {
  Box, Paper, Typography, Button, FormControl, InputLabel, Select, MenuItem,
  Table, TableHead, TableRow, TableCell, TableBody, TablePagination,
  Chip, IconButton, Tooltip, Alert, CircularProgress,
  InputAdornment, TextField,
  Menu, ListItemIcon, ListItemText, Divider,
  TableSortLabel, Badge, Popover, Stack,
  Snackbar,
} from '@mui/material';
import {
  Add, Visibility, Edit, Delete, Science, Lock as LockIcon, SlideshowRounded,
  ContentCopy, MoreVert, Link as LinkIcon,
} from '@mui/icons-material';
import dayjs from 'dayjs';
import { useProjects } from '../../auth/hooks';
import { usePermissions } from '../../../shared/hooks/usePermissions';
import type { Account } from '../../admin/accounts/types';
import type { Project } from '../../../types';
import {
  usePortfolioPresentations,
  useCreatePortfolioPresentation,
  useDeletePortfolioPresentation,
  useDuplicatePortfolioPresentation,
  usePortfolioPresentationPrefetch,
} from './hooks';
import { buildDemoPortfolioPayload } from './demoData';
import { portfolioPresentationCreateUrl, portfolioPresentationEditUrl, portfolioPresentationViewUrl } from '../../../routes/paths';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import type { existValues } from './types';
import { useLocation, useNavigate } from 'react-router-dom';
import ConfirmationDialog from '../../../shared/components/ConfirmationDialog';

export interface SortConfig {
  column: 'meetingDate' | 'createdAt';
  direction: 'ASC' | 'DESC';
}

interface Props {
  accounts: Account[];
  selectedAccount?: any;
}

const healthColor = (h: string) => {
  if (h === 'Green') return 'success';
  if (h === 'Amber') return 'warning';
  if (h === 'Red') return 'error';
  return 'default';
};

const toolTipPosition = {
  popper: {
    modifiers: [
      {
        name: 'offset',
        options: {
          offset: [0, -11],
        },
      },
    ],
  },
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  totalItems: number;
}

export function PortfolioPresentationList({ accounts, selectedAccount: propAccount }: Props) {
  const [selectedAccountId, setSelectedAccountId] = useState<number | ''>(propAccount?.id || '');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [page, setPage] = useState(1);
  const limit = 10;

  const [searchValue, setSearchValue] = useState('');
  const [searchString, setSearchString] = useState('');
    const navigate = useNavigate();

  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: 'meetingDate', direction: 'DESC' });
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuRow, setMenuRow] = useState<any | null>(null);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [showUnsavedAlert, setShowUnsavedAlert] = useState(false);
  const [isDelete, setIsDelete] = useState(false);
  const [openFilter, setOpenFilter] = useState<boolean>(false);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const [activeFilter, setActiveFilter] = useState<boolean>(false);

  const [selectedProject, setSelectedProject] = useState<string | number | undefined>('all');
  const [filterProject, setFilterProject] = useState<string | number | undefined>('all');
  const [appliedFilter, setAppliedFilter] = useState<number | null | undefined>(null);

  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  // Demo seed is a Superuser-only convenience for first-time setup / smoke testing.
  // Other roles never see the "Load Demo Presentation" button.
  const { isSuperuser } = usePermissions();

  const projectsQuery = useProjects(selectedAccountId ? (selectedAccountId as number) : undefined);
  const projects: Project[] = (selectedAccountId ? (projectsQuery.data ?? []) : []) as Project[];

  const listQuery = usePortfolioPresentations(selectedAccountId ? (selectedAccountId as number) : 0, searchValue, selectedProject === 'all' ? undefined : selectedProject, page, limit, sortConfig);
  const response = (selectedAccountId ? (listQuery.data ?? []) : []) as unknown as PaginatedResponse<existValues>;
  const rows = response.data;
  const totalItems = response.totalItems;
  const loading = !!selectedAccountId && listQuery.isFetching;

  const createMutation = useCreatePortfolioPresentation();
  const deleteMutation = useDeletePortfolioPresentation();
  const duplicateMutation = useDuplicatePortfolioPresentation();
  const prefetchPresentation = usePortfolioPresentationPrefetch();

  const filteredProjectName = projects.find((p: Project) => String(p.id) === String(selectedProject))?.name;

  useEffect(() => {
    if (propAccount?.id) setSelectedAccountId(propAccount.id);
  }, [propAccount?.id]);

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);
  const location = useLocation();
  useEffect(() => {
    const formType = location.state?.formType;
    if (formType) {
      setSnackbarOpen(true);
      setSuccess(formType === 'create' ? "Presentation created successfully" : "Presentation updated successfully");      
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  const handleSeedDemo = async () => {
    if (!selectedAccountId) return;
    if (projects.length === 0) {
      setError('This account has no projects; demo requires at least one project.');
      return;
    }
    const projectIds = projects.filter(p => !p.isSharedTeam && (p.dataSourceType ?? 'jira') !== 'excel').slice(0, 3).map(p => p.id);
    if (projectIds.length === 0) {
      setError('This account has no non-shared projects available for the demo.');
      return;
    }
    setSeedingDemo(true);
    setError('');
    try {
      const payload = buildDemoPortfolioPayload({ accountId: selectedAccountId as number, projectIds });
      await createMutation.mutateAsync({ accountId: selectedAccountId as number, data: payload });
    } catch {
      setError('Failed to load demo presentation.');
    } finally {
      setSeedingDemo(false);
    }
  };

  const handleSearch = () => {
    setSearchValue(searchString);
    setPage(1);
  }

  const handlePopOverClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      setAnchorEl(event.currentTarget);
      setOpenFilter(true);
  };

  const applyFilter = () => {
    setSelectedProject(filterProject);
    if (filterProject === 'all') {
      setAppliedFilter(null);
      setActiveFilter(false);
    } else {
      setAppliedFilter(Number(filterProject));
      setActiveFilter(true);
    }
    setPage(1);
    setOpenFilter(false);
  };

  const clearFilter = () => {
    setSelectedProject('all');
    setFilterProject('all');
    setAppliedFilter(null);
    setPage(1);
    setActiveFilter(false);
    setOpenFilter(false);
  }

  const handleClear = () => {
    setSearchValue('');
    setSearchString('');
  }

  const openMenu = (e: React.MouseEvent<HTMLElement>, r: any) => {
    setMenuAnchor(e.currentTarget);
    setMenuRow(r);
    prefetchPresentation(r.id);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuRow(null);
  };

  const handlePresent = async (r: any) => {
    closeMenu();
    const mode = "presentation";
    navigate(portfolioPresentationViewUrl(mode,r.id))
  };
  const handleView = async (r: any) => {
    closeMenu();
    const mode = "view";
    navigate(portfolioPresentationViewUrl(mode,r.id))
  };
  const handleEdit = async (r: any) => {
    closeMenu();
    navigate(portfolioPresentationEditUrl(r.id))
  };

  const handleCopyLink = async (r: any) => {
    closeMenu();
    setError('');
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${portfolioPresentationViewUrl("presentation",r.id)}`);
      setSuccessMsg('Share link copied to clipboard. Anyone with access can open it after signing in.');
    } catch {
      setError('Could not copy the link to your clipboard.');
    }
  };

  const handleDuplicate = async (r: any) => {
    closeMenu();
    setError('');
    setSuccessMsg('');
    try {
      const copy = await duplicateMutation.mutateAsync(r.id);
      setSuccessMsg(`Cloned — "${copy?.title ?? `(Copy) ${r.title}`}" created. It is editable (no MOM, not locked).`);
    } catch {
      setError('Failed to copy presentation.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      setShowDeleteAlert(false);
      setIsDelete(false);
      if(rows.length === 1){
        setPage(page -1);
      }
    } catch {
      setError('Failed to delete presentation.');
    }
  };
  const forceCloseForm = () => {
    setShowUnsavedAlert(false);
  };


  const handleSortRequest = (columnName: "meetingDate" | "createdAt") => {
    let direction: 'ASC' | 'DESC' = 'DESC';
    if (sortConfig.column === columnName && sortConfig.direction === 'DESC') {
      direction = 'ASC';
    }
    setSortConfig({ column: columnName, direction });
  };

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={600}>Delivery Presentations</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Build a ~30 minute customer-facing deck covering multiple projects under a delivery account.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {isSuperuser && (
            <Button
              variant="outlined"
              startIcon={seedingDemo ? <CircularProgress size={14} /> : <Science />}
              disabled={!selectedAccountId || seedingDemo}
              onClick={handleSeedDemo}
            >
              {seedingDemo ? 'Loading…' : 'Load Demo Presentation'}
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<Add />}
            disabled={!selectedAccountId}
            onClick={() => { navigate(portfolioPresentationCreateUrl()) }}
          >
            New Presentation
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {successMsg && <Alert severity="success" onClose={() => setSuccessMsg('')} sx={{ mb: 2 }}>{successMsg}</Alert>}

      <Paper sx={{ p: 2, mb: 3, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {!propAccount && (
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Account</InputLabel>
            <Select value={selectedAccountId} label="Account"
              onChange={e => setSelectedAccountId(e.target.value as number)}>
              {accounts.map(a => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
            </Select>
          </FormControl>
        )}
        {selectedAccount && (
          <Typography variant="body2" color="text.secondary">
            Active account: <strong>{selectedAccount.name}</strong> · {projects.length} project(s) in scope
          </Typography>
        )}
      </Paper>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
        <Box
          sx={{
            display: 'flex',
            gap: 1.5,
            mb: 2.5,
            alignItems: { xs: 'stretch', sm: 'center' },
            flexWrap: 'wrap',
            flexDirection: { xs: 'column', sm: 'row' }
          }}
        >
          <TextField
            size="small"
            placeholder="Search by title or project"
            value={searchString}
            onChange={e => setSearchString(e.target.value)}
            sx={{
              width: { xs: '100%', sm: 300 },
              '& .MuiOutlinedInput-root': {
                borderRadius: 1.5,
                fontSize: 13,
                fontFamily: 'Inter, sans-serif',
                '& fieldset': { borderColor: '#e0e4ea' },
                '&:hover fieldset': { borderColor: '#9ca3af' },
                '&.Mui-focused fieldset': { borderColor: 'navy' },
              },
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: '#9ca3af' }} />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    {searchString && (
                      <IconButton
                        onClick={handleClear}
                        size="small"
                      >
                        <ClearIcon fontSize='small' sx={{ color: '#9ca3af' }} />
                      </IconButton>
                    )}
                    <IconButton onClick={handlePopOverClick} color={openFilter ? 'primary' : 'default'}>
                      <Badge
                          variant="dot"
                          color="error"
                          invisible={!activeFilter}
                          anchorOrigin={{
                            vertical: 'top',
                            horizontal: 'right',
                          }}
                      >
                        <FilterAltIcon />
                      </Badge>
                    </IconButton>
                  </InputAdornment>
                )
              },
            }}
          />

          <Box
            sx={{
                display: 'flex',
                gap: 1.5,
                mb: 2.5,
                alignItems: { xs: 'stretch', sm: 'center' },
                flexWrap: 'wrap',
                flexDirection: { xs: 'column', sm: 'row' }
            }}
        >
          <Popover
              open={openFilter}
              onClose={()=> setOpenFilter(false)}
              anchorEl={anchorEl}
              anchorOrigin={{
                  vertical: 'bottom',
                  horizontal: 'left'
              }}
              transformOrigin={{
                  vertical: 'top',
                  horizontal: 'left'
              }}
              slotProps={{
                  paper: {
                      sx: { p: 2.5, minWidth: { xs: '100%', sm: 140 } }
                  }
              }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 2 }}>
                Filters
            </Typography>
            <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 }, maxWidth: { xs: '100%', sm: 200 } }}>
              <InputLabel id="project-select-label">Project</InputLabel>
              <Select
                labelId="project-select-label"
                value={filterProject}
                label="Project"
                onChange={(e) => { setFilterProject(e.target.value); }}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      maxHeight: 240,
                      overflowY: 'auto',
                    },
                  },
                }}
              >
              <MenuItem value="all">All Projects</MenuItem>
              {projects.map((p: Project) => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </Select>
            </FormControl>
            <Stack direction="row" spacing={1} justifyContent="space-between" sx={{ pt: 1 }}>
              <Button
                size="small"
                color="error"
                onClick={clearFilter}
              >
                Clear All
              </Button>
              <Button variant="contained" size="small" disabled={!filterProject} onClick={applyFilter}>
                Apply
              </Button>
            </Stack>                    
          </Popover>
        </Box>

          <Button
            variant="contained"
            onClick={handleSearch}
            size="small"
          >
            Search
          </Button>
        </Box>
      </Box>

      {appliedFilter && selectedProject !== 'all' && (
      <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, pb: 2 }}>
        <Chip
          label={filteredProjectName || String(selectedProject)}
          size="small"
          onDelete={clearFilter}
          sx={{
            fontFamily: 'Inter, sans-serif',
            fontSize: 11,
            fontWeight: 600,
            bgcolor: 'rgba(156, 163, 175, 0.15)',
            color: '#6b7280',
            border: 'none',
            height: 22,
          }}
        />
      </Box>
    )}

      {!selectedAccountId ? (
        <Paper sx={{ p: 4 }}>
          <Typography variant="subtitle1" fontWeight={600}>Pick an account to get started</Typography>
          <Typography variant="body2" color="text.secondary">
            Select an account above. The Delivery Presentation will pull sprint metrics, risks, and action items
            across the projects under that account for the chosen date range.
          </Typography>
        </Paper>
      ) : loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>
      ) : rows.length === 0 && selectedProject === 'all' ? (
        <Paper sx={{ p: 4 }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            No presentations yet for {selectedAccount?.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {isSuperuser
              ? 'Create your first delivery presentation, or load demo data to explore the full slideshow + PDF.'
              : 'Create your first delivery presentation.'}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            <Button variant="contained" startIcon={<Add />}
              onClick={() => { navigate(portfolioPresentationCreateUrl()) }}>
              Create First Presentation
            </Button>
            {isSuperuser && (
              <Button variant="outlined" startIcon={<Science />}
                disabled={seedingDemo} onClick={handleSeedDemo}>
                {seedingDemo ? 'Loading…' : 'Load Demo Presentation'}
              </Button>
            )}
          </Box>
        </Paper>
      ) : (
        <Paper>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                <TableCell><strong>Title</strong></TableCell>
                <TableCell><strong>Meeting
                  <TableSortLabel sx={{ fontSize: 10 }}
                    active={sortConfig.column === 'meetingDate'}
                    direction={sortConfig.direction === 'DESC' ? 'desc' : 'asc'}
                    onClick={() => handleSortRequest('meetingDate')}>
                  </TableSortLabel>
                </strong></TableCell>
                <TableCell><strong>Period</strong></TableCell>
                <TableCell><strong>Projects</strong></TableCell>
                <TableCell><strong>Health</strong></TableCell>
                <TableCell><strong>Created
                  <TableSortLabel sx={{ fontSize: 10 }}
                    active={sortConfig.column === 'createdAt'}
                    direction={sortConfig.direction === 'DESC' ? 'desc' : 'asc'}
                    onClick={() => handleSortRequest('createdAt')}>
                  </TableSortLabel>
                </strong></TableCell>
                <TableCell align="center"><strong>Actions</strong></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} hover>
                  <TableCell>
                    <Tooltip
                      title={r.title}
                      slotProps={toolTipPosition}
                    >
                      <span style={{ display: 'inline-block', maxWidth: 240, verticalAlign: 'middle' }}>
                        <Typography
                          variant="body2"
                          fontWeight={500}
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {r.title}
                        </Typography>
                      </span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {r.meetingDate ? dayjs(r.meetingDate).format('DD MMM YYYY') : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {dayjs(r.startDate).format('DD MMM')}
                      {' – '}
                      {dayjs(r.endDate).format('DD MMM')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant='body2'>
                      {r.projectNames?.join(', ')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Chip label={r.health} color={healthColor(r.health)} size="small" sx={{ fontWeight: 600 }} />
                      {r.momStatus === 'accepted' && <Chip label="MOM ✓" size="small" color="success" sx={{ fontSize: 10, height: 20 }} />}
                      {r.momStatus === 'draft' && <Chip label="MOM draft" size="small" sx={{ fontSize: 10, height: 20 }} />}
                      {r.lockedAt && <Chip icon={<LockIcon sx={{ fontSize: '12px !important' }} />} label="Locked" size="small" sx={{ fontSize: 10, height: 20, bgcolor: '#e3e8ef' }} />}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Actions" slotProps={toolTipPosition}>
                      <IconButton size="small" onClick={e => openMenu(e, r)}>
                        <MoreVert fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={totalItems}
            page={totalItems > 0 ? page - 1 : 0}
            onPageChange={(_, p) => setPage(p + 1)}
            rowsPerPage={limit}
            rowsPerPageOptions={[limit]}
          />
        </Paper>
      )}

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem onClick={() => menuRow && handlePresent(menuRow)}>
          <ListItemIcon><SlideshowRounded fontSize="small" /></ListItemIcon>
          <ListItemText>Presentation mode</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => menuRow && handleView(menuRow)}>
          <ListItemIcon><Visibility fontSize="small" /></ListItemIcon>
          <ListItemText>View (Edit / MOM / PDF)</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => menuRow && handleCopyLink(menuRow)}>
          <ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Copy share link</ListItemText>
        </MenuItem>
        <MenuItem disabled={!!menuRow?.lockedAt} onClick={() => menuRow && handleEdit(menuRow)}>
          <ListItemIcon><Edit fontSize="small" /></ListItemIcon>
          <ListItemText>{menuRow?.lockedAt ? 'Edit (locked)' : 'Edit'}</ListItemText>
        </MenuItem>
        <MenuItem disabled={duplicateMutation.isPending} onClick={() => menuRow && handleDuplicate(menuRow)}>
          <ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>
          <ListItemText>Clone (new editable, no MOM)</ListItemText>
        </MenuItem>
        {isSuperuser && <Divider />}
        {isSuperuser && (
          <MenuItem onClick={() => { const r = menuRow; closeMenu(); setDeleteTarget(r); setShowDeleteAlert(true); setIsDelete(true); }} sx={{ color: 'error.main' }}>
            <ListItemIcon><Delete fontSize="small" color="error" /></ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        )}
      </Menu>
        {(showDeleteAlert || showUnsavedAlert) && (
          <ConfirmationDialog
            title={isDelete ? "Delete Presentation?": "Unsaved Changes"}
            message={isDelete ?  `Are you sure you want to delete ${deleteTarget?.title}? This cannot be undone.` : "You have some unsaved changes, do you want to close it?"}
            action={isDelete ? "Delete" : "Yes"}
            closeButtonText={isDelete ? "Cancel" : "No"}
            ActionButtonColor={isDelete? "error" : "primary"}
            confirm={isDelete ? handleDelete : forceCloseForm}
            setShowAlert={isDelete ? setShowDeleteAlert : setShowUnsavedAlert}
            onClose={() => {
              const deleteOption = () => {setShowDeleteAlert(false); setIsDelete(false)};
              /* eslint-disable @typescript-eslint/no-unused-expressions*/
              isDelete ? deleteOption() : setShowUnsavedAlert(false);
            }}
          />
        )}
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={3000}
          onClose={() => setSnackbarOpen(false)}
          anchorOrigin={{
            vertical: "top",
            horizontal: "center",
          }}
        >
          <Alert
            severity="success"
            variant="filled"
            onClose={() => setSnackbarOpen(false)}
          >
            {success}
          </Alert>
        </Snackbar>
    </Box>
  );
}
