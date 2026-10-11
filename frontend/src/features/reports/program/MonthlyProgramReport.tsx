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
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Snackbar,
  Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ScheduleSendIcon from '@mui/icons-material/ScheduleSend';
import DownloadIcon from '@mui/icons-material/Download';
import { useAccessiblePrograms, useProgramMonthlyReports, useQueueProgramMonthlyReport, downloadProgramMonthlyReport } from '../../programs/hooks';
import type { ProgramMonthlyReportRow } from '../../programs/types';
import ReportCompletenessBanner from '../shared/ReportCompletenessBanner';
import dayjs, { Dayjs } from 'dayjs';
import { DatePicker } from '@mui/x-date-pickers';
import type { Account } from '../../admin/accounts/types';

interface Props {
  accounts: Account[];
  selectedAccount?: Account | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const healthColor = (h?: string): 'success' | 'warning' | 'error' | 'default' => {
  if (h === 'Green') return 'success';
  if (h === 'Amber') return 'warning';
  if (h === 'Red') return 'error';
  return 'default';
};

export const MonthlyProgramReport = ({ accounts: _accounts, selectedAccount }: Props) => {
  const accessibleQuery = useAccessiblePrograms();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const accessible = accessibleQuery.data ?? [];

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

  const reportsQuery = useProgramMonthlyReports(programId === '' ? null : programId, page, limit);
  const reports: ProgramMonthlyReportRow[] = reportsQuery.data?.reports ?? [];
  const total = reportsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const queueMutation = useQueueProgramMonthlyReport();
  const [genOpen, setGenOpen] = useState(false);
  const [genDate, setGenDate] = useState<Dayjs | null>(dayjs());
  const [monthError, setMonthError] = useState('');
  const [genError, setGenError] = useState('');
  const [toast, setToast] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' }>({
    open: false, msg: '', severity: 'success',
  });

  const handleQueue = async () => {
    setGenError('');
    if (!programId) {
      setGenError('Pick a program.');
      return;
    }
    if(!genDate){
      setGenError('Month/Year are required')
      return;
    }
    try {
      const m = genDate.month() + 1;
      const y = genDate.year();
      await queueMutation.mutateAsync({ programId: Number(programId), month: m, year: y });
      setGenOpen(false);
      setToast({ open: true, msg: 'Queued — refresh in a minute to view the new report.', severity: 'success' });
    } catch (err) {
        const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
        setGenError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to queue report.');
    }
  };

  const handleGenMonth = (reportDate: dayjs.Dayjs | null) => {
    if (reportDate && reportDate.isValid()) {
      setGenDate(reportDate);
      if (reportDate && dayjs(reportDate).isAfter(dayjs())) {
          setMonthError('Date cannot be future.');
      } else if (reportDate && dayjs(reportDate).isBefore(dayjs().subtract(6, 'M'))) {
          setMonthError('Date not valid.');
      } else {
          setMonthError('');
      }
    } else if (!reportDate) {
      setGenDate(null);
      setMonthError('');
    }
    return reportDate;
  }

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
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Monthly Program Report</Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
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
            .filter((a) => accountIdsWithPrograms.has(Number(a.id)))
            .map((a) => (
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

        <Box sx={{ flexGrow: 1 }} />

        <Tooltip title="Queues a background job. Refresh after a minute to see the new report.">
          <span>
            <Button
              variant="contained"
              startIcon={<ScheduleSendIcon />}
              disabled={!programId}
              onClick={() => {setGenOpen(true); setGenDate(dayjs()); setMonthError('');}}
            >
              Queue Generation
            </Button>
          </span>
        </Tooltip>
      </Box>

      {!programId ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
          <Typography color="text.secondary">Select a program to view its monthly reports.</Typography>
        </Paper>
      ) : reportsQuery.isFetching ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
      ) : reports.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
          <Typography color="text.secondary">No reports generated yet.</Typography>
        </Paper>
      ) : (
        <>
          {reports.map(r => <MonthlyReportCard key={r.id} report={r} />)}
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination count={totalPages} page={page} onChange={(_, v) => setPage(v)} />
            </Box>
          )}
        </>
      )}

      <Dialog open={genOpen} onClose={() => setGenOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Generate Program Monthly Report</DialogTitle>
        <DialogContent dividers>
          {genError && <Alert severity="error" sx={{ mb: 2 }}>{genError}</Alert>}
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
              <DatePicker
                label="Month & Year"
                value={genDate}
                onChange={handleGenMonth}
                views={['month', 'year']}
                minDate={dayjs().subtract(6, 'M')} maxDate={dayjs()}
                slotProps={{ textField: { fullWidth: true, required: true, helperText: monthError, error: Boolean(monthError) } }}
              />
              <Typography variant="caption" color="textSecondary">
                  This will aggregate all monthly project reports for the selected account and month, then generate a consolidated executive summary and PPT.
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenOpen(false)}>Cancel</Button>
          <Button onClick={handleQueue} variant="contained" disabled={queueMutation.isPending || !genDate || Boolean(monthError)}>
            {queueMutation.isPending ? 'Queuing…' : 'Queue'}
          </Button>
        </DialogActions>
      </Dialog>

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

