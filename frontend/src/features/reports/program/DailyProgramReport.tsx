import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  TextField,
  MenuItem,
  Paper,
  Typography,
  Chip,
  Alert,
  CircularProgress,
  Pagination,
  Snackbar,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  Stack,
  Tooltip,
} from '@mui/material';
import type { Theme } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ScheduleSendIcon from '@mui/icons-material/ScheduleSend';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { Dayjs } from 'dayjs';
import {
  useAccessiblePrograms,
  useProgramDailyReports,
  useQueueProgramDailyReport,
} from '../../programs/hooks';
import type {
  ProgramDailyReportRow,
  ProjectIncludedDailySnapshot,
  SprintBurndown,
} from '../../programs/types';
import ReportCompletenessBanner from '../shared/ReportCompletenessBanner';
import type { Account } from '../../admin/accounts/types';
import { AxiosError } from 'axios';

interface Props {
  accounts: Account[];
  selectedAccount?: Account | null;
}

interface ApiErrorResponse {
  error?: string;
}

const healthColor = (h?: string): 'success' | 'warning' | 'error' | 'default' => {
  if (h === 'Green') return 'success';
  if (h === 'Amber') return 'warning';
  if (h === 'Red') return 'error';
  return 'default';
};

const cardBorder = (h?: string) => (theme: Theme) => {
  const c = healthColor(h);
  if (c === 'success') return theme.palette.success.main;
  if (c === 'warning') return theme.palette.warning.main;
  if (c === 'error') return theme.palette.error.main;
  return theme.palette.grey[400];
};

