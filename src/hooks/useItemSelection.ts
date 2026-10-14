import { PointerEvent, MouseEvent, useCallback, useEffect, useRef, useState } from 'react';

// Picking several items at once (see components/split/ItemSelection.tsx)

/** What item rows need to take part in selecting */
export interface RowSelection {
  selected: Set<string>;
  /** Taps toggle items rather than opening them */
  active: boolean;
  /** range: also everything between the last one picked and this one (shift-click) */
  toggle: (id: string, range?: boolean) => void;
}

export function useItemSelection(order: string[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const orderKey = order.join();

  // Items removed (here or by someone else) drop out of the selection
  useEffect(() => {
    setSelected((was) => {
      const present = new Set(order);
      const kept = [...was].filter((id) => present.has(id));
      return kept.length === was.size ? was : new Set(kept);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKey]);

  const toggle = useCallback(
    (id: string, range = false) => {
      setSelected((was) => {
        const next = new Set(was);
        const from = anchor.current == null ? -1 : order.indexOf(anchor.current);
        const to = order.indexOf(id);
        if (range && from >= 0 && to >= 0) {
          const [a, b] = from < to ? [from, to] : [to, from];
          for (const between of order.slice(a, b + 1)) next.add(between);
        } else if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      anchor.current = id;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderKey],
  );

  const clear = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);
  const selectAll = useCallback(() => setSelected(new Set(order)), [orderKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const row: RowSelection = { selected, active: selected.size > 0, toggle };
  return { row, selected, count: selected.size, clear, selectAll };
}

const LONG_PRESS_MS = 450;
const MOVE_SLOP_PX = 10;

/**
 * A long press with a finger (not a mouse): calls onLongPress, and the click that
 * follows the release is swallowed so it doesn't also open the item
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    clearTimeout(timer.current);
    start.current = null;
  };

  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(10);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // Phones show a menu on a long press otherwise
    onContextMenu: (e: MouseEvent) => {
      if (start.current != null || fired.current) e.preventDefault();
    },
    /** True (once) when the click comes from the release of a long press */
    consumeClick: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
}
