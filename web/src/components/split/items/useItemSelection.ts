import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackDismiss } from '../../../hooks/useBackDismiss';

// Picking several items at once (see ItemSelection.tsx)

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
  // The order as shown now, read when picking; a new array each render, so the callbacks
  // below stay the same and the effect runs only when the order really changes
  const latestOrder = useRef(order);
  latestOrder.current = order;
  const orderKey = order.join();

  // Items removed (here or by someone else) drop out of the selection
  useEffect(() => {
    setSelected((was) => {
      const present = new Set(latestOrder.current);
      const kept = [...was].filter((id) => present.has(id));
      return kept.length === was.size ? was : new Set(kept);
    });
  }, [orderKey]);

  const toggle = useCallback((id: string, range = false) => {
    const order = latestOrder.current;
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
  }, []);

  /** Stops picking, letting go of everything picked */
  const clear = useCallback(() => {
    setSelected(new Set());
    setOn(false);
    anchor.current = null;
  }, []);
  /** Starts picking with nothing picked yet (computers) */
  const start = useCallback(() => setOn(true), []);
  const selectAll = useCallback(() => setSelected(new Set(latestOrder.current)), []);

  // Phones pick from a long press, so picking ends when nothing's left picked
  const active = on || selected.size > 0;
  const row: RowSelection = { selected, active, toggle };
  return { row, selected, active, count: selected.size, clear, start, selectAll };
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

  // A layer like a sheet's, so Back closes a sheet opened over the selection first. On
  // tablets too, where sheets aren't layers but the selection still ends with Back.
  useBackDismiss(!isDesktop && selecting, clear, { tablets: true });

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
