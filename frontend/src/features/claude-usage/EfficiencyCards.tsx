import { Box, Paper, Typography } from '@mui/material';
import {
  PALETTE,
  StatCard,
  CardTitle,
  BucketHistogram,
  NotMeasuredYet,
  VerdictChip,
  fmtTokens,
} from './ui';
import type {
  CacheEfficiency,
  ContextLoss,
  SessionShape,
  ConcurrencyView,
  PaceView,
  ModelTaskRow,
  ModelSuggestion,
  PromptTypeMix,
} from './types';

/**
 * The efficiency cards: where tokens go without producing results.
 *
 * Split out of MyClaudeReport because these six read as one story — caching,
 * context loss, session shape, parallel work, pace, model fit — and every one of
 * them pairs a number with a "Reading" block. A metric here without a reading is
 * just a number to feel bad about, which is the opposite of the intent.
 */

const CARD = { p: 2, mb: 2.5, border: `1px solid ${PALETTE.border}`, borderRadius: 2 } as const;

/** The interpretation attached to every efficiency metric. */
function Reading({ tone = 'neutral', children }: { tone?: 'neutral' | 'caution'; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        mt: 1.75, p: 1.5, bgcolor: '#f7f9fc', border: `1px solid ${PALETTE.border}`,
        borderLeft: `3px solid ${tone === 'caution' ? PALETTE.ok : PALETTE.navy}`, borderRadius: 1.5,
      }}
    >
      <Typography sx={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: PALETTE.ink2, mb: 0.75 }}>
        Reading
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.25 }}>{children}</Box>
    </Box>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="li" sx={{ fontSize: 13.5, color: '#374151', lineHeight: 1.6, mb: 0.75, '&:last-of-type': { mb: 0 } }}>
      {children}
    </Typography>
  );
}

function MiniStat({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  return (
    <Box sx={{ bgcolor: '#f7f9fc', border: `1px solid ${PALETTE.border}`, borderRadius: 1.5, px: 1.5, py: 1.25 }}>
      <Typography sx={{ fontSize: 11, color: PALETTE.ink2 }}>{label}</Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 700, color: color ?? PALETTE.navy, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 11, color: '#9ca3af' }}>{sub}</Typography>
    </Box>
  );
}

const VERDICT_LABEL: Record<CacheEfficiency['verdict'], { tone: 'good' | 'ok' | 'poor'; label: string }> = {
  healthy: { tone: 'good', label: 'Healthy' },
  partial: { tone: 'ok', label: 'Partial' },
  investigate: { tone: 'poor', label: 'Worth a look' },
};

export function CacheCard({ cache }: { cache: CacheEfficiency }) {
  const v = VERDICT_LABEL[cache.verdict];
  const context = cache.read + cache.write + cache.fresh;
  const pct = (n: number) => (context ? Math.round((n / context) * 1000) / 10 : 0);
  return (
    <Paper elevation={0} sx={CARD}>
      <CardTitle term="cache">Prompt caching</CardTitle>
      <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
        Claude re-reads your conversation on every turn. This is how much of that re-reading you get at the
        cheaper cached rate.
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 2 }}>
        <StatCard
          label="Cache hit rate"
          value={`${cache.hitRatePct}%`}
          color={cache.verdict === 'healthy' ? PALETTE.good : cache.verdict === 'partial' ? PALETTE.ok : PALETTE.poor}
          hint="of context tokens"
        />
        <StatCard label="Read from cache" value={fmtTokens(cache.read)} hint="at the cached rate" />
        <StatCard label="Cache writes" value={fmtTokens(cache.write)} hint="cost of establishing it" />
        <StatCard
          label="Saved vs no cache"
          value={`$${cache.savedUsd.toLocaleString()}`}
          color={PALETTE.good}
          hint="estimate at list prices"
        />
      </Box>

      <Box sx={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', mb: 1 }}>
        <Box sx={{ width: `${pct(cache.read)}%`, bgcolor: PALETTE.good }} />
        <Box sx={{ width: `${pct(cache.write)}%`, bgcolor: PALETTE.ok }} />
        <Box sx={{ width: `${pct(cache.fresh)}%`, bgcolor: PALETTE.poor }} />
      </Box>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: 11.5, color: PALETTE.ink2 }}>
        <span>● Cached {pct(cache.read)}%</span>
        <span>● First read {pct(cache.write)}%</span>
        <span>● Uncached {pct(cache.fresh)}%</span>
      </Box>

      <Reading>
        <Point><VerdictChip tone={v.tone} label={v.label} /></Point>
        {cache.verdict === 'healthy' ? (
          <Point>Caching is doing its job. There is nothing to configure and nothing to change.</Point>
        ) : (
          <Point>
            Below 85% usually means sessions are being restarted often — a fresh session pays full
            price to read context back in. The session cards below will show whether that is what is happening.
          </Point>
        )}
      </Reading>
    </Paper>
  );
}

