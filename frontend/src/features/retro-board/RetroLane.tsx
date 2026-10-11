import { Box, Chip, Paper, Typography } from '@mui/material';
import { useDroppable } from '@dnd-kit/core';
import RetroItemCard from './RetroItemCard';
import RetroItemComposer from './RetroItemComposer';
import type { RetroItem, RetroLane as Lane } from './types';

interface Props {
  lane: Lane;
  items: RetroItem[];
  canAddItems: boolean;
  allowAnonymous: boolean;
  dragDisabled: boolean;
  onAdd: (laneKey: string, content: string, isAnonymous: boolean) => Promise<void>;
  onOpen: (item: RetroItem) => void;
  onVote: (item: RetroItem) => void;
  onDelete: (item: RetroItem) => void;
}

export default function RetroLane({
  lane, items, canAddItems, allowAnonymous, dragDisabled, onAdd, onOpen, onVote, onDelete,
}: Props) {
  // The lane key IS the droppable id, mirroring how RiskLane uses the status
  // string — so a drop handler only needs `over.id`.
  const { setNodeRef, isOver } = useDroppable({ id: lane.key });

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      data-testid={`retro-lane-${lane.key}`}
      sx={{
        p: 1.5,
        minWidth: 300,
        flex: '1 1 300px',
        bgcolor: isOver ? 'action.hover' : 'background.paper',
        borderTop: `3px solid ${lane.color}`,
        display: 'flex',
        flexDirection: 'column',
        transition: 'background-color 120ms',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, color: lane.color }}>
          {lane.name}
        </Typography>
        <Chip size="small" label={items.length} sx={{ height: 20, fontSize: 11 }} />
      </Box>

      <Box sx={{ flexGrow: 1, minHeight: 40 }}>
        {items.map(item => (
          <RetroItemCard
            key={item.id}
            item={item}
            onOpen={onOpen}
            onVote={onVote}
            onDelete={onDelete}
            dragDisabled={dragDisabled}
          />
        ))}
        {items.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Nothing here yet.
          </Typography>
        )}
      </Box>

      {canAddItems && (
        <RetroItemComposer
          laneKey={lane.key}
          laneName={lane.name}
          allowAnonymous={allowAnonymous}
          onSubmit={(content, isAnonymous) => onAdd(lane.key, content, isAnonymous)}
        />
      )}
    </Paper>
  );
}
