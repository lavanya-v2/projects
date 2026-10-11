import { Alert, Box, Button, Chip, Paper, Tooltip, Typography } from '@mui/material';
import { EmojiEventsRounded, HowToVoteRounded } from '@mui/icons-material';
import { suggestVotes, shouldSuggestChange } from './voteGuidance';
import type { RetroBoard, RetroItem } from './types';

const RANK_COLORS: Record<number, string> = { 1: '#f9a825', 2: '#90a4ae', 3: '#8d6e63' };

interface Props {
  board: RetroBoard;
  items: RetroItem[];
  onSetRank: (item: RetroItem, rank: number | null) => void;
  onApplyVoteSuggestion?: (votes: number) => void;
}

/**
 * Connects voting to the decision.
 *
 * Voting is the team's signal — cheap, parallel, everyone at once. The top 3 is
 * the facilitator's commitment: what the team will actually act on. They are
 * deliberately separate steps (the highest-voted item is not always the one you
 * commit to; it may already be in progress, or two items may merge), but the
 * board previously showed no relationship between them at all, which made the
 * voting look pointless. This panel makes the hand-off explicit: it ranks by
 * votes and lets the facilitator promote a candidate in one click.
 */
export default function TopPicksPanel({ board, items, onSetRank, onApplyVoteSuggestion }: Props) {
  if (board.status === 'DRAFT') return null;

  const totalVotesCast = items.reduce((sum, i) => sum + i.voteCount, 0);
  const suggestedVotes = suggestVotes(items.length);
  // Surface the suggestion at the one moment it is actionable: collection has
  // produced items, but nobody has voted yet, so the budget can still change
  // without invalidating votes already cast.
  const showVoteSuggestion =
    board.permissions.canEditSettings &&
    board.status === 'ACTIVE' &&
    board.votingEnabled &&
    board.votesPerUser > 0 &&
    items.length >= 3 &&
    totalVotesCast === 0 &&
    shouldSuggestChange(items.length, board.votesPerUser) &&
    !!onApplyVoteSuggestion;

  const ranked = items
    .filter(i => i.topPickRank !== null)
    .sort((a, b) => (a.topPickRank as number) - (b.topPickRank as number));

  const candidates = items
    .filter(i => i.topPickRank === null && i.voteCount > 0)
    // Tie-break on id so equal-vote items hold a stable order instead of
    // reshuffling under the facilitator every time a vote lands.
    .sort((a, b) => b.voteCount - a.voteCount || a.id - b.id)
    .slice(0, 5);

  const canRank = board.permissions.canMarkTopPicks;
  const usedRanks = new Set(ranked.map(i => i.topPickRank));
  const nextFreeRank = [1, 2, 3].find(r => !usedRanks.has(r)) ?? null;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="top-picks-panel">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <EmojiEventsRounded fontSize="small" sx={{ color: '#f9a825' }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Top 3 agreed points
        </Typography>
        <Chip size="small" label={`${ranked.length}/3`} sx={{ height: 20, fontSize: 11 }} />
      </Box>

      {showVoteSuggestion && (
        <Alert
          severity="info"
          sx={{ mb: 1.5 }}
          data-testid="vote-suggestion"
          action={
            <Button
              size="small"
              data-testid="apply-vote-suggestion"
              onClick={() => onApplyVoteSuggestion?.(suggestedVotes)}
            >
              Use {suggestedVotes}
            </Button>
          }
        >
          {items.length} items on the board, and everyone currently has {board.votesPerUser} vote
          {board.votesPerUser === 1 ? '' : 's'}. About {suggestedVotes} votes each gives the top 3
          clearer separation.
        </Alert>
      )}

      {ranked.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          {canRank
            ? 'Nothing agreed yet. Let the team vote, then promote the points you want to commit to.'
            : 'The facilitator has not confirmed the top points yet.'}
        </Typography>
      ) : (
        <Box sx={{ mb: candidates.length ? 2 : 0 }}>
          {ranked.map(item => (
            <Box
              key={item.id}
              data-testid={`top-pick-${item.topPickRank}`}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, p: 1,
                borderLeft: `4px solid ${RANK_COLORS[item.topPickRank as number]}`,
                bgcolor: 'action.hover', borderRadius: 1,
              }}
            >
              <Chip
                size="small"
                label={`#${item.topPickRank}`}
                sx={{
                  height: 22, fontWeight: 700, color: '#fff',
                  bgcolor: RANK_COLORS[item.topPickRank as number],
                }}
              />
              <Typography variant="body2" sx={{ flexGrow: 1 }}>{item.content}</Typography>
              <Chip
                size="small" variant="outlined"
                icon={<HowToVoteRounded sx={{ fontSize: 14 }} />}
                label={item.voteCount}
                sx={{ height: 22, fontSize: 11 }}
              />
              {canRank && (
                <Button size="small" onClick={() => onSetRank(item, null)}>Remove</Button>
              )}
            </Box>
          ))}
        </Box>
      )}

      {canRank && candidates.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            Most voted so far — promote the ones the team commits to:
          </Typography>
          {candidates.map(item => (
            <Box
              key={item.id}
              data-testid={`candidate-${item.id}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}
            >
              <Chip
                size="small" variant="outlined"
                icon={<HowToVoteRounded sx={{ fontSize: 14 }} />}
                label={item.voteCount}
                sx={{ height: 22, fontSize: 11, minWidth: 56 }}
              />
              <Typography variant="body2" sx={{ flexGrow: 1 }} noWrap>{item.content}</Typography>
              <Tooltip
                title={nextFreeRank
                  ? `Commit this as top ${nextFreeRank}`
                  : 'All three slots are taken — remove one first'}
              >
                <span>
                  <Button
                    size="small" variant="outlined" disabled={!nextFreeRank}
                    data-testid={`promote-${item.id}`}
                    onClick={() => nextFreeRank && onSetRank(item, nextFreeRank)}
                  >
                    {nextFreeRank ? `Make #${nextFreeRank}` : 'Full'}
                  </Button>
                </span>
              </Tooltip>
            </Box>
          ))}
        </>
      )}

      {canRank && ranked.length === 0 && candidates.length === 0 && board.votingEnabled && (
        <Alert severity="info" sx={{ mt: 1 }}>
          No votes yet. Ask the team to vote on the items that matter most — the highest-voted
          points will appear here for you to confirm.
        </Alert>
      )}
    </Paper>
  );
}
