import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  CircularProgress,
  Alert,
  TextField,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  Avatar,
} from '@mui/material';
import SearchRounded from '@mui/icons-material/SearchRounded';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
} from 'recharts';
import { useTeamPromptReport } from './hooks';
import { PALETTE, CardTitle, SignalBars, ModelUsageBars, toISODate, daysAgo, shortDay, fmtTokens } from './ui';
import { teamMemberDetailUrl } from '../../routes/paths';
import type { TeamMemberRow, TeamReport } from './types';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import { handleDateChange } from '../../shared/components/CustomDateHelper';

const FOCUS_COLOR: Record<string, string> = {
  Strong: PALETTE.good,
  Context: PALETTE.ok,
  Rework: PALETTE.ok,
  Adoption: PALETTE.orange,
};

/** Tiny inline sparkline for a member's score trend. */
function Sparkline({ values }: { values: (number | null)[] }) {
  // Days with nothing scored arrive as null. Drop them rather than plot them as 0 —
  // this is a shape hint, and a fake trough reads as a bad day.
  const scored = values.filter((v): v is number => v != null);
  if (!scored.length) return <Typography sx={{ fontSize: 11, color: '#9ca3af' }}>—</Typography>;
  const w = 90;
  const h = 24;
  const max = Math.max(...scored);
  const min = Math.min(...scored);
  const span = max - min || 1;
  const pts = scored
    .map((v, i) => `${(w * i) / Math.max(scored.length - 1, 1)},${h - 2 - (h - 4) * ((v - min) / span)}`)
    .join(' ');
  return (
    <svg width={w} height={h} style={{ verticalAlign: 'middle' }}>
      <polyline points={pts} fill="none" stroke={PALETTE.blue} strokeWidth={1.6} />
    </svg>
  );
}

