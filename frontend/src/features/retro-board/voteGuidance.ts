/**
 * Choosing how many votes to give each participant.
 *
 * Voting exists to force a ranking, and scarcity is the mechanism that makes it
 * work. Too few votes and everything ties; too many and everyone endorses half
 * the board, so the top 3 stops being distinguishable from items 4-8. The
 * degenerate case makes it obvious — give each person a vote per item and the
 * exercise returns no information at all.
 *
 * The facilitation heuristic is votes ≈ items ÷ 3. The clamp keeps it usable at
 * both extremes: below 3 there is not enough room to express a preference, and
 * above 8 the budget stops being scarce enough to discriminate.
 */

export const SUGGESTED_MIN = 3;
export const SUGGESTED_MAX = 8;
/** Mirrors MAX_VOTES_PER_USER in the backend's retroBoardService. */
export const MAX_VOTES_PER_USER = 20;

export function suggestVotes(itemCount: number): number {
  if (!Number.isFinite(itemCount) || itemCount <= 0) return SUGGESTED_MIN;
  return Math.min(SUGGESTED_MAX, Math.max(SUGGESTED_MIN, Math.ceil(itemCount / 3)));
}

/**
 * Whether the current budget is far enough from the suggestion to be worth
 * mentioning. Avoids nagging the facilitator over a difference of one.
 */
export function shouldSuggestChange(itemCount: number, current: number): boolean {
  if (current === 0) return false; // unlimited is a deliberate choice
  return Math.abs(suggestVotes(itemCount) - current) >= 2;
}

export function voteBudgetLabel(votesPerUser: number): string {
  return votesPerUser === 0 ? 'unlimited' : String(votesPerUser);
}
