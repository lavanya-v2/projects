import { describe, it, expect } from 'vitest';
import { generateCycles, lastCompletedCycle, cycleByIndex, cycleLabel, validateKanbanCadence } from './kanbanCycleService';

// 2026-06-01, 2026-03-02 and 2026-10-26 are all Mondays. The latter two sit
// either side of a DST change (US spring-forward 2026-03-08, EU fall-back
// 2026-10-25) — cycle math is UTC DATEONLY and must not drift across them.
const MON = '2026-06-01';

const dow = (d: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${d}T00:00:00Z`).getUTCDay()];

describe('generateCycles — contiguous (stride omitted)', () => {
    it('defaults stride to the window length, preserving back-to-back cycles', () => {
        const cycles = generateCycles(MON, 7, '2026-06-22');
        expect(cycles.map(c => [c.startDate, c.endDate])).toEqual([
            ['2026-06-01', '2026-06-07'],
            ['2026-06-08', '2026-06-14'],
            ['2026-06-15', '2026-06-21'],
            ['2026-06-22', '2026-06-28'],
        ]);
    });

    it('leaves no gap between one cycle end and the next start', () => {
        const cycles = generateCycles(MON, 14, '2026-09-01');
        for (let i = 1; i < cycles.length; i++) {
            const prevEnd = new Date(`${cycles[i - 1].endDate}T00:00:00Z`).getTime();
            const thisStart = new Date(`${cycles[i].startDate}T00:00:00Z`).getTime();
            expect(thisStart - prevEnd).toBe(86_400_000);
        }
    });

    it('marks a cycle complete only once its end date is strictly past', () => {
        const cycles = generateCycles(MON, 7, '2026-06-10');
        expect(cycles[0].isComplete).toBe(true);
        expect(cycles[cycles.length - 1].isComplete).toBe(false);
    });
});

describe('generateCycles — Mon–Fri cadence (window 5, stride 7)', () => {
    it('produces a Mon–Fri window every week with no weekend drift', () => {
        const cycles = generateCycles(MON, 5, '2026-08-24', 7);

        expect(cycles.length).toBeGreaterThanOrEqual(12);
        for (const c of cycles) {
            expect(dow(c.startDate)).toBe('Mon');
            expect(dow(c.endDate)).toBe('Fri');
        }
    });

    it('starts each cycle exactly 7 days after the previous, leaving the weekend out', () => {
        const cycles = generateCycles(MON, 5, '2026-07-06', 7);
        expect(cycles.map(c => [c.startDate, c.endDate])).toEqual([
            ['2026-06-01', '2026-06-05'],
            ['2026-06-08', '2026-06-12'],
            ['2026-06-15', '2026-06-19'],
            ['2026-06-22', '2026-06-26'],
            ['2026-06-29', '2026-07-03'],
            ['2026-07-06', '2026-07-10'],
        ]);
    });

    it('does not drift across a spring-forward DST boundary', () => {
        // US DST starts 2026-03-08, inside the second cycle.
        const cycles = generateCycles('2026-03-02', 5, '2026-03-30', 7);
        for (const c of cycles) {
            expect(dow(c.startDate)).toBe('Mon');
            expect(dow(c.endDate)).toBe('Fri');
        }
    });

    it('does not drift across a fall-back DST boundary', () => {
        // EU DST ends 2026-10-25, immediately before the anchor.
        const cycles = generateCycles('2026-10-26', 5, '2026-11-23', 7);
        for (const c of cycles) {
            expect(dow(c.startDate)).toBe('Mon');
            expect(dow(c.endDate)).toBe('Fri');
        }
    });

    it('excludes the weekend from every window', () => {
        const cycles = generateCycles(MON, 5, '2026-08-24', 7);
        for (const c of cycles) {
            const start = new Date(`${c.startDate}T00:00:00Z`).getTime();
            const end = new Date(`${c.endDate}T00:00:00Z`).getTime();
            for (let t = start; t <= end; t += 86_400_000) {
                const day = new Date(t).getUTCDay();
                expect(day).not.toBe(0);
                expect(day).not.toBe(6);
            }
        }
    });
});

describe('generateCycles — invalid config', () => {
    it.each([
        ['missing anchor', '', 7, undefined],
        ['zero window', MON, 0, undefined],
        ['negative window', MON, -5, undefined],
        ['zero stride', MON, 5, 0],
        ['negative stride', MON, 5, -7],
        ['stride shorter than window (overlapping cycles)', MON, 7, 5],
    ])('returns empty for %s rather than throwing', (_label, anchor, windowDays, stride) => {
        expect(generateCycles(anchor as string, windowDays as number, '2026-06-30', stride as number | undefined)).toEqual([]);
    });

    it('returns empty when the anchor is after asOf', () => {
        expect(generateCycles('2026-07-01', 5, '2026-06-01', 7)).toEqual([]);
    });
});

describe('lastCompletedCycle', () => {
    it('honours stride when picking the most recent finished cycle', () => {
        // Window Mon 2026-06-15 .. Fri 2026-06-19 is the last one fully elapsed
        // as of Monday 2026-06-22.
        const c = lastCompletedCycle(MON, 5, '2026-06-22', 7);
        expect(c).not.toBeNull();
        expect([c!.startDate, c!.endDate]).toEqual(['2026-06-15', '2026-06-19']);
    });

    it('returns null before any cycle has completed', () => {
        expect(lastCompletedCycle(MON, 5, '2026-06-03', 7)).toBeNull();
    });
});

describe('cycleByIndex', () => {
    it('resolves a Mon–Fri cycle by index using stride', () => {
        const c = cycleByIndex(MON, 5, 3, 7);
        expect(c).not.toBeNull();
        expect([c!.startDate, c!.endDate]).toEqual(['2026-06-22', '2026-06-26']);
    });

    it('agrees with generateCycles at the same index', () => {
        const generated = generateCycles(MON, 5, '2026-08-24', 7);
        for (const g of generated) {
            const byIndex = cycleByIndex(MON, 5, g.index, 7);
            expect([byIndex!.startDate, byIndex!.endDate]).toEqual([g.startDate, g.endDate]);
        }
    });

    it('returns null for a negative index', () => {
        expect(cycleByIndex(MON, 5, -1, 7)).toBeNull();
    });
});

describe('cycleLabel', () => {
    it('renders a readable range', () => {
        expect(cycleLabel('2026-06-01', '2026-06-05')).toBe('Cycle: Jun 1 - Jun 5, 2026');
    });

    it('spans a month boundary', () => {
        expect(cycleLabel('2026-06-29', '2026-07-03')).toBe('Cycle: Jun 29 - Jul 3, 2026');
    });
});

describe('validateKanbanCadence — the API-boundary check', () => {
    // Reproduces the exact mistake made against the live form: "Working
    // window" left on Weekly (7 days) while "Repeats every" was set to 5.
    // The client already blocks this via its own error prop, but that check
    // is bypassable (curl, Postman, any future UI path) -- this is what must
    // reject it at the API regardless of what the client sent.
    it('rejects a 7-day window repeating every 5 days', () => {
        const result = validateKanbanCadence(7, 5);
        expect(result.valid).toBe(false);
        expect((result as any).error).toMatch(/at least the working window/);
    });

    it('accepts the corrected pair: 5-day window repeating every 7 days', () => {
        expect(validateKanbanCadence(5, 7)).toEqual({ valid: true });
    });

    it('accepts stride equal to window (back-to-back)', () => {
        expect(validateKanbanCadence(7, 7)).toEqual({ valid: true });
    });

    it('accepts an absent stride (defaults to back-to-back downstream)', () => {
        expect(validateKanbanCadence(7, null)).toEqual({ valid: true });
        expect(validateKanbanCadence(7, undefined)).toEqual({ valid: true });
    });

    it('rejects a zero or negative stride once a window is set', () => {
        expect(validateKanbanCadence(5, 0).valid).toBe(false);
        expect(validateKanbanCadence(5, -3).valid).toBe(false);
    });

    it('does not block on stride alone before a window is chosen', () => {
        // Matches the form's initial state (window unset) — nothing to
        // validate the stride against yet.
        expect(validateKanbanCadence(null, 5)).toEqual({ valid: true });
        expect(validateKanbanCadence(0, 5)).toEqual({ valid: true });
    });
});
