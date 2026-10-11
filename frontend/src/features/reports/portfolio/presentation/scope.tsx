import { ToggleButton, ToggleButtonGroup, Box, Typography } from '@mui/material';

// Per-slide metric scope. The delivery presentation defaults to the whole team
// (every contributor on the board) and can be flipped to V2 (the V2 team's own
// contribution) per slide. Both scopes are precomputed on the backend from
// PerfTicketFact using the SAME formulas as Team Performance Trends, so each
// scope reconciles to the Board View by construction.
export type Scope = 'v2' | 'overall';
export const DEFAULT_SCOPE: Scope = 'overall';

export function scopeShortLabel(scope: Scope): string {
  return scope === 'v2' ? 'V2 Team' : 'Whole Team';
}

// Footnote stamped on each scoped slide (and into the PDF) so a saved export is
// self-documenting about which scope the numbers represent.
export function scopeFootnote(scope: Scope): string {
  return scope === 'v2'
    ? 'Scope: V2 Team Members Only.'
    : 'Scope: Whole Team (all contributors on the board).';
}

// True when the drilldown actually carries dual-scope data (perf projects with
// PerfTicketFact). WSR/Kanban drilldowns and older saved presentations don't —
// the toggle is hidden for them and the base numbers render unchanged.
export function hasScopeData(d: any): boolean {
  return !!(d?.metricsByScope?.v2 && d?.metricsByScope?.overall);
}

export function anyScopeData(drilldowns: any[]): boolean {
  return Array.isArray(drilldowns) && drilldowns.some(hasScopeData);
}

// Resolve a drilldown's sprint + quality metrics for the chosen scope. Falls
// back to the base (unscoped) objects when no metricsByScope is present.
// planned / capacity ARE scope-dependent (V2 vs whole-team committed SP) and are
// overridden alongside delivered SP, so the "delivered / planned" ratio compares
// the same population in each scope. Spillover / scope-added follow the scope too
// (their % denominator is the scope's planned SP), so they switch with the toggle.
// Per-sprint rows are merged by syncId: the scope supplies planned/delivered/
// reopen/bug, the base keeps per-sprint spillover/scope-added.
// (sc.planned/capacity are absent on presentations saved before this fix — the
// `?? base` fallbacks keep those rendering unchanged until refreshed/recreated.)
export function scopedDrilldown(d: any, scope: Scope): { m: any; q: any } {
  const baseM = d?.sprintMetrics || {};
  const baseQ = d?.qualityMetrics || {};
  const sc = d?.metricsByScope?.[scope];
  if (!sc) return { m: baseM, q: baseQ };

  const scBySync = new Map<number, any>();
  for (const p of (sc.perSprint || [])) scBySync.set(p.syncId, p);
  const mergedPerSprint = Array.isArray(baseM.perSprint)
    ? baseM.perSprint.map((p: any) => {
        const s = scBySync.get(p.syncId);
        if (!s) return p;
        return {
          ...p,
          planned: s.planned ?? p.planned,
          actual: s.deliveredSP,
          deliveredCount: s.deliveredCount,
          reopenedCount: s.reopenedCount,
          reopenRatePct: s.reopenRatePct,
          bugsRaised: s.bugCount,
        };
      })
    : baseM.perSprint;

  return {
    m: {
      ...baseM,
      planned: sc.planned ?? baseM.planned,
      capacity: sc.capacity ?? baseM.capacity,
      actual: sc.actual,
      deliveredCount: sc.deliveredCount,
      reopenedCount: sc.reopenedCount,
      reopenRatePct: sc.reopenRatePct,
      productivityPct: sc.productivityPct,
      // Spillover / scope-added switch with the scope; ?? base keeps
      // presentations saved before this fix rendering unchanged until refreshed.
      spillovers: sc.spillovers ?? baseM.spillovers,
      spilloverCount: sc.spilloverCount ?? baseM.spilloverCount,
      spilloverPct: sc.spilloverPct ?? baseM.spilloverPct,
      scopeAddedSP: sc.scopeAddedSP ?? baseM.scopeAddedSP,
      scopeAddedCount: sc.scopeAddedCount ?? baseM.scopeAddedCount,
      scopeCreepPct: sc.scopeCreepPct ?? baseM.scopeCreepPct,
      // Removed (punted) + re-estimation residual — switch with the scope.
      removedSp: sc.removedSp ?? baseM.removedSp,
      removedCount: sc.removedCount ?? baseM.removedCount,
      removedPct: sc.removedPct ?? baseM.removedPct,
      reEstimatedSp: sc.reEstimatedSp ?? baseM.reEstimatedSp,
      perSprint: mergedPerSprint,
    },
    q: {
      ...baseQ,
      validBugs: sc.validBugs,
      bugDensityPct: sc.bugDensityPct,
      storyPoints: sc.storyPoints,
    },
  };
}

// Headline metric fields a presenter can manually override per scope. These are
// the primary numbers shown on the Delivery card / Overview / KPI tiles. The
// percentages (spillover/scope/removed/reopen) are NOT stored — they are
// re-derived from the effective numbers below so they always match.
export const OVERRIDABLE_METRIC_FIELDS = [
  'capacity', 'actual', 'deliveredCount',
  'spillovers', 'spilloverCount',
  'scopeAddedSP', 'scopeAddedCount',
  'removedSp', 'removedCount',
  'reEstimatedSp', 'reopenedCount',
] as const;
// validBugs lives on qualityMetrics, not sprintMetrics.
export const OVERRIDABLE_QUALITY_FIELDS = ['validBugs'] as const;

const derivePct = (num: number, denom: number) =>
  denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0;

