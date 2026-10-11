import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Button,
  Chip,
  CircularProgress,
  Alert,
  TextField,
} from '@mui/material';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
} from 'recharts';
import { useMemberDetailReport } from './hooks';
import {
  PALETTE,
  TIER_META,
  StatCard,
  CardTitle,
  InfoTip,
  SignalBars,
  ModelUsageBars,
  toISODate,
  daysAgo,
  fmtTokens,
  shortDay,
  PROMPT_TYPE_LABELS,
  CAPS,
  CapCard,
  RateCapCard,
} from './ui';
import {
  CacheCard,
  ContextLossCard,
  SessionShapeCard,
  ParallelWorkCard,
  PaceCard,
  ModelFitCard,
} from './EfficiencyCards';
import { PATHS } from '../../routes/paths';
import type { PromptTypeMix } from './types';

/**
 * A lead's click-through to ONE team member's usage detail — no coaching, no
 * vibe-coding index, no consent/collector setup (see the type doc on
 * `MemberDetailReport` for why). Everything else is the same reading as
 * `MyClaudeReport`'s Details tab, minus the pieces that are either private to
 * the member or meaningless for someone looking at another person's data.
 *
 * `from`/`to` are read from THIS page's own query string, which the Team
 * members table forwards verbatim on row-click — so "← Back to team" can
 * carry that exact string back and land the list exactly where it was.
 */
