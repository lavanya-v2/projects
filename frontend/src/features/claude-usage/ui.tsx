import { Paper, Typography, Box, Tooltip } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { GLOSSARY, SIGNAL_EXPLAINERS } from './glossary';
import type { SignalShare, ModelSplit, SkillTier, CapabilityUsage, PromptTypeMix } from './types';

export const PALETTE = {
  navy: '#002e5b',
  blue: '#1f6fb2',
  orange: '#f15a24',
  good: '#4caf50',
  ok: '#ff9800',
  poor: '#f44336',
  grid: '#eef2f7',
  axis: '#94a3b8',
  ink2: '#6b7280',
  border: '#e0e4ea',
};

/** Shared so any surface showing a skill-tier badge (report header, dashboard indicator)
 * uses the same colors. */
export const TIER_META: Record<SkillTier['tier'], { color: string }> = {
  starting: { color: PALETTE.ink2 },
  building: { color: PALETTE.ok },
  strong: { color: PALETTE.blue },
  expert: { color: PALETTE.good },
};

export const toISODate = (d: Date) => d.toISOString().slice(0, 10);
export const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

export function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export const fmtDateTime = (value: string | null) => {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Short calendar day for chart axes: "2026-08-04" -> "Aug 4". */
export const shortDay = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** The ⓘ affordance sourced from the glossary. */
export function InfoTip({ term }: { term: keyof typeof GLOSSARY }) {
  const g = GLOSSARY[term];
  if (!g) return null;
  return (
    <Tooltip
      arrow
      title={
        <Box sx={{ p: 0.5, maxWidth: 260 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 12.5, mb: 0.5 }}>{g.title}</Typography>
          <Typography sx={{ fontSize: 12, lineHeight: 1.5 }}>{g.what}</Typography>
          <Typography sx={{ fontSize: 10.5, mt: 0.75, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.8 }}>
            How to improve
          </Typography>
          <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: '#a7f3d0' }}>{g.improve}</Typography>
        </Box>
      }
    >
      <InfoOutlinedIcon
        sx={{ fontSize: 15, color: PALETTE.axis, ml: 0.5, verticalAlign: 'middle', cursor: 'help' }}
      />
    </Tooltip>
  );
}

/** Shared between MyClaudeReport (self) and TeamMemberDetail (a lead's view of
 * one member) — the prompt-type category display names. */
export const PROMPT_TYPE_LABELS: Record<keyof PromptTypeMix, string> = {
  debugging: 'Debugging',
  codeGen: 'Building',
  refactor: 'Refactoring',
  review: 'Reviewing',
  explain: 'Explaining',
  other: 'Other',
};

/** Which good-practice capabilities to show, and in what order — shared between
 * MyClaudeReport and TeamMemberDetail so a lead sees the exact same categories. */
export const CAPS: Array<{ key: keyof CapabilityUsage; label: string; term: keyof typeof GLOSSARY; nudge: string }> = [
  { key: 'skills', label: 'Skills', term: 'capSkills', nudge: 'Wrap repeat tasks in a skill' },
  { key: 'mcp', label: 'MCP', term: 'capMcp', nudge: 'Connect your systems via MCP' },
  { key: 'planMode', label: 'Plan mode', term: 'capPlan', nudge: 'Plan before big changes' },
  { key: 'acceptEdits', label: 'Accept-edits', term: 'capAccept', nudge: 'Speed up low-risk changes' },
  { key: 'subagents', label: 'Subagents', term: 'capSubagents', nudge: 'Fan out research with subagents' },
  { key: 'taskPlanning', label: 'Task planning', term: 'capTask', nudge: 'Track multi-step work as to-dos' },
  { key: 'webResearch', label: 'Web research', term: 'capResearch', nudge: 'Ground answers in real sources' },
  { key: 'toolCalls', label: 'Tool calling', term: 'capTools', nudge: 'Let Claude drive the tools' },
  { key: 'distinctMcpServers', label: 'MCP servers', term: 'capMcpServers', nudge: 'Connect more of your systems' },
];

