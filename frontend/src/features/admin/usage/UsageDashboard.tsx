import { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Chip,
  CircularProgress,
  LinearProgress,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts';
import { useUsageSummary, useUsageTrend, useUsageUsers, useUsageFeatures } from './hooks';
import type { UsageUserRow } from './types';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import { handleDateChange } from '../../../shared/components/CustomDateHelper';

const NAVY = '#002e5b';
const ORANGE = '#f15a24';
const GREEN = '#4caf50';
const AMBER = '#ff9800';
const RED = '#f44336';

const ROLES = ['superuser', 'admin', 'manager', 'lead', 'member', 'executive'];

const toISODate = (d: Date) => d.toISOString().slice(0, 10);

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

const formatDateTime = (value: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatMinutes = (minutes: number) => {
  if (!minutes) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

/** Days since a timestamp, or null if it never happened. */
const daysSince = (value: string | null): number | null => {
  if (!value) return null;
  return Math.floor((Date.now() - new Date(value).getTime()) / (24 * 60 * 60 * 1000));
};

type SortColumn = 'name' | 'roleName' | 'lastLoginEver' | 'sessionCount' | 'totalMinutes' | 'eventCount';

function StatCard({
  label,
  value,
  hint,
  color = NAVY,
}: {
  label: string;
  value: string | number;
  hint?: string;
  color?: string;
}) {
  return (
    <Paper
      elevation={0}
      sx={{ p: 2, border: '1px solid #e0e4ea', borderRadius: 2, height: '100%' }}
    >
      <Typography sx={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>{label}</Typography>
      <Typography sx={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1.2, mt: 0.5 }}>
        {value}
      </Typography>
      {hint && (
        <Typography sx={{ fontSize: 11, color: '#9ca3af', mt: 0.5 }}>{hint}</Typography>
      )}
    </Paper>
  );
}

export function UsageDashboard() {
  const [from, setFrom] = useState(toISODate(daysAgo(30)));
  const [to, setTo] = useState(toISODate(new Date()));
  const [role, setRole] = useState('All roles');
  const [sortBy, setSortBy] = useState<SortColumn>('eventCount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [startError, setStartError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  const window = useMemo(() => ({ from, to }), [from, to]);

  const summaryQuery = useUsageSummary(window);
  const trendQuery = useUsageTrend(window);
  const usersQuery = useUsageUsers(window, role);
  const featuresQuery = useUsageFeatures(window);

  const summary = summaryQuery.data;

  const sortedUsers = useMemo(() => {
    const rows = [...(usersQuery.data || [])];
    rows.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      // Nulls (never logged in) always sort to the bottom regardless of direction.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [usersQuery.data, sortBy, sortDir]);

  const maxFeatureCount = Math.max(1, ...(featuresQuery.data || []).map(f => f.eventCount));

  const handleSort = (column: SortColumn) => {
    if (column === sortBy) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
  };

  /** Colour-codes recency of last use: fresh / going quiet / dormant. */
  const activityChip = (row: UsageUserRow) => {
    const days = daysSince(row.lastLoginEver);
    if (days === null) {
      return <Chip size="small" label="Never logged in" sx={{ bgcolor: '#fdecea', color: RED, fontWeight: 600, fontSize: 11 }} />;
    }
    if (days <= 7) {
      return <Chip size="small" label={days === 0 ? 'Today' : `${days}d ago`} sx={{ bgcolor: '#e8f5e9', color: GREEN, fontWeight: 600, fontSize: 11 }} />;
    }
    if (days <= 30) {
      return <Chip size="small" label={`${days}d ago`} sx={{ bgcolor: '#fff4e5', color: AMBER, fontWeight: 600, fontSize: 11 }} />;
    }
    return <Chip size="small" label={`${days}d ago`} sx={{ bgcolor: '#fdecea', color: RED, fontWeight: 600, fontSize: 11 }} />;
  };

  const anyError = summaryQuery.error || trendQuery.error || usersQuery.error || featuresQuery.error;

  return (
    <Box>
      {/* Filters */}
      <Box
        sx={{
          display: "flex",
          gap: 2,
          flexWrap: "wrap",
          mb: 3,
          alignItems: "flex-start",
        }}
      >
        <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="From"
              value={dayjs(from)}
              onChange={(date) =>
                handleDateChange(date?.format('YYYY-MM-DD') || from, to, setFrom, setTo, setStartError, setEndError, false)
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
                handleDateChange(from, date?.format('YYYY-MM-DD') || to, setFrom, setTo, setStartError, setEndError, false)
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
        <TextField
          label="Role"
          select
          size="medium"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="All roles">All roles</MenuItem>
          {ROLES.map((r) => (
            <MenuItem key={r} value={r}>
              {r}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {/* Headline stats */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr 1fr",
            md: "repeat(3, 1fr)",
            lg: "repeat(6, 1fr)",
          },
          gap: 2,
          mb: 3,
        }}
      >
        {anyError ? (
          <Typography
            sx={{ fontSize: 14, fontWeight: 600, color: NAVY, mb: 2 }}
          >
            No data match this filter.
          </Typography>
        ) : summaryQuery.isLoading || !summary ? (
          <Box
            sx={{
              gridColumn: "1 / -1",
              display: "flex",
              justifyContent: "center",
              py: 4,
            }}
          >
            <CircularProgress size={28} />
          </Box>
        ) : (
          <>
            <StatCard
              label="Daily active"
              value={summary.dau}
              hint="last 24 hours"
              color={ORANGE}
            />
            <StatCard
              label="Weekly active"
              value={summary.wau}
              hint="last 7 days"
            />
            <StatCard
              label="Monthly active"
              value={summary.mau}
              hint="last 30 days"
            />
            <StatCard
              label="Adoption"
              value={
                summary.totalUsers
                  ? `${Math.round((summary.mau / summary.totalUsers) * 100)}%`
                  : "—"
              }
              hint={`${summary.mau} of ${summary.totalUsers} active accounts`}
            />
            <StatCard
              label="Avg session"
              value={formatMinutes(summary.avgSessionMinutes)}
              hint={`${summary.totalSessions} sessions in window`}
            />
            <StatCard
              label="Never logged in"
              value={summary.neverLoggedIn}
              hint="active accounts, zero sessions"
              color={summary.neverLoggedIn > 0 ? RED : NAVY}
            />
          </>
        )}
      </Box>

      {/* Trend */}
      <Paper
        elevation={0}
        sx={{ p: 2.5, border: "1px solid #e0e4ea", borderRadius: 2, mb: 3 }}
      >
        <Typography sx={{ fontSize: 14, fontWeight: 600, color: NAVY, mb: 2 }}>
          Activity over time
        </Typography>
        {trendQuery.isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={trendQuery.data || []}
              margin={{ top: 5, right: 20, bottom: 5, left: -10 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11 }}
                stroke="#9ca3af"
              />
              <RechartsTooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="activeUsers"
                name="Active users"
                stroke={ORANGE}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="sessions"
                name="Logins"
                stroke={NAVY}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Paper>

      {/* Feature usage */}
      <Accordion
        disableGutters
        elevation={0}
        defaultExpanded={false}
        sx={{
          border: "1px solid #e0e4ea",
          borderRadius: 2,
          mb: 3,
          "&:before": { display: "none" },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: NAVY }}>
            Feature usage
          </Typography>
          <Typography sx={{ fontSize: 12, color: "#9ca3af", ml: 1.5 }}>
            {featuresQuery.data?.length || 0} features
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          {featuresQuery.isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={28} />
            </Box>
          ) : !featuresQuery.data?.length ? (
            <Typography sx={{ fontSize: 13, color: "#6b7280" }}>
              No feature activity recorded in this window.
            </Typography>
          ) : (
            <Box sx={{ display: "grid", gap: 1.25 }}>
              {featuresQuery.data.map((f) => (
                <Box
                  key={f.feature}
                  sx={{ display: "flex", alignItems: "center", gap: 2 }}
                >
                  <Typography
                    sx={{
                      fontSize: 12,
                      width: 200,
                      flexShrink: 0,
                      color: "#374151",
                    }}
                  >
                    {f.feature}
                  </Typography>
                  <Box sx={{ flexGrow: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={(f.eventCount / maxFeatureCount) * 100}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: "#f1f3f7",
                        "& .MuiLinearProgress-bar": {
                          bgcolor: NAVY,
                          borderRadius: 4,
                        },
                      }}
                    />
                  </Box>
                  <Typography
                    sx={{
                      fontSize: 12,
                      width: 130,
                      flexShrink: 0,
                      textAlign: "right",
                      color: "#6b7280",
                    }}
                  >
                    {f.eventCount} · {f.userCount}{" "}
                    {f.userCount === 1 ? "user" : "users"}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Per-user breakdown */}
      <Paper
        elevation={0}
        sx={{
          border: "1px solid #e0e4ea",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <Box sx={{ p: 2.5, pb: 1.5 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600, color: NAVY }}>
            Per-user activity
          </Typography>
          <Typography sx={{ fontSize: 12, color: "#6b7280", mt: 0.5 }}>
            All active accounts, including those with no usage. Session counts
            and time are within the selected window; "Last used" is all-time.
          </Typography>
        </Box>
        {usersQuery.isLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <TableContainer sx={{ maxHeight: 560 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {(
                    [
                      ["name", "User"],
                      ["roleName", "Role"],
                      ["lastLoginEver", "Last used"],
                      ["sessionCount", "Sessions"],
                      ["totalMinutes", "Time in app"],
                      ["eventCount", "Actions"],
                    ] as [SortColumn, string][]
                  ).map(([col, label]) => (
                    <TableCell
                      key={col}
                      sx={{
                        fontWeight: 600,
                        fontSize: 12,
                        color: NAVY,
                        bgcolor: "#fafbfc",
                      }}
                    >
                      <TableSortLabel
                        active={sortBy === col}
                        direction={sortBy === col ? sortDir : "desc"}
                        onClick={() => handleSort(col)}
                      >
                        {label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                  <TableCell
                    sx={{
                      fontWeight: 600,
                      fontSize: 12,
                      color: NAVY,
                      bgcolor: "#fafbfc",
                    }}
                  >
                    Top features
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedUsers.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
                        {row.name || row.userId}
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: "#9ca3af" }}>
                        {row.userId}
                      </Typography>
                    </TableCell>
                    <TableCell
                      sx={{ fontSize: 12, textTransform: "capitalize" }}
                    >
                      {row.roleName}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={formatDateTime(row.lastLoginEver)} arrow>
                        <span>{activityChip(row)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {row.sessionCount || "—"}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {formatMinutes(row.totalMinutes)}
                      {row.sessionCount > 0 && (
                        <Typography
                          component="span"
                          sx={{ fontSize: 11, color: "#9ca3af", ml: 0.5 }}
                        >
                          (avg {formatMinutes(row.avgSessionMinutes)})
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      {row.eventCount || "—"}
                    </TableCell>
                    <TableCell
                      sx={{ fontSize: 11, color: "#6b7280", maxWidth: 280 }}
                    >
                      {row.topFeatures || "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {!sortedUsers.length && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      sx={{
                        textAlign: "center",
                        py: 4,
                        color: "#6b7280",
                        fontSize: 13,
                      }}
                    >
                      No users match this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Box>
  );
}

export default UsageDashboard;
