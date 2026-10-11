import { describe, it, expect } from 'vitest';
import { computeDefectDensity, computeReopenRatio, QualityFact } from './qualityMath';

const fact = (over: Partial<QualityFact>): QualityFact => ({
    storyPoints: 0,
    issueType: 'Story',
    isProductionBug: false,
    wasReopened: false,
    wasPunted: false,
    ...over,
});

describe('computeDefectDensity — bugs / SP, invalid bugs excluded', () => {
    it('excludes invalidBug=true tickets from the numerator', () => {
        const facts = [
            fact({ issueType: 'Bug', storyPoints: 0 }),
            fact({ issueType: 'Sub-bug', storyPoints: 0, invalidBug: true }),
            fact({ issueType: 'Sub-bug', storyPoints: 0, invalidBug: true }),
            fact({ issueType: 'Story', storyPoints: 10 }),
        ];
        const r = computeDefectDensity(facts);
        expect(r.bugCount).toBe(1);
        expect(r.totalSp).toBe(10);
        expect(r.density).toBe(0.1);
    });

    it('counts a bug with invalidBug=false (or unset) normally', () => {
        const facts = [
            fact({ issueType: 'Bug', storyPoints: 0, invalidBug: false }),
            fact({ issueType: 'Story', storyPoints: 5 }),
        ];
        const r = computeDefectDensity(facts);
        expect(r.bugCount).toBe(1);
        expect(r.density).toBe(0.2);
    });

    it('still applies the sprint-window filter alongside the invalidBug exclusion', () => {
        const facts = [
            fact({ issueType: 'Bug', storyPoints: 0, jiraCreatedAt: '2026-09-05' }),
            fact({ issueType: 'Bug', storyPoints: 0, jiraCreatedAt: '2026-08-01' }), // outside window
            fact({ issueType: 'Sub-bug', storyPoints: 0, invalidBug: true, jiraCreatedAt: '2026-09-06' }),
            fact({ issueType: 'Story', storyPoints: 10 }),
        ];
        const r = computeDefectDensity(facts, { startDate: '2026-09-01', endDate: '2026-09-15' });
        expect(r.bugCount).toBe(1);
    });
});

describe('computeReopenRatio — Stories + standalone Bugs, Sub-bugs excluded', () => {
    it('counts standalone Bugs in both numerator and denominator', () => {
        const facts = [
            fact({ issueType: 'Story', wasReopened: true }),
            fact({ issueType: 'Story', wasReopened: false }),
            fact({ issueType: 'Bug', wasReopened: true }),
            fact({ issueType: 'Bug', wasReopened: false }),
        ];
        const r = computeReopenRatio(facts);
        expect(r.reopenedStoryCount).toBe(2);
        expect(r.totalStoryCount).toBe(4);
        expect(r.reopenRatio).toBe(50);
    });

    it('excludes Sub-bugs from both numerator and denominator', () => {
        const facts = [
            fact({ issueType: 'Story', wasReopened: true }),
            fact({ issueType: 'Story', wasReopened: false }),
            // sub-bugs must not inflate either count even if flagged reopened
            fact({ issueType: 'Sub-bug', wasReopened: true }),
            fact({ issueType: 'Sub-bug', wasReopened: false }),
        ];
        const r = computeReopenRatio(facts);
        expect(r.reopenedStoryCount).toBe(1);
        expect(r.totalStoryCount).toBe(2);
        expect(r.reopenRatio).toBe(50);
    });

    it('excludes punted tickets', () => {
        const facts = [
            fact({ issueType: 'Story', wasReopened: true }),
            fact({ issueType: 'Story', wasReopened: true, wasPunted: true }),
        ];
        const r = computeReopenRatio(facts);
        expect(r.reopenedStoryCount).toBe(1);
        expect(r.totalStoryCount).toBe(1);
        expect(r.reopenRatio).toBe(100);
    });

    it('returns 0 ratio when there are no in-scope tickets', () => {
        const r = computeReopenRatio([fact({ issueType: 'Sub-bug', wasReopened: true })]);
        expect(r.totalStoryCount).toBe(0);
        expect(r.reopenRatio).toBe(0);
    });
});
