import { Box, Card, CardContent, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import {
  ThumbUpAltRounded,
  ThumbUpOffAltRounded,
  ChatBubbleOutlineRounded,
  DeleteOutlineRounded,
  VisibilityOffRounded,
  EmojiEventsRounded,
  TaskAltRounded,
  ShieldRounded,
} from '@mui/icons-material';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { RetroItem } from './types';

const RANK_COLORS: Record<number, string> = { 1: '#f9a825', 2: '#90a4ae', 3: '#8d6e63' };

interface Props {
  item: RetroItem;
  onOpen: (item: RetroItem) => void;
  onVote: (item: RetroItem) => void;
  onDelete: (item: RetroItem) => void;
  dragDisabled?: boolean;
}

export default function RetroItemCard({ item, onOpen, onVote, onDelete, dragDisabled }: Props) {
  const canDrag = !dragDisabled && item.permissions.canMove;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    data: { item },
    disabled: !canDrag,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  // Only take dnd-kit's a11y attributes when the card is actually draggable.
  // When disabled it still emits role="button" aria-disabled="true", which
  // announces the card as an inert control to screen readers and blocks the
  // click that opens its detail view — the card is not disabled, it just
  // cannot be dragged.
  const dragProps = canDrag ? { ...attributes, ...listeners } : {};

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...dragProps}
      data-testid={`retro-item-${item.id}`}
      data-anonymous={item.isAnonymous ? 'true' : 'false'}
      sx={{
        mb: 1,
        cursor: canDrag ? 'grab' : 'pointer',
        borderLeft: item.topPickRank ? `4px solid ${RANK_COLORS[item.topPickRank]}` : '4px solid transparent',
        '&:hover': { boxShadow: 3 },
      }}
      onClick={() => onOpen(item)}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        {item.topPickRank && (
          <Chip
            size="small"
            icon={<EmojiEventsRounded sx={{ fontSize: 14 }} />}
            label={`Top ${item.topPickRank}`}
            sx={{ mb: 0.75, bgcolor: RANK_COLORS[item.topPickRank], color: '#fff', fontWeight: 600 }}
          />
        )}

        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
          {item.content}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          {item.isAnonymous ? (
            <Tooltip title="Posted anonymously — the author is not recorded">
              <Chip
                size="small"
                variant="outlined"
                icon={<VisibilityOffRounded sx={{ fontSize: 14 }} />}
                label="Anonymous"
                data-testid="anonymous-badge"
                sx={{ height: 22, fontSize: 11 }}
              />
            </Tooltip>
          ) : (
            <Chip
              size="small"
              variant="outlined"
              label={item.author ? `${item.author.firstName} ${item.author.lastName}` : 'Unknown'}
              sx={{ height: 22, fontSize: 11 }}
            />
          )}

          {item.converted && (
            <Chip
              size="small"
              color="primary"
              icon={item.converted.type === 'ACTION_ITEM'
                ? <TaskAltRounded sx={{ fontSize: 14 }} />
                : <ShieldRounded sx={{ fontSize: 14 }} />}
              label={item.converted.type === 'ACTION_ITEM'
                ? `Action #${item.converted.refId}`
                : `Risk #${item.converted.refId}`}
              sx={{ height: 22, fontSize: 11 }}
            />
          )}

          <Box sx={{ flexGrow: 1 }} />

          {item.commentCount > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, color: 'text.secondary' }}>
              <ChatBubbleOutlineRounded sx={{ fontSize: 14 }} />
              <Typography variant="caption">{item.commentCount}</Typography>
            </Box>
          )}

          <Tooltip title={item.permissions.canVote ? (item.hasVoted ? 'Remove vote' : 'Vote') : 'Voting closed'}>
            <span>
              <IconButton
                size="small"
                disabled={!item.permissions.canVote}
                data-testid={`vote-${item.id}`}
                onClick={e => { e.stopPropagation(); onVote(item); }}
              >
                {item.hasVoted
                  ? <ThumbUpAltRounded sx={{ fontSize: 16 }} color="primary" />
                  : <ThumbUpOffAltRounded sx={{ fontSize: 16 }} />}
              </IconButton>
            </span>
          </Tooltip>
          <Typography variant="caption" sx={{ minWidth: 12 }}>{item.voteCount}</Typography>

          {item.permissions.canDelete && (
            <Tooltip title={item.isAnonymous ? 'Withdraw this anonymous item' : 'Delete'}>
              <IconButton
                size="small"
                data-testid={`delete-${item.id}`}
                onClick={e => { e.stopPropagation(); onDelete(item); }}
              >
                <DeleteOutlineRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