export function ContextLossCard({ data, onSetUp }: { data: ContextLoss | null; onSetUp?: () => void }) {
  return (
    <Paper elevation={0} sx={CARD}>
      <CardTitle term="contextLoss">Context loss</CardTitle>
      <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
        When a conversation outgrows the context window, most of its history is thrown away and summarised.
        Everything dropped has to be re-established.
      </Typography>

      {!data ? (
        <NotMeasuredYet what="Context loss" onSetUp={onSetUp} />
      ) : data.compactions === 0 ? (
        <Typography sx={{ fontSize: 13.5, color: PALETTE.ink2, py: 1 }}>
          No context was lost in this period — your conversations stayed inside the window.
        </Typography>
      ) : (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 2 }}>
            <StatCard
              label="Times context was lost"
              value={data.compactions}
              color={data.auto > 0 ? PALETTE.ok : PALETTE.navy}
              hint={`${data.auto} automatic · ${data.manual} you triggered`}
            />
            <StatCard
              label="Tokens thrown away"
              value={fmtTokens(data.droppedTokens)}
              color={PALETTE.poor}
              hint={`≈ $${data.costUsd.toLocaleString()} to rebuild`}
            />
            <StatCard label="Time spent compacting" value={`${data.minutes} min`} hint="blocked, waiting" />
            <StatCard
              label="Context size when it hit"
              value={fmtTokens(data.avgPreTokens)}
              hint="average across events"
            />
          </Box>

          <Reading tone={data.auto > 0 ? 'caution' : 'neutral'}>
            {data.auto > 0 ? (
              <>
                <Point>
                  <b>{data.auto} automatic {data.auto === 1 ? 'compaction' : 'compactions'}</b> — the conversation
                  ran out of room mid-task. That is the number worth acting on.
                </Point>
                <Point>
                  The fix is scope, not discipline: one session per task. A session that has already absorbed
                  several unrelated tasks will run out during the next one.
                </Point>
              </>
            ) : (
              <Point>
                All {data.manual} {data.manual === 1 ? 'compaction was' : 'compactions were'} triggered by you.
                That is deliberate — you chose the moment and kept what mattered. No action needed.
              </Point>
            )}
            {data.manual > 0 && data.auto > 0 && (
              <Point>The other {data.manual} you triggered yourself, which is not a problem.</Point>
            )}
          </Reading>
        </>
      )}
    </Paper>
  );
}

