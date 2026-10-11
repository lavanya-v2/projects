import { shortenPeriodLabel } from '../../../../shared/utils/periodLabel';

// Re-exported under this module's established name so existing callers
// (`import { shortenSprintName } from './sprintLabel'`) don't need to
// change. The implementation now lives in shared/utils/periodLabel.ts --
// see that file for the full set of forms handled (sprint names, Kanban
// cadence cycle labels, continuous reporting-week labels) and why they were
// consolidated into one place.
export const shortenSprintName = shortenPeriodLabel;

// Business-day count (Mon–Fri inclusive) between two dates. Mirrors the
// backend's countWeekdays (capacityMath.ts) so the Velocity Trend chart can
// normalize for sprint length without a stored/backend-computed field — every
// trend sprint already carries startDate/endDate. Returns null when either
// date is missing/invalid (e.g. WSR-sourced weeks or in-progress placeholders).
export function sprintWorkingDays(startDate?: string | null, endDate?: string | null): number | null {
    if (!startDate || !endDate) return null;
    const from = new Date(startDate);
    const to = new Date(endDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    from.setHours(0, 0, 0, 0);
    to.setHours(0, 0, 0, 0);
    let count = 0;
    const cur = new Date(from);
    while (cur <= to) {
        const d = cur.getDay();
        if (d !== 0 && d !== 6) count++;
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}
