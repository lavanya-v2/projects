import { useState, type MouseEvent } from 'react';
import type { ProjectQualityTrends, SprintQualityRow, MetricSummary } from '../team-performance/useQualityTrends';

export type MetricKey = 'productivity' | 'defectDensity' | 'reopenRatio';
export type Health = 'green' | 'amber' | 'red';

/** Health band → hex (semantic status colors). */
export const HEALTH_HEX: Record<Health, string> = { green: '#16a34a', amber: '#d97706', red: '#dc2626' };
/** Health band → CSS modifier class used by executive.css. */
export const HEALTH_CLASS: Record<Health, 'good' | 'warn' | 'crit'> = { green: 'good', amber: 'warn', red: 'crit' };

export interface MetricConfig {
  key: MetricKey;
  label: string;
  unit: string;
  tabValue: string;
  higherBetter: boolean;
  fmt: (v: number) => string;
  sprintValue: (s: SprintQualityRow) => number;
  summary: (p: ProjectQualityTrends) => MetricSummary;
  /** Short worded status for the given health band. */
  pill: (h: Health) => string;
  /** Health band for a raw metric value. */
  band: (v: number) => Health;
}

export const METRICS: Record<MetricKey, MetricConfig> = {
  productivity: {
    key: 'productivity', label: 'Productivity', unit: '%', tabValue: 'productivity', higherBetter: true,
    fmt: v => String(Math.round(v)), sprintValue: s => s.productivity, summary: p => p.productivity,
    pill: h => (h === 'green' ? 'On track' : h === 'amber' ? 'Watch' : 'At risk'),
    band: v => (v >= 80 ? 'green' : v >= 60 ? 'amber' : 'red'),
  },
  defectDensity: {
    key: 'defectDensity', label: 'Bug Density', unit: '', tabValue: 'bug-density', higherBetter: false,
    fmt: v => v.toFixed(2), sprintValue: s => s.defectDensity, summary: p => p.defectDensity,
    pill: h => (h === 'green' ? 'Healthy' : h === 'amber' ? 'Watch' : 'Elevated'),
    band: v => (v < 0.15 ? 'green' : v <= 0.3 ? 'amber' : 'red'),
  },
  reopenRatio: {
    key: 'reopenRatio', label: 'Reopen Ratio', unit: '%', tabValue: 'reopen-ratio', higherBetter: false,
    fmt: v => v.toFixed(1), sprintValue: s => s.reopenRatio, summary: p => p.reopenRatio,
    pill: h => (h === 'green' ? 'Stable' : h === 'amber' ? 'Watch' : 'Elevated'),
    band: v => (v < 10 ? 'green' : v <= 20 ? 'amber' : 'red'),
  },
};

export const METRIC_ORDER: MetricKey[] = ['productivity', 'defectDensity', 'reopenRatio'];

/** "How this is calculated" content, mirroring the internal methodology. */
export interface PopContent { title: string; body: string; formula: string; note: string; }

export const POPS: Record<string, PopContent> = {
  productivity: {
    title: 'Productivity', body: 'How much of the committed sprint scope the team delivered.',
    formula: 'Story points delivered ÷ story points planned × 100',
    note: 'Higher is better. Green ≥ 80% · Amber 60–80% · Red < 60%.',
  },
  defectDensity: {
    title: 'Bug Density', body: 'Defects surfaced relative to the work shipped in the sprint.',
    formula: 'Bugs logged in sprint ÷ story points delivered',
    note: 'Lower is better. Only bugs first raised inside the sprint window are counted.',
  },
  reopenRatio: {
    title: 'Reopen Ratio', body: 'Share of stories that had to be sent back to development.',
    formula: 'Reopened stories ÷ total stories × 100',
    note: 'Standalone bugs are included; sub-bugs are excluded to avoid double-counting.',
  },
  score: {
    title: 'Execution Score', body: 'A blended view of a developer’s delivery and how much rework it took.',
    formula: 'Delivery × 0.8  +  (100 − Rework) × 0.2',
    note: 'Delivery = SP done ÷ SP planned. Rework = share of effort spent redoing work.',
  },
  quality: {
    title: 'QA Quality', body: 'A tester’s effectiveness at catching issues before they reach the customer.',
    formula: 'UAT pass rate × 0.7  +  in-sprint catch × 0.3',
    note: 'Shown once a tester has covered ≥ 5 tickets. Weighted bugs: Critical ×3 · High ×2 · Medium ×1.5 · Low ×1.',
  },
  live: {
    title: 'Live Sprint',
    body: 'The active sprint, read in real time from Jira. Pipeline figures are story-point sums per stage (not ticket counts). Reopened is not tracked live, so it shows as “—”.',
    formula: 'Done % = SP done ÷ (SP done + SP remaining)',
    note: 'Pick the members you want, then load their live breakdown.',
  },
};

