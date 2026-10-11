/**
 * Shorten a delivery-period label (sprint name, Kanban cycle label, or
 * reporting-week label) for chart X-axis ticks, so labels from different
 * projects/models don't overlap or collide.
 *
 *   "MAV 2026 Sprint 3.2"          -> "3.2"              (explicit "Sprint" form)
 *   "EXP 2.1"                      -> "2.1"               (project-code prefix, trailing version)
 *   "LOT 3"                        -> "3"
 *   "Cycle: Jun 2 - Jun 8, 2026"   -> "Jun 2-8"            (cadence cycle)
 *   "Wk 34, 2026"                  -> "Wk 34"              (continuous reporting week)
 *   "Wk 14"                        -> "Wk 14"              (legacy week label, untouched)
 *
 * Falls back to the original string when no recognised form matches.
 *
 * This is the single consolidated home for what used to be five near-identical
 * copies (`shortSprint` in four team-performance chart components plus
 * member-dashboard's chartCommon.tsx, and `shortenSprintName` in the Delivery
 * Presentation). All of them shared the same bug: taking the trailing
 * whitespace-separated token of the label, which is correct for "Sprint 32"
 * but wrong for anything ending in a bare year -- "Cycle: Jun 2 - Jun 8, 2026"
 * and "Wk 34, 2026" both collapsed to the literal string "2026", making every
 * bar on every Kanban trend chart carry the same label. The cycle/week cases
 * are matched explicitly here, before the trailing-token fallback ever runs.
 */
// "Sep 15 - Sep 19" -> "Sep 15-19" (same month); "Sep 29 - Oct 3" ->
// "Sep 29-Oct 3". Shorter ticks stay inside the chart's right edge instead of
// being clipped ("Sep 29 - O"). Anything not matching is returned unchanged.
function compactDateRange(range: string): string {
    const m = range.match(/^([A-Za-z]{3})\s+(\d{1,2})\s*-\s*([A-Za-z]{3})\s+(\d{1,2})$/);
    if (!m) return range;
    const [, m1, d1, m2, d2] = m;
    return m1 === m2 ? `${m1} ${d1}-${d2}` : `${m1} ${d1}-${m2} ${d2}`;
}

export function shortenPeriodLabel(name: string | null | undefined): string {
    if (!name) return '';
    const s = String(name).trim();

    // Kanban cadence cycle: "Cycle: <date range>, <year>" -> "<date range>".
    const cycleMatch = s.match(/^Cycle:\s*(.+?),\s*\d{4}$/i);
    if (cycleMatch) return compactDateRange(cycleMatch[1].trim());

    // Continuous reporting week WITH year: "Wk N, YYYY" -> "Wk N". Must be
    // checked before the trailing-version fallback, or the year alone would
    // match it and reproduce the exact bug this function exists to fix.
    if (/^Wk\s+\d+,\s*\d{4}$/i.test(s)) return s.split(',')[0].trim();

    // Legacy week label with no year -- already short, left untouched.
    if (/^Wk\s+\d+$/i.test(s)) return s;

    const sprintMatch = s.match(/sprint\s+(\S+.*)$/i);
    if (sprintMatch) return sprintMatch[1].trim();

    const trailingVersion = s.match(/(\d+(?:\.\d+)*)\s*$/);
    if (trailingVersion) return trailingVersion[1];

    return s;
}
