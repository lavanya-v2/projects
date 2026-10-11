import { describe, it, expect } from 'vitest';
import {
    computeSprintProductivity,
    computeProductivityTrend,
    round1,
    SprintFact,
} from './productivityMath';

describe('computeSprintProductivity', () => {
    it('returns zeros for empty input', () => {
        expect(computeSprintProductivity([])).toEqual({
            spDone: 0,
            spPlanned: 0,
            productivity: 0,
        });
    });

    it('returns 100 when every fact is completed', () => {
        const facts: SprintFact[] = [
            { storyPoints: 5, wasCompleted: true },
            { storyPoints: 3, wasCompleted: true },
        ];
        expect(computeSprintProductivity(facts)).toEqual({
            spDone: 8,
            spPlanned: 8,
            productivity: 100,
        });
    });

    it('returns 0 when no fact is completed', () => {
        const facts: SprintFact[] = [
            { storyPoints: 5, wasCompleted: false },
            { storyPoints: 3, wasCompleted: false },
        ];
        expect(computeSprintProductivity(facts)).toEqual({
            spDone: 0,
            spPlanned: 8,
            productivity: 0,
        });
    });

    it('computes the canonical mixed case by hand', () => {
        // 3 completed (8+5+3 = 16 SP) + 2 incomplete (5+2 = 7 SP)  →  16 / 23 × 100 = 69.565... → 69.6
        const facts: SprintFact[] = [
            { storyPoints: 8, wasCompleted: true },
            { storyPoints: 5, wasCompleted: true },
            { storyPoints: 3, wasCompleted: true },
            { storyPoints: 5, wasCompleted: false },
            { storyPoints: 2, wasCompleted: false },
        ];
        expect(computeSprintProductivity(facts)).toEqual({
            spDone: 16,
            spPlanned: 23,
            productivity: 69.6,
        });
    });

    it('treats null story points as zero in both totals', () => {
        const facts: SprintFact[] = [
            { storyPoints: null, wasCompleted: true },
            { storyPoints: 5, wasCompleted: true },
            { storyPoints: null, wasCompleted: false },
        ];
        expect(computeSprintProductivity(facts)).toEqual({
            spDone: 5,
            spPlanned: 5,
            productivity: 100,
        });
    });

    it('returns 0 productivity (no NaN/Infinity) when every fact is unestimated', () => {
        const facts: SprintFact[] = [
            { storyPoints: null, wasCompleted: true },
            { storyPoints: null, wasCompleted: false },
        ];
        const result = computeSprintProductivity(facts);
        expect(result.productivity).toBe(0);
        expect(Number.isFinite(result.productivity)).toBe(true);
    });

    it('rounds productivity to 1 decimal place', () => {
        // 16 / 23 × 100 = 69.5652173... → round1 → 69.6
        const facts: SprintFact[] = [
            { storyPoints: 16, wasCompleted: true },
            { storyPoints: 7, wasCompleted: false },
        ];
        expect(computeSprintProductivity(facts).productivity).toBe(69.6);
    });
});

describe('computeProductivityTrend', () => {
    it('returns neutral/red when no sprint rows exist', () => {
        expect(computeProductivityTrend([])).toEqual({
            currentProductivity: null,
            avgProductivity: null,
            trend: 'neutral',
            trendPct: 0,
            health: 'red',
        });
    });

    it('returns neutral with null avg when only one sprint exists', () => {
        expect(computeProductivityTrend([{ productivity: 85 }])).toEqual({
            currentProductivity: 85,
            avgProductivity: null,
            trend: 'neutral',
            trendPct: 0,
            health: 'green',
        });
    });

    it('classifies trend as up when current beats avg by >5%', () => {
        // current 92, historical [80, 80] → avg 80 → (92-80)/80 = 15% → up
        const trend = computeProductivityTrend([
            { productivity: 92 },
            { productivity: 80 },
            { productivity: 80 },
        ]);
        expect(trend.currentProductivity).toBe(92);
        expect(trend.avgProductivity).toBe(80);
        expect(trend.trendPct).toBe(15);
        expect(trend.trend).toBe('up');
        expect(trend.health).toBe('green');
    });

    it('classifies trend as down when current trails avg by >5%', () => {
        // current 68, historical [80, 80] → avg 80 → (68-80)/80 = -15% → down
        const trend = computeProductivityTrend([
            { productivity: 68 },
            { productivity: 80 },
            { productivity: 80 },
        ]);
        expect(trend.trendPct).toBe(-15);
        expect(trend.trend).toBe('down');
        expect(trend.health).toBe('amber');
    });

    it('classifies trend as neutral inside the ±5% band', () => {
        // current 83, historical [80, 80] → avg 80 → (83-80)/80 = 3.75% → round → 4 → neutral
        const trend = computeProductivityTrend([
            { productivity: 83 },
            { productivity: 80 },
            { productivity: 80 },
        ]);
        expect(trend.trendPct).toBe(4);
        expect(trend.trend).toBe('neutral');
    });

    it('guards against avg=0 (no NaN/Infinity in trendPct)', () => {
        const trend = computeProductivityTrend([
            { productivity: 40 },
            { productivity: 0 },
            { productivity: 0 },
        ]);
        expect(trend.avgProductivity).toBe(0);
        expect(trend.trendPct).toBe(0);
        expect(trend.trend).toBe('neutral');
        expect(Number.isFinite(trend.trendPct)).toBe(true);
    });

    it('applies health thresholds exactly at 80 and 60', () => {
        expect(computeProductivityTrend([{ productivity: 80 }]).health).toBe('green');
        expect(computeProductivityTrend([{ productivity: 79.9 }]).health).toBe('amber');
        expect(computeProductivityTrend([{ productivity: 60 }]).health).toBe('amber');
        expect(computeProductivityTrend([{ productivity: 59.9 }]).health).toBe('red');
    });

    it('averages only historical sprints (excludes the current/newest)', () => {
        // current 50; historical [100, 100, 100] → avg 100; not ((50+100+100+100)/4 = 87.5)
        const trend = computeProductivityTrend([
            { productivity: 50 },
            { productivity: 100 },
            { productivity: 100 },
            { productivity: 100 },
        ]);
        expect(trend.currentProductivity).toBe(50);
        expect(trend.avgProductivity).toBe(100);
    });
});

describe('round1', () => {
    it('rounds to one decimal place', () => {
        expect(round1(68.3478)).toBe(68.3);
        expect(round1(68.36)).toBe(68.4);
        expect(round1(0)).toBe(0);
        expect(round1(100)).toBe(100);
    });
});
