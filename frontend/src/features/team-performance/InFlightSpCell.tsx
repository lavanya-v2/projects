import { Typography } from '@mui/material';

/**
 * "SP In Flight" cell for Kanban developer rows (no tracked commitment): story
 * points that moved during the cycle and had not finished by the end of it.
 *
 * The value is `spOpen`, NOT `spPlanned - spDone`. The latter omits points for a
 * ticket already carried last cycle (so scoring does not count the same work
 * twice), which understates the real load badly -- on LS Jul 27-31 it read 4 SP
 * for a developer actually holding 30, and 0 for one holding 6.
 *
 * `spOpen` is null on cycles synced before the field existed. Rather than print
 * a number that would understate, those fall back to the ticket count.
 */
export function InFlightSpCell({ spOpen, openTickets }: { spOpen: number | null | undefined; openTickets: number }) {
  if (spOpen == null) {
    return openTickets > 0
      ? (
        <Typography variant="body2" fontWeight={700} color="text.secondary">
          {openTickets} {openTickets === 1 ? 'ticket' : 'tickets'}
        </Typography>
      )
      : <Typography variant="caption" color="text.secondary">&mdash;</Typography>;
  }
  if (!spOpen) {
    return <Typography variant="caption" color="text.secondary">&mdash;</Typography>;
  }
  return <Typography variant="body2" fontWeight={700}>{spOpen} SP</Typography>;
}
