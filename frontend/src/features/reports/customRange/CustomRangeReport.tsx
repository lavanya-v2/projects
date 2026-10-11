import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { useAccount } from '../../../context/UseAccount';
import {
  apiErrorMessage,
  useCustomRangeProjects,
  useDownloadCustomRange,
  useGenerateCustomRange,
} from './hooks';
import type { CustomRangeReportData } from './types';

dayjs.extend(utc);
dayjs.extend(timezone);

const HEALTH_COLOR: Record<string, string> = { Green: '#4caf50', Amber: '#ff9800', Red: '#f44336' };
const PRESETS = [5, 7, 14];

// The backend validates against today's date in IST, so the picker does too.
const todayIst = () => dayjs().tz('Asia/Kolkata').format('YYYY-MM-DD');
// A typed or pasted future date snaps to today: the native max only limits the picker.
const clampToToday = (d: string) => (d && d > todayIst() ? todayIst() : d);
const fmt = (d: string) => dayjs(d).format('D MMM YYYY');
const fmtShort = (d: string) => dayjs(d).format('D MMM');

const spanDays = (start: string, end: string) => dayjs(end).diff(dayjs(start), 'day') + 1;

const sectionTitleSx = { pb: 0.75, mb: 1.5, borderBottom: '2px solid #1976d2', fontWeight: 600 } as const;

export const CustomRangeReport = () => {
  const { activeAccount } = useAccount();
  const projectsQuery = useCustomRangeProjects(activeAccount?.id);
  const generate = useGenerateCustomRange();
  const download = useDownloadCustomRange();

  const maxDays = projectsQuery.data?.maxDays ?? 15;
  const projects = projectsQuery.data?.projects ?? [];

  const [selectedProjectId, setProjectId] = useState<number | ''>('');
  const [endDate, setEndDate] = useState(todayIst());
  const [startDate, setStartDate] = useState(dayjs(todayIst()).subtract(6, 'day').format('YYYY-MM-DD'));
  const [generated, setReport] = useState<CustomRangeReportData | null>(null);

  // Switching account changes the project list; drop a selection or report from another account.
  const projectId = projects.some(p => p.id === selectedProjectId) ? selectedProjectId : '';
  const report = generated && projects.some(p => p.id === generated.project.id) ? generated : null;

  const rangeError = useMemo(() => {
    if (!startDate || !endDate) return 'Select a start and end date.';
    if (startDate > endDate) return 'The start date must not be after the end date.';
    if (startDate > todayIst() || endDate > todayIst()) return 'Future dates cannot be selected.';
    const days = spanDays(startDate, endDate);
    if (days > maxDays) return `The selected range is ${days} days. Pick a window of ${maxDays} calendar days or fewer.`;
    return null;
  }, [startDate, endDate, maxDays]);

  const canRun = projectId !== '' && !rangeError && !generate.isPending;

  const applyPreset = (days: number) => {
    const end = todayIst();
    setEndDate(end);
    setStartDate(dayjs(end).subtract(days - 1, 'day').format('YYYY-MM-DD'));
  };

  const run = () => {
    if (projectId === '') return;
    setReport(null);
    generate.mutate({ projectId, startDate, endDate }, { onSuccess: setReport });
  };

  const downloadAs = (format: 'txt' | 'eml') => {
    if (!report) return;
    download.mutate({
      params: { projectId: report.project.id, startDate: report.window.startDate, endDate: report.window.endDate },
      format,
    });
  };

  const currentDays = !startDate || !endDate ? 0 : spanDays(startDate, endDate);

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 1.5, md: 3 } }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Consolidated progress for up to {maxDays} calendar days, built from existing Daily reports. Nothing is stored.
      </Typography>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-end' }}>
          <TextField
            select
            size="small"
            label="Project"
            value={projectId}
            onChange={e => setProjectId(Number(e.target.value))}
            sx={{ minWidth: 280 }}
            disabled={projectsQuery.isLoading}
            helperText={projectsQuery.isLoading ? 'Loading projects...' : projects.length === 0 ? 'No projects assigned to you' : ' '}
          >
            {projects.map(p => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}{p.accountName ? ` (${p.accountName})` : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="date"
            label="From"
            value={startDate}
            onChange={e => setStartDate(clampToToday(e.target.value))}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: endDate && endDate < todayIst() ? endDate : todayIst() } }}
            helperText=" "
          />
          <TextField
            size="small"
            type="date"
            label="To"
            value={endDate}
            onChange={e => setEndDate(clampToToday(e.target.value))}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: todayIst() } }}
            helperText="Latest selectable date: today (IST)"
          />
          <Button variant="contained" onClick={run} disabled={!canRun} sx={{ mb: 2.75 }}>
            {generate.isPending ? <CircularProgress size={20} color="inherit" /> : 'Generate report'}
          </Button>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="caption" color="text.secondary">Quick range:</Typography>
          {PRESETS.map(d => (
            <Chip
              key={d}
              size="small"
              label={`Last ${d} days`}
              onClick={() => applyPreset(d)}
              color={currentDays === d && endDate === todayIst() ? 'primary' : 'default'}
              variant={currentDays === d && endDate === todayIst() ? 'filled' : 'outlined'}
            />
          ))}
          <Typography variant="caption" color="text.secondary">
            Window is limited to {maxDays} calendar days.
          </Typography>
        </Box>
      </Paper>

      {rangeError && <Alert severity="error" sx={{ mb: 2 }}>{rangeError}</Alert>}
      {generate.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {apiErrorMessage(generate.error, 'Failed to generate the report. Please try again.')}
        </Alert>
      )}
      {download.isError && <Alert severity="error" sx={{ mb: 2 }}>The download failed. Please try again.</Alert>}

      {report && <ReportBody report={report} onDownload={downloadAs} downloading={download.isPending} />}
    </Box>
  );
};

