/**
 * Report window validation and computation (Phase 4 of the RAG-reliability plan).
 *
 * Splits window *validation* (what dates are allowed) from window *computation* (turning a
 * validated start/end into a usable range) so the same underlying rollup logic can serve both
 * the app (which enforces a strict weekly cadence) and standalone scripts (which historically
 * used whatever date range was typed on the command line, with no shared validation at all).
 *
 * `normalizeWindow(..., 'fri-thu-week')` reproduces, verbatim, the validation block that used
 * to be duplicated inline in reportService.ts's `generateWeeklyReport` and
 * accountReportService.ts's `generateAccountWeeklyReport` — same error messages, same rules —
 * so the app's behavior is byte-identical after this change. The weaker duplicate checks that
 * also existed in reportController.ts (missing the legacy Sun-Sat lock and the same-calendar-
 * week test, and only run when `force===true`) are deleted, not unified toward, since the
 * canonical rule now lives here.
 *
 * 'complete-weeks' (used starting at Phase 6, for the consolidated multi-week report) requires
 * a whole number of 7-day weeks without pinning the start day to Friday. 'arbitrary' (used by
 * the standalone scripts) accepts any valid start/end pair with no shape constraint at all.
 */

export type WindowPolicy = 'fri-thu-week' | 'complete-weeks' | 'arbitrary';

export interface ReportWindow {
    start: Date;
    end: Date;
    startDate: string;
    endDate: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Days since the most recently completed cycle-start day, as of `now`. `startDay` follows JS
 * `Date.getDay()` convention (0=Sun...6=Sat); default 5 (Friday) preserves the original
 * Friday-Thursday-only behavior for any caller that doesn't pass one.
 */
const daysSinceLastStartDay = (d: Date, startDay: number): number => (d.getDay() - startDay + 7) % 7;

/** The cycle-start day of the calendar week containing `d`, at midnight, as a timestamp. */
const toWeekStart = (d: Date, startDay: number): number => {
    const fd = new Date(d);
    fd.setHours(0, 0, 0, 0);
    fd.setDate(d.getDate() - daysSinceLastStartDay(d, startDay));
    return fd.getTime();
};

/**
 * Most recently completed 7-day reporting week, as of `now` (defaults to the real current time),
 * for a cycle starting on `startDay` (default 5=Friday, matching every account until it's
 * explicitly reconfigured — see Account.weekStartDay).
 */
export function currentFriThuWeek(now: Date = new Date(), startDay: number = 5): ReportWindow {
    const start = new Date(now);
    start.setDate(now.getDate() - daysSinceLastStartDay(now, startDay));
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end, startDate: formatDate(start), endDate: formatDate(end) };
}

/**
 * Validates and normalizes an explicit start/end date pair according to `policy`. When both
 * dates are omitted, returns the current cycle week regardless of policy — matches the existing
 * behavior at both call sites this replaces, which both defaulted the same way. `startDay`
 * (0=Sun...6=Sat, default 5=Friday) only affects the `'fri-thu-week'` policy's validation/default;
 * `'complete-weeks'` and `'arbitrary'` are already start-day-unconstrained.
 */
export function normalizeWindow(
    startDate: string | undefined,
    endDate: string | undefined,
    policy: WindowPolicy,
    startDay: number = 5
): ReportWindow {
    if (!startDate || !endDate) {
        return currentFriThuWeek(new Date(), startDay);
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new Error('Invalid date format. Please use YYYY-MM-DD.');
    }

    if (end < start) {
        throw new Error('End date must be after or equal to start date.');
    }

    if (policy === 'arbitrary') {
        return { start, end, startDate, endDate };
    }

    if (policy === 'fri-thu-week') {
        const actualStartDay = start.getDay();
        const expectedEndDay = (startDay + 6) % 7;

        // Lock legacy Sun-Sat reports from regeneration — only meaningful when this account's
        // configured cycle is NOT itself Sunday-start; if it is, Sunday is now a legitimate,
        // intentionally-configured start day, not a legacy artifact.
        if (startDay !== 0 && actualStartDay === 0) {
            throw new Error('This report was generated under the legacy Sun-Sat week format and cannot be regenerated. The stored report remains available for download.');
        }

        if (actualStartDay !== startDay) {
            throw new Error(`Start date must be a ${DAY_NAMES[startDay]}. This account's report week currently runs ${DAY_NAMES[startDay]}-${DAY_NAMES[expectedEndDay]}; if this date is from a report generated under a previous cycle, that setting has since changed and the stored report remains available for download.`);
        }

        const endDay = end.getDay();
        if (endDay !== expectedEndDay) {
            throw new Error(`End date must be a ${DAY_NAMES[expectedEndDay]}. This account's report week currently runs ${DAY_NAMES[startDay]}-${DAY_NAMES[expectedEndDay]}; if this date is from a report generated under a previous cycle, that setting has since changed and the stored report remains available for download.`);
        }

        const diffTime = Math.abs(end.getTime() - start.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > 6) {
            throw new Error('Report duration cannot exceed 7 days.');
        }

        if (toWeekStart(start, startDay) !== toWeekStart(end, startDay)) {
            throw new Error(`Start date and End date must be within the same calendar week (${DAY_NAMES[startDay]} to ${DAY_NAMES[expectedEndDay]}).`);
        }

        return { start, end, startDate, endDate };
    }

    // 'complete-weeks' (Phase 6): a whole number of 7-day weeks, start day unconstrained.
    const diffTime = end.getTime() - start.getTime();
    const inclusiveDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    if (inclusiveDays % 7 !== 0) {
        throw new Error('Window must span a whole number of complete weeks.');
    }
    const weeks = inclusiveDays / 7;
    if (weeks < 2 || weeks > 26) {
        throw new Error('Window must span between 2 and 26 weeks.');
    }

    return { start, end, startDate, endDate };
}

/**
 * True when `date` (default: now) is the day an account's configured reporting week *begins* --
 * the day the weekly cron should generate a report for that account, covering the 7-day window
 * that just ended *yesterday*. Not the week's last day: the report is generated the morning
 * after the week closes, once it's fully complete, exactly matching the old hardcoded system
 * (cron fired Friday, generating the Friday-Thursday week that had just ended the day before).
 * For the default `weekStartDay=5` (Friday), this is true only on Friday, matching exactly the
 * one day the old Friday-only cron used to fire on.
 */
export function isAccountReportGenerationDay(weekStartDay: number, date: Date = new Date()): boolean {
    return date.getDay() === weekStartDay;
}
