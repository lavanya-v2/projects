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
  Alert,
  CircularProgress,
} from '@mui/material';
import { useCollectorInstalls, type CollectorInstallRow } from './hooks';

const NAVY = '#002e5b';
const BORDER = '#e0e4ea';

/** IST (Asia/Kolkata) regardless of the viewer's own machine timezone — the fleet
 * is India-based, so a fixed timezone reads consistently for every superuser. */
const fmtIST = (s: string | null) =>
  s
    ? `${new Date(s).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })} IST`
    : '—';

export function CollectorInstallsAdmin() {
  const { data, isLoading, isError } = useCollectorInstalls();
  const rows = data?.installs;
  const currentVersion = data?.currentVersion ?? null;
  const staleAfterDays = data?.staleAfterDays ?? 5;

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (isError) return <Alert severity="error">Failed to load collector installs.</Alert>;

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: NAVY }}>Installs</Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mt: 0.5, mb: 2, maxWidth: 780 }}>
        Everyone who has ever generated a collector token, and when they last synced —
        sorted most-recent-sync first, so a stale or never-synced install is easy to spot.
        An install with no contact in {staleAfterDays}+ days is flagged below — that can
        mean they're inactive, but it's also what a collector stuck treating itself as
        permanently on a VPN would look like, so it's worth a quick check either way.
        A revoked token means the person opted out or rotated it; it's kept here for history.
        Version is read from their most recent push, compared against{' '}
        {currentVersion ? <b>{currentVersion}</b> : 'the currently-served version'} — the
        collector has no auto-update, so after a fix ships, someone stays on the old version
        until they re-run the installer.
      </Typography>

      <Paper elevation={0} sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer sx={{ maxHeight: 640 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {['User', 'Token', 'Installed', 'Last sync (IST)', 'Version', 'Status'].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 600, fontSize: 12, color: NAVY, bgcolor: '#fafbfc' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {(rows ?? []).map((r: CollectorInstallRow) => {
                const outdated = !!r.collectorVersion && !!currentVersion && r.collectorVersion !== currentVersion;
                return (
                  <TableRow key={r.tokenId} hover>
                    <TableCell sx={{ fontSize: 13 }}>
                      {r.name} <Typography component="span" sx={{ fontSize: 11.5, color: '#6b7280' }}>({r.login})</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 11.5, fontFamily: 'monospace', color: '#6b7280' }}>…{r.lastFour ?? '????'}</TableCell>
                    <TableCell sx={{ fontSize: 12.5, color: '#6b7280' }}>{fmtIST(r.createdAt)}</TableCell>
                    <TableCell sx={{ fontSize: 12.5 }}>
                      <Box sx={{ color: r.lastSeenAt ? '#374151' : '#9ca3af', fontStyle: r.lastSeenAt ? 'normal' : 'italic' }}>
                        {r.lastSeenAt ? fmtIST(r.lastSeenAt) : 'Never synced'}
                      </Box>
                      {r.isStale && (
                        <Chip
                          label={`⚠ ${r.staleDays}d no contact`}
                          size="small"
                          sx={{ mt: 0.5, bgcolor: '#fde8e8', color: '#c62828', fontWeight: 600, fontSize: 10.5 }}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {r.collectorVersion ? (
                        <Chip
                          label={r.collectorVersion}
                          size="small"
                          sx={
                            outdated
                              ? { bgcolor: '#fff4e5', color: '#b26a00', fontWeight: 600, fontSize: 11, fontFamily: 'monospace' }
                              : { bgcolor: '#eef2f7', color: '#41607f', fontWeight: 600, fontSize: 11, fontFamily: 'monospace' }
                          }
                        />
                      ) : (
                        <Typography sx={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>unknown</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={r.revokedAt ? 'Revoked' : 'Active'}
                        size="small"
                        sx={
                          r.revokedAt
                            ? { bgcolor: '#fde8e8', color: '#c62828', fontWeight: 600, fontSize: 11 }
                            : { bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 600, fontSize: 11 }
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {!(rows ?? []).length && (
                <TableRow>
                  <TableCell colSpan={6} sx={{ textAlign: 'center', py: 4, color: '#6b7280', fontSize: 13 }}>
                    No one has installed the collector yet.
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

export default CollectorInstallsAdmin;
