/**
 * Capacity math for hours-based projects.
 *
 * Story-point projects keep `capacity = planned` (handled by the caller). For
 * hours projects we compute an *available-hours* capacity from a per-developer
 * daily-hours rate × the sprint's working days:
 *
 *   capacity = Σ over dev members [ dailyCap(member) × workingDays ]
 *
 * dailyCap(member) comes from the project↔member mapping
 * (AccountTeamMember.dailyCapacityHours), falling back to the project default,
 * then to 8. (PTO/leave is intentionally not modelled.)
 */
export const DEFAULT_DAILY_CAPACITY_HOURS = 8;

/** Business-day count (Mon–Fri inclusive) between two dates. No holiday calendar. */
export function countWeekdays(from: Date, to: Date): number {
    let count = 0;
    const cur = new Date(from);
    cur.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(0, 0, 0, 0);
    while (cur <= end) {
        const d = cur.getDay();
        if (d !== 0 && d !== 6) count++;
        cur.setDate(cur.getDate() + 1);
    }
    return count;
}

interface CapacitySprintInput {
    startDate: string | Date | null;
    endDate: string | Date | null;
}

/**
 * Available developer hours for one sprint. `devMembers` is the V2 dev population
 * for the sprint (each carries a jiraLoginId); QA is excluded by the caller.
 * `memberDailyCapacity` maps a normalized jiraLoginId → that member's configured
 * hours/day (from the project↔member mapping). `defaultDailyHours` is the project
 * default (falls back to 8 when null/invalid).
 */
export function computeSprintHoursCapacity(
    sync: CapacitySprintInput,
    devMembers: Array<{ jiraLoginId: string }>,
    memberDailyCapacity: Map<string, number>,
    defaultDailyHours: number | null | undefined,
): number {
    if (!sync.startDate || !sync.endDate || devMembers.length === 0) return 0;
    const workingDays = countWeekdays(new Date(sync.startDate), new Date(sync.endDate));
    if (workingDays <= 0) return 0;

    const projectDaily = Number(defaultDailyHours) > 0
        ? Number(defaultDailyHours)
        : DEFAULT_DAILY_CAPACITY_HOURS;

    let capacity = 0;
    for (const m of devMembers) {
        const mapped = memberDailyCapacity.get(String(m.jiraLoginId || '').trim().toLowerCase());
        const dailyCap = Number(mapped) > 0 ? Number(mapped) : projectDaily;
        capacity += dailyCap * workingDays;
    }
    return Math.round(capacity * 10) / 10;
}