export const initials = (n: string) => (n || '').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase();

export function seriesTrend(values: number[], higherBetter: boolean) {
  if (values.length < 2) return { improving: true, diffPct: 0, cur: values[0] ?? 0, prevAvg: values[0] ?? 0 };
  const cur = values[values.length - 1];
  const prevAvg = values.slice(0, -1).reduce((a, b) => a + b, 0) / (values.length - 1);
  const diffPct = prevAvg === 0 ? 0 : ((cur - prevAvg) / prevAvg) * 100;
  const improving = higherBetter ? cur >= prevAvg : cur <= prevAvg;
  return { improving, diffPct, cur, prevAvg };
}

const ArrowUp = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M7 17L17 7M17 7H9M17 7v8" /></svg>
);
const ArrowDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M7 7l10 10M17 17H9M17 17V9" /></svg>
);

/** Trend pill (▲/▼ N%). `label` optionally appends "vs avg". */
export function Trend({ improving, diffPct, label }: { improving: boolean; diffPct: number; label?: string }) {
  return (
    <span className={`trend ${improving ? 'up' : 'down'}`}>
      {improving ? <ArrowUp /> : <ArrowDown />}
      {Math.abs(diffPct).toFixed(1)}%{label ? ` ${label}` : ''}
    </span>
  );
}

/** Inline sparkline SVG (ported from the mockup). Colored to match the tile's health. */
export function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 96, h = 30, p = 3;
  if (!values.length) return <svg className="spark" viewBox={`0 0 ${w} ${h}`} />;
  const min = Math.min(...values), max = Math.max(...values);
  const rng = (max - min) || 1;
  const pts = values.map((v, i) => {
    const x = p + (i * (w - 2 * p)) / Math.max(1, values.length - 1);
    const y = h - p - ((v - min) / rng) * (h - 2 * p);
    return [x, y] as const;
  });
  const d = pts.map((pt, i) => (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join(' ');
  const col = color;
  const last = pts[pts.length - 1];
  const area = `${d} L${last[0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`}>
      <path d={area} fill={col} opacity={0.08} />
      <path d={d} fill="none" stroke={col} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r={2.6} fill={col} />
    </svg>
  );
}

/**
 * The italic-"i" info button + a self-contained popover. The popover is
 * `position: fixed` at coordinates computed from the button, so it escapes the
 * `overflow: hidden` on the KPI/panel/card containers instead of being clipped.
 */
export function InfoPopover({ pop }: { pop: PopContent }) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    if (coords) { setCoords(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const W = 288;
    // prefer right-aligned to the button; clamp within the viewport
    let left = r.right - W;
    left = Math.max(12, Math.min(left, window.innerWidth - W - 12));
    setCoords({ top: r.bottom + 8, left });
  };

  return (
    <span className="pop-wrap">
      <button className="info" aria-label={`How ${pop.title} is calculated`} onClick={toggle}>i</button>
      {coords && (
        <>
          <div className="pop-back" onClick={() => setCoords(null)} />
          <div className="pop" role="dialog" style={{ top: coords.top, left: coords.left }}>
            <h4>{pop.title}</h4>
            {pop.body}
            <code className="formula">{pop.formula}</code>
            <span className="note">{pop.note}</span>
          </div>
        </>
      )}
    </span>
  );
}
