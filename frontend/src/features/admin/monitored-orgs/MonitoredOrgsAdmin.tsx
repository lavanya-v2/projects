import { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Switch,
  Chip,
  Alert,
  CircularProgress,
  Select,
  MenuItem,
  TextField,
} from '@mui/material';
import { useMonitoredOrgs, useSetOrgEnabled, useSetOrgLicense, type MonitoredOrg } from './hooks';

const NAVY = '#002e5b';
const BORDER = '#e0e4ea';

const fmtDate = (s: string) =>
  new Date(s).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Inline editors for the VALUE view economics. Blank/'Benchmark' clears the override
// so the report falls back to the global assumed seat benchmark.
function LicenseCells({ o }: { o: MonitoredOrg }) {
  const setLicense = useSetOrgLicense();
  const [seat, setSeat] = useState(o.seatMonthlyUsd != null ? String(o.seatMonthlyUsd) : '');

  return (
    <>
      <TableCell>
        <Select
          size="small"
          value={o.licenseType ?? ''}
          displayEmpty
          disabled={setLicense.isPending}
          onChange={(e) =>
            setLicense.mutate({ orgUuid: o.orgUuid, licenseType: (e.target.value || null) as 'seat' | 'api' | null })
          }
          sx={{ fontSize: 12.5, minWidth: 120 }}
        >
          <MenuItem value=""><em>Benchmark</em></MenuItem>
          <MenuItem value="seat">Seat / subscription</MenuItem>
          <MenuItem value="api">API / consumption</MenuItem>
        </Select>
      </TableCell>
      <TableCell>
        <TextField
          size="small"
          type="number"
          placeholder="benchmark"
          value={seat}
          disabled={setLicense.isPending}
          onChange={(e) => setSeat(e.target.value)}
          onBlur={() => {
            const next = seat.trim() === '' ? null : Number(seat);
            const prev = o.seatMonthlyUsd;
            if (next !== prev) setLicense.mutate({ orgUuid: o.orgUuid, seatMonthlyUsd: next });
          }}
          sx={{ width: 110, '& input': { fontSize: 12.5 } }}
        />
      </TableCell>
    </>
  );
}

export function MonitoredOrgsAdmin() {
  const { data: orgs, isLoading, isError } = useMonitoredOrgs();
  const setEnabled = useSetOrgEnabled();

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (isError) return <Alert severity="error">Failed to load monitored organizations.</Alert>;

  const pending = (orgs ?? []).filter((o) => !o.enabled).length;

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: NAVY }}>Monitored Organizations</Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mt: 0.5, mb: 2, maxWidth: 780 }}>
        Only usage from an <b>enabled</b> customer Claude organization is stored. A machine reports the org
        it's currently signed into (from Claude's account file — never its tokens). New orgs appear here as
        <b> pending</b> and are rejected until you enable them, so personal or non-customer accounts are
        blocked automatically.
      </Typography>

      {pending > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {pending} organization{pending === 1 ? '' : 's'} pending review. Enable the ones that are legitimate
          customer licenses.
        </Alert>
      )}

      <Paper elevation={0} sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {['Organization', 'Org UUID', 'First seen', 'Status', 'Monitor', 'License', 'Seat $/mo'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 600, fontSize: 12, color: NAVY, bgcolor: '#fafbfc' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {(orgs ?? []).map((o) => (
                <TableRow key={o.orgUuid} hover>
                  <TableCell sx={{ fontSize: 13, fontWeight: 500 }}>{o.orgName || '(unnamed)'}</TableCell>
                  <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace', color: '#6b7280' }}>{o.orgUuid}</TableCell>
                  <TableCell sx={{ fontSize: 12.5, color: '#6b7280' }}>{fmtDate(o.firstSeenAt)}</TableCell>
                  <TableCell>
                    {o.enabled
                      ? <Chip label="Monitored" size="small" sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 600, fontSize: 11 }} />
                      : <Chip label="Pending" size="small" sx={{ bgcolor: '#fff4e5', color: '#b26a00', fontWeight: 600, fontSize: 11 }} />}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={o.enabled}
                      disabled={setEnabled.isPending}
                      onChange={(e) => setEnabled.mutate({ orgUuid: o.orgUuid, enabled: e.target.checked })}
                      color="success"
                    />
                  </TableCell>
                  <LicenseCells o={o} />
                </TableRow>
              ))}
              {!(orgs ?? []).length && (
                <TableRow>
                  <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: '#6b7280', fontSize: 13 }}>
                    No organizations have reported yet. They appear here the first time a collector pushes.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
}

export default MonitoredOrgsAdmin;