export function SessionShapeCard({ data, onSetUp }: { data: SessionShape | null; onSetUp?: () => void }) {
  return (
    <Paper elevation={0} sx={{ ...CARD, mb: 0, height: '100%' }}>
      <CardTitle term="sessionShape">Session shape</CardTitle>
      <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
        How much work each session carried before you started a new one.
      </Typography>

      {!data ? (
        <NotMeasuredYet what="Session shape" onSetUp={onSetUp} />
      ) : (
        <>
          <BucketHistogram
            buckets={[
              { label: '1–5 prompts', value: data.sizeBuckets.s1_5, tone: 'warn' },
              { label: '6–20', value: data.sizeBuckets.s6_20 },
              { label: '21–100', value: data.sizeBuckets.s21_100 },
              { label: '100+', value: data.sizeBuckets.s100plus },
            ]}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mt: 1.75 }}>
            <MiniStat label="Sessions" value={String(data.sessions)} sub="in this period" />
            <MiniStat
              label="Short sessions"
              value={`${data.shortSessionPct}%`}
              sub="5 prompts or fewer"
              color={data.shortSessionPct >= 40 ? PALETTE.ok : PALETTE.navy}
            />
          </Box>
          <Reading tone={data.shortSessionPct >= 40 ? 'caution' : 'neutral'}>
            {data.shortSessionPct >= 40 ? (
              <Point>
                <b>{data.sizeBuckets.s1_5} sessions ended within five prompts.</b> Each paid full price to load
                context and then discarded it — that is what pulls a cache hit rate down.
              </Point>
            ) : (
              <Point>Your sessions are carrying real work before you start a new one — that is the shape you want.</Point>
            )}
            <Point>
              A healthy distribution is fat in the middle. Heavy on the left means restarting too often; heavy on
              the right means sessions that will eventually compact.
            </Point>
          </Reading>
        </>
      )}
    </Paper>
  );
}

export function ParallelWorkCard({ data, onSetUp }: { data: ConcurrencyView | null; onSetUp?: () => void }) {
  return (
    <Paper elevation={0} sx={{ ...CARD, mb: 0, height: '100%' }}>
      <CardTitle term="parallelWork">Parallel work</CardTitle>
      <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
        Several conversations open at once. Not a problem in itself — each one just pays for its own context.
      </Typography>

      {!data ? (
        <NotMeasuredYet what="Parallel work" onSetUp={onSetUp} />
      ) : (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 1.75 }}>
            <StatCard
              label="Peak at once"
              value={data.maxConcurrent}
              color={data.maxConcurrent >= 3 ? PALETTE.ok : PALETTE.navy}
              hint="sessions overlapping in time"
            />
            <StatCard
              label="Days with overlap"
              value={`${data.daysWithOverlap} of ${data.activeDays}`}
              hint="active days in range"
            />
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <MiniStat label="Session switches" value={String(data.switches)} sub="prompt moved to another session" />
            <MiniStat
              label="Within 5 minutes"
              value={`${data.switchesUnder5m}`}
              sub={`${data.rapidSwitchPct}% of switches`}
              color={data.rapidSwitchPct >= 50 ? PALETTE.ok : PALETTE.navy}
            />
          </Box>
          <Reading>
            <Point>
              A peak of {data.maxConcurrent} is ordinary — a build running in one window while you work in another.
            </Point>
            {data.switchesUnder5m > 0 && (
              <Point>
                The signal is the rapid ones: <b>{data.switchesUnder5m} switches happened within five minutes</b>.
                That is several problems held at once, and it tends to track with the vague and rework signals below.
              </Point>
            )}
            <Point>
              This is <b>not</b> a productivity score. Two people with identical output can sit at either end of it.
            </Point>
          </Reading>
        </>
      )}
    </Paper>
  );
}

export function PaceCard({ data, reworkPct, onSetUp }: { data: PaceView | null; reworkPct: number; onSetUp?: () => void }) {
  return (
    <Paper elevation={0} sx={CARD}>
      <CardTitle term="pace">Pace between prompts</CardTitle>
      <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
        How long you leave between Claude finishing and your next prompt.
      </Typography>

      {!data ? (
        <NotMeasuredYet what="Prompt pace" onSetUp={onSetUp} />
      ) : (
        <>
          <BucketHistogram
            buckets={[
              { label: 'under 10s', value: data.gapBuckets.lt10s, tone: data.immediatePct >= 40 ? 'bad' : 'neutral' },
              { label: '10–60s', value: data.gapBuckets.s10_60 },
              { label: '1–5 min', value: data.gapBuckets.m1_5 },
              { label: '5–30 min', value: data.gapBuckets.m5_30 },
              { label: 'over 30 min', value: data.gapBuckets.gt30m },
            ]}
          />
          <Reading tone={data.immediatePct >= 40 ? 'caution' : 'neutral'}>
            {data.immediatePct >= 40 ? (
              <Point>
                <b>{data.immediatePct}% of your prompts land within ten seconds</b> of the previous answer — faster
                than that answer can be read. Those are mostly reflex replies.
              </Point>
            ) : (
              <Point>
                {data.immediatePct}% of prompts follow within ten seconds, which leaves room to actually read the output.
              </Point>
            )}
            <Point>
              Your rework rate is <b>{reworkPct}%</b>. When both are high, the same ground is being re-covered at
              full token cost.
            </Point>
            <Point>Slower is not better — a healthy profile has quick confirmations and real reading gaps.</Point>
          </Reading>
        </>
      )}
    </Paper>
  );
}

