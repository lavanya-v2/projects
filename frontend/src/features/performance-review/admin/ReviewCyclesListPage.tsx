import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, InputAdornment, MenuItem, Paper, Stack, Switch,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { AddRounded, ArrowBackRounded, InfoOutlined, SearchRounded } from '@mui/icons-material';
import { useAccount } from '../../../context/UseAccount';
import { useActiveAccountProjects } from '../../../shared/hooks/useActiveAccountProjects';
import { useCycles, useReviewConfig, useGenerateCatchUpCycle } from '../hooks';
import { CycleAdminPage } from './CycleAdminPage';
import { STATUS_LEGEND } from '../statusLegend';
import type { CycleStatus } from '../types';

const NAVY = '#002e5b';
const INDIGO = '#4f46e5';

const STATUS_CHIP: Record<CycleStatus, { bg: string; fg: string }> = {
  scheduled: { bg: '#eef2f7', fg: '#374151' },
  open: { bg: '#e3f2fd', fg: '#0d47a1' },
  locked: { bg: '#fff4e5', fg: '#8a5300' },
  published: { bg: '#e8f5e9', fg: '#1b5e20' },
  archived: { bg: '#f3f4f6', fg: '#9ca3af' },
};

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const fiscalYearStartFor = (dateIso: string, startMonth: number) => {
  const [y, m] = dateIso.split('-').map(Number);
  const firstYear = m >= startMonth ? y : y - 1;
  return `${firstYear}-${String(startMonth).padStart(2, '0')}-01`;
};

/**
 * The landing view for the module: every review period, searchable and
 * filterable by project.
 *
 * A row is a period, not a project — filtering by project narrows which
 * periods show (those whose scope includes it), it never fabricates a
 * separate row per project. This is deliberate: cycles are account-scoped
 * (one review per person even if they work across several projects), and a
 * per-project row would misrepresent that as independent per-project cycles.
 *
 * Forward-only by default (Phase 12c): an account with a `setupDate` hides
 * periods that predate it unless "Show historical periods" is switched on —
 * never deleted, just not the default view. Phase 12d's catch-up action lets
 * a superuser collect one retrospective review for whatever got hidden.
 */
