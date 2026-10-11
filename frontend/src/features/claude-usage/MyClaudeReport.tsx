import { useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Chip,
  CircularProgress,
  Alert,
  Divider,
  Snackbar,
  Collapse,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
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
import { useMyPromptReport, useRefreshCoaching } from './hooks';
import { CollectorDialog } from './CollectorDialog';
import { PALETTE, TIER_META, StatCard, CardTitle, InfoTip, SignalBars, ModelUsageBars, toISODate, daysAgo, fmtTokens, fmtDateTime, shortDay, PROMPT_TYPE_LABELS, CAPS, CapCard, RateCapCard } from './ui';
import {
  CacheCard,
  ContextLossCard,
  SessionShapeCard,
  ParallelWorkCard,
  PaceCard,
  ModelFitCard,
} from './EfficiencyCards';
import type { PromptTypeMix, LicenseView, SignalShare } from './types';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import { handleDateChange } from '../../shared/components/CustomDateHelper';

const READING_TONE_COLOR: Record<NonNullable<LicenseView['usageReading']>['tone'], string> = {
  positive: PALETTE.good,
  neutral: PALETTE.navy,
  caution: '#b26a00',
};

const VIBE_META: Record<string, { label: string; color: string }> = {
  low: { label: 'Low', color: PALETTE.good },
  medium: { label: 'Medium', color: PALETTE.ok },
  high: { label: 'High', color: PALETTE.poor },
};

/**
 * Ties the person's ACTUAL numbers into a plain-English "why this score" sentence,
 * next to the generic rubric text the InfoTip/glossary already provides. Built
 * entirely from data already on the page (scored-prompt counts, signal counts) —
 * no new API call, and it stays inside the existing privacy boundary (aggregate
 * counts only; the collector never sends per-prompt text, so this can never name
 * an actual prompt — only which signals fired and how often).
 */
function scoreNarrative(totals: { good: number; ok: number; poor: number; avgScore: number }, signals: SignalShare[]) {
  const scored = totals.good + totals.ok + totals.poor;
  if (!scored) return null;
  const top = [...signals].filter((s) => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 2);
  const composition = `${scored} prompt${scored === 1 ? '' : 's'} scored this period, averaging ${totals.avgScore}/100 — `
    + `${totals.good} good, ${totals.ok} ok, ${totals.poor} poor.`;
  if (!top.length) return `${composition} No penalty signals fired — nice.`;
  const drivers = top
    .map((s) => `${s.label.toLowerCase()} on ${s.count} prompt${s.count === 1 ? '' : 's'} (${s.pct}%)`)
    .join(', and ');
  return `${composition} Biggest factor${top.length > 1 ? 's' : ''} pulling the score down: ${drivers}.`;
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Box sx={{ bgcolor: '#fff', border: `1px solid ${PALETTE.border}`, borderRadius: 1.5, p: 1.25 }}>
      <Typography sx={{ fontSize: 11, color: PALETTE.ink2, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 800, color: PALETTE.navy, lineHeight: 1.2 }}>{value}</Typography>
      <Typography sx={{ fontSize: 11, color: PALETTE.ink2 }}>{sub}</Typography>
    </Box>
  );
}

// Two in-page sub-tabs, same local-state pattern as ClaudeUsageAdmin.tsx: Overview
// is everything glanceable/actionable (the numbers, the score, what to do about
// it); Details is everything for digging in (capability breakdowns, trends, the
// efficiency-signal cards). The date range, status/consent banners and setup
// prompts stay OUTSIDE both tabs — they apply regardless of which tab is open,
// and switching tabs must never hide a setup warning or reset the range.
type ReportTab = 'overview' | 'details';

// Not clearly useful yet — hidden for now, not deleted, so it's a one-line flip
// to bring back once there's more confidence in what it should show. Gates both
// the "Value & leverage" panel and the headline "Value vs seat"/"Est. value" tile.
const SHOW_VALUE_LEVERAGE = false;

