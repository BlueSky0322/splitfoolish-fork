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
  // Computers: picking is switched on with a button, and stays on until Done
  const [on, setOn] = useState(false);
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

  /** Stops picking, letting go of everything picked */
  const clear = useCallback(() => {
    setSelected(new Set());
    setOn(false);
    anchor.current = null;
  }, []);
  /** Starts picking with nothing picked yet (computers) */
  const start = useCallback(() => setOn(true), []);
  const selectAll = useCallback(() => setSelected(new Set(order)), [orderKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phones pick from a long press, so picking ends when nothing's left picked
  const active = on || selected.size > 0;
  const row: RowSelection = { selected, active, toggle };
  return { row, selected, active, count: selected.size, clear, start, selectAll };
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

/**
 * Keys and buttons while picking items. Phones: the back button stops picking rather
 * than leaving the split. Computers: Esc lets go of the selection, and Delete removes
 * it (with Undo).
 */
export function useSelectionKeys(
  selecting: boolean,
  isDesktop: boolean,
  clear: () => void,
  remove: () => void,
) {
  // The latest handlers, so the listeners below needn't be set up again on every render
  const handlers = useRef({ clear, remove });
  useEffect(() => {
    handlers.current = { clear, remove };
  });

  useEffect(() => {
    if (isDesktop || !selecting) return;
    window.history.pushState({ sfSelecting: true }, '');
    const onBack = () => handlers.current.clear();
    window.addEventListener('popstate', onBack);
    return () => {
      window.removeEventListener('popstate', onBack);
      if ((window.history.state as { sfSelecting?: boolean } | null)?.sfSelecting) {
        window.history.back();
      }
    };
  }, [isDesktop, selecting]);

  useEffect(() => {
    if (!isDesktop || !selecting) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      if (e.key === 'Escape') handlers.current.clear();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handlers.current.remove();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, selecting]);
}
