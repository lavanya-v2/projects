/**
 * Vote budget rules.
 *
 * Deliberately free of model imports so it stays unit-testable without a
 * database or decorator metadata — the same reason retroPermissions.ts is a
 * pure module.
 *
 * Why a budget exists at all: voting's job is to force a ranking, and scarcity
 * is the mechanism. Too many votes and everyone endorses half the board, so the
 * top 3 stops being distinguishable from the rest. 0 means unlimited, which is
 * a legitimate choice for a small board; MAX_VOTES_PER_USER is the point past
 * which a budget no longer discriminates at all.
 */

export const MAX_VOTES_PER_USER = 20;

export class VoteBudgetError extends Error {
    statusCode = 400;
    constructor(message: string) {
        super(message);
        this.name = 'VoteBudgetError';
    }
}

/**
 * Validate a vote budget.
 *
 * Guards two previously silent failures: a non-numeric value became NaN and
 * surfaced as a 500 from the NOT NULL column, and a negative value passed
 * straight through — then failed the `> 0` test in toggleVote, quietly turning
 * voting unlimited rather than restricting it.
 */
export function parseVotesPerUser(raw: unknown): number {
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_VOTES_PER_USER) {
        throw new VoteBudgetError(
            `votesPerUser must be a whole number between 0 and ${MAX_VOTES_PER_USER} (0 = unlimited)`
        );
    }
    return n;
}