const MIX_LABELS: Array<{ key: keyof PromptTypeMix; label: string }> = [
  { key: 'debugging', label: 'Debugging' },
  { key: 'codeGen', label: 'Building' },
  { key: 'refactor', label: 'Refactoring' },
  { key: 'review', label: 'Reviewing' },
  { key: 'explain', label: 'Explaining' },
  { key: 'other', label: 'Other' },
];

export function ModelFitCard({
  rows,
  suggestions,
  onSetUp,
}: {
  rows: ModelTaskRow[] | null;
  suggestions: ModelSuggestion[];
  onSetUp?: () => void;
}) {
  return (
    <Paper elevation={0} sx={CARD}>
      <CardTitle term="modelFit">Model fit</CardTitle>
      <Typography sx={{ fontSize: 12, color: PALETTE.ink2, mt: -1, mb: 1.5 }}>
        Which model answered which kind of work — the basis for picking a cheaper one where it would do just as well.
      </Typography>

      {!rows ? (
        <NotMeasuredYet what="Model fit" onSetUp={onSetUp} />
      ) : !rows.length ? (
        <Typography sx={{ fontSize: 13.5, color: PALETTE.ink2, py: 1 }}>
          No model-task activity recorded in this period.
        </Typography>
      ) : (
        <>
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" sx={TH}>Model</Box>
                  {MIX_LABELS.map((c) => (
                    <Box component="th" key={c.key} sx={{ ...TH, textAlign: 'right' }}>{c.label}</Box>
                  ))}
                  <Box component="th" sx={{ ...TH, textAlign: 'right' }}>Tokens</Box>
                  <Box component="th" sx={{ ...TH, textAlign: 'right' }}>Est. cost</Box>
                </Box>
              </Box>
              <Box component="tbody">
                {rows.map((r) => (
                  <Box component="tr" key={r.model}>
                    <Box component="td" sx={{ ...TD, fontWeight: 600 }}>{r.model}</Box>
                    {MIX_LABELS.map((c) => (
                      <Box component="td" key={c.key} sx={{ ...TD, textAlign: 'right' }}>{r.mix[c.key]}</Box>
                    ))}
                    <Box component="td" sx={{ ...TD, textAlign: 'right' }}>{fmtTokens(r.tokens)}</Box>
                    <Box component="td" sx={{ ...TD, textAlign: 'right' }}>${r.cost.toLocaleString()}</Box>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>

          <Reading>
            {suggestions.length ? (
              suggestions.map((s, i) => (
                <Point key={i}>
                  {s.detail}
                  {s.monthlySavingUsd != null && s.monthlySavingUsd > 0 && (
                    <> Roughly <b>${s.monthlySavingUsd.toLocaleString()}/month</b> at this volume.</>
                  )}
                </Point>
              ))
            ) : (
              <Point>
                Nothing stands out — the work you send to each model broadly matches what that model is for.
              </Point>
            )}
            <Point>
              Keep debugging and code generation on the most capable model. A cheaper one there usually costs more
              overall, because the retry loop runs longer than the saving.
            </Point>
          </Reading>
        </>
      )}
    </Paper>
  );
}

const TH = {
  fontSize: 11,
  fontWeight: 600,
  color: PALETTE.navy,
  bgcolor: '#fafbfc',
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  textAlign: 'left',
  p: '10px 12px',
  borderBottom: `1px solid ${PALETTE.border}`,
  whiteSpace: 'nowrap',
} as const;

const TD = {
  fontSize: 13,
  p: '9px 12px',
  borderBottom: `1px solid ${PALETTE.grid}`,
  fontVariantNumeric: 'tabular-nums',
} as const;
