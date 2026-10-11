import type { ReactNode, CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { IconButton, TableCell } from '@mui/material';
import { DragIndicator } from '@mui/icons-material';

// Reusable drag-to-reorder primitives for the presentation table editors.
// Ids are index-based strings (rows are capped well under any perf concern),
// so no stable per-row id is added to the persisted data model.

interface SortableRowsProps {
  count: number;
  onReorder: (from: number, to: number) => void;
  children: ReactNode;
  // When false, renders children unchanged with no drag context — lets callers
  // keep a single code path and gate the behavior with a prop.
  enabled?: boolean;
}

// Sets up the drag context over `count` index-based ids. Renders no DOM of its
// own, so it nests safely around a <Table>/<TableBody> or a <Stack>.
export function SortableRows({ count, onReorder, children, enabled = true }: SortableRowsProps) {
  const sensors = useSensors(
    // Small activation distance so clicking into a cell input never starts a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = Number(active.id);
    const to = Number(over.id);
    if (Number.isNaN(from) || Number.isNaN(to)) return;
    onReorder(from, to);
  };

  if (!enabled) return <>{children}</>;

  const ids = Array.from({ length: count }, (_, i) => String(i));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

// Derive the exact attribute/listener types from useSortable's return so the
// spread onto MUI IconButton doesn't collide with restricted MUI prop unions.
type SortableResult = ReturnType<typeof useSortable>;
interface DragHandleProps {
  attributes: SortableResult['attributes'];
  listeners: SortableResult['listeners'];
}

interface SortableRowChildProps {
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  dragHandleProps: DragHandleProps;
}

interface SortableRowProps {
  index: number;
  children: (props: SortableRowChildProps) => ReactNode;
}

// Render-prop wrapper around a single sortable item. The caller attaches
// setNodeRef/style to its <TableRow>/<Paper> and spreads dragHandleProps onto
// a dedicated handle (see DragHandleCell / DragHandleButton below).
export function SortableRow({ index, children }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(index),
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: isDragging ? '#eef2f7' : undefined,
    position: 'relative',
    zIndex: isDragging ? 1 : undefined,
  };

  return <>{children({ setNodeRef, style, isDragging, dragHandleProps: { attributes, listeners } })}</>;
}

// Leading table cell holding the drag handle, for the <Table>-based editors.
export function DragHandleCell({ dragHandleProps }: { dragHandleProps: DragHandleProps }) {
  return (
    <TableCell sx={{ width: 36, px: 0.5, cursor: 'grab', touchAction: 'none' }}>
      <IconButton
        size="small"
        disableRipple
        {...dragHandleProps.attributes}
        {...dragHandleProps.listeners}
        sx={{ cursor: 'grab', color: 'text.disabled', '&:active': { cursor: 'grabbing' } }}
      >
        <DragIndicator fontSize="small" />
      </IconButton>
    </TableCell>
  );
}

// Standalone drag handle button, for card-style (non-table) editors.
export function DragHandleButton({ dragHandleProps }: { dragHandleProps: DragHandleProps }) {
  return (
    <IconButton
      size="small"
      disableRipple
      {...dragHandleProps.attributes}
      {...dragHandleProps.listeners}
      sx={{ cursor: 'grab', color: 'text.disabled', touchAction: 'none', '&:active': { cursor: 'grabbing' } }}
    >
      <DragIndicator fontSize="small" />
    </IconButton>
  );
}