export function TeamClaudeReport() {
  const navigate = useNavigate();
  // List state lives in the URL (ADDENDUM 24): a row click carries this exact
  // query string to the member-detail route, and "back to team" carries it
  // back unchanged — so the list is exactly as left, not reset to defaults.
  // No page in this app did this before (Retro Boards/Delivery Presentation
  // both reset their list on return); this establishes the better pattern.
  const [searchParams, setSearchParams] = useSearchParams();

  const [from, setFrom] = useState(searchParams.get('from') || toISODate(daysAgo(14)));
  const [to, setTo] = useState(searchParams.get('to') || toISODate(new Date()));

  // Members table: server-side search + pagination (ADDENDUM 24). The team can
  // be large enough that shipping every member's full row set to the browser
  // just to slice it client-side doesn't scale — the server filters and pages,
  // the browser only ever holds one page. `memberSearchInput` is what the text
  // field shows immediately; `memberSearch` is the debounced value actually
  // sent to the server, so typing doesn't fire a request per keystroke.
  const [memberSearchInput, setMemberSearchInput] = useState(searchParams.get('search') || '');
  const [memberSearch, setMemberSearch] = useState(searchParams.get('search') || '');
  const [page, setPage] = useState(Number(searchParams.get('page')) || 0);
  const [rowsPerPage, setRowsPerPage] = useState(Number(searchParams.get('pageSize')) || 10);
  const [startError, setStartError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setMemberSearch(memberSearchInput);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [memberSearchInput]);

  // Keep the URL in sync with the list's actual state, so a row click (which
  // forwards this query string) and a later "back to team" both land here
  // exactly as left. `replace: true` — paging/searching shouldn't fill up
  // browser history with a step per keystroke or click.
  useEffect(() => {
    const next = new URLSearchParams();
    next.set('from', from);
    next.set('to', to);
    if (memberSearch) next.set('search', memberSearch);
    if (page) next.set('page', String(page));
    if (rowsPerPage !== 10) next.set('pageSize', String(rowsPerPage));
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, memberSearch, page, rowsPerPage]);

  const { data, isLoading, isError, error } = useTeamPromptReport(from, to, memberSearch, page, rowsPerPage);

  const trend = useMemo(
    () => (data?.teamAvgTrend ?? []).map((d) => ({ ...d, label: shortDay(d.day) })),
    [data],
  );

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (isError || !data) {
    return <Alert severity="error">Failed to load the team report. {(error as Error)?.message}</Alert>;
  }

  return (
    <Box>
      {/* No page title here — AppLayout's PageHeader already renders it from the route
          label (paths.ts), so an inline title here would just duplicate it. */}
      <Typography sx={{ fontSize: 13, color: PALETTE.ink2, mb: 2.5 }}>
        Team quality &amp; adoption patterns. Individual vibe-coding flags and AI coaching stay private to each member.
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DatePicker
            label="From"
            value={dayjs(from)}
            onChange={(date) => {
              handleDateChange(date?.format('YYYY-MM-DD') || from, to, setFrom, setTo, setStartError, setEndError, false);
              setPage(0);
            }}
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
            onChange={(date) => {
              handleDateChange(from, date?.format('YYYY-MM-DD') || to, setFrom, setTo, setStartError, setEndError, false);
              setPage(0);
            }}
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
      </Box>
      <Typography sx={{ fontSize: 11.5, color: PALETTE.ink2, mb: 2.5 }}>
        Every number below is a total or average across the whole From–To range, not a single day — widening
        the range accumulates more, it never resets. Only the trend charts break it down day by day.
      </Typography>

      {/* Trend + adoption */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 2, mb: 2.5 }}>
        <Paper elevation={0} sx={{ p: 2, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
          <CardTitle term="teamScore">Team average score / day</CardTitle>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend} margin={{ top: 5, right: 16, bottom: 5, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
              <RTooltip />
              {/* connectNulls={false}: a day with nothing scored is a gap, not a zero. */}
              <Line type="monotone" dataKey="avgScore" name="Team avg" stroke={PALETTE.blue} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </Paper>
        <Paper elevation={0} sx={{ p: 2, border: `1px solid ${PALETTE.border}`, borderRadius: 2, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: 12, color: PALETTE.ink2, display: 'flex', alignItems: 'center' }}>
            Team skill/MCP adoption
          </Typography>
          <Typography sx={{ fontSize: 30, fontWeight: 700, color: PALETTE.navy }}>
            {data.teamToolAdoptionPct}%
          </Typography>
          <Typography sx={{ fontSize: 12, color: PALETTE.ink2 }}>of turns are tool-assisted</Typography>
          {/* Whole-team count — NOT data.members.length, which is now one page
              of a server-paged/searched list (ADDENDUM 24). */}
          <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, mt: 2 }}>
            {data.efficiencyCoverage.total} member{data.efficiencyCoverage.total === 1 ? '' : 's'} reporting
          </Typography>
          {/* Cache health sits beside adoption because it is the other number that
              is true for the whole team regardless of collector version. */}
          <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: 2 }}>Team cache hit rate</Typography>
          <Typography sx={{ fontSize: 22, fontWeight: 700, color: cacheColor(data.teamCacheHitPct) }}>
            {data.teamCacheHitPct}%
          </Typography>
        </Paper>
      </Box>

      {/* Members table */}
      <Paper elevation={0} sx={{ border: `1px solid ${PALETTE.border}`, borderRadius: 2, mb: 2.5, overflow: 'hidden' }}>
        <Box sx={{ p: 2, pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
          <CardTitle>Team members</CardTitle>
          <TextField
            size="small"
            placeholder="Search by name or login"
            value={memberSearchInput}
            onChange={(e) => setMemberSearchInput(e.target.value)}
            sx={{ width: 240 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded sx={{ fontSize: 18, color: PALETTE.ink2 }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {[
                  { h: 'Engineer', right: false },
                  { h: 'Prompts', right: true },
                  { h: 'Avg score', right: true },
                  { h: 'Trend', right: false },
                  { h: 'Skill/MCP use', right: true },
                  // Efficiency columns: where a member's tokens went, not how well
                  // they worked. The table stays sorted by score, deliberately.
                  { h: 'Cache hit', right: true },
                  { h: 'Context lost', right: true },
                  { h: 'Avg session', right: true },
                  { h: 'Peak parallel', right: true },
                  { h: 'Focus', right: false },
                ].map(({ h, right }) => (
                  <TableCell key={h} align={right ? 'right' : 'left'}
                    sx={{ fontWeight: 600, fontSize: 11, color: PALETTE.navy, bgcolor: '#fafbfc', textTransform: 'uppercase' }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.members.map((m: TeamMemberRow) => (
                <TableRow
                  key={m.userId}
                  hover
                  onClick={() => navigate(`${teamMemberDetailUrl(m.userId)}?${searchParams.toString()}`)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar sx={{ width: 26, height: 26, fontSize: 11, bgcolor: '#dbe9f6', color: PALETTE.blue }}>
                        {initials(m.name)}
                      </Avatar>
                      <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{m.name}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ fontSize: 13 }}>{m.prompts}</TableCell>
                  <TableCell align="right" sx={{ fontSize: 13, fontWeight: 700 }}>{m.avgScore}</TableCell>
                  <TableCell><Sparkline values={m.trend} /></TableCell>
                  <TableCell align="right" sx={{ fontSize: 13 }}>{m.toolAssistedPct}%</TableCell>
                  <TableCell align="right" sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                    <Box component="span" sx={{ color: cacheColor(m.cacheHitPct), fontWeight: 600 }}>
                      {m.cacheHitPct}%
                    </Box>
                  </TableCell>
                  {/* An em dash, not a 0 — these are null until that member's
                      collector reports them, and "lost nothing" would be a lie. */}
                  <TableCell align="right" sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                    {m.contextLossTokens == null ? <Muted /> : fmtTokens(m.contextLossTokens)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                    {m.avgSessionPrompts == null ? <Muted /> : m.avgSessionPrompts}
                  </TableCell>
                  <TableCell align="right" sx={{ fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
                    {m.maxConcurrent == null ? <Muted /> : m.maxConcurrent}
                  </TableCell>
                  <TableCell>
                    <Chip label={m.focus} size="small"
                      sx={{ bgcolor: `${FOCUS_COLOR[m.focus] ?? '#9ca3af'}22`, color: FOCUS_COLOR[m.focus] ?? '#6b7280', fontWeight: 600, fontSize: 11.5 }} />
                  </TableCell>
                </TableRow>
              ))}
              {data.efficiencyCoverage.total === 0 && (
                <TableRow>
                  <TableCell colSpan={10} sx={{ textAlign: 'center', py: 4, color: PALETTE.ink2, fontSize: 13 }}>
                    No team members have reported usage yet.
                  </TableCell>
                </TableRow>
              )}
              {data.efficiencyCoverage.total > 0 && data.membersTotal === 0 && (
                <TableRow>
                  <TableCell colSpan={10} sx={{ textAlign: 'center', py: 4, color: PALETTE.ink2, fontSize: 13 }}>
                    No one matches &ldquo;{memberSearch}&rdquo;.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        {!!data.membersTotal && (
          <TablePagination
            component="div"
            count={data.membersTotal}
            page={page}
            onPageChange={(_, next) => setPage(next)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50]}
            sx={{ borderBottom: `1px solid ${PALETTE.border}` }}
          />
        )}
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography sx={{ fontSize: 12, color: PALETTE.ink2 }}>
            🔒 Individual <b>vibe-coding</b> flags and AI coaching stay private to each member — leads see quality &amp; adoption patterns, not a per-person red flag.
          </Typography>
        </Box>
      </Paper>

      {/* Team signals + AI pattern */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2.5 }}>
        <Paper elevation={0} sx={{ p: 2, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
          <CardTitle term="signals">Where the team loses points</CardTitle>
          <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
            Team-wide share of prompts tripping each signal
          </Typography>
          <SignalBars signals={data.signals} emptyText="No penalty signals in this period." />
        </Paper>
        <Paper elevation={0} sx={{ p: 2, borderLeft: `3px solid ${PALETTE.navy}`, border: `1px solid ${PALETTE.border}`, borderRadius: 2, bgcolor: '#f7f9fc' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
            <AutoAwesomeIcon sx={{ fontSize: 16, color: PALETTE.navy }} />
            <Typography sx={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: PALETTE.ink2 }}>
              Team pattern · aggregate only
            </Typography>
          </Box>
          <Typography sx={{ fontSize: 15, fontWeight: 650, mb: 1 }}>Team coaching focus</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {teamTips(data).map((t, i) => (
              <Typography component="li" key={i} sx={{ fontSize: 14, color: '#374151', mb: 0.75, lineHeight: 1.5 }}>
                {t}
              </Typography>
            ))}
          </Box>
        </Paper>
      </Box>

      {/* Where the team loses tokens (ADDENDUM 21) — ranked by cost, not by how
          many people do it, so the biggest shared habit surfaces first. */}
      <Paper elevation={0} sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
        <CardTitle>Where the team loses tokens</CardTitle>
        <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
          Cost that doesn&rsquo;t show up as output, ranked by size
          {data.efficiencyCoverage.total > 0 && data.efficiencyCoverage.reporting < data.efficiencyCoverage.total && (
            <>
              {' '}&middot; context loss covers {data.efficiencyCoverage.reporting} of{' '}
              {data.efficiencyCoverage.total} members (the rest are on an older collector)
            </>
          )}
        </Typography>
        {data.teamTokenSinks.length ? (
          <>
            {data.teamTokenSinks.map((s) => {
              const max = data.teamTokenSinks[0].tokens || 1;
              return (
                <Box key={s.key} sx={{ mb: 1.5, '&:last-of-type': { mb: 0 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                    <Typography sx={{ fontSize: 12.5, color: PALETTE.navy, flex: 1, minWidth: 0 }}>{s.label}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: PALETTE.ink2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {fmtTokens(s.tokens)} tok &middot; ${s.costUsd.toLocaleString()}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: PALETTE.navy, width: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {s.pct}%
                    </Typography>
                  </Box>
                  <Box sx={{ height: 8, borderRadius: 4, bgcolor: PALETTE.grid, overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', minWidth: 3, width: `${(s.tokens / max) * 100}%`, borderRadius: 4, bgcolor: PALETTE.blue }} />
                  </Box>
                </Box>
              );
            })}
            <Typography sx={{ fontSize: 11.5, color: PALETTE.ink2, mt: 1.5 }}>
              Costs are estimates at API list prices, not a bill.
            </Typography>
          </>
        ) : (
          <Typography sx={{ fontSize: 13, color: PALETTE.ink2, py: 2 }}>
            No measurable token loss in this period.
          </Typography>
        )}
      </Paper>

      {/* Team model usage (ADDENDUM 18) — aggregate only, no per-member breakdown */}
      <Paper elevation={0} sx={{ p: 2, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
        <CardTitle>Team model usage</CardTitle>
        <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
          Which models the team relies on, so you can standardize on what actually works
        </Typography>
        <ModelUsageBars models={data.teamModelSplit} emptyText="No model usage recorded for this team yet." />
        {data.teamModelSuggestions.length > 0 && (
          <Box sx={{ mt: 2, p: 1.5, bgcolor: '#f7f9fc', border: `1px solid ${PALETTE.border}`, borderLeft: `3px solid ${PALETTE.navy}`, borderRadius: 1.5 }}>
            <Typography sx={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: PALETTE.ink2, mb: 0.75 }}>
              Suggested
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
              {data.teamModelSuggestions.map((s, i) => (
                <Typography component="li" key={i} sx={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6, mb: 0.75, '&:last-of-type': { mb: 0 } }}>
                  {s.detail}
                  {s.monthlySavingUsd != null && s.monthlySavingUsd > 0 && (
                    <> Standardising this is worth roughly <b>${s.monthlySavingUsd.toLocaleString()}/month</b> across the team.</>
                  )}
                </Typography>
              ))}
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  );
}

/** Cache health colour. Same thresholds the backend uses to set CacheEfficiency.verdict. */
function cacheColor(pct: number): string {
  if (pct >= 85) return PALETTE.good;
  if (pct >= 60) return PALETTE.ok;
  return PALETTE.poor;
}

/** Placeholder for a metric this member's collector has not reported yet. */
function Muted() {
  return <Box component="span" sx={{ color: '#c3cad3' }}>&mdash;</Box>;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** Deterministic team-level coaching from the aggregate signals. */
function teamTips(data: TeamReport): string[] {
  const tips: string[] = [];
  const top = [...data.signals].sort((a, b) => b.pct - a.pct)[0];
  if (top && top.pct >= 15) {
    tips.push(`"${top.label}" is the team's weakest habit (${top.pct}% of prompts). A short "good prompt anatomy" share could lift the whole team.`);
  }

  // Efficiency coaching. Deliberately phrased as a shared habit with a cause —
  // a low cache rate is nearly always short sessions, not a misconfiguration, and
  // saying so stops people hunting for a setting that doesn't exist. Uses the
  // whole-team `lowCacheMembers` count, NOT `data.members` — that array is now
  // server-paged/searched and only ever holds one page (ADDENDUM 24).
  const { count: lowCacheCount, shortSessionCount } = data.lowCacheMembers;
  if (lowCacheCount) {
    tips.push(
      shortSessionCount
        ? `${lowCacheCount} member${lowCacheCount === 1 ? '' : 's'} sit below 80% cache hit rate, and ${shortSessionCount} of them average under 6 prompts per session — they're restarting sessions, not misconfiguring anything. One "keep the session open for the whole task" share fixes both numbers.`
        : `${lowCacheCount} member${lowCacheCount === 1 ? '' : 's'} sit below 80% cache hit rate — worth checking whether sessions are being restarted mid-task.`,
    );
  }
  const topSink = data.teamTokenSinks[0];
  if (topSink && topSink.costUsd >= 1) {
    tips.push(`"${topSink.label}" is the team's largest token sink at about $${topSink.costUsd.toLocaleString()} in this period.`);
  }

  if (data.teamToolAdoptionPct < 55) {
    tips.push(`Skill/MCP adoption is ${data.teamToolAdoptionPct}% — reinforce tools and skills; teams above 60% tend to score higher.`);
  } else {
    tips.push(`Skill/MCP adoption is healthy at ${data.teamToolAdoptionPct}% — keep reinforcing it.`);
  }
  tips.push('Encourage members to check their private report for personalised coaching.');
  return tips.slice(0, 4);
}

export default TeamClaudeReport;