export const DailyProgramReport = ({ accounts: _accounts, selectedAccount }: Props) => {
  const accessibleQuery = useAccessiblePrograms();
  const accessible = useMemo(
    () => accessibleQuery.data ?? [],
    [accessibleQuery.data],
  );

  const [accountId, setAccountId] = useState<number | ''>(
    selectedAccount?.id ? Number(selectedAccount.id) : '',
  );
  const [programId, setProgramId] = useState<number | ''>('');
  const [page, setPage] = useState(1);
  const limit = 10;

  const programsForAccount = useMemo(
    () => accessible.filter(p => p.accountId === accountId),
    [accessible, accountId],
  );
  const accountIdsWithPrograms = useMemo(() => {
    const set = new Set<number>();
    accessible.forEach(p => set.add(p.accountId));
    return set;
  }, [accessible]);

  const reportsQuery = useProgramDailyReports(
    programId === '' ? null : programId,
    page,
    limit,
  );
  const reports: ProgramDailyReportRow[] = reportsQuery.data?.reports ?? [];
  const total = reportsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const queueMutation = useQueueProgramDailyReport();
  const [genDate, setGenDate] = useState<Dayjs | null>(dayjs());
  const [error, setError] = useState<string>('');
  const [toast, setToast] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' }>({
    open: false,
    msg: '',
    severity: 'success',
  });

  const Datehandler = (reportDate: dayjs.Dayjs | null) => {
    if (reportDate && reportDate.isValid()) {
      setGenDate(reportDate);
      if (reportDate && dayjs(reportDate).isAfter(dayjs())) {
        setError('Date cannot be future.');
      } else if (reportDate && dayjs(reportDate).isBefore(dayjs().subtract(6, 'month'))) {
        setError('Date not valid.');
      } else {
        setError('');
      }
    } else if (!reportDate) {
      setGenDate(null);
      setError('');
    }
    return reportDate;
  }

  const handleQueue = async () => {
    if (!programId) return;
    try {
      await queueMutation.mutateAsync({
        programId: Number(programId),
        date: genDate?.format('YYYY-MM-DD'),
      });
      setToast({ open: true, msg: 'Queued — refresh in a minute to view the new report.', severity: 'success' });
    } catch (err) {
      const axiosError = err as AxiosError<ApiErrorResponse>;
      setToast({
        open: true,
        msg: axiosError.response?.data?.error || 'Failed to queue report',
        severity: 'error',
      });
    }
  };

  if (accessibleQuery.isLoading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>;
  }

  if (accessible.length === 0) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">
          No programs are configured for accounts you can access. Ask an administrator to set up a program.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Daily Program Report</Typography>

      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label="Account"
          value={accountId === '' ? '' : String(accountId)}
          onChange={e => {
            const id = e.target.value === '' ? '' : Number(e.target.value);
            setAccountId(id);
            setProgramId('');
            setPage(1);
          }}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value=""><em>Select account…</em></MenuItem>
          {(_accounts ?? [])
            .filter((a: Account) => accountIdsWithPrograms.has(Number(a.id)))
            .map((a: Account) => (
              <MenuItem key={a.id} value={String(a.id)}>{a.name}</MenuItem>
            ))}
        </TextField>

        <TextField
          select
          size="small"
          label="Program"
          value={programId === '' ? '' : String(programId)}
          onChange={e => { setProgramId(e.target.value === '' ? '' : Number(e.target.value)); setPage(1); }}
          disabled={!accountId || programsForAccount.length === 0}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value=""><em>Select program…</em></MenuItem>
          {programsForAccount.map(p => (
            <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>
          ))}
        </TextField>

        <DatePicker
          label="Generate for date"
          value={genDate}
          onChange={Datehandler}
          minDate={dayjs().subtract(6,'month')}
          maxDate={dayjs()}
          slotProps={{ textField: { size: 'small', helperText: error, error: Boolean(error) } }}
        />

        <Box sx={{ flexGrow: 1 }} />

        <Tooltip title="Queues a background job. Refresh after a minute to see the new report.">
          <span>
            <Button
              variant="contained"
              startIcon={<ScheduleSendIcon />}
              disabled={!programId || queueMutation.isPending || !genDate || Boolean(error)}
              onClick={handleQueue}
            >
              {queueMutation.isPending ? 'Queuing…' : 'Queue Generation'}
            </Button>
          </span>
        </Tooltip>
      </Box>

      {!programId ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
          <Typography color="text.secondary">Select a program to view its daily reports.</Typography>
        </Paper>
      ) : reportsQuery.isFetching ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
      ) : reports.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
          <Typography color="text.secondary">
            No reports generated yet. Click "Queue Generation" to create one.
          </Typography>
        </Paper>
      ) : (
        <>
          {reports.map((r, i) => <DailyReportCard key={r.id} report={r} defaultExpanded={i === 0} />)}
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination count={totalPages} page={page} onChange={(_, v) => setPage(v)} />
            </Box>
          )}
        </>
      )}

      <Snackbar
        open={toast.open}
        autoHideDuration={4500}
        onClose={() => setToast({ ...toast, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={toast.severity} onClose={() => setToast({ ...toast, open: false })}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

interface CardProps { report: ProgramDailyReportRow; defaultExpanded?: boolean }
const DailyReportCard = ({ report, defaultExpanded = false }: CardProps) => {
  const risksData = report.risks;
  const risksItems: string[] = 
  risksData && typeof risksData === 'object' && 'items' in risksData && Array.isArray(risksData.items)
    ? risksData.items
    : Array.isArray(risksData)
      ? risksData
      : typeof risksData === 'string'
        ? [risksData]
        : [];

  const includedRich: ProjectIncludedDailySnapshot[] = (report.projectsIncluded ?? [])
    .map(p => typeof p === 'string' ? { projectName: p } : p);

  const missingCount = (report.projectsMissing ?? []).length;
  const projectsCaption = `${includedRich.length} project${includedRich.length === 1 ? '' : 's'}` +
    (missingCount > 0 ? `, ${missingCount} missing` : '');

  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      sx={{
        mb: 2,
        borderLeft: '4px solid',
        borderColor: cardBorder(report.health),
        '&:before': { display: 'none' },
      }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', width: '100%' }}>
          <Typography variant="h6">{report.reportDate}</Typography>
          {report.health && (
            <Chip
              size="small"
              label={report.health}
              color={healthColor(report.health) === 'default' ? undefined : healthColor(report.health)}
            />
          )}
          <Typography variant="caption" color="text.secondary">{projectsCaption}</Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <ReportCompletenessBanner projectsMissing={report.projectsMissing} />

        {report.summary && (
          <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>{report.summary}</Typography>
        )}

        {includedRich.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Sprint progress</Typography>
            <Stack spacing={1.5}>
              {includedRich.map((p, i) => (
                <SprintProgressRow key={i} project={p} />
              ))}
            </Stack>
            <Divider sx={{ mt: 2 }} />
          </Box>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {report.keyAccomplishments && report.keyAccomplishments.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Today's key items</Typography>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {report.keyAccomplishments.map((a, i) => <li key={i}><Typography variant="body2">{a}</Typography></li>)}
              </ul>
            </Box>
          )}

          {risksItems.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Risks</Typography>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {risksItems.map((r: string, i: number) => <li key={i}><Typography variant="body2">{r}</Typography></li>)}
              </ul>
            </Box>
          )}

          {report.actionItems && report.actionItems.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Action items</Typography>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {report.actionItems.map((a, i) => <li key={i}><Typography variant="body2">{a}</Typography></li>)}
              </ul>
            </Box>
          )}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {includedRich.map((p, i) => (
              <Chip key={`inc-${i}`} size="small" label={p.projectName} color="success" variant="outlined" />
            ))}
            {(report.projectsMissing ?? []).map((n, i) => (
              <Chip key={`miss-${i}`} size="small" label={`${n} (no snapshot)`} color="warning" variant="outlined" />
            ))}
          </Box>

          {report.managerInsights && (
            <Box sx={{ mt: 1, p: 1.5, bgcolor: 'grey.50', borderLeft: '3px solid #9c27b0' }}>
              <Typography variant="subtitle2" sx={{ color: '#9c27b0', mb: 0.5 }}>Manager Insights</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{report.managerInsights}</Typography>
            </Box>
          )}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};

interface SprintRowProps { project: ProjectIncludedDailySnapshot }
const SprintProgressRow = ({ project }: SprintRowProps) => {
  // A bypassed marker carries no metrics (the sprint did not exist on that date), so it
  // must read as "no burndown" rather than being drawn as a bar full of zeros.
  const raw: SprintBurndown | null | undefined = project.sprintBurndown;
  const sb: SprintBurndown | null | undefined = raw?.bypassed ? null : raw;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="body2" fontWeight={600} sx={{ minWidth: 140 }}>
          {project.projectName}
        </Typography>
        {project.health && (
          <Chip
            size="small"
            label={project.health}
            color={healthColor(project.health) === 'default' ? undefined : healthColor(project.health)}
            sx={{ height: 18, fontSize: 11 }}
          />
        )}
        <Box sx={{ flexGrow: 1 }} />
        {sb?.sprintName ? (
          <Typography variant="caption" color="text.secondary">
            {sb.sprintName}
            {sb.daysElapsed != null && sb.daysTotal != null && ` · day ${sb.daysElapsed}/${sb.daysTotal}`}
            {sb.completionPct != null && ` · ${Math.round(sb.completionPct)}%`}
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary">(No active sprint)</Typography>
        )}
      </Box>

      {sb && sb.usedSP !== false && (
        <SprintLaneBar burndown={sb} />
      )}
    </Box>
  );
};

const SprintLaneBar = ({ burndown }: { burndown: SprintBurndown }) => {
  const lanes = [
    { key: 'completedV2SP', label: 'Done', value: burndown.completedV2SP ?? 0, color: '#4caf50' },
    { key: 'inUatSP', label: 'UAT', value: burndown.inUatSP ?? 0, color: '#26a69a' },
    { key: 'inQaSP', label: 'QA', value: burndown.inQaSP ?? 0, color: '#7e57c2' },
    { key: 'inReviewSP', label: 'Review', value: burndown.inReviewSP ?? 0, color: '#5c6bc0' },
    { key: 'inProgressSP', label: 'In Progress', value: burndown.inProgressSP ?? 0, color: '#42a5f5' },
    { key: 'todoSP', label: 'To Do', value: burndown.todoSP ?? 0, color: '#bdbdbd' },
    { key: 'blockedSP', label: 'Blocked', value: burndown.blockedSP ?? 0, color: '#ef5350' },
    { key: 'reopenedSP', label: 'Reopened', value: burndown.reopenedSP ?? 0, color: '#ff7043' },
  ];

  const total = lanes.reduce((acc, l) => acc + l.value, 0);
  if (total === 0) {
    return (
      <Box
        sx={{
          height: 10,
          bgcolor: 'grey.200',
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="caption" color="text.secondary">No story points</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', height: 10, borderRadius: 1, overflow: 'hidden' }}>
        {lanes.filter(l => l.value > 0).map(lane => (
          <Tooltip key={lane.key} title={`${lane.label}: ${lane.value} SP (${Math.round((lane.value / total) * 100)}%)`}>
            <Box
              sx={{
                width: `${(lane.value / total) * 100}%`,
                bgcolor: lane.color,
                cursor: 'help',
              }}
            />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        {lanes.filter(l => l.value > 0).map(l => (
          <Box key={l.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 8, height: 8, bgcolor: l.color, borderRadius: 0.5 }} />
            <Typography variant="caption" color="text.secondary">{l.label}: {l.value}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};
