import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

let draggedAt = 0;

/** Called as a drag starts and ends */
export const markDragged = () => {
  draggedAt = Date.now();
};

/** True just after a drag ends, when the browser also sends the drop as a click */
export const justDragged = () => Date.now() - draggedAt < 250;

/** Props that make an element draggable within SortableSplits */
export function useSortableSplit(id: string) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id });
  return {
    'ref': setNodeRef,
    ...listeners,
    'style': {
      transform: CSS.Translate.toString(transform),
      transition,
      position: 'relative' as const,
      zIndex: isDragging ? 2 : undefined,
    },
    'data-dragging': isDragging || undefined,
  };
}