export function ReviewCyclesListPage({ onAddProject }: { onAddProject: () => void }) {
  const { activeAccount } = useAccount();
  const { jiraProjects } = useActiveAccountProjects();
  const [showHistorical, setShowHistorical] = useState(false);
  const { data: cycles = [], isLoading } = useCycles(activeAccount?.id, undefined, showHistorical);
  const { data: configData } = useReviewConfig(activeAccount?.id);
  const generateCatchUp = useGenerateCatchUpCycle();
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<number | 'all'>('all');
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(null);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [catchUpStart, setCatchUpStart] = useState('');
  const [catchUpEnd, setCatchUpEnd] = useState('');

  const projectNameById = useMemo(() => new Map(jiraProjects.map(p => [p.id, p.name])), [jiraProjects]);

  const setupDate = configData?.config?.setupDate ?? null;
  const hasHiddenHistory = !!setupDate;

  const openCatchUpDialog = () => {
    if (setupDate && configData?.config) {
      setCatchUpStart(fiscalYearStartFor(setupDate, configData.config.reviewYearStartMonth));
      setCatchUpEnd(dayBefore(setupDate));
    } else {
      setCatchUpStart('');
      setCatchUpEnd('');
    }
    setCatchUpOpen(true);
  };

  const submitCatchUp = () => {
    if (!activeAccount || !catchUpStart || !catchUpEnd) return;
    generateCatchUp.mutate(
      { accountId: activeAccount.id, startDate: catchUpStart, endDate: catchUpEnd },
      { onSuccess: () => setCatchUpOpen(false) },
    );
  };

  const filtered = useMemo(() => {
    return cycles.filter((c: any) => {
      if (projectFilter !== 'all' && !(c.scopeProjectIds ?? []).includes(projectFilter)) return false;
      if (query && !c.periodLabel.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [cycles, query, projectFilter]);

  if (!activeAccount) {
    return <Alert severity="info" sx={{ fontSize: 13 }}>Select an account to view review cycles.</Alert>;
  }

  if (selectedCycleId) {
    return (
      <Box>
        <Button size="small" startIcon={<ArrowBackRounded />} sx={{ mb: 2 }}
          onClick={() => setSelectedCycleId(null)}>
          Back to Review Cycles
        </Button>
        <CycleAdminPage initialCycleId={selectedCycleId} />
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 16, color: NAVY }}>
          Review Cycles
        </Typography>
        <Button
          size="small" variant="contained" startIcon={<AddRounded />}
          sx={{ bgcolor: INDIGO, '&:hover': { bgcolor: '#4338ca' } }}
          onClick={onAddProject}
        >
          Add a project
        </Button>
      </Stack>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2.5 }}>
        Every review period this account has generated, account-wide. A period spans every in-scope
        project at once — filter by project to see which periods include it, not a separate cycle per
        project.
      </Typography>

      {!isLoading && cycles.length === 0 && !hasHiddenHistory ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{ fontSize: 14, color: NAVY, fontWeight: 600, mb: 1 }}>
            No review cycles yet
          </Typography>
          <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2 }}>
            Add your first project to set up cadence, team, reviewer and template, then launch its
            first review cycle.
          </Typography>
          <Button
            variant="contained" startIcon={<AddRounded />}
            sx={{ bgcolor: INDIGO, '&:hover': { bgcolor: '#4338ca' } }}
            onClick={onAddProject}
          >
            Add a project
          </Button>
        </Paper>
      ) : (
        <>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
            <TextField
              size="small" placeholder="Search periods…" sx={{ minWidth: 220 }}
              value={query} onChange={e => setQuery(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded sx={{ fontSize: 18 }} /></InputAdornment> }}
            />
            <TextField
              select size="small" label="Project" sx={{ minWidth: 200 }}
              value={projectFilter} onChange={e => setProjectFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              <MenuItem value="all">All projects</MenuItem>
              {jiraProjects.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </TextField>

            {hasHiddenHistory && (
              <FormControlLabel
                control={<Switch size="small" checked={showHistorical} onChange={e => setShowHistorical(e.target.checked)} />}
                label={<Typography sx={{ fontSize: 12.5 }}>Show historical periods (before {setupDate})</Typography>}
              />
            )}

            <Box sx={{ flexGrow: 1 }} />

            {hasHiddenHistory && (
              <Tooltip title="Group the months before this account's setup date into one period a lead can review once, scored from the combined ticket data across that span.">
                <Button size="small" onClick={openCatchUpDialog}>
                  Create a catch-up period
                </Button>
              </Tooltip>
            )}
          </Stack>

          <Paper variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 12 }}>Period</TableCell>
                  <TableCell sx={{ fontSize: 12 }}>Window</TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <span>Projects in scope</span>
                      <Tooltip title="The projects actually in scope when this period was generated/opened — a historical snapshot, may differ from today's scope.">
                        <InfoOutlined sx={{ fontSize: 13, color: '#9ca3af' }} />
                      </Tooltip>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <span>Status</span>
                      <Tooltip title={STATUS_LEGEND}>
                        <InfoOutlined sx={{ fontSize: 13, color: '#9ca3af' }} />
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map((c: any) => (
                  <TableRow key={c.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedCycleId(c.id)}>
                    <TableCell sx={{ fontSize: 13, fontWeight: 600 }}>
                      {c.periodLabel}
                      {c.isCatchUp && (
                        <Chip size="small" label="catch-up" sx={{ ml: 1, fontSize: 10, bgcolor: '#ede9fe', color: '#5b21b6' }} />
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12.5 }}>{c.startDate} → {c.endDate}</TableCell>
                    <TableCell sx={{ fontSize: 12.5 }}>
                      {(c.scopeProjectIds ?? []).map((pid: number) => projectNameById.get(pid) ?? `#${pid}`).join(', ') || '—'}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={c.status} sx={{ fontSize: 11, fontWeight: 600, ...STATUS_CHIP[c.status as CycleStatus] }} />
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ fontSize: 13, color: '#6b7280', textAlign: 'center', py: 3 }}>
                      No periods match this search/filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}

      <Dialog open={catchUpOpen} onClose={() => setCatchUpOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontSize: 16 }}>Create a catch-up period</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: '#6b7280', mb: 2 }}>
            Groups this whole span into one period — a lead reviews it once, scored from the combined
            ticket data across every month in the range. Suggested to cover exactly the months hidden
            by this account's setup date; adjust if needed.
          </Typography>
          <Stack direction="row" spacing={2}>
            <TextField
              size="small" type="date" label="Start date" sx={{ minWidth: 190 }}
              InputLabelProps={{ shrink: true }} value={catchUpStart}
              onChange={e => setCatchUpStart(e.target.value)}
            />
            <TextField
              size="small" type="date" label="End date" sx={{ minWidth: 190 }}
              InputLabelProps={{ shrink: true }} value={catchUpEnd}
              onChange={e => setCatchUpEnd(e.target.value)}
            />
          </Stack>
          {generateCatchUp.isError && (
            <Alert severity="error" sx={{ mt: 2, fontSize: 12.5 }}>
              {(generateCatchUp.error as any)?.response?.data?.message ?? 'Could not create the catch-up period.'}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setCatchUpOpen(false)}>Cancel</Button>
          <Button
            size="small" variant="contained" disabled={!catchUpStart || !catchUpEnd || generateCatchUp.isPending}
            sx={{ bgcolor: INDIGO, '&:hover': { bgcolor: '#4338ca' } }}
            onClick={submitCatchUp}
          >
            {generateCatchUp.isPending ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : 'Create period'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default ReviewCyclesListPage;
