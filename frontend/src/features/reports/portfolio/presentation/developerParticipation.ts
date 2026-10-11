/**
 * Participation filtering + zero-vs-no-data labelling for the drilldown's
 * "Individual Performance Trends" charts (Velocity / Reopen / Carryover).
 *
 * WHY THIS EXISTS
 * ---------------
 * Those charts put one X category per DEVELOPER and one bar per sprint. People
 * who only brushed the project (a single sprint out of five) consumed a named
 * slot while showing nothing, which read as noise in a customer-facing deck.
 *
 * Two DIFFERENT populations produced those empty columns, and only one of them
 * should be removed:
 *   1. Marginal contributors — active in 1-2 of the 5 sprints. Filtered out here.
 *   2. Developers active in EVERY sprint whose ratio is a genuine 0% (e.g. zero
 *      carryover — a perfect score). These must stay; they are the best
 *      performers on that chart. They looked identical to case 1 only because
 *      the charts flatten null -> 0 for Recharts geometry.
 * So this module does two orthogonal things: it filters (1) out, and it gives
 * (2) a printed "0"/"0%" so a measured zero is distinguishable from no data.
 *
 * WHY THE FILTER IS CLIENT-SIDE
 * -----------------------------
 * Presentations store a snapshot of the FULL roster in per_project_drilldown
 * JSONB. Filtering server-side would fix no existing presentation without
 * regenerating it, and the client rule would still be needed for the ~46 saved
 * decks — so the rule lives here only, and the snapshot stays the roster of
 * record. That also keeps the filter reversible.
 *
 * Shared verbatim by the on-screen slide (slides.tsx) and the PDF document
 * (PortfolioPresentationPdfDocument.tsx) so the two can never drift.
 */

export interface SprintRef {
  syncId: number;
  sprintName: string;
  startDate?: string;
  endDate?: string;
}

/** One developer's series for one metric, ready to flatten into Recharts rows. */
export interface MetricRow {
  jiraLoginId: string;
  name: string;
  /**
   * syncId -> the number actually plotted. Always numeric (0 stands in for both
   * "measured zero" and "no data") because feeding null into a Bar that carries
   * a LabelList risks NaN geometry in recharts. Use `rawBySync` to tell the two
   * apart when rendering text.
   */
  valuesBySync: Record<string, number>;
  /** syncId -> the raw measurement. null = absent, or present but no denominator. */
  rawBySync: Record<string, number | null>;
  /** syncId -> the developer had a PerfMemberScore row that sprint. */
  activeBySync: Record<string, boolean>;
}

export interface IndividualTrendsView {
  sprints: SprintRef[];
  velocityRows: MetricRow[];
  reopenRows: MetricRow[];
  carryoverRows: MetricRow[];
  maxSp: number;
  maxReopenPct: number;
  maxCarryoverPct: number;
  /** Roster size AFTER filtering — drives dense / one-chart-per-row / label density. */
  devCount: number;
  /** Names dropped by the participation rule, for the presenter-only tooltip. */
  hiddenNames: string[];
  /** ceil(sprints.length / 2) */
  minActiveSprints: number;
  /** false when the rule was bypassed because it would have hidden everyone. */
  filterApplied: boolean;
}

/** Suffix for the companion field holding a bar's pre-rendered label text. */
export const LABEL_SUFFIX = '__lbl';

/**
 * Keep a developer whose tenure is contiguous and runs to the newest sprint,
 * even if that is fewer than half the window — otherwise a genuine new joiner
 * disappears from the deck in their first fortnight.
 *
 * Deliberately contiguous rather than merely "active in the latest sprint":
 * on real data (LOSAI 8.1) a drive-by contributor was active in 6.2 and 7.2
 * with a gap, and the looser rule would have re-admitted exactly the person the
 * filter exists to remove. Flip to false to disable the exemption entirely.
 */
const NEW_JOINER_EXEMPTION = true;

/**
 * Round up to the next "nice" tick — 5, 10, 15 … 100, 125, 150 …
 * Ported verbatim from perfAggregation.ts:622 so a client-recomputed Y ceiling
 * is byte-identical to the backend's when nothing has been filtered out.
 */
function roundUpToNiceTick(n: number): number {
  if (n <= 0) return 5;
  if (n <= 100) return Math.ceil(n / 5) * 5;
  return Math.ceil(n / 25) * 25;
}

/**
 * JSONB round-trips numeric object keys to strings, so a stored
 * `spDeliveredBySync` reads back as { "365": 5 }. Every lookup here goes
 * through String(syncId) — indexing with a raw number happens to work via JS
 * coercion, but Object.keys(...).includes(number) silently returns false.
 */
