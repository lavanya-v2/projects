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
  Tooltip,
  Button,
  Alert,
  CircularProgress,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import { useFlaggedRows, useAcknowledgeFlag, type IntegrityFlag } from './hooks';

const NAVY = '#002e5b';
const BORDER = '#e0e4ea';

const SEV_COLOR: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#fde8e8', fg: '#c62828' },
  medium: { bg: '#fff4e5', fg: '#b26a00' },
  low: { bg: '#eef2f7', fg: '#41607f' },
};

const fmtNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString());

function FlagChips({ flags }: { flags: IntegrityFlag[] }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {flags.map((f, i) => {
        const c = SEV_COLOR[f.severity] || SEV_COLOR.low;
        return (
          <Tooltip key={i} title={f.detail} arrow>
            <Chip label={f.code} size="small" sx={{ bgcolor: c.bg, color: c.fg, fontWeight: 600, fontSize: 11 }} />
          </Tooltip>
        );
      })}
    </Box>
  );
}

/**
 * How the reporting machine is triggered. This is here because a *missing* row is
 * ambiguous — a broken schedule and a day off look identical — so without it a
 * member can quietly stop reporting for weeks and nothing on screen says so.
 * Only 'scheduler' guarantees a row on every working day.
 */
const TRIGGER_INFO: Record<string, { label: string; bg: string; fg: string; tip: string }> = {
  scheduler: {
    label: 'daily job', bg: '#e8f5e9', fg: '#2e7d32',
    tip: 'A real weekday OS job. Reports even on days this person never opens Claude Code.',
  },
  startup: {
    label: 'at login', bg: '#fff4e5', fg: '#b26a00',
    tip: 'Fallback: runs when they log in, not on a fixed schedule. A machine left on for days may not report.',
  },
  hook: {
    label: 'session only', bg: '#fde8e8', fg: '#c62828',
    tip: 'Only reports when a Claude session ends. A day with no Claude use sends nothing at all — ask them to re-run the installer.',
  },
  none: {
    label: 'no trigger', bg: '#fde8e8', fg: '#c62828',
    tip: 'Nothing is scheduled. This machine will stop reporting.',
  },
};

function TriggerChip({ tier }: { tier: string | null }) {
  if (!tier) {
    return (
      <Tooltip title="Collector predates this signal — re-running the installer will report it." arrow>
        <Chip label="unknown" size="small" sx={{ bgcolor: '#eef2f7', color: '#41607f', fontSize: 11 }} />
      </Tooltip>
    );
  }
  const i = TRIGGER_INFO[tier] ?? TRIGGER_INFO.none;
  return (
    <Tooltip title={i.tip} arrow>
      <Chip label={i.label} size="small" sx={{ bgcolor: i.bg, color: i.fg, fontWeight: 600, fontSize: 11 }} />
    </Tooltip>
  );
}

export function DataQualityAdmin() {
  const [status, setStatus] = useState<'flagged' | 'all'>('flagged');
  const { data: rows, isLoading, isError } = useFlaggedRows(status);
  const ack = useAcknowledgeFlag();

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  if (isError) return <Alert severity="error">Failed to load data quality flags.</Alert>;

  return (
    <Box>
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: NAVY }}>Data Quality</Typography>
      <Typography sx={{ fontSize: 13, color: '#6b7280', mt: 0.5, mb: 2, maxWidth: 820 }}>
        Usage is self-reported from each engineer&rsquo;s machine, so Lens can&rsquo;t cryptographically
        prove the numbers. Impossible values (failing arithmetic checks) are rejected at ingest; the rows
        below merely look <b>implausible</b> and are surfaced for a human glance. This is a coaching signal,
        not an audit &mdash; treat flags as &ldquo;worth a look&rdquo;, not proof of anything.
      </Typography>

      <ToggleButtonGroup
        size="small"
        exclusive
        value={status}
        onChange={(_, v) => v && setStatus(v)}
        sx={{ mb: 2 }}
      >
        <ToggleButton value="flagged">Flagged only</ToggleButton>
        <ToggleButton value="all">All rows</ToggleButton>
      </ToggleButtonGroup>

      <Paper elevation={0} sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {['User', 'Day', 'Reporting', 'Why flagged', 'Avg score', 'Prompts', 'Tokens', 'Vibe', ''].map((h) => (
                  <TableCell key={h} sx={{ fontWeight: 600, fontSize: 12, color: NAVY, bgcolor: '#fafbfc' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {(rows ?? []).map((r) => (
                <TableRow key={`${r.userId}-${r.day}`} hover>
                  <TableCell sx={{ fontSize: 13 }}>
                    <Box sx={{ fontWeight: 500 }}>{r.name}</Box>
                    <Box sx={{ fontSize: 11, color: '#6b7280' }}>{r.login}</Box>
                  </TableCell>
                  <TableCell sx={{ fontSize: 12.5, color: '#374151' }}>{r.day}</TableCell>
                  <TableCell><TriggerChip tier={r.triggerTier} /></TableCell>
                  <TableCell>{r.flags.length ? <FlagChips flags={r.flags} /> : <Chip label="ok" size="small" sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontSize: 11 }} />}</TableCell>
                  {/* No prompts means nothing was scored — show that, rather than the
                      stored 0, which reads as a genuine score of zero. */}
                  <TableCell sx={{ fontSize: 12.5 }}>
                    {r.totalPrompts > 0 ? r.avgScore : <Box component="span" sx={{ color: '#9ca3af' }}>&mdash;</Box>}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12.5 }}>{r.totalPrompts}</TableCell>
                  <TableCell sx={{ fontSize: 12.5 }}>{fmtNum(r.tokens)}</TableCell>
                  <TableCell sx={{ fontSize: 12.5 }}>{r.vibeIndex}</TableCell>
                  <TableCell>
                    {r.flags.length > 0 && (
                      <Button
                        size="small"
                        disabled={ack.isPending}
                        onClick={() => ack.mutate({ userId: r.userId, day: r.day })}
                        sx={{ textTransform: 'none', fontSize: 12 }}
                      >
                        Acknowledge
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!(rows ?? []).length && (
                <TableRow>
                  <TableCell colSpan={9} sx={{ textAlign: 'center', py: 4, color: '#6b7280', fontSize: 13 }}>
                    Nothing flagged — all ingested rows look plausible.
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

export default DataQualityAdmin;
