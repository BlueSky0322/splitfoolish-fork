import type { MouseEvent, PointerEvent } from 'react';
import { useEffect, useRef } from 'react';

const LONG_PRESS_MS = 450;
const MOVE_SLOP_PX = 10;

/**
 * A long press with a finger (not a mouse): calls onLongPress, and the click that
 * follows the release is swallowed so it doesn't also open what was pressed. A press
 * cut short (the finger moves or lifts, or the row goes away) does nothing.
 */
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
  };

  // A row that goes away mid-press (a tab change, leaving the split) mustn't pick later
  useEffect(() => cancel, []);

  return {
    onPointerDown: (e: PointerEvent) => {
      fired.current = false;
      // A second finger starts the press again rather than leaving the first one's
      cancel();
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = undefined;
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