const sid = (syncId: unknown): string => String(syncId);

function asSprints(raw: any): SprintRef[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(s => s && s.syncId != null)
    .map(s => ({
      syncId: Number(s.syncId),
      sprintName: String(s.sprintName ?? ''),
      startDate: s.startDate,
      endDate: s.endDate,
    }));
}

function asDevelopers(raw: any): any[] {
  return Array.isArray(raw?.developers) ? raw.developers.filter(Boolean) : [];
}

/**
 * Which sprints a developer was actually on the board for.
 *
 * Velocity is the ground truth: a key exists in `spDeliveredBySync` if and only
 * if a PerfMemberScore row existed for that sprint. Key PRESENCE is the signal,
 * not a non-zero value — a developer who was assigned work and delivered 0 SP
 * was still on the team, and treating that as absence would repeat the same
 * mistake as reading a 0% carryover as "no data".
 *
 * The trends object cannot be used for this: its backend writes an explicit
 * null for every sprint including missing ones, so all keys always exist. The
 * trends-only branch below is a fallback for the rare shape where velocity is
 * null but trends survived, and approximates activity from "either metric has a
 * value".
 */
function activeSprintIds(
  velDev: any | undefined,
  trDev: any | undefined,
  sprints: SprintRef[],
): Set<string> {
  const out = new Set<string>();
  if (velDev?.spDeliveredBySync) {
    const map = velDev.spDeliveredBySync;
    for (const s of sprints) {
      if (Object.prototype.hasOwnProperty.call(map, sid(s.syncId))) out.add(sid(s.syncId));
    }
    return out;
  }
  if (trDev) {
    for (const s of sprints) {
      const k = sid(s.syncId);
      const r = trDev.reopenPctBySync?.[k];
      const c = trDev.carryoverPctBySync?.[k];
      if (r != null || c != null) out.add(k);
    }
  }
  return out;
}

/** Contiguous tenure running through to the newest sprint. */
function isNewJoiner(active: Set<string>, sprints: SprintRef[]): boolean {
  if (active.size === 0) return false;
  const firstIdx = sprints.findIndex(s => active.has(sid(s.syncId)));
  if (firstIdx < 0) return false;
  for (let i = firstIdx; i < sprints.length; i++) {
    if (!active.has(sid(sprints[i].syncId))) return false;
  }
  return true;
}

function buildRow(
  dev: any,
  valueMap: any,
  active: Set<string>,
  sprints: SprintRef[],
): MetricRow {
  const valuesBySync: Record<string, number> = {};
  const rawBySync: Record<string, number | null> = {};
  const activeBySync: Record<string, boolean> = {};
  for (const s of sprints) {
    const k = sid(s.syncId);
    const raw = valueMap?.[k];
    const n = raw == null ? null : Number(raw);
    rawBySync[k] = n != null && Number.isFinite(n) ? n : null;
    valuesBySync[k] = rawBySync[k] ?? 0;
    activeBySync[k] = active.has(k);
  }
  return { jiraLoginId: String(dev.jiraLoginId ?? ''), name: String(dev.name ?? ''), valuesBySync, rawBySync, activeBySync };
}

/**
 * Y ceiling recomputed from the rows that survived the filter. The stored
 * max* values come from the unfiltered roster, so a hidden 2-of-5 contributor
 * with one large burst would otherwise leave every remaining bar squashed into
 * the bottom of the chart. Reproduces the backend's arithmetic exactly (same
 * nice-tick rounding, same 1.15 headroom, same floor for percentages), so when
 * nothing is hidden this is a no-op.
 */
function ceilingFor(rows: MetricRow[], stored: number, floor: number): number {
  let max = 0;
  for (const r of rows) {
    for (const v of Object.values(r.rawBySync)) {
      if (v != null && v > max) max = v;
    }
  }
  if (max <= 0) return Number(stored) || floor;
  return Math.max(floor, roundUpToNiceTick(max * 1.15));
}

/**
 * Build the filtered, label-ready view for one project at one scope.
 * Returns null when there is nothing to render at all (e.g. Kanban projects,
 * where both inputs are null).
 */