interface CardProps { report: ProgramMonthlyReportRow }
const MonthlyReportCard = ({ report }: CardProps) => {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const risksItems = Array.isArray((report.risks as any)?.items)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (report.risks as any).items
    : Array.isArray(report.risks)
      ? (report.risks as string[])
      : typeof report.risks === 'string'
        ? [report.risks]
        : [];

  // Reports predating PPT support regenerate the deck on demand, so this can be slow.
  const handleDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadProgramMonthlyReport(report.programId, report.month, report.year);
    } catch {
      setDownloadError('Could not download the deck. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card sx={{
      mb: 2,
      borderLeft: '4px solid',
      borderColor: theme => {
        const c = healthColor(report.health);
        if (c === 'success') return theme.palette.success.main;
        if (c === 'warning') return theme.palette.warning.main;
        if (c === 'error') return theme.palette.error.main;
        return theme.palette.grey[400];
      },
    }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
          <Typography variant="h6">
            {MONTH_NAMES[report.month - 1]} {report.year}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {report.health && (
            <Chip label={report.health} color={healthColor(report.health) === 'default' ? undefined : healthColor(report.health)} />
          )}
          <Button
            size="small"
            startIcon={downloading ? <CircularProgress size={14} /> : <DownloadIcon />}
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? 'Preparing…' : 'Download PPT'}
          </Button>
        </Box>

        {downloadError && <Alert severity="error" sx={{ mb: 2 }}>{downloadError}</Alert>}

        <ReportCompletenessBanner projectsMissing={report.projectsMissing} />

        {report.summary && (
          <Typography variant="body2" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>{report.summary}</Typography>
        )}

        <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">Details</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {report.keyAccomplishments && report.keyAccomplishments.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Key accomplishments</Typography>
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

              {report.annexure && report.annexure.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Annexure</Typography>
                  {report.annexure.map((a, i) => (
                    <Box key={i} sx={{ mb: 1 }}>
                      <Typography variant="body2" fontWeight={600}>{a.title}</Typography>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {a.points.map((p, j) => <li key={j}><Typography variant="body2">{p}</Typography></li>)}
                      </ul>
                    </Box>
                  ))}
                </Box>
              )}

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {(report.projectsIncluded ?? []).map((n, i) => (
                  <Chip key={`inc-${i}`} size="small" label={n} color="success" variant="outlined" />
                ))}
                {(report.projectsMissing ?? []).map((n, i) => (
                  <Chip key={`miss-${i}`} size="small" label={`${n} (missing)`} color="warning" variant="outlined" />
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
      </CardContent>
    </Card>
  );
};
