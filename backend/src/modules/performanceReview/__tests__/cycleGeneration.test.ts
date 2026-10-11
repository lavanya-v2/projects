import { describe, it, expect } from 'vitest';
import {
    generatePeriods,
    reviewYearOf,
    reviewYearStart,
} from '../services/cycleGenerationService';

const monthly = (anchorDate: string, reviewYearStartMonth = 4) =>
    ({ cadence: 'monthly' as const, anchorDate, reviewYearStartMonth }) as any;

const quarterly = (anchorDate: string, reviewYearStartMonth = 4) =>
    ({ cadence: 'quarterly' as const, anchorDate, reviewYearStartMonth }) as any;

describe('reviewYearOf', () => {
    it('places a date after the FY start month in the year that opens the FY', () => {
        expect(reviewYearOf('2026-10-01', 4)).toBe('FY2026-27');
        expect(reviewYearOf('2026-04-01', 4)).toBe('FY2026-27');
    });

    it('places a date before the FY start month in the PREVIOUS FY', () => {
        // Feb 2027 is still in the FY that began April 2026.
        expect(reviewYearOf('2027-02-15', 4)).toBe('FY2026-27');
        expect(reviewYearOf('2026-03-31', 4)).toBe('FY2025-26');
    });

    it('supports a calendar-year FY', () => {
        expect(reviewYearOf('2026-10-01', 1)).toBe('FY2026');
    });

    it('pads the second year across a century boundary', () => {
        expect(reviewYearOf('2099-10-01', 4)).toBe('FY2099-00');
    });
});

describe('reviewYearStart', () => {
    it('returns the first day of the containing review year', () => {
        expect(reviewYearStart('2026-10-15', 4)).toBe('2026-04-01');
        expect(reviewYearStart('2027-02-15', 4)).toBe('2026-04-01');
    });
});

describe('generatePeriods — monthly', () => {
    it('produces contiguous calendar months with no gap or overlap', () => {
        const periods = generatePeriods(monthly('2026-10-01'), '2026-10-01', '2026-12-31');

        expect(periods.map(p => [p.startDate, p.endDate])).toEqual([
            ['2026-10-01', '2026-10-31'],
            ['2026-11-01', '2026-11-30'],
            ['2026-12-01', '2026-12-31'],
        ]);
    });

    it('leaves no day unassigned between consecutive periods', () => {
        const periods = generatePeriods(monthly('2026-04-01'), '2026-04-01', '2027-03-31');
        for (let i = 1; i < periods.length; i++) {
            const prevEnd = new Date(`${periods[i - 1].endDate}T00:00:00Z`).getTime();
            const thisStart = new Date(`${periods[i].startDate}T00:00:00Z`).getTime();
            expect(thisStart - prevEnd).toBe(86_400_000); // exactly one day
        }
    });

    it('honours a mid-month anchor', () => {
        const periods = generatePeriods(monthly('2026-10-15'), '2026-10-15', '2026-12-14');
        expect(periods.map(p => [p.startDate, p.endDate])).toEqual([
            ['2026-10-15', '2026-11-14'],
            ['2026-11-15', '2026-12-14'],
        ]);
    });

    it('clamps a 31st anchor into short months without drifting afterwards', () => {
        // The clamp must not become permanent: Jan must still start on the 31st.
        const periods = generatePeriods(monthly('2026-12-31'), '2026-12-31', '2027-03-30');
        expect(periods.map(p => p.startDate)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31'].slice(0, periods.length));
    });

    it('handles a leap-year February', () => {
        const periods = generatePeriods(monthly('2028-02-01'), '2028-02-01', '2028-02-29');
        expect(periods[0]).toMatchObject({ startDate: '2028-02-01', endDate: '2028-02-29' });
    });

    it('numbers sequence within a review year, restarting each FY', () => {
        const periods = generatePeriods(monthly('2026-04-01'), '2026-04-01', '2027-05-31');
        const apr26 = periods.find(p => p.startDate === '2026-04-01')!;
        const mar27 = periods.find(p => p.startDate === '2027-03-01')!;
        const apr27 = periods.find(p => p.startDate === '2027-04-01')!;

        expect(apr26).toMatchObject({ reviewYear: 'FY2026-27', sequenceNo: 1 });
        expect(mar27).toMatchObject({ reviewYear: 'FY2026-27', sequenceNo: 12 });
        // New FY restarts the counter — the trend comparison depends on this.
        expect(apr27).toMatchObject({ reviewYear: 'FY2027-28', sequenceNo: 1 });
    });

    it('labels monthly periods by calendar month', () => {
        const [p] = generatePeriods(monthly('2026-10-01'), '2026-10-01', '2026-10-31');
        expect(p.periodLabel).toBe('2026-10');
    });
});

describe('generatePeriods — quarterly', () => {
    it('produces three-month periods aligned to the FY', () => {
        const periods = generatePeriods(quarterly('2026-04-01'), '2026-04-01', '2027-03-31');
        expect(periods.map(p => [p.startDate, p.endDate])).toEqual([
            ['2026-04-01', '2026-06-30'],
            ['2026-07-01', '2026-09-30'],
            ['2026-10-01', '2026-12-31'],
            ['2027-01-01', '2027-03-31'],
        ]);
        expect(periods.map(p => p.periodLabel)).toEqual(['FY26-27-Q1', 'FY26-27-Q2', 'FY26-27-Q3', 'FY26-27-Q4']);
    });
});

describe('generatePeriods — backfill determinism', () => {
    /**
     * The property that matters most: a cycle's dates must not depend on when it
     * was generated. Backfilling history must reproduce exactly the boundaries a
     * forward generation would have produced, or re-generating would reassign
     * sprints between periods and silently change people's scores.
     */
    it('walks back from the anchor to produce identical boundaries for history', () => {
        const forward = generatePeriods(monthly('2026-04-01'), '2026-04-01', '2026-12-31');
        const backfilled = generatePeriods(monthly('2026-10-01'), '2026-04-01', '2026-12-31');
        expect(backfilled.map(p => [p.startDate, p.endDate])).toEqual(
            forward.map(p => [p.startDate, p.endDate]),
        );
    });

    it('generates history before the anchor when asked to backfill', () => {
        const periods = generatePeriods(monthly('2026-10-01'), '2026-04-01', '2026-10-31');
        expect(periods[0].startDate).toBe('2026-04-01');
        expect(periods.at(-1)!.startDate).toBe('2026-10-01');
        expect(periods).toHaveLength(7);
    });

    it('excludes periods that end before the requested window', () => {
        const periods = generatePeriods(monthly('2026-10-01'), '2026-06-01', '2026-08-31');
        expect(periods.every(p => p.endDate >= '2026-06-01')).toBe(true);
        expect(periods.every(p => p.startDate <= '2026-08-31')).toBe(true);
    });
});
