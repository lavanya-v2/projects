import { describe, it, expect } from 'vitest';
import { normalizeWindow, currentFriThuWeek, isAccountReportGenerationDay } from './reportWindow';

describe('normalizeWindow — fri-thu-week policy (byte-identical to the pre-Phase-4 inline checks)', () => {
    it('accepts a valid Friday-to-Thursday week', () => {
        // 2026-08-14 is a confirmed Friday; 2026-08-20 the following Thursday.
        const w = normalizeWindow('2026-08-14', '2026-08-20', 'fri-thu-week');
        expect(w.startDate).toBe('2026-08-14');
        expect(w.endDate).toBe('2026-08-20');
    });

    it('rejects a non-Friday start date with the exact original message', () => {
        expect(() => normalizeWindow('2026-08-13', '2026-08-20', 'fri-thu-week'))
            .toThrow('Start date must be a Friday.');
    });

    it('rejects a non-Thursday end date with the exact original message', () => {
        expect(() => normalizeWindow('2026-08-14', '2026-08-19', 'fri-thu-week'))
            .toThrow('End date must be a Thursday.');
    });

    it('rejects a window longer than 7 days with the exact original message', () => {
        // Friday to the Thursday after next -- both day-of-week checks pass, but spans 14 days.
        expect(() => normalizeWindow('2026-08-14', '2026-08-27', 'fri-thu-week'))
            .toThrow('Report duration cannot exceed 7 days.');
    });

    // No separate test for the "same calendar week" guard: given start must be a Friday, end
    // must be a Thursday, and end must be >= start, the only arrangement satisfying all three
    // simultaneously is the immediate next Thursday (6 days later) -- any other Friday/Thursday
    // pairing either violates end>=start or is caught by the diffDays>6 check first. The guard
    // is retained (matches the original code exactly) as defense-in-depth, not because a
    // reachable failing case exists to test here.

    it('locks legacy Sunday-start reports from regeneration with the exact original message', () => {
        // 2026-08-16 is a Sunday.
        expect(() => normalizeWindow('2026-08-16', '2026-08-20', 'fri-thu-week'))
            .toThrow('This report was generated under the legacy Sun-Sat week format and cannot be regenerated. The stored report remains available for download.');
    });

    it('rejects an end date before the start date', () => {
        expect(() => normalizeWindow('2026-08-20', '2026-08-14', 'fri-thu-week'))
            .toThrow('End date must be after or equal to start date.');
    });

    it('rejects an invalid date format', () => {
        expect(() => normalizeWindow('not-a-date', '2026-08-20', 'fri-thu-week'))
            .toThrow('Invalid date format. Please use YYYY-MM-DD.');
    });

    it('defaults to the current Fri-Thu week when both dates are omitted, regardless of policy', () => {
        const w = normalizeWindow(undefined, undefined, 'fri-thu-week');
        expect(new Date(w.startDate).getDay()).toBe(5); // Friday
        const expected = currentFriThuWeek();
        expect(w.startDate).toBe(expected.startDate);
        expect(w.endDate).toBe(expected.endDate);
    });
});

describe('normalizeWindow — arbitrary policy (used by the standalone scripts)', () => {
    it('accepts a Monday-to-Sunday range', () => {
        // 2026-08-10 is a Monday; 2026-08-16 the following Sunday.
        const w = normalizeWindow('2026-08-10', '2026-08-16', 'arbitrary');
        expect(w.startDate).toBe('2026-08-10');
        expect(w.endDate).toBe('2026-08-16');
    });

    it('accepts a range longer than 7 days', () => {
        const w = normalizeWindow('2026-08-01', '2026-08-31', 'arbitrary');
        expect(w.startDate).toBe('2026-08-01');
        expect(w.endDate).toBe('2026-08-31');
    });

    it('still rejects an end date before the start date', () => {
        expect(() => normalizeWindow('2026-08-20', '2026-08-14', 'arbitrary'))
            .toThrow('End date must be after or equal to start date.');
    });

    it('still rejects an invalid date format', () => {
        expect(() => normalizeWindow('garbage', '2026-08-20', 'arbitrary'))
            .toThrow('Invalid date format. Please use YYYY-MM-DD.');
    });
});

describe('normalizeWindow — complete-weeks policy (Phase 6 consolidated report)', () => {
    it('accepts exactly 2 weeks, Friday-anchored', () => {
        const w = normalizeWindow('2026-08-14', '2026-08-27', 'complete-weeks');
        expect(w.startDate).toBe('2026-08-14');
        expect(w.endDate).toBe('2026-08-27');
    });

    it('accepts a non-Friday-anchored whole number of weeks (start day unconstrained)', () => {
        const w = normalizeWindow('2026-08-10', '2026-08-23', 'complete-weeks'); // Monday, 2 weeks
        expect(w.startDate).toBe('2026-08-10');
    });

    it('rejects a partial week', () => {
        expect(() => normalizeWindow('2026-08-14', '2026-08-25', 'complete-weeks'))
            .toThrow('Window must span a whole number of complete weeks.');
    });

    it('rejects a single week (minimum is 2)', () => {
        expect(() => normalizeWindow('2026-08-14', '2026-08-20', 'complete-weeks'))
            .toThrow('Window must span between 2 and 26 weeks.');
    });

    it('rejects more than 26 weeks', () => {
        const w = normalizeWindow('2026-01-02', '2026-08-27', 'arbitrary'); // sanity: arbitrary allows it
        expect(w).toBeTruthy();
        expect(() => normalizeWindow('2026-01-02', '2026-08-27', 'complete-weeks'))
            .toThrow(/Window must span/);
    });
});

