import { describe, it, expect } from 'vitest';
import {
    tokenise, similarity, classify, groupIntoThemes,
    EXACT_THRESHOLD, LIKELY_THRESHOLD, type AgreedPointInput,
} from '../services/agreedPointsRepeat';

const point = (overrides: Partial<AgreedPointInput> & { content: string; boardId: number }): AgreedPointInput => ({
    itemId: Math.floor(Math.random() * 1e6),
    boardTitle: 'Retro',
    meetingDate: '2026-08-01',
    topPickRank: 1,
    outcome: null,
    convertedType: null,
    convertedRefId: null,
    ...overrides,
});

describe('tokenise', () => {
    it('strips punctuation and case', () => {
        expect(tokenise('Standups OVERRUN!')).toEqual(new Set(['standup', 'overrun']));
    });

    it('joins hyphenated compounds so stand-ups matches standups', () => {
        expect(tokenise('stand-ups')).toEqual(tokenise('standups'));
        expect(classify('Stand-ups overrun', 'standups overrun')).toBe('EXACT_REPEAT');
    });

    it('drops stopwords', () => {
        expect(tokenise('we need to be in the room')).toEqual(new Set(['room']));
    });

    it('folds simple plurals so standup and standups match', () => {
        expect(tokenise('standups')).toEqual(tokenise('standup'));
    });

    it('does not fold words ending in double-s', () => {
        expect(tokenise('process')).toEqual(new Set(['process']));
    });
});

describe('similarity', () => {
    it('is 1 for identical content', () => {
        expect(similarity('flaky tests slow us down', 'flaky tests slow us down')).toBe(1);
    });

    it('is 0 for unrelated content', () => {
        expect(similarity('flaky tests', 'hiring plan')).toBe(0);
    });

    it('is 0 when either side has no meaningful tokens', () => {
        expect(similarity('we the of', 'flaky tests')).toBe(0);
        expect(similarity('', 'flaky tests')).toBe(0);
    });
});

describe('classify', () => {
    it('treats a reworded identical point as an exact repeat', () => {
        expect(classify('Standups overrun', 'standups overrun!')).toBe('EXACT_REPEAT');
    });

    it('treats a near-restatement as an exact repeat', () => {
        expect(classify('flaky tests slow the build', 'flaky tests slow build times')).toBe('EXACT_REPEAT');
    });

    it('treats a partial overlap as a likely repeat', () => {
        expect(classify('flaky tests slow the build', 'tests fail randomly on build')).toBe('LIKELY_REPEAT');
    });

    it('groups a short point restated at greater length', () => {
        // Jaccard alone scores this 0.4 and would miss it; containment catches it.
        expect(classify('Standups overrun', 'standups overrun every single day')).toBe('EXACT_REPEAT');
    });

    it('does not merge on a single shared word', () => {
        expect(classify('flaky tests', 'tests are slow')).toBe('DISTINCT');
    });

    it('keeps genuinely different points distinct', () => {
        expect(classify('standups overrun', 'deployment pipeline is slow')).toBe('DISTINCT');
    });

    it('does not merge points that differ only in a meaningful word', () => {
        // The stopword list is deliberately short for exactly this reason.
        expect(classify('deploy to staging', 'deploy to production')).toBe('DISTINCT');
    });

    it('honours the documented thresholds', () => {
        expect(EXACT_THRESHOLD).toBeGreaterThan(LIKELY_THRESHOLD);
    });
});

describe('groupIntoThemes', () => {
    it('groups the same point raised in different retros', () => {
        const themes = groupIntoThemes([
            point({ content: 'Standups overrun', boardId: 1, meetingDate: '2026-06-01' }),
            point({ content: 'standups overrun again', boardId: 2, meetingDate: '2026-07-01' }),
        ]);

        expect(themes).toHaveLength(1);
        expect(themes[0].occurrences).toHaveLength(2);
        expect(themes[0].isRepeat).toBe(true);
    });

    it('does not mark a single-board repeat as recurring', () => {
        // Two similar points in the SAME retro is not a cross-retro pattern.
        const themes = groupIntoThemes([
            point({ content: 'Standups overrun', boardId: 1 }),
            point({ content: 'standups overrun badly', boardId: 1 }),
        ]);

        expect(themes[0].occurrences).toHaveLength(2);
        expect(themes[0].isRepeat).toBe(false);
    });

    it('keeps unrelated points in separate themes', () => {
        const themes = groupIntoThemes([
            point({ content: 'Standups overrun', boardId: 1 }),
            point({ content: 'Deployment pipeline is slow', boardId: 2 }),
        ]);
        expect(themes).toHaveLength(2);
    });

    it('flags a recurring point that was never resolved', () => {
        const themes = groupIntoThemes([
            point({ content: 'Standups overrun', boardId: 1, meetingDate: '2026-06-01' }),
            point({ content: 'Standups overrun', boardId: 2, meetingDate: '2026-07-01' }),
            point({ content: 'Standups overrun', boardId: 3, meetingDate: '2026-08-01' }),
        ]);

        expect(themes[0].unresolvedRepeat).toBe(true);
    });

    it('does NOT flag a recurring point that was actioned', () => {
        const themes = groupIntoThemes([
            point({ content: 'Standups overrun', boardId: 1 }),
            point({ content: 'Standups overrun', boardId: 2, convertedType: 'ACTION_ITEM', convertedRefId: 9 }),
        ]);

        expect(themes[0].isRepeat).toBe(true);
        expect(themes[0].unresolvedRepeat).toBe(false);
    });

    it('does NOT flag a recurring point that was deliberately dropped', () => {
        // Dropping is a decision, not neglect.
        const themes = groupIntoThemes([
            point({ content: 'Standups overrun', boardId: 1 }),
            point({ content: 'Standups overrun', boardId: 2, outcome: 'DROPPED' }),
        ]);

        expect(themes[0].unresolvedRepeat).toBe(false);
    });

    it('orders the most-repeated theme first', () => {
        const themes = groupIntoThemes([
            point({ content: 'One off issue', boardId: 1, meetingDate: '2026-06-01' }),
            point({ content: 'Standups overrun', boardId: 2, meetingDate: '2026-07-01' }),
            point({ content: 'Standups overrun', boardId: 3, meetingDate: '2026-08-01' }),
        ]);

        expect(themes[0].occurrences).toHaveLength(2);
        expect(themes[0].label).toContain('Standups');
    });

    it('labels a theme with its earliest wording', () => {
        const themes = groupIntoThemes([
            point({ content: 'Standups overrun', boardId: 1, meetingDate: '2026-06-01' }),
            point({ content: 'standups overrun every single day', boardId: 2, meetingDate: '2026-07-01' }),
        ]);
        expect(themes[0].label).toBe('Standups overrun');
    });

    it('returns nothing for no input', () => {
        expect(groupIntoThemes([])).toEqual([]);
    });
});
