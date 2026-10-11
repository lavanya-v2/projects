import { Box, Chip, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { Project } from '../../types';

/**
 * Built-in "done" statuses used when a Kanban project has no explicit override.
 * Mirror of EFFECTIVE_DONE in backend performanceSyncService.ts — keep in step.
 */
const DEFAULT_DONE_STATUSES = [
  'Pending Deployment', 'Ready for Deployment', 'Ready for Release',
  'Deployed', 'Released', 'Done', 'Closed', 'Resolved',
  'Complete', 'Completed', 'Accepted', 'Verified',
];

const MAX_VISIBLE = 4;

interface Props {
  isKanban: boolean;
  project?: Project | null;
}

/**
 * One-line statement of what counts as Done on this board, so it doesn't have to
 * be explained person-by-person. The statuses shown are the project's ACTUAL
 * configured done list (Project Settings), falling back to the built-in set.
 * Everything secondary lives in the hover, deliberately — a wall of text here
 * just gets ignored.
 */
export function DefinitionOfDoneNote({ isKanban, project }: Props) {
  const configured = (project?.kanbanDoneStatuses ?? []).filter(Boolean);
  const isCustom = configured.length > 0;
  const statuses = isCustom ? configured : DEFAULT_DONE_STATUSES;
  const visible = statuses.slice(0, MAX_VISIBLE);
  const hidden = statuses.slice(MAX_VISIBLE);

  // Sprint projects only show the chip list once they've actually configured an
  // override -- the unconfigured default (DEFAULT_DONE_STATUSES) doesn't fully
  // describe real behavior for Sprint, since Jira's statusCategory also
  // independently qualifies a ticket as done regardless of status name.
  const showChips = isKanban || isCustom;

  const details = isKanban ? (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="caption" component="div" sx={{ mb: 0.75 }}>
        <strong>Done statuses{isCustom ? ' (set for this project)' : ' (default set)'}:</strong> {statuses.join(', ')}
      </Typography>
      <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
        A ticket is credited to the cycle where it <strong>first</strong> reaches one of these.
        Closing it off later (e.g. Pending Deployment &rarr; Closed at release) does not bring it
        back into a later cycle.
      </Typography>
      <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
        There is <strong>no commitment or plan</strong> on a Kanban board, so a cycle is reported
        as work <strong>delivered</strong> plus work <strong>still in flight</strong> &mdash;
        counting only tickets that moved during the cycle, not everything currently open.
      </Typography>
      <Typography variant="caption" component="div">
        <strong>QA</strong> credit and UAT rejections count only in the cycle they happened.
        Bugs linked to an Epic are excluded from In-Sprint Catch. Quality rating needs 5+ tickets
        tested.
      </Typography>
    </Box>
  ) : isCustom ? (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="caption" component="div" sx={{ mb: 0.75 }}>
        <strong>Done statuses (set for this project):</strong> {statuses.join(', ')}
      </Typography>
      <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
        This overrides Jira&rsquo;s own status-category detection for this project — a ticket is
        completed only when it reaches one of these statuses within the sprint window, regardless
        of what Jira&rsquo;s built-in Done category says.
      </Typography>
      <Typography variant="caption" component="div">
        <strong>Planned</strong> = the sprint commitment; later additions show as scope added,
        removals as punted. Bugs linked to an Epic are excluded from In-Sprint Catch. Quality
        rating needs 5+ tickets tested.
      </Typography>
    </Box>
  ) : (
    <Box sx={{ p: 0.5 }}>
      <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
        Done follows Jira&rsquo;s own sprint report — a ticket counts as delivered when Jira puts
        it in the sprint&rsquo;s completed list at close.
      </Typography>
      <Typography variant="caption" component="div">
        <strong>Planned</strong> = the sprint commitment; later additions show as scope added,
        removals as punted. Bugs linked to an Epic are excluded from In-Sprint Catch. Quality
        rating needs 5+ tickets tested.
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexBasis: '100%', flexWrap: 'wrap' }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
        Done =
      </Typography>

      {showChips ? (
        <>
          {visible.map(s => (
            <Chip key={s} label={s} size="small" variant="outlined"
              sx={{ height: 20, fontSize: 11.5, '& .MuiChip-label': { px: 0.75 } }} />
          ))}
          {hidden.length > 0 && (
            <Typography variant="caption" color="text.secondary">+{hidden.length} more</Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            &middot; {isKanban ? 'credited to the cycle it first gets there' : 'credited to the sprint it reaches this in'}
          </Typography>
        </>
      ) : (
        <Typography variant="caption" color="text.secondary">
          Jira&rsquo;s sprint report &mdash; completed at sprint close
        </Typography>
      )}

      <Tooltip title={details} arrow placement="bottom-start"
        componentsProps={{ tooltip: { sx: { maxWidth: 460 } } }}>
        <InfoOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled', cursor: 'help' }} />
      </Tooltip>
    </Box>
  );
}
