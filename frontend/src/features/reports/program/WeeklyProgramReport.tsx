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
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { Dayjs } from 'dayjs';
import { useAccessiblePrograms, useProgramWeeklyReports, useQueueProgramWeeklyReport, downloadProgramWeeklyReport } from '../../programs/hooks';
import type { ProgramWeeklyReportRow } from '../../programs/types';
import ReportCompletenessBanner from '../shared/ReportCompletenessBanner';
import type { Account } from '../../admin/accounts/types';

interface Props {
  accounts: Account[];
  selectedAccount?: Account | null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const healthColor = (h?: string): 'success' | 'warning' | 'error' | 'default' => {
  if (h === 'Green') return 'success';
  if (h === 'Amber') return 'warning';
  if (h === 'Red') return 'error';
  return 'default';
};

export const WeeklyProgramReport = ({ accounts, selectedAccount }: Props) => {
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

  const reportsQuery = useProgramWeeklyReports(programId === '' ? null : programId, page, limit);
  const reports: ProgramWeeklyReportRow[] = reportsQuery.data?.reports ?? [];
  const total = reportsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const queueMutation = useQueueProgramWeeklyReport();
  const [genOpen, setGenOpen] = useState(false);
  const [startDate, setStartDate] = useState<Dayjs | null>(null);
  const [endDate, setEndDate] = useState<Dayjs | null>(null);
  const [startDateError, setStartDateError] = useState('');
  const [endDateError, setEndDateError] = useState('');
  // Default/validate against the selected account's configured cycle (Account.weekStartDay);
  // defaults to Friday when no account is selected yet.
  const selectedAccountForCycle = accountId !== '' ? accounts.find(a => Number(a.id) === Number(accountId)) : null;
  const weekStartDay = selectedAccountForCycle?.weekStartDay ?? 5;
  const expectedEndDayOfWeek = (weekStartDay + 6) % 7;
  const today = dayjs();
  const diffToFri = ((today.day() - weekStartDay + 7) % 7) + 7;
  const [genStart, setGenStart] = useState<Dayjs | null>(today.subtract(diffToFri, 'day'));
  const [genEnd, setGenEnd] = useState<Dayjs | null>(today.subtract(diffToFri, 'day').add(6, 'day'));
  const [genError, setGenError] = useState('');
  const [pageError, setPageError] = useState('');
  const [toast, setToast] = useState<{ open: boolean; msg: string; severity: 'success' | 'error' }>({
    open: false, msg: '', severity: 'success',
  });

  const StartDateHandler = (startDate: dayjs.Dayjs | null) => {
          setGenError('');
          if (startDate && startDate.isValid()) {
              setStartDate(startDate);
              if (startDate && dayjs(startDate).isAfter(dayjs())) {
                  setStartDateError('Date cannot be future.');
              } else if (startDate && dayjs(startDate).isBefore(dayjs().subtract(91, 'day'))) {
                  setStartDateError('Date not valid.');
              } else {
                  setGenStart(startDate);
                  setStartDateError('');
              }
          } else if (!startDate) {
              setStartDate(null);
              setStartDateError('Start Date is required.');
          }
          return startDate;
      }
  
  const EndDateHandler = (endDate: dayjs.Dayjs | null) => {
      setGenError('');
      if (endDate && endDate.isValid()) {
          setEndDate(endDate);
          if (endDate && dayjs(endDate).isAfter(dayjs())) {
              setEndDateError('Date cannot be future.');
          } else if (endDate && dayjs(endDate).isBefore(dayjs().subtract(91, 'day'))) {
              setEndDateError('Date not valid.');
          } else {
              setGenEnd(endDate);
              setEndDateError('');
          }
      } else if (!endDate) {
          setEndDate(null);
          setEndDateError('End Date is required.');
      }
      return endDate;
  }
  
  const handleQueue = async () => {
    setGenError('');
    if (!programId || !genStart || !genEnd) {
      setGenError(`Pick a program and a ${DAY_NAMES[weekStartDay]}-${DAY_NAMES[expectedEndDayOfWeek]} date range.`);
      return;
    }
    if (genStart.day() !== weekStartDay) {
      setStartDateError(`Start date must be a ${DAY_NAMES[weekStartDay]}.`);
      return;
    }
    if (genEnd.day() !== expectedEndDayOfWeek) {
      setEndDateError(`End date must be a ${DAY_NAMES[expectedEndDayOfWeek]}.`);
      return;
    }
    if (genStart.isAfter(genEnd, 'day')) {
      setGenError('Start Date cannot be after End Date.');
      return;
    }
    if (genEnd.startOf('day').diff(genStart.startOf('day'), 'day') !== 6) {
      setGenError('Report duration cannot exceed 7 days.');
      return;
    }
    try {
      await queueMutation.mutateAsync({
        programId: Number(programId),
        startDate: genStart.format('YYYY-MM-DD'),
        endDate: genEnd.format('YYYY-MM-DD'),
      });
      setGenOpen(false);
      setToast({ open: true, msg: 'Queued — refresh in a minute to view the new report.', severity: 'success' });
    } catch (err) {
      const errorWithResponse = err as { response?: { data?: { error?: string } }; message?: string };
      setGenError(errorWithResponse?.response?.data?.error || errorWithResponse?.message || 'Failed to queue report.');
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
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>Weekly Program Report</Typography>

      {pageError && <Alert severity="error" onClose={() => setPageError('')} sx={{ mb: 2 }}>{pageError}</Alert>}

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
          {(accounts ?? [])
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
              onClick={() => {setGenOpen(true);
                setStartDate(today.subtract(diffToFri, 'day'));
                setEndDate(today.subtract(diffToFri, 'day').add(6, 'day'));
                setStartDateError('');
                setEndDateError('');
                setGenError('')
              }}
            >
              Queue Generation
            </Button>
          </span>
        </Tooltip>
      </Box>

      {!programId ? (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: 'grey.50' }}>
          <Typography color="text.secondary">Select a program to view its weekly reports.</Typography>
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
          {reports.map(r => <WeeklyReportCard key={r.id} report={r} />)}
          {totalPages > 1 && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
              <Pagination count={totalPages} page={page} onChange={(_, v) => setPage(v)} />
            </Box>
          )}
        </>
      )}

      <Dialog open={genOpen} onClose={() => setGenOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Generate Program Weekly Report</DialogTitle>
        <DialogContent dividers>
          {genError && <Alert severity="error" sx={{ mb: 2 }}>{genError}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <DatePicker
              label={`Start Date (${DAY_NAMES[weekStartDay]})`}
              value={startDate}
              onChange={StartDateHandler}
              slotProps={{ textField: { fullWidth: true, required: true, helperText: startDateError, error: Boolean(startDateError) } }}
              maxDate={dayjs()}
              minDate={dayjs().subtract(90, 'day')}
            />
            <DatePicker
              label={`End Date (${DAY_NAMES[expectedEndDayOfWeek]} — same week)`}
              value={endDate}
              onChange={EndDateHandler}
              slotProps={{ textField: { fullWidth: true, required: true, helperText: endDateError, error: Boolean(endDateError) } }}
              maxDate={dayjs()}
              minDate={dayjs().subtract(90, 'day')}
            />
            <Typography variant="caption" color="text.secondary">
              Reports cover a {DAY_NAMES[weekStartDay]}-to-{DAY_NAMES[expectedEndDayOfWeek]} work week. Pick any {DAY_NAMES[weekStartDay]} from the last 90 days as the start date.
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGenOpen(false)}>Cancel</Button>
          <Button onClick={handleQueue} variant="contained" disabled={queueMutation.isPending || !startDate || !endDate || Boolean(startDateError) || Boolean(endDateError) || Boolean(genError)}>
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

interface CardProps { report: ProgramWeeklyReportRow }
const WeeklyReportCard = ({ report }: CardProps) => {
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
      await downloadProgramWeeklyReport(report.programId, report.weekNumber, report.year);
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
            Week {report.weekNumber} · {report.year}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            ({report.startDate} – {report.endDate})
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