export function TeamMemberDetail() {
  const { userId } = useParams<{ userId: string }>();
  const targetUserId = Number(userId);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [from, setFrom] = useState(searchParams.get('from') || toISODate(daysAgo(14)));
  const [to, setTo] = useState(searchParams.get('to') || toISODate(new Date()));

  const { data, isLoading, isError, error } = useMemberDetailReport(targetUserId, from, to);

  const dailyChart = useMemo(
    () => (data?.daily ?? []).map((d) => ({ ...d, label: shortDay(d.day) })),
    [data],
  );
  const promptTypeShares = data?.hasData
    ? (Object.keys(PROMPT_TYPE_LABELS) as (keyof PromptTypeMix)[]).map((key) => {
        const total = Object.values(data.promptTypes).reduce((s, n) => s + n, 0) || 1;
        return { key, label: PROMPT_TYPE_LABELS[key], pct: Math.round((data.promptTypes[key] / total) * 100), count: data.promptTypes[key] };
      })
    : [];

  const backToTeam = () => navigate(`${PATHS.TEAM_CLAUDE_REPORT}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`);

  const updateDate = (which: 'from' | 'to', value: string) => {
    if (which === 'from') setFrom(value); else setTo(value);
    const next = new URLSearchParams(searchParams);
    next.set(which, value);
    setSearchParams(next, { replace: true });
  };

  return (
    <Box>
      <Button
        size="small"
        variant="outlined"
        startIcon={<ArrowBackRounded />}
        onClick={backToTeam}
        sx={{ mb: 2, textTransform: 'none' }}
      >
        Back to team
      </Button>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}
      {isError && (
        <Alert severity="error">
          {(error as any)?.response?.status === 403
            ? "This member is outside your team, or you don't have access to their data."
            : `Failed to load this member's report. ${(error as Error)?.message ?? ''}`}
        </Alert>
      )}

      {data && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 20, fontWeight: 700, color: PALETTE.navy }}>{data.member.name}</Typography>
            <Typography sx={{ fontSize: 13, color: PALETTE.ink2 }}>({data.member.login})</Typography>
            {data.hasData && (
              <Chip
                label={`${data.skillTier.label} · ${data.skillTier.score}/100`}
                size="small"
                sx={{ bgcolor: `${TIER_META[data.skillTier.tier].color}22`, color: TIER_META[data.skillTier.tier].color, fontWeight: 700, ml: 1 }}
              />
            )}
            <InfoTip term="skillTier" />
          </Box>
          <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, mb: 2.5 }}>
            Usage detail only — no coaching tips or vibe-coding index are shown here; those stay private to
            the member themselves.
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2.5 }}>
            <TextField label="From" type="date" size="small" value={from}
              onChange={(e) => updateDate('from', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="To" type="date" size="small" value={to}
              onChange={(e) => updateDate('to', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Box>

          {!data.hasData ? (
            <Paper elevation={0} sx={{ p: 4, border: `1px dashed ${PALETTE.border}`, borderRadius: 2, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 14, color: PALETTE.ink2 }}>
                No usage recorded for this member in this range.
              </Typography>
            </Paper>
          ) : (
            <>
              {/* Headline tiles */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 2.5 }}>
                <StatCard label="Prompts" value={data.totals.prompts} hint="in range" term="prompts" />
                <StatCard label="Avg score" value={`${data.totals.avgScore}/100`} color={PALETTE.orange} term="score" />
                <StatCard label="Tokens" value={fmtTokens(data.totals.tokens)} term="tokens" />
                <StatCard
                  label="Quality mix"
                  value={
                    <Box component="span" sx={{ fontSize: 18 }}>
                      <span style={{ color: PALETTE.good }}>{data.totals.good}</span>{' · '}
                      <span style={{ color: '#b26a00' }}>{data.totals.ok}</span>{' · '}
                      <span style={{ color: PALETTE.poor }}>{data.totals.poor}</span>
                    </Box>
                  }
                  hint="Good · OK · Poor"
                  term="mix"
                />
              </Box>

              {/* Score + quality trend */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2.5 }}>
                <Paper elevation={0} sx={{ p: 2, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
                  <CardTitle term="score">Average prompt score / day</CardTitle>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={dailyChart} margin={{ top: 5, right: 16, bottom: 5, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                      <RTooltip />
                      <Line type="monotone" dataKey="avgScore" name="Avg score" stroke={PALETTE.blue} strokeWidth={2} dot={{ r: 2.5 }} connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Paper>
                <Paper elevation={0} sx={{ p: 2, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
                  <CardTitle term="mix">Prompt quality mix / day</CardTitle>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={dailyChart} margin={{ top: 5, right: 16, bottom: 5, left: -12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
                      <RTooltip />
                      <Bar dataKey="good" stackId="q" name="Good" fill={PALETTE.good} />
                      <Bar dataKey="ok" stackId="q" name="OK" fill={PALETTE.ok} />
                      <Bar dataKey="poor" stackId="q" name="Poor" fill={PALETTE.poor} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <Box sx={{ display: 'flex', gap: 2, mt: 1, fontSize: 12, color: PALETTE.ink2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 11, height: 11, borderRadius: '3px', bgcolor: PALETTE.good }} />Good ≥70
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 11, height: 11, borderRadius: '3px', bgcolor: PALETTE.ok }} />OK 40–69
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 11, height: 11, borderRadius: '3px', bgcolor: PALETTE.poor }} />Poor &lt;40
                    </Box>
                  </Box>
                </Paper>
              </Box>

              {/* Why prompts lost points */}
              <Paper elevation={0} sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
                <CardTitle term="signals">Why prompts lost points</CardTitle>
                <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
                  Share of prompts tripping each signal
                </Typography>
                <SignalBars signals={data.signals} emptyText="No penalty signals in this period." />
              </Paper>

              {/* Good-practice capabilities */}
              <Paper elevation={0} sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                  <Typography sx={{ fontWeight: 700, color: PALETTE.navy, fontSize: 15 }}>Good-practice capabilities</Typography>
                  <InfoTip term="capabilities" />
                </Box>
                <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, mb: 1.5 }}>
                  The habits that most lift Claude&rsquo;s output.
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1.5 }}>
                  {CAPS.map((c) => (
                    <CapCard key={c.key} label={c.label} value={data.capabilities[c.key] as number} term={c.term} nudge={c.nudge} />
                  ))}
                  <RateCapCard label="Edit acceptance" value={data.capabilities.editAcceptanceRate} term="capAcceptance" />
                </Box>
              </Paper>

              {/* What they use Claude for */}
              <Paper elevation={0} sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
                <CardTitle term="promptTypes">What they use Claude for</CardTitle>
                <SignalBars signals={promptTypeShares} emptyText="Not enough prompts yet to break this down." />
              </Paper>

              {/* Model usage */}
              <Paper elevation={0} sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
                <CardTitle>Model usage</CardTitle>
                <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
                  Share of tokens by model
                </Typography>
                <ModelUsageBars models={data.modelSplit} />
              </Paper>

              {/* Where their tokens go */}
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: PALETTE.navy, mt: 1, mb: 0.25 }}>
                Where their tokens go
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, mb: 2 }}>
                Cost and effort that don&rsquo;t show up as output. None of this feeds their score or skill tier.
              </Typography>
              {data.efficiencyCoverage.reporting < data.efficiencyCoverage.total && (
                <Typography sx={{ fontSize: 12, color: '#b26a00', mb: 2, fontStyle: 'italic' }}>
                  Based on {data.efficiencyCoverage.reporting} of {data.efficiencyCoverage.total} days in range —
                  the rest predate a collector update, so the sums below don&rsquo;t cover the whole period.
                </Typography>
              )}

              <CacheCard cache={data.cache} />
              <ContextLossCard data={data.contextLoss} />
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2.5 }}>
                <SessionShapeCard data={data.sessionShape} />
                <ParallelWorkCard data={data.concurrency} />
              </Box>
              <PaceCard data={data.pace} reworkPct={data.signals.find((s) => s.key === 'rework')?.pct ?? 0} />
              <ModelFitCard rows={data.modelTasks} suggestions={data.modelSuggestions} />
            </>
          )}
        </>
      )}
    </Box>
  );
}

export default TeamMemberDetail;