export function CapCard({ label, value, term, nudge }: { label: string; value: number; term: keyof typeof GLOSSARY; nudge: string }) {
  const zero = value === 0;
  return (
    <Box
      sx={{
        bgcolor: zero ? '#fbfbfc' : '#fff',
        border: `1px solid ${PALETTE.border}`,
        borderRadius: 1.5,
        p: 1.25,
        opacity: zero ? 0.85 : 1,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
        <Typography sx={{ fontSize: 11, color: PALETTE.ink2, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {label}
        </Typography>
        <InfoTip term={term} />
      </Box>
      <Typography sx={{ fontSize: 20, fontWeight: 800, color: zero ? PALETTE.ink2 : PALETTE.navy, lineHeight: 1.2 }}>
        {value.toLocaleString()}
      </Typography>
      <Typography sx={{ fontSize: 11, color: zero ? '#b26a00' : PALETTE.ink2 }}>
        {zero ? `Not used yet — ${nudge.toLowerCase()}` : nudge}
      </Typography>
    </Box>
  );
}

/** Like CapCard, but for a rate that can be null (no schemaVersion>=3 rows yet) — "—" not a zero-nudge. */
export function RateCapCard({ label, value, term }: { label: string; value: number | null; term: keyof typeof GLOSSARY }) {
  const noData = value == null;
  return (
    <Box sx={{ bgcolor: noData ? '#fbfbfc' : '#fff', border: `1px solid ${PALETTE.border}`, borderRadius: 1.5, p: 1.25, opacity: noData ? 0.85 : 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
        <Typography sx={{ fontSize: 11, color: PALETTE.ink2, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {label}
        </Typography>
        <InfoTip term={term} />
      </Box>
      <Typography sx={{ fontSize: 20, fontWeight: 800, color: noData ? PALETTE.ink2 : PALETTE.navy, lineHeight: 1.2 }}>
        {noData ? '—' : `${value}%`}
      </Typography>
      <Typography sx={{ fontSize: 11, color: PALETTE.ink2 }}>
        {noData ? 'Not enough edits yet' : 'kept vs. undone/rejected'}
      </Typography>
    </Box>
  );
}

export function StatCard({
  label,
  value,
  hint,
  color = PALETTE.navy,
  term,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  color?: string;
  term?: keyof typeof GLOSSARY;
}) {
  return (
    <Paper elevation={0} sx={{ p: 2, border: `1px solid ${PALETTE.border}`, borderRadius: 2, height: '100%' }}>
      <Typography sx={{ fontSize: 12, color: PALETTE.ink2, fontWeight: 500, display: 'flex', alignItems: 'center' }}>
        {label}
        {term && <InfoTip term={term} />}
      </Typography>
      <Typography sx={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1.2, mt: 0.5 }}>{value}</Typography>
      {hint && <Typography sx={{ fontSize: 11, color: '#9ca3af', mt: 0.5 }}>{hint}</Typography>}
    </Paper>
  );
}

/**
 * Ranked share list for the penalty signals — sorted, always labelled, and scaled to a
 * rounded max rather than a fixed 0-100 so small shares stay visible. Zero rows are kept
 * (dimmed) because "never tripped this" is a result, not missing data.
 */
export function SignalBars({
  signals,
  emptyText = 'No penalty signals in this period.',
}: {
  signals: SignalShare[];
  emptyText?: string;
}) {
  const rows = signals
    .map((s, i) => ({ ...s, i }))
    .sort((a, b) => b.pct - a.pct || a.i - b.i);
  const max = rows.reduce((m, r) => Math.max(m, r.pct), 0);

  if (!rows.length || max === 0) {
    return (
      <Typography sx={{ fontSize: 13, color: PALETTE.ink2, py: 2 }}>{emptyText}</Typography>
    );
  }

  const axisMax = Math.max(20, Math.ceil(max / 10) * 10);

  return (
    <Box>
      {rows.map((r) => {
        const zero = r.pct === 0;
        return (
          <Box key={r.key} sx={{ mb: 1.5, '&:last-of-type': { mb: 0 } }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
              <Tooltip
                arrow
                enterDelay={300}
                title={
                  SIGNAL_EXPLAINERS[r.key] ? (
                    <Box sx={{ p: 0.5, maxWidth: 260 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 12.5, mb: 0.5 }}>{r.label}</Typography>
                      <Typography sx={{ fontSize: 12, lineHeight: 1.5 }}>{SIGNAL_EXPLAINERS[r.key].what}</Typography>
                      <Typography sx={{ fontSize: 10.5, mt: 0.75, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.8 }}>
                        Example
                      </Typography>
                      <Typography sx={{ fontSize: 12, lineHeight: 1.5, fontStyle: 'italic', color: '#a7f3d0' }}>
                        {SIGNAL_EXPLAINERS[r.key].example}
                      </Typography>
                    </Box>
                  ) : (
                    r.label
                  )
                }
              >
                <Typography
                  sx={{
                    fontSize: 12.5,
                    color: zero ? PALETTE.ink2 : PALETTE.navy,
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.label}
                </Typography>
              </Tooltip>
              <Typography
                sx={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: zero ? PALETTE.ink2 : PALETTE.navy,
                  width: 44,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {r.pct}%
              </Typography>
            </Box>
            <Box sx={{ height: 8, borderRadius: 4, bgcolor: PALETTE.grid, overflow: 'hidden' }}>
              {!zero && (
                <Box
                  sx={{
                    height: '100%',
                    minWidth: 3,
                    width: `${(r.pct / axisMax) * 100}%`,
                    borderRadius: 4,
                    bgcolor: PALETTE.blue,
                  }}
                />
              )}
            </Box>
          </Box>
        );
      })}
      <Typography sx={{ fontSize: 11.5, color: PALETTE.ink2, mt: 1.5 }}>
        A prompt can trip more than one signal, so shares don&rsquo;t add up to 100%.
      </Typography>
    </Box>
  );
}

/**
 * Model-usage bars (ADDENDUM 18) — % of tokens per model + estimated cost, so
 * engineers/leads can see which model is actually doing the work. Mirrors
 * SignalBars' visual style but keyed by model name, not a fixed signal set.
 */
export function ModelUsageBars({
  models,
  emptyText = 'No model usage in this period.',
}: {
  models: ModelSplit[];
  emptyText?: string;
}) {
  const total = models.reduce((s, m) => s + m.tokens, 0);
  if (!models.length || total === 0) {
    return <Typography sx={{ fontSize: 13, color: PALETTE.ink2, py: 2 }}>{emptyText}</Typography>;
  }
  return (
    <Box>
      {models.map((m) => {
        const pct = total ? Math.round((m.tokens / total) * 100) : 0;
        return (
          <Box key={m.model} sx={{ mb: 1.5, '&:last-of-type': { mb: 0 } }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
              <Typography
                sx={{
                  fontSize: 12.5,
                  color: PALETTE.navy,
                  flex: 1,
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {m.model}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: PALETTE.ink2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {fmtTokens(m.tokens)} tok &middot; ${m.cost.toLocaleString()}
              </Typography>
              <Typography
                sx={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: PALETTE.navy,
                  width: 38,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {pct}%
              </Typography>
            </Box>
            <Box sx={{ height: 8, borderRadius: 4, bgcolor: PALETTE.grid, overflow: 'hidden' }}>
              <Box sx={{ height: '100%', minWidth: 3, width: `${pct}%`, borderRadius: 4, bgcolor: PALETTE.blue }} />
            </Box>
          </Box>
        );
      })}
      <Typography sx={{ fontSize: 11.5, color: PALETTE.ink2, mt: 1.5 }}>
        Cost is an estimate at API list prices, not a bill.
      </Typography>
    </Box>
  );
}

/**
 * A small column histogram for distributions the bar lists can't express —
 * session sizes and prompt gaps, where the ORDER of the buckets is the meaning
 * (left-heavy vs right-heavy) and sorting by value would destroy it. That's why
 * this exists alongside SignalBars rather than reusing it.
 *
 * `tone` lets a bucket carry a judgement (e.g. very short sessions, reflex
 * prompts) without a legend.
 */
export function BucketHistogram({
  buckets,
  format = (n) => String(n),
}: {
  buckets: Array<{ label: string; value: number; tone?: 'neutral' | 'warn' | 'bad' }>;
  format?: (n: number) => string;
}) {
  const max = buckets.reduce((m, b) => Math.max(m, b.value), 0);
  if (!max) {
    return <Typography sx={{ fontSize: 13, color: PALETTE.ink2, py: 2 }}>Nothing recorded in this period.</Typography>;
  }
  const color = (tone?: string) =>
    tone === 'bad' ? PALETTE.poor : tone === 'warn' ? PALETTE.ok : PALETTE.blue;
  return (
    <Box>
      <Box sx={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', gap: 1.25, alignItems: 'end', height: 132 }}>
        {buckets.map((b) => (
          <Box key={b.label} sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 0.75, height: '100%' }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: PALETTE.navy, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
              {format(b.value)}
            </Typography>
            <Box sx={{ height: `${Math.max(3, (b.value / max) * 100)}%`, bgcolor: color(b.tone), borderRadius: '3px 3px 0 0' }} />
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: '1fr', gap: 1.25, borderTop: `1px solid ${PALETTE.grid}`, mt: 0.75, pt: 0.75 }}>
        {buckets.map((b) => (
          <Typography key={b.label} sx={{ fontSize: 10.5, color: PALETTE.ink2, textAlign: 'center' }}>
            {b.label}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

/**
 * The forward-only empty state. These metrics were never backfilled, so a range
 * that predates collector 1.5.0 has genuinely never measured them — showing a
 * zero would assert something false (e.g. "you lost no context").
 */
export function NotMeasuredYet({ what, onSetUp }: { what: string; onSetUp?: () => void }) {
  return (
    <Box sx={{ border: `1px dashed ${PALETTE.border}`, borderRadius: 2, p: 2.5, textAlign: 'center', bgcolor: '#fcfdfe' }}>
      <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: PALETTE.navy, mb: 0.5 }}>Not measured yet</Typography>
      <Typography sx={{ fontSize: 12.5, color: PALETTE.ink2, lineHeight: 1.6, maxWidth: 460, mx: 'auto' }}>
        {what} starts being recorded once your collector is updated. Nothing updates
        itself, and past days can&rsquo;t be filled in retrospectively.
      </Typography>
      {onSetUp && (
        <Typography
          component="button"
          onClick={onSetUp}
          sx={{
            mt: 1.25, border: 0, background: 'none', p: 0, font: 'inherit', fontSize: 12.5,
            fontWeight: 600, color: PALETTE.blue, cursor: 'pointer', textDecoration: 'underline',
          }}
        >
          How to update
        </Typography>
      )}
    </Box>
  );
}

/** A verdict pill for a metric that has a healthy / watch / act reading. */
export function VerdictChip({ tone, label }: { tone: 'good' | 'ok' | 'poor'; label: string }) {
  const color = tone === 'good' ? PALETTE.good : tone === 'ok' ? PALETTE.ok : PALETTE.poor;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex', alignItems: 'center', borderRadius: 16, px: 1.25, py: 0.25,
        bgcolor: `${color}22`, color, fontSize: 11.5, fontWeight: 700,
      }}
    >
      ● {label}
    </Box>
  );
}

export function CardTitle({ children, term }: { children: React.ReactNode; term?: keyof typeof GLOSSARY }) {
  return (
    <Typography sx={{ fontSize: 14, fontWeight: 600, color: PALETTE.navy, mb: 1.5, display: 'flex', alignItems: 'center' }}>
      {children}
      {term && <InfoTip term={term} />}
    </Typography>
  );
}
