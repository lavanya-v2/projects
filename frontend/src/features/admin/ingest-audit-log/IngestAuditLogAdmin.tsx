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
  Chip,
  Button,
  Alert,
  CircularProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import { useIngestAuditLog, type AuditLogRow } from './hooks';

const NAVY = '#002e5b';
const BORDER = '#e0e4ea';

const OUTCOME_COLOR: Record<string, { bg: string; fg: string }> = {
  accepted: { bg: '#e8f5e9', fg: '#2e7d32' },
  'rejected-auth': { bg: '#fde8e8', fg: '#c62828' },
  'rejected-consent': { bg: '#fde8e8', fg: '#c62828' },
  'rejected-rate-limit': { bg: '#fff4e5', fg: '#b26a00' },
  'rejected-payload': { bg: '#fde8e8', fg: '#c62828' },
  'rejected-integrity': { bg: '#fde8e8', fg: '#c62828' },
  'rejected-org-required': { bg: '#fff4e5', fg: '#b26a00' },
  'rejected-org-not-monitored': { bg: '#fff4e5', fg: '#b26a00' },
  'rejected-outdated-collector': { bg: '#fff4e5', fg: '#b26a00' },
};

const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function OutcomeChip({ outcome, httpStatus }: { outcome: string; httpStatus: number }) {
  const c = OUTCOME_COLOR[outcome] || { bg: '#eef2f7', fg: '#41607f' };
  return (
    <Chip
      label={`${outcome} · ${httpStatus}`}
      size="small"
      sx={{ bgcolor: c.bg, color: c.fg, fontWeight: 600, fontSize: 11 }}
    />
  );
}

// VPN gate Stage 2 — 'confirmed clear' and 'unverified' need to be immediately
// scannable here, not buried in the payload dialog. Green = the check ran and
// found no VPN; amber = it sent without being able to check at all; red = the
// gate was switched off in config; grey = unknown (predates the gate, or the
// row was rejected before the payload validated).
const GATE_DISPLAY: Record<string, { label: string; bg: string; fg: string }> = {
  enforced: { label: 'confirmed clear', bg: '#e8f5e9', fg: '#2e7d32' },
  'allowed-after-failed-check': { label: 'unverified', bg: '#fff4e5', fg: '#b26a00' },
  disabled: { label: 'gate disabled', bg: '#fde8e8', fg: '#c62828' },
};

function VpnGateChip({ vpnGate }: { vpnGate: string | null }) {
  if (!vpnGate) {
    return <Typography sx={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>—</Typography>;
  }
  const d = GATE_DISPLAY[vpnGate] || { label: vpnGate, bg: '#eef2f7', fg: '#41607f' };
  return <Chip label={d.label} size="small" sx={{ bgcolor: d.bg, color: d.fg, fontWeight: 600, fontSize: 11 }} />;
}

export function IngestAuditLogAdmin() {
  const [view, setView] = useState<'default' | 'all'>('default');
  const { data: rows, isLoading, isError } = useIngestAuditLog(view === 'all');
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (isError) return <Alert severity="error">Failed to load the ingest audit log.</Alert>;

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: NAVY }}>Audit Log</Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mt: 0.5, mb: 2, maxWidth: 820 }}>
        One row per ingest ATTEMPT — accepted or rejected — including unauthenticated and malformed
        pushes. Append-only: re-pushing the same day shows up as multiple rows here even though only
        the latest is stored in the daily report. Visible rows are scoped to projects you personally
        have access to, even though this screen is superuser-only. VPN Gate shows how each push's
        VPN check actually went: "confirmed clear" means it ran and found no VPN, "unverified" means
        it sent anyway because the check itself couldn't run — worth a look if it shows up often for
        the same person.
      </Typography>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={view}
        onChange={(_, v) => v && setView(v)}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="default">Hide rate-limit noise</ToggleButton>
        <ToggleButton value="all">All outcomes</ToggleButton>
      </ToggleButtonGroup>
      {view === 'default' && (
        <Typography sx={{ fontSize: 11.5, color: '#9ca3af', mt: -1.5, mb: 1.5 }}>
          Rate-limited (429) attempts are hidden by default — mostly IDE-restart/session-hook noise,
          not usually worth reviewing. Switch to "All outcomes" to see them.
        </Typography>
      )}

      <Paper elevation={0} sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer sx={{ maxHeight: 640 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['Received', 'User', 'Day', 'Collector', 'VPN Gate', 'Outcome', ''].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 600, fontSize: 12, color: NAVY, bgcolor: '#fafbfc' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {(rows ?? []).map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ fontSize: 12.5, color: '#374151', whiteSpace: 'nowrap' }}>{fmtDateTime(r.receivedAt)}</TableCell>
                  <TableCell sx={{ fontSize: 13 }}>
                    {r.name ? (
                      <>
                        <Box sx={{ fontWeight: 500 }}>{r.name}</Box>
                        <Box sx={{ fontSize: 11, color: '#6b7280' }}>{r.login}</Box>
                      </>
                    ) : (
                      <Box sx={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>unresolved token</Box>
                    )}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12.5, color: '#374151' }}>{r.day ?? '—'}</TableCell>
                  <TableCell sx={{ fontSize: 12, color: '#6b7280' }}>{r.collectorVersion ?? '—'}</TableCell>
                  <TableCell><VpnGateChip vpnGate={r.vpnGate} /></TableCell>
                  <TableCell><OutcomeChip outcome={r.outcome} httpStatus={r.httpStatus} /></TableCell>
                  <TableCell>
                    {r.payload && (
                      <Button size="small" onClick={() => setDetail(r)} sx={{ textTransform: 'none', fontSize: 12 }}>
                        View payload
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!(rows ?? []).length && (
                <TableRow>
                  <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: '#6b7280', fontSize: 13 }}>
                    No ingest attempts recorded yet for the projects you have access to.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700, color: NAVY }}>
          Payload — {detail?.name ?? 'unresolved'} · {detail?.day ?? ''}
        </DialogTitle>
        <DialogContent>
          <Box
            component="pre"
            sx={{
              fontSize: 12,
              fontFamily: 'monospace',
              bgcolor: '#f7f9fc',
              border: `1px solid ${BORDER}`,
              borderRadius: 1,
              p: 1.5,
              overflow: 'auto',
              maxHeight: 420,
            }}
          >
            {detail ? JSON.stringify(detail.payload, null, 2) : ''}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}

export default IngestAuditLogAdmin;