// Apply a scope's manual HEADLINE overrides on top of the factual scoped
// metrics. Edits are a SEPARATE layer (drilldown.metricsOverrideByScope[scope])
// that feeds only the high-level total displays — the Delivery card, KPI tiles,
// and per-project Overview row. It is intentionally NOT applied to m.perSprint,
// team tables, or trend data, so every graph / breakdown table stays faithful to
// the imported facts. Returns edited m/q plus the set of overridden field keys
// (for the "adjusted" marker). Percentages are re-derived from the effective
// numbers so what's shown is always internally consistent.
export function applyHeadlineOverride(
  m: any,
  q: any,
  override: any,
): { m: any; q: any; edited: Set<string> } {
  const edited = new Set<string>();
  if (!override || typeof override !== 'object') return { m, q, edited };
  const num = (v: any) => (v === '' || v == null ? undefined : Number(v));
  const em = { ...m };
  const eq = { ...q };
  for (const f of OVERRIDABLE_METRIC_FIELDS) {
    const v = num(override[f]);
    if (v == null || Number.isNaN(v)) continue;
    em[f] = v;
    edited.add(f);
    if (f === 'capacity') em.planned = v; // capacity == planned (committed SP)
  }
  for (const f of OVERRIDABLE_QUALITY_FIELDS) {
    const v = num(override[f]);
    if (v == null || Number.isNaN(v)) continue;
    eq[f] = v;
    edited.add(f);
  }
  if (edited.size === 0) return { m, q, edited };
  // Re-derive percentages from the effective numbers.
  const cap = Number(em.capacity) || 0;
  em.spilloverPct = derivePct(Number(em.spillovers) || 0, cap);
  em.scopeCreepPct = derivePct(Number(em.scopeAddedSP) || 0, cap);
  em.removedPct = derivePct(Number(em.removedSp) || 0, cap);
  em.reopenRatePct = derivePct(Number(em.reopenedCount) || 0, Number(em.deliveredCount) || 0);
  em.productivityPct = cap > 0 ? derivePct(Number(em.actual) || 0, cap) : 0;
  return { m: em, q: eq, edited };
}

// Net scope change = SP pulled IN mid-sprint − SP pulled OUT. This is the
// headline SM number, and the only "scope" figure shown on the Overview row and
// the Delivery card, so the two can't disagree. The backend never emits a net —
// it produces scopeAddedSP (wasScopeChange facts) and removedSp (wasPunted
// facts, set by applyBoard) separately — so the subtraction lives here.
// removedSp is absent on drilldowns that never ran the Board reconciliation
// (presentations saved before it, non-perf projects) — there, gross adds ARE
// the net, which keeps those rendering exactly as they did before.
export function netScopeChange(
  m: { scopeAddedSP?: number | null; removedSp?: number | null } | null | undefined,
): {
  net: number;
  addedSP: number;
  removedSP: number;
  hasRemoved: boolean;
} {
  const addedSP = Number(m?.scopeAddedSP) || 0;
  const removedSP = Number(m?.removedSp) || 0;
  return {
    net: Math.round((addedSP - removedSP) * 10) / 10,
    addedSP,
    removedSP,
    hasRemoved: m?.removedSp != null,
  };
}

// Signed display form of the net ("+13", "-6", "0") — shared by the Overview
// row, the Delivery card and their PDF mirrors so the sign convention matches.
export function formatNetScope(net: number): string {
  return `${net >= 0 ? '+' : ''}${net}`;
}

// Resolve a drilldown's team list(s) for the chosen scope. Whole-team adds the
// non-V2 contributors. Falls back to the base (V2) team for pre-feature
// presentations that lack the *ByScope fields.
export function scopedTeam(d: any, scope: Scope): { team: any[]; teamBySprint: any[] } {
  return {
    team: d?.teamMembersByScope?.[scope] ?? d?.teamMembers ?? [],
    teamBySprint: d?.teamBySprintByScope?.[scope] ?? d?.teamBySprint ?? [],
  };
}

// Resolve a drilldown's per-developer trend datasets for the chosen scope.
// Whole-team adds the non-V2 developers. Falls back to the base (V2) datasets
// for pre-feature presentations that lack the *ByScope fields.
export function scopedDeveloperTrends(d: any, scope: Scope): { developerVelocity: any; developerTrends: any } {
  return {
    developerVelocity: d?.developerVelocityByScope?.[scope] ?? d?.developerVelocity ?? null,
    developerTrends: d?.developerTrendsByScope?.[scope] ?? d?.developerTrends ?? null,
  };
}

// Resolve one trend sprint's metrics/qualityMetrics for the chosen scope.
export function scopedTrendSprint(sprint: any, scope: Scope): { metrics: any; qualityMetrics: any } {
  return {
    metrics: sprint?.metricsByScope?.[scope] || sprint?.metrics || {},
    qualityMetrics: sprint?.qualityMetricsByScope?.[scope] || sprint?.qualityMetrics || {},
  };
}

// Compact V2 ⇄ Whole-team switch shown at the top of each scoped slide.
export function ScopeToggle({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10.5 }}>
        Scope
      </Typography>
      <ToggleButtonGroup
        size="small"
        exclusive
        value={scope}
        onChange={(_e, val) => { if (val) onChange(val as Scope); }}
        sx={{ '& .MuiToggleButton-root': { px: 1.25, py: 0.25, fontSize: 11, fontWeight: 700, textTransform: 'none' } }}
      >
        <ToggleButton value="v2">V2 Team</ToggleButton>
        <ToggleButton value="overall">Whole Team</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}
