import {
  DndContext,
  DragEndEvent,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, SortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ReactNode } from 'react';
import { moveSplit } from '../../hooks/useHomeData';
import { markDragged } from '../../hooks/useSortableSplit';

// Dragging splits into your own order, in the sidebar and on My splits. A mouse drags
// after moving a few pixels; a finger after a short press, so lists still scroll.

export function SortableSplits({
  ids,
  strategy = verticalListSortingStrategy,
  children,
}: {
  ids: string[];
  strategy?: SortingStrategy;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    markDragged();
    if (over && active.id !== over.id) moveSplit(String(active.id), String(over.id));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
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
