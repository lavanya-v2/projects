import { useMemo, useState } from 'react';
import {
    Alert,
    Box,
    CircularProgress,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';
import { useAiSpendSummary } from './hooks';
import type { SpendBucket } from './types';
import dayjs from 'dayjs';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { handleDateChange } from '../../../shared/components/CustomDateHelper';

const NAVY = '#002e5b';
const BORDER = '#e0e4ea';

const isoDaysAgo = (days: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
};

const fmtNum = (n: number) => n.toLocaleString();
const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <Paper elevation={0} sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, p: 2, flex: '1 1 160px' }}>
            <Typography sx={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {label}
            </Typography>
            <Typography sx={{ fontSize: 22, fontWeight: 700, color: NAVY, mt: 0.5 }}>{value}</Typography>
            {hint && <Typography sx={{ fontSize: 11, color: '#9ca3af', mt: 0.25 }}>{hint}</Typography>}
        </Paper>
    );
}

function BucketTable({ rows, firstHeader }: { rows: SpendBucket[]; firstHeader: string }) {
    if (!rows.length) {
        return (
            <Typography sx={{ fontSize: 13, color: '#6b7280', py: 2 }}>
                No calls recorded in this window.
            </Typography>
        );
    }
    const headers = [firstHeader, 'Calls', 'Input tokens', 'Output tokens', 'Cost'];
    return (
        <Paper elevation={0} sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
            <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            {headers.map((h, i) => (
                                <TableCell
                                    key={h}
                                    align={i === 0 ? 'left' : 'right'}
                                    sx={{ fontWeight: 600, fontSize: 12, color: NAVY, bgcolor: '#fafbfc' }}
                                >
                                    {h}
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.map((r) => (
                            <TableRow key={r.key} hover>
                                <TableCell sx={{ fontSize: 13, fontWeight: 500 }}>{r.key}</TableCell>
                                <TableCell align="right" sx={{ fontSize: 12.5 }}>{fmtNum(r.calls)}</TableCell>
                                <TableCell align="right" sx={{ fontSize: 12.5 }}>{fmtNum(r.inputTokens)}</TableCell>
                                <TableCell align="right" sx={{ fontSize: 12.5 }}>{fmtNum(r.outputTokens)}</TableCell>
                                <TableCell align="right" sx={{ fontSize: 12.5, fontWeight: 600 }}>{fmtUsd(r.costUsd)}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Paper>
    );
}

type Grouping = 'callSite' | 'model' | 'day';

export function AiSpendAdmin() {
    const [from, setFrom] = useState(() => isoDaysAgo(30));
    const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
    const [grouping, setGrouping] = useState<Grouping>('callSite');
    const [startError, setStartError] = useState<string | null>(null);
    const [endError, setEndError] = useState<string | null>(null);

    const { data, isLoading, isError } = useAiSpendSummary(from, to);

    const rows = useMemo<SpendBucket[]>(() => {
        if (!data) return [];
        if (grouping === 'model') return data.byModel;
        if (grouping === 'day') return data.byDay;
        return data.byCallSite;
    }, [data, grouping]);

    const firstHeader = grouping === 'model' ? 'Model' : grouping === 'day' ? 'Day' : 'Report type';

    return (
      <Box>
        <Typography sx={{ fontSize: 18, fontWeight: 700, color: NAVY }}>
          AI Spend
        </Typography>
        <Typography
          sx={{ fontSize: 13, color: "#6b7280", mt: 0.5, mb: 2, maxWidth: 860 }}
        >
          What <b>this application</b> spends on the Anthropic API generating
          reports. One row is recorded per API call. This is <b>not</b> the
          Claude Usage tab &mdash; that measures what engineers do in Claude
          Code on their own machines. Costs are derived from the rate card under{" "}
          <b>Claude Usage &rarr; Pricing</b>, using the version that was in
          force when each call was made.
        </Typography>

        <Box
          sx={{
            display: "flex",
            gap: 2,
            alignItems: "flex-start",
            flexWrap: "wrap",
            mb: 2,
          }}
        >
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="From"
              value={dayjs(from)}
              onChange={(date) =>
                handleDateChange(
                  date?.format("YYYY-MM-DD") || from,
                  to,
                  setFrom,
                  setTo,
                  setStartError,
                  setEndError,
                  false,
                )
              }
              minDate={dayjs().subtract(12, 'month')}
              maxDate={dayjs()}
              slotProps={{
                textField: {
                  error: !!startError,
                  helperText: startError,
                },
              }}
            />
          </LocalizationProvider>

          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="To"
              value={dayjs(to)}
              onChange={(date) =>
                handleDateChange(
                  from,
                  date?.format("YYYY-MM-DD") || to,
                  setFrom,
                  setTo,
                  setStartError,
                  setEndError,
                  false,
                )
              }
              minDate={dayjs(from)}
              maxDate={dayjs()}
              slotProps={{
                textField: {
                  error: !!endError,
                  helperText: endError,
                },
              }}
            />
          </LocalizationProvider>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={grouping}
            onChange={(_, v) => v && setGrouping(v as Grouping)}
          >
            <ToggleButton value="callSite">By report type</ToggleButton>
            <ToggleButton value="model">By model</ToggleButton>
            <ToggleButton value="day">By day</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {isLoading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {data && !isLoading && !isError && (
          <>
            {data.unpriced && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Some calls could not be priced because no rate card is
                configured. Token counts are accurate; costs shown are
                understated. Add a version under Claude Usage &rarr; Pricing.
              </Alert>
            )}

            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
              <StatTile
                label="Total cost"
                value={fmtUsd(data.totals.costUsd)}
                hint={`${from} to ${to}`}
              />
              <StatTile label="Calls" value={fmtNum(data.totals.calls)} />
              <StatTile
                label="Input tokens"
                value={fmtNum(data.totals.inputTokens)}
              />
              <StatTile
                label="Output tokens"
                value={fmtNum(data.totals.outputTokens)}
                hint="priced ~5x input"
              />
            </Box>

            <BucketTable rows={rows} firstHeader={firstHeader} />
          </>
        )}
      </Box>
    );
}

export default AiSpendAdmin;