describe('normalizeWindow — fri-thu-week policy, configurable startDay (Account.weekStartDay)', () => {
    it('accepts a valid Monday-to-Sunday week when startDay=1 (Monday)', () => {
        // 2026-08-10 is a confirmed Monday; 2026-08-16 the following Sunday.
        const w = normalizeWindow('2026-08-10', '2026-08-16', 'fri-thu-week', 1);
        expect(w.startDate).toBe('2026-08-10');
        expect(w.endDate).toBe('2026-08-16');
    });

    it('rejects a Friday start when startDay=1 (Monday), with a dynamic day name in the message', () => {
        expect(() => normalizeWindow('2026-08-14', '2026-08-20', 'fri-thu-week', 1))
            .toThrow('Start date must be a Monday.');
    });

    it('rejects a Saturday end when startDay=1 (Monday)', () => {
        expect(() => normalizeWindow('2026-08-10', '2026-08-15', 'fri-thu-week', 1))
            .toThrow('End date must be a Sunday.');
    });

    it('explains a stale-cycle date range (e.g. resyncing an old Friday-start report after the account switched to Monday-start) rather than just rejecting it', () => {
        expect(() => normalizeWindow('2026-08-14', '2026-08-20', 'fri-thu-week', 1))
            .toThrow("if this date is from a report generated under a previous cycle, that setting has since changed and the stored report remains available for download.");
    });

    it('accepts a valid Sunday-to-Saturday week when startDay=0 (Sunday) — no longer locked as "legacy"', () => {
        // 2026-08-16 is a confirmed Sunday; 2026-08-22 the following Saturday.
        const w = normalizeWindow('2026-08-16', '2026-08-22', 'fri-thu-week', 0);
        expect(w.startDate).toBe('2026-08-16');
        expect(w.endDate).toBe('2026-08-22');
    });

    it('still locks a Sunday start as legacy when the account is NOT configured for Sunday-start (default startDay=5)', () => {
        expect(() => normalizeWindow('2026-08-16', '2026-08-20', 'fri-thu-week'))
            .toThrow('This report was generated under the legacy Sun-Sat week format and cannot be regenerated. The stored report remains available for download.');
    });

    it('omitting startDay still defaults to Friday — byte-identical to every existing account today', () => {
        const w = normalizeWindow('2026-08-14', '2026-08-20', 'fri-thu-week');
        expect(w.startDate).toBe('2026-08-14');
        expect(w.endDate).toBe('2026-08-20');
    });

    it('defaults to the current week for the configured startDay when both dates are omitted', () => {
        const w = normalizeWindow(undefined, undefined, 'fri-thu-week', 1); // Monday
        expect(new Date(w.startDate).getDay()).toBe(1);
    });
});

describe('isAccountReportGenerationDay', () => {
    it('is true on Friday for the default Friday-start cycle (weekStartDay=5) — matches the old Friday-only cron trigger day exactly', () => {
        for (let day = 0; day <= 6; day++) {
            const d = new Date(2026, 7, 9 + day); // 2026-08-09 is a Sunday; walks through a full week
            expect(isAccountReportGenerationDay(5, d)).toBe(d.getDay() === 5);
        }
    });

    it('is true on Monday for a Monday-start cycle (weekStartDay=1)', () => {
        for (let day = 0; day <= 6; day++) {
            const d = new Date(2026, 7, 9 + day);
            expect(isAccountReportGenerationDay(1, d)).toBe(d.getDay() === 1);
        }
    });

    it('is true on Sunday for a Sunday-start cycle (weekStartDay=0)', () => {
        for (let day = 0; day <= 6; day++) {
            const d = new Date(2026, 7, 9 + day);
            expect(isAccountReportGenerationDay(0, d)).toBe(d.getDay() === 0);
        }
    });
});

describe('currentFriThuWeek', () => {
    it('returns a Friday-start, Thursday-end window ending at 23:59:59.999', () => {
        const now = new Date('2026-08-20T10:00:00'); // a Thursday
        const w = currentFriThuWeek(now);
        expect(w.start.getDay()).toBe(5);
        expect(w.end.getDay()).toBe(4);
        expect(w.end.getHours()).toBe(23);
        expect(w.end.getMinutes()).toBe(59);
    });

    it('is a pure function of `now` — same input, same output', () => {
        const now = new Date('2026-08-20T10:00:00');
        const a = currentFriThuWeek(now);
        const b = currentFriThuWeek(now);
        expect(a.startDate).toBe(b.startDate);
        expect(a.endDate).toBe(b.endDate);
    });

    it('respects a configurable startDay — Monday-start cycle', () => {
        const now = new Date('2026-08-20T10:00:00'); // a Thursday
        const w = currentFriThuWeek(now, 1);
        expect(w.start.getDay()).toBe(1); // Monday
        expect(w.end.getDay()).toBe(0); // Sunday
    });
});
