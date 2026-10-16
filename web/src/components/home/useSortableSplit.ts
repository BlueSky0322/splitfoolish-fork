import type { MouseEvent, TouchEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

let draggedAt = 0;

/** Called as a drag starts and ends */
export const markDragged = () => {
  draggedAt = Date.now();
};

/** True just after a drag ends, when the browser also sends the drop as a click */
export const justDragged = () => Date.now() - draggedAt < 250;

/**
 * A split that can be dragged within SortableSplits: `node` goes on what moves, and the
 * handlers on what's pressed to drag it, for an element that handles touches itself too
 */
export function useSortableSplitParts(id: string) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id });
  const handlers = listeners as
    | { onTouchStart?: (e: TouchEvent) => void; onMouseDown?: (e: MouseEvent) => void }
    | undefined;
  return {
    node: {
      'ref': setNodeRef,
      'style': {
        transform: CSS.Translate.toString(transform),
        transition,
        position: 'relative' as const,
        zIndex: isDragging ? 2 : undefined,
      },
      'data-dragging': isDragging || undefined,
    },
    onTouchStart: handlers?.onTouchStart,
    onMouseDown: handlers?.onMouseDown,
    listeners,
    dragging: isDragging,
  };
}

/** Props that make an element draggable within SortableSplits */
export function useSortableSplit(id: string) {
  const { node, listeners } = useSortableSplitParts(id);
  return { ...node, ...listeners };
}
