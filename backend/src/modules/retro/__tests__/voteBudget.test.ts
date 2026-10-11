import { describe, it, expect } from 'vitest';
import { parseVotesPerUser, MAX_VOTES_PER_USER } from '../services/voteBudget';

/**
 * The vote budget is the one board setting with real mid-meeting consequences,
 * and it previously had no validation at all. Two failures were silent: a
 * non-numeric value became NaN and surfaced as a 500 from the NOT NULL column,
 * and a negative value passed through then failed the `> 0` test in toggleVote —
 * quietly making voting UNLIMITED rather than restricting it.
 */
describe('parseVotesPerUser', () => {
    it('accepts the normal range', () => {
        expect(parseVotesPerUser(3)).toBe(3);
        expect(parseVotesPerUser(6)).toBe(6);
        expect(parseVotesPerUser(MAX_VOTES_PER_USER)).toBe(MAX_VOTES_PER_USER);
    });

    it('accepts 0, which deliberately means unlimited', () => {
        expect(parseVotesPerUser(0)).toBe(0);
    });

    it('accepts numeric strings from JSON bodies', () => {
        expect(parseVotesPerUser('5')).toBe(5);
    });

    it('rejects a negative budget rather than silently enabling unlimited voting', () => {
        expect(() => parseVotesPerUser(-1)).toThrow(/between 0 and/);
    });

    it('rejects non-numeric input instead of letting it 500 on the column', () => {
        expect(() => parseVotesPerUser('abc')).toThrow(/between 0 and/);
        expect(() => parseVotesPerUser(null)).toThrow();
        expect(() => parseVotesPerUser(undefined)).toThrow();
        expect(() => parseVotesPerUser(NaN)).toThrow();
    });

    it('rejects fractional budgets', () => {
        expect(() => parseVotesPerUser(2.5)).toThrow();
    });

    it('rejects a budget so large that voting stops discriminating', () => {
        expect(() => parseVotesPerUser(MAX_VOTES_PER_USER + 1)).toThrow(/between 0 and/);
    });

    it('reports a 400, not a 500', () => {
        try {
            parseVotesPerUser(-1);
            throw new Error('should have thrown');
        } catch (e: unknown) {
            expect((e as { statusCode?: number }).statusCode).toBe(400);
        }
    });
});