export function MyClaudeReport() {
  const [from, setFrom] = useState(toISODate(daysAgo(14)));
  const [to, setTo] = useState(toISODate(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [coachingSnackbar, setCoachingSnackbar] = useState<{ msg: string; severity: 'success' | 'info' } | null>(null);
  const [showLeverageDetail, setShowLeverageDetail] = useState(false);
  const [tab, setTab] = useState<ReportTab>('overview');
  const [startError, setStartError] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useMyPromptReport(from, to);
  const refreshCoaching = useRefreshCoaching();

  const handleRefreshCoaching = () => {
    refreshCoaching.mutate(undefined, {
      onSuccess: (result) => {
        if (result.skipped) {
          const next = result.nextAvailableAt ? fmtDateTime(result.nextAvailableAt) : null;
          setCoachingSnackbar({
            msg: next ? `${result.message} — next available ${next}.` : (result.message ?? 'Coaching is already up to date'),
            severity: 'info',
          });
        } else {
          setCoachingSnackbar({ msg: 'Coaching refresh queued — check back shortly.', severity: 'success' });
        }
      },
    });
  };

  const dailyChart = useMemo(
    () => (data?.daily ?? []).map((d) => ({ ...d, label: shortDay(d.day) })),
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
    return <Alert severity="error">Failed to load your Claude report. {(error as Error)?.message}</Alert>;
  }

  const { totals, vibe, consent, collector, coaching, license, capabilities, skillTier, promptTypes } = data;
  const vibeMeta = VIBE_META[vibe.bucket];
  const notSetUp = !consent.consented || !collector.connected;
  const isSeat = license.licenseType === 'seat' && license.roiMultiple != null;

  const promptTypeShares = data.hasData
    ? (Object.keys(PROMPT_TYPE_LABELS) as (keyof PromptTypeMix)[])
        .map((key) => {
          const total = Object.values(promptTypes).reduce((s, n) => s + n, 0) || 1;
          return { key, label: PROMPT_TYPE_LABELS[key], pct: Math.round((promptTypes[key] / total) * 100), count: promptTypes[key] };
        })
    : [];

  return (
    <Box>
      {/* No page title here — AppLayout's PageHeader already renders it from the route
          label (paths.ts), so an inline title here would just duplicate it. */}
      {data.hasData && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
          <Chip
            label={`${skillTier.label} · ${skillTier.score}/100`}
            size="small"
            sx={{ bgcolor: `${TIER_META[skillTier.tier].color}22`, color: TIER_META[skillTier.tier].color, fontWeight: 700 }}
          />
          <InfoTip term="skillTier" />
        </Box>
      )}
      <Typography sx={{ fontSize: 13, color: PALETTE.ink2, mb: 2.5 }}>
        Private coaching on how effectively you prompt. Weak-prompt examples never leave your laptop.
      </Typography>

      {/* Status banner */}
      <Paper elevation={0} sx={{ p: 1.75, border: `1px solid ${PALETTE.border}`, borderRadius: 2, mb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: collector.connected ? PALETTE.good : PALETTE.poor }} />
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
            {collector.connected ? 'Collector connected' : 'Collector not set up'}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2 }}>
            {consent.consented ? `· consented v${consent.currentVersion}` : '· consent needed'}
            {collector.lastSeenAt ? ` · last report ${fmtDateTime(collector.lastSeenAt)}` : ''}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Chip
            icon={<LockOutlinedIcon sx={{ fontSize: 15 }} />}
            label="Only numbers leave your machine — no prompts, code, or file names"
            size="small"
            sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontSize: 11.5, fontWeight: 600 }}
          />
          <Button size="small" variant="outlined" startIcon={<InfoOutlinedIcon />} onClick={() => setDialogOpen(true)}>
            How it works &amp; consent
          </Button>
        </Box>
      </Paper>

      {notSetUp && (
        <Alert severity="info" sx={{ mb: 2.5 }} action={
          <Button color="inherit" size="small" onClick={() => setDialogOpen(true)}>Set up</Button>
        }>
          {consent.needsReconsent
            ? 'The consent policy was updated — please review and re-consent to keep your report current.'
            : 'Set up the collector to start seeing your report: consent, generate a token, and run the installer.'}
        </Alert>
      )}

      {/* An out-of-date collector is invisible otherwise — nothing on the machine
          updates itself, so a laptop keeps its old behaviour indefinitely and the
          only symptom is data that quietly looks normal. Since the VPN gate this is
          also what decides whether reports still leave from inside a customer
          network, which is why it warrants a warning rather than a quiet note. */}
      {!notSetUp && collector.outOfDate && (
        <Alert severity="warning" sx={{ mb: 2.5 }} action={
          <Button color="inherit" size="small" onClick={() => setDialogOpen(true)}>Update</Button>
        }>
          Your collector is version {collector.installedVersion} — the current release is{' '}
          {collector.latestVersion}. Updating takes one command and keeps your existing
          setup; nothing updates itself.
        </Alert>
      )}

      {/* Consented + connected but nothing pushed yet: don't show misleading zeros. */}
      {!data.hasData && (
        <Paper elevation={0} sx={{ p: 4, border: `1px dashed ${PALETTE.border}`, borderRadius: 2, textAlign: 'center', mb: 2.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 600, color: PALETTE.navy, mb: 1 }}>
            Waiting for your first data
          </Typography>
          <Typography sx={{ fontSize: 13.5, color: PALETTE.ink2, maxWidth: 520, mx: 'auto', lineHeight: 1.6 }}>
            {consent.consented
              ? 'Your consent is recorded. Download and run the collector on your machine (it runs daily). Once it pushes a day of usage — or you run it manually — this report fills in automatically.'
              : 'Consent and set up the collector to start seeing your report.'}
          </Typography>
          <Button variant="contained" sx={{ mt: 2 }} onClick={() => setDialogOpen(true)}>
            {consent.consented ? 'Download the collector' : 'Set up the collector'}
          </Button>
        </Paper>
      )}

      {/* Date range */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2.5 }}>
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
      </Box>

      {data.hasData && (
      <ToggleButtonGroup
        value={tab}
        exclusive
        onChange={(_, v) => v && setTab(v)}
        sx={{
          mb: 2.5,
          bgcolor: '#fff',
          '& .MuiToggleButton-root': {
            textTransform: 'none',
            fontSize: 14,
            fontWeight: 600,
            px: 2.5,
            py: 0.75,
            color: PALETTE.ink2,
            border: `1px solid ${PALETTE.border}`,
          },
          '& .Mui-selected': {
            bgcolor: `${PALETTE.navy} !important`,
            color: '#fff !important',
          },
        }}
      >
        <ToggleButton value="overview">Overview</ToggleButton>
        <ToggleButton value="details">Details</ToggleButton>
      </ToggleButtonGroup>
      )}

      {data.hasData && tab === 'overview' && <>
      {/* Headline tiles */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: `repeat(${SHOW_VALUE_LEVERAGE ? 5 : 4}, 1fr)` }, gap: 2, mb: 2.5 }}>
        <StatCard label="Prompts" value={totals.prompts} hint="in range" term="prompts" />
        <StatCard label="Avg score" value={`${totals.avgScore}/100`} color={PALETTE.orange} term="score" />
        <StatCard label="Tokens" value={fmtTokens(totals.tokens)} term="tokens" />
        {SHOW_VALUE_LEVERAGE && (isSeat ? (
          <StatCard
            label="Value vs seat"
            value={license.roiMultipleDisplay ?? `${license.roiMultiple}×`}
            color={PALETTE.good}
            hint="AI value ÷ seat cost"
            term="value"
          />
        ) : (
          <StatCard
            label="Est. value"
            value={`$${totals.cost.toFixed(2)}`}
            hint="at API list prices"
            term="value"
          />
        ))}
        <StatCard
          label="Quality mix"
          value={
            <Box component="span" sx={{ fontSize: 18 }}>
              <span style={{ color: PALETTE.good }}>{totals.good}</span>{' · '}
              <span style={{ color: '#b26a00' }}>{totals.ok}</span>{' · '}
              <span style={{ color: PALETTE.poor }}>{totals.poor}</span>
            </Box>
          }
          hint="Good · OK · Poor"
          term="mix"
        />
      </Box>
      </>}

      {data.hasData && tab === 'details' && <>
      {/* Value & leverage panel — hidden for now (not clearly useful yet), not
          deleted; flip SHOW_VALUE_LEVERAGE above to bring it back. */}
      {SHOW_VALUE_LEVERAGE && <Paper
        elevation={0}
        sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderLeft: `3px solid ${PALETTE.good}`, borderRadius: 2, bgcolor: '#f6faf7' }}
      >
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 1 }}>
          <Typography sx={{ fontWeight: 700, color: PALETTE.navy, fontSize: 15 }}>
            Value &amp; leverage
          </Typography>
          <Chip
            size="small"
            label={
              license.seatSource === 'org'
                ? `seat: $${license.seatMonthlyUsd}/mo (configured)`
                : `seat: $${license.seatMonthlyUsd}/mo (assumed benchmark)`
            }
            sx={{ bgcolor: '#eef2f7', color: PALETTE.ink2, fontWeight: 600 }}
          />
        </Box>

        {!license.projectionReliable ? (
          <Typography sx={{ fontSize: 13, color: PALETTE.ink2, mb: 1.5 }}>
            Still gathering data — {license.activeDays} active day{license.activeDays === 1 ? '' : 's'} so far.
            A monthly value projection needs a few more days to be meaningful; the figures below are exact,
            not extrapolated.
          </Typography>
        ) : isSeat && license.usageReading ? (
          <>
            <Typography
              sx={{ fontSize: 18, fontWeight: 800, color: READING_TONE_COLOR[license.usageReading.tone], mb: 0.25 }}
            >
              {license.usageReading.label}
            </Typography>
            <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, mb: 1.5 }}>
              {license.usageReading.detail} This is an estimate to encourage good use — <b>not a bill</b>, and
              never a customer charge.
            </Typography>
          </>
        ) : (
          <Typography sx={{ fontSize: 13, color: PALETTE.ink2, mb: 1.5 }}>
            This org is billed by consumption (API), so the figures below are the estimated cost at list prices.
          </Typography>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(2, 1fr)' }, gap: 1.5 }}>
          <MiniStat label="AI-equivalent value" value={`$${license.apiEquivalentValue.toLocaleString()}`} sub="at API list prices — not a bill" />
          <MiniStat label="Usage intensity" value={`${license.promptsPerActiveDay}/day`} sub={`${fmtTokens(license.tokensPerActiveDay)} tokens/day`} />
        </Box>

        {license.projectionReliable && (
          <>
            <Button
              size="small"
              onClick={() => setShowLeverageDetail((v) => !v)}
              sx={{ textTransform: 'none', fontSize: 12, mt: 1.25, px: 0 }}
            >
              {showLeverageDetail ? 'Hide the exact numbers' : 'See the exact numbers'}
            </Button>
            <Collapse in={showLeverageDetail}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(2, 1fr)' }, gap: 1.5, mt: 1 }}>
                <MiniStat label="Projected / month" value={`$${license.monthlyValueWorkdays.toLocaleString()}`} sub={`${license.activeDays} active days → 21-workday est.`} />
                <MiniStat
                  label="Seat utilization"
                  value={license.utilizationPct != null ? `${license.utilizationPct}%${license.utilizationPct >= 999 ? '+' : ''}` : '—'}
                  sub="of one seat's cost, in value"
                />
              </Box>
            </Collapse>
          </>
        )}

        <Typography sx={{ fontSize: 11.5, color: PALETTE.ink2, mt: 1.25 }}>
          Token counts are exact (from Claude’s own usage records). The dollar figure is an estimate — tokens ×
          {data.pricing.versionsUsed.length
            ? ` cost model ${data.pricing.versionsUsed.map((v) => `v${v.version}`).join(', ')}`
            : ' the Lens cost model'}
          {license.seatSource === 'benchmark' ? '; seat price is an assumed benchmark (set the real one in Admin → Monitored Orgs).' : '.'}
        </Typography>
      </Paper>}

      {/* Good-practice capabilities */}
      <Paper elevation={0} sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
          <Typography sx={{ fontWeight: 700, color: PALETTE.navy, fontSize: 15 }}>
            Good-practice capabilities
          </Typography>
          <InfoTip term="capabilities" />
        </Box>
        <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, mb: 1.5 }}>
          The habits that most lift Claude&rsquo;s output. Zeros aren&rsquo;t a mark against you — just
          features worth trying.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1.5 }}>
          {CAPS.map((c) => (
            <CapCard key={c.key} label={c.label} value={capabilities[c.key] as number} term={c.term} nudge={c.nudge} />
          ))}
          <RateCapCard label="Edit acceptance" value={capabilities.editAcceptanceRate} term="capAcceptance" />
        </Box>
      </Paper>

      {/* What you use Claude for (prompt-type mix) */}
      <Paper elevation={0} sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
        <CardTitle term="promptTypes">What you use Claude for</CardTitle>
        <SignalBars signals={promptTypeShares} emptyText="Not enough prompts yet to break this down." />
      </Paper>

      {/* Model usage (ADDENDUM 18) */}
      <Paper elevation={0} sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
        <CardTitle>Model usage</CardTitle>
        <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
          Share of tokens by model, so you know which one is actually doing the work
        </Typography>
        <ModelUsageBars models={data.modelSplit} />
      </Paper>

      {/* Efficiency signals (ADDENDUM 21) — where tokens go without producing
          results. Ordered as a story: are you getting caching, are you losing
          context, is that because of how sessions are shaped, how fast are you
          going, and is the work on the right model. */}
      <Typography sx={{ fontSize: 15, fontWeight: 700, color: PALETTE.navy, mt: 3.5, mb: 0.25 }}>
        Where your tokens go
      </Typography>
      <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, mb: 2 }}>
        Cost and effort that don&rsquo;t show up as output. None of this feeds your score or skill tier —
        it&rsquo;s here to be useful, not to rank you.
      </Typography>

      {data.efficiencyCoverage.reporting < data.efficiencyCoverage.total && (
        <Typography sx={{ fontSize: 12, color: '#b26a00', mb: 2, fontStyle: 'italic' }}>
          Based on {data.efficiencyCoverage.reporting} of {data.efficiencyCoverage.total} days in range — the
          rest predate your collector&rsquo;s efficiency-tracking update, so the sums below don&rsquo;t cover
          the whole period.
        </Typography>
      )}

      <CacheCard cache={data.cache} />
      <ContextLossCard data={data.contextLoss} onSetUp={() => setDialogOpen(true)} />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2.5 }}>
        <SessionShapeCard data={data.sessionShape} onSetUp={() => setDialogOpen(true)} />
        <ParallelWorkCard data={data.concurrency} onSetUp={() => setDialogOpen(true)} />
      </Box>

      <PaceCard data={data.pace} reworkPct={vibe.reworkPct} onSetUp={() => setDialogOpen(true)} />
      <ModelFitCard
        rows={data.modelTasks}
        suggestions={data.modelSuggestions}
        onSetUp={() => setDialogOpen(true)}
      />

      {/* "Why prompts lost points" stays in Details — the score/mix trend charts
          and vibe index that used to sit alongside it moved to Overview, next to
          the headline numbers they explain. */}
      <Paper elevation={0} sx={{ p: 2, border: `1px solid ${PALETTE.border}`, borderRadius: 2, mb: 2.5 }}>
        <CardTitle term="signals">Why prompts lost points</CardTitle>
        <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
          Share of prompts tripping each signal
        </Typography>
        {(() => {
          const narrative = scoreNarrative(totals, data.signals);
          return narrative ? (
            <Typography sx={{ fontSize: 13, color: PALETTE.ink2, mb: 1.5, lineHeight: 1.6 }}>
              {narrative}
            </Typography>
          ) : null;
        })()}
        <SignalBars signals={data.signals} emptyText="No penalty signals in this period — nice." />
      </Paper>
      </>}

      {/* Score derivation, trend charts + vibe index — moved to Overview so the
          numbers on the headline tiles are explained right where they're seen,
          not several sections away. */}
      {data.hasData && tab === 'overview' && <>
      <Paper elevation={0} sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2, bgcolor: '#f7f9fc' }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: PALETTE.navy, mb: 0.5 }}>
          How your score is worked out
        </Typography>
        <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, lineHeight: 1.7 }}>
          Every prompt starts at 50 points, then moves: <b>+15</b> for giving context (a file, error, or path),{' '}
          <b>−20</b> for a vague catch-all like &ldquo;fix it&rdquo;, <b>−15</b> for a fast, low-effort re-prompt,{' '}
          <b>−10 to −25</b> for being too short. Your <b>{totals.avgScore}/100</b> above is the average of{' '}
          {totals.good + totals.ok + totals.poor} scored prompts this period — {totals.good} landed Good (≥70),{' '}
          {totals.ok} OK (40–69), {totals.poor} Poor (&lt;40). See exactly which habit is costing you points below.
        </Typography>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2.5 }}>
        <Paper elevation={0} sx={{ p: 2, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
          <CardTitle term="score">Average prompt score / day</CardTitle>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={dailyChart} margin={{ top: 5, right: 16, bottom: 5, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={PALETTE.grid} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke={PALETTE.axis} />
              <RTooltip />
              {/* connectNulls={false}: a day with nothing scored is a gap in the line,
                  not a drop to zero. */}
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
            <LegendDot color={PALETTE.good} label="Good ≥70" />
            <LegendDot color={PALETTE.ok} label="OK 40–69" />
            <LegendDot color={PALETTE.poor} label="Poor <40" />
          </Box>
        </Paper>
      </Box>

      <Paper elevation={0} sx={{ p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 }}>
        <CardTitle term="vibe">
          Vibe-coding index{' '}
          <Typography component="span" sx={{ fontSize: 12, color: PALETTE.ink2, fontWeight: 500, ml: 0.5 }}>
            · private to you
          </Typography>
        </CardTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
          <Chip label={`● ${vibeMeta.label}`} size="small"
            sx={{ bgcolor: `${vibeMeta.color}22`, color: vibeMeta.color, fontWeight: 700 }} />
          <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2 }}>structure vs free-text</Typography>
        </Box>
        {/* meter */}
        <Box sx={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: '2px', mb: 0.75 }}>
          {[0, 1, 2, 3, 4].map((i) => {
            const filled = vibe.index >= (i + 1) * 20 - 10;
            return <Box key={i} sx={{ flex: 1, bgcolor: filled ? vibeMeta.color : '#e5e7eb' }} />;
          })}
        </Box>
        <Typography sx={{ fontSize: 12, color: PALETTE.ink2 }}>Low structure ◄———► High structure</Typography>
        <Divider sx={{ my: 1.5 }} />
        <Typography sx={{ fontSize: 13.5, lineHeight: 1.9 }}>
          Skills used <b>{vibe.skillInvocations}</b> · MCP calls <b>{vibe.mcpCalls}</b> · tool-assisted turns{' '}
          <b>{vibe.toolAssistedPct}%</b>
          <br />
          Rework re-prompts <b>{vibe.reworkPct}%</b> · vague prompts <b>{vibe.vaguePct}%</b>
        </Typography>
      </Paper>

      {/* AI coaching — the most actionable content, seen at a glance on Overview. */}
      <Paper elevation={0} sx={{ p: 2, borderLeft: `3px solid ${PALETTE.navy}`, border: `1px solid ${PALETTE.border}`, borderRadius: 2, bgcolor: '#f7f9fc' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <AutoAwesomeIcon sx={{ fontSize: 16, color: PALETTE.navy }} />
            <Typography sx={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: PALETTE.ink2 }}>
              {coaching.source === 'ai' ? 'AI coaching' : 'Coaching'} · generated from your aggregate signals only
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            disabled={refreshCoaching.isPending}
            onClick={handleRefreshCoaching}
            sx={{ textTransform: 'none', fontSize: 12, flexShrink: 0 }}
          >
            {refreshCoaching.isPending ? 'Refreshing…' : 'Refresh'}
          </Button>
        </Box>
        <Typography sx={{ fontSize: 15, fontWeight: 650, mb: 1 }}>Ways to raise your score</Typography>
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {coaching.tips.map((tip, i) => (
            <Typography component="li" key={i} sx={{ fontSize: 14, color: '#374151', mb: 0.75, lineHeight: 1.5 }}>
              {tip}
            </Typography>
          ))}
        </Box>
      </Paper>
      </>}

      <Snackbar
        open={!!coachingSnackbar}
        autoHideDuration={6000}
        onClose={() => setCoachingSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={coachingSnackbar?.severity ?? 'info'} onClose={() => setCoachingSnackbar(null)} sx={{ width: '100%' }}>
          {coachingSnackbar?.msg}
        </Alert>
      </Snackbar>

      <CollectorDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </Box>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Box sx={{ width: 11, height: 11, borderRadius: '3px', bgcolor: color }} />
      {label}
    </Box>
  );
}

export default MyClaudeReport;