const ReportBody = ({
  report,
  onDownload,
  downloading,
}: {
  report: CustomRangeReportData;
  onDownload: (f: 'txt' | 'eml') => void;
  downloading: boolean;
}) => {
  const hasData = report.snapshotCount > 0;
  const { counts } = report.health;
  const timeline = new Map(report.healthTimeline.map(h => [h.date, h.health]));
  const days: string[] = [];
  for (let d = dayjs(report.window.startDate); !d.isAfter(dayjs(report.window.endDate)); d = d.add(1, 'day')) {
    days.push(d.format('YYYY-MM-DD'));
  }

  if (!hasData) {
    return (
      <Alert severity="info">
        No Daily reports exist for {report.project.name} between {fmt(report.window.startDate)} and {fmt(report.window.endDate)}.
      </Alert>
    );
  }

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
          <Box>
            <Typography variant="h6">
              {report.project.name}: {fmtShort(report.window.startDate)} to {fmt(report.window.endDate)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {report.calendarDays} calendar days, {report.snapshotCount} daily reports found
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">Health for the range:</Typography>
              <Chip
                size="small"
                label={report.health.status}
                sx={{ bgcolor: HEALTH_COLOR[report.health.status] ?? '#9e9e9e', color: '#fff', fontWeight: 600 }}
              />
              <Typography variant="caption" color="text.secondary">
                avg {report.health.avg.toFixed(2)} over {report.health.scoredDays} scored day
                {report.health.scoredDays === 1 ? '' : 's'} ({counts.Green} Green, {counts.Amber} Amber, {counts.Red} Red). Same rule as the weekly project status.
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Button variant="outlined" size="small" disabled={downloading} onClick={() => onDownload('txt')}>Download .txt</Button>
            {/* .eml download is hidden for now; onDownload('eml') and the backend route still work. */}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1.5 }}>
          {days.map(d => {
            const h = timeline.get(d);
            return (
              <Box
                key={d}
                title={`${fmt(d)}: ${h ?? 'No daily report'}`}
                sx={{
                  width: 34, height: 34, borderRadius: 0.5, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11,
                  bgcolor: h ? HEALTH_COLOR[h] ?? '#9e9e9e' : '#e0e0e0', color: h ? '#fff' : '#777',
                }}
              >
                {dayjs(d).format('D')}
                <span>{h ? h[0] : '-'}</span>
              </Box>
            );
          })}
        </Box>
      </Paper>

      {report.missingDates.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          No Daily report exists for {report.missingDates.map(fmtShort).join(', ')}. Anything that happened only on those days is not reflected.
        </Alert>
      )}
      {report.achievements.source === 'fallback' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          The narrative below was compiled from the latest daily summary without AI because AI composition was unavailable. Wording may differ once AI composition succeeds.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>Achievements</Typography>
        <Achievements text={report.achievements.text} />
        <Typography variant="caption" color="text.secondary">
          Only the latest state of each item is reported. Intermediate progress between the selected dates is deliberately omitted.
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>Blockers and Risks</Typography>
        <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>Still blocked at end of range</Typography>
        {report.blockers.length === 0 ? (
          <Typography variant="body2" sx={{ mb: 1.5 }}>None.</Typography>
        ) : (
          <Table size="small" sx={{ mb: 1.5 }}>
            <TableHead>
              <TableRow>
                <TableCell>Ticket</TableCell><TableCell>Summary</TableCell><TableCell>Status</TableCell>
                <TableCell>Assignee</TableCell><TableCell>Blocked since</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.blockers.map(b => (
                <TableRow key={b.key}>
                  <TableCell>{b.key}</TableCell>
                  <TableCell>{b.summary}</TableCell>
                  <TableCell>{b.status}</TableCell>
                  <TableCell>{b.assignee || '-'}</TableCell>
                  <TableCell>{b.blockedSince ? fmtShort(b.blockedSince) : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
          Risks{report.risks.asOf ? ` (latest daily report, ${fmtShort(report.risks.asOf)})` : ''}
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{report.risks.text || 'None reported.'}</Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={sectionTitleSx}>Ticket Details</Typography>
        {report.tickets.length === 0 ? (
          <Typography variant="body2">No ticket details available for this range.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 110 }}>Ticket</TableCell>
                <TableCell sx={{ width: 100 }}>Type</TableCell>
                <TableCell sx={{ width: 140 }}>Status</TableCell>
                <TableCell>Description (latest report)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.tickets.map(t => (
                <TableRow key={t.key}>
                  <TableCell>{t.key}</TableCell>
                  <TableCell>{t.issueType}</TableCell>
                  <TableCell>{t.status}</TableCell>
                  <TableCell>{t.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          One row per ticket, taken from the latest daily report it appears in. Sorted by ticket key.
        </Typography>
      </Paper>
    </>
  );
};

/** Renders the narrative: lines starting with ## are theme headings, other lines are paragraphs. */
const Achievements = ({ text }: { text: string }) => {
  if (!text) return <Typography variant="body2" sx={{ mb: 1 }}>No achievements recorded for this range.</Typography>;
  return (
    <Box sx={{ mb: 1 }}>
      {text.split(/\n+/).filter(Boolean).map((line, i) => {
        const m = line.match(/^##\s*(.*)$/);
        return m ? (
          <Typography key={i} variant="body2" fontWeight={600} sx={{ mt: i === 0 ? 0 : 1.5 }}>{m[1]}</Typography>
        ) : (
          <Typography key={i} variant="body2" sx={{ lineHeight: 1.6 }}>{line}</Typography>
        );
      })}
    </Box>
  );
};
