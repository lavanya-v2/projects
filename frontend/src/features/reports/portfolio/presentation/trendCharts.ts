// Registry of the default Trends-slide charts. Shared by the presentation form
// (show/hide list), the on-screen slide, and the PDF so chart ids/labels stay in
// sync. Visibility is stored per presentation in `hiddenCharts` (chartId -> true
// means hidden). An empty/absent map means every chart is shown.
export interface TrendChartDef {
  id: string;
  label: string;
  // Hidden unless a presentation explicitly opts in. Used for newly added charts
  // that need a fresh data sync before they show anything meaningful.
  defaultHidden?: boolean;
  // Shows a temporary "New" hint next to the toggle in the editor (edit-only).
  // Remove once the feature is no longer new.
  isNew?: boolean;
}

export const TREND_CHART_DEFS: TrendChartDef[] = [
  { id: 'velocity-trend', label: 'Velocity Trend' },
  { id: 'productivity', label: 'Productivity %' },
  { id: 'defect-density', label: 'Defect Density %' },
  { id: 'reopen-ratio', label: 'Reopen Ratio %' },
  // id kept as 'invalid-reopens' for backward compatibility with saved presentations;
  // display renamed to "Invalid Bugs" (a testing-quality signal).
  { id: 'invalid-reopens', label: 'Invalid Bugs', defaultHidden: true, isNew: true },
  { id: 'defect-leakage', label: 'Defect Leakage %' },
  // Raw counts (no rate) — production bugs identified and UAT reopens per sprint.
  { id: 'prod-bugs-count', label: 'Production Bugs Worked', defaultHidden: true, isNew: true },
  { id: 'uat-reopens-count', label: 'UAT Reopens (count)', defaultHidden: true, isNew: true },
  // Not a trend chart — an optional editable table rendered on its own slide.
  // Listed here so it shares the Step 4 enable/disable toggle + isChartHidden gating.
  { id: 'team-capacity', label: 'Team Capacity (table)', defaultHidden: true, isNew: true },
];

// True when the presentation is Kanban for its date range (no committed plan
// to divide delivered SP by), so Productivity % is not offered or rendered.
// Uses the drilldown flag when present; older saved presentations fall back to
// "every visible project's trend is throughput-only", which only Kanban
// projects without a tracked commitment produce.
export function isKanbanPresentation(report: any, visibleIds: number[]): boolean {
  const drill: any[] = (report?.perProjectDrilldown || []).filter((d: any) => visibleIds.includes(d.projectId));
  if (drill.length > 0 && drill.every((d: any) => d?.isKanbanEffective === true)) return true;
  const trend = report?.trendData || {};
  const withTrend = visibleIds.filter(pid => (trend[String(pid)]?.sprints || []).length > 0);
  return withTrend.length > 0 && withTrend.every(pid =>
    (trend[String(pid)].sprints as any[]).every(s => s?.metrics?.metricKind === 'throughput'));
}

// Effective visibility: an explicit per-presentation entry always wins; otherwise
// fall back to the chart's defaultHidden flag.
export function isChartHidden(hiddenCharts: Record<string, boolean> | null | undefined, id: string): boolean {
  const explicit = hiddenCharts?.[id];
  if (explicit === true) return true;
  if (explicit === false) return false;
  return TREND_CHART_DEFS.find(d => d.id === id)?.defaultHidden === true;
}
