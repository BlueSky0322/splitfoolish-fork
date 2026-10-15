import {
  DndContext,
  DragEndEvent,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, SortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ReactNode } from 'react';
import { markDragged } from '../../hooks/useSortableSplit';

// Dragging splits into your own order, in the sidebar and on My splits. A mouse drags
// after moving a few pixels; a finger after a short press, so lists still scroll.
// Lists only move up and down, and never past their own ends; grids move freely.

const IN_LIST = [restrictToVerticalAxis, restrictToParentElement];

export function SortableSplits({
  ids,
  strategy = verticalListSortingStrategy,
  layout = 'list',
  onMove,
  children,
}: {
  ids: string[];
  /** A split dropped where another one is */
  onMove: (id: string, toId: string) => void;
  strategy?: SortingStrategy;
  /** list: one column, so up and down only. grid: rows and columns */
  layout?: 'list' | 'grid';
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    markDragged();
    if (over && active.id !== over.id) onMove(String(active.id), String(over.id));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={layout === 'list' ? IN_LIST : undefined}
      // Focus stays where the person left it, rather than ringing the split just clicked
      accessibility={{ restoreFocus: false }}
      onDragStart={markDragged}
      onDragEnd={onDragEnd}
      onDragCancel={markDragged}
    >
      <SortableContext
        items={ids}
        strategy={strategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}