export function buildIndividualTrendsView(vel: any, tr: any): IndividualTrendsView | null {
  const velDevs = asDevelopers(vel);
  const trDevs = asDevelopers(tr);
  if (velDevs.length === 0 && trDevs.length === 0) return null;

  // Velocity owns the sprint axis when present so all three panels line up.
  const sprints = asSprints(vel?.sprints ?? tr?.sprints);
  if (sprints.length === 0) return null;

  const minActiveSprints = Math.ceil(sprints.length / 2);

  const velById = new Map<string, any>(velDevs.map(d => [String(d.jiraLoginId ?? ''), d]));
  const trById = new Map<string, any>(trDevs.map(d => [String(d.jiraLoginId ?? ''), d]));

  // Decide participation ONCE, from the union of both rosters, so the three
  // panels always agree on who is shown even though the backend drops
  // developers from velocity and trends on different conditions.
  const allIds = new Set<string>([...velById.keys(), ...trById.keys()]);
  const activeById = new Map<string, Set<string>>();
  const keptIds = new Set<string>();
  const hiddenNames: string[] = [];

  for (const id of allIds) {
    const velDev = velById.get(id);
    const trDev = trById.get(id);
    const active = activeSprintIds(velDev, trDev, sprints);
    activeById.set(id, active);
    const keep = active.size >= minActiveSprints
      || (NEW_JOINER_EXEMPTION && isNewJoiner(active, sprints));
    if (keep) keptIds.add(id);
    else hiddenNames.push(String((velDev ?? trDev)?.name ?? ''));
  }

  // A rotating contractor pool can leave every developer below the threshold.
  // Never render a chart with zero categories — fall back to the full roster
  // and let the caller say so in the caption.
  let filterApplied = true;
  if (keptIds.size === 0) {
    filterApplied = false;
    hiddenNames.length = 0;
    for (const id of allIds) keptIds.add(id);
  }

  // Preserve each source object's own ordering (the backend already sorted by
  // name); a developer present in velocity but absent from trends still belongs
  // on the velocity chart, so the rosters are not intersected.
  const keep = (d: any) => keptIds.has(String(d.jiraLoginId ?? ''));
  const activeOf = (d: any) => activeById.get(String(d.jiraLoginId ?? '')) ?? new Set<string>();

  const velocityRows = velDevs.filter(keep).map(d => buildRow(d, d.spDeliveredBySync, activeOf(d), sprints));
  const reopenRows = trDevs.filter(keep).map(d => buildRow(d, d.reopenPctBySync, activeOf(d), sprints));
  const carryoverRows = trDevs.filter(keep).map(d => buildRow(d, d.carryoverPctBySync, activeOf(d), sprints));

  return {
    sprints,
    velocityRows,
    reopenRows,
    carryoverRows,
    maxSp: ceilingFor(velocityRows, Number(vel?.maxSp) || 5, 5),
    maxReopenPct: ceilingFor(reopenRows, Number(tr?.maxReopenPct) || 5, 5),
    maxCarryoverPct: ceilingFor(carryoverRows, Number(tr?.maxCarryoverPct) || 5, 5),
    devCount: Math.max(velocityRows.length, reopenRows.length, carryoverRows.length),
    hiddenNames: hiddenNames.filter(Boolean).sort((a, b) => a.localeCompare(b)),
    minActiveSprints,
    filterApplied,
  };
}

/**
 * Text to print above one bar.
 *
 * Three states, not two — and only the third gets a "0":
 *   - no data for that sprint                     -> blank
 *   - present but the ratio has no denominator    -> blank (undefined, not zero)
 *   - a measured zero                             -> "0" / "0%"
 * Both of the first two arrive here as a null in `rawBySync`, so the predicate
 * is "did we measure something", not "was the developer active".
 *
 * A measured zero is NEVER suppressed by density. That carve-out is the whole
 * point: on a 9-developer team the full-value labels stay off (9 x 5 = 45 bars
 * would collide), and without it a perfect 0% score would still render as an
 * indistinguishable blank column. Zeros print into empty space where no bar
 * exists, so they cannot overlap a bar top.
 */
export function barLabelFor(
  row: MetricRow,
  syncId: number,
  unit: 'SP' | '%',
  showFullLabels: boolean,
): string {
  const v = row.rawBySync[sid(syncId)];
  if (v == null) return '';
  if (v === 0) return unit === '%' ? '0%' : '0';
  if (!showFullLabels) return '';
  return unit === '%' ? `${v}%` : `${v}`;
}

/** Caption explaining the filter and the blank-vs-zero convention. */
export function participationCaption(view: IndividualTrendsView): string {
  const legend = 'Blank = no data that sprint; 0 = measured zero.';
  if (!view.filterApplied) {
    return `No developer was active in ${view.minActiveSprints} of the last ${view.sprints.length} sprints — showing all contributors. ${legend}`;
  }
  if (view.hiddenNames.length === 0) return legend;
  return `Showing developers active in ${view.minActiveSprints} or more of the last ${view.sprints.length} sprints (${view.hiddenNames.length} with occasional activity not shown). ${legend}`;
}
