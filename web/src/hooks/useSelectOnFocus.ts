import { type FocusEvent, type MouseEvent, useRef } from 'react';

/**
 * For a field whose whole value is usually typed over (an amount): clicking, tapping or
 * tabbing into it selects everything, so typing replaces it. A further click places the
 * cursor as usual. Spread the result onto the input.
 */
export function useSelectOnFocus() {
  const justFocused = useRef(false);
  return {
    onFocus: (e: FocusEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      input.select();
      justFocused.current = true;
      // Some phones place the cursor after focusing, which would undo it
      requestAnimationFrame(() => {
        if (document.activeElement === input && justFocused.current) input.select();
      });
    },
    // The click or tap that focused it would otherwise put the cursor where it landed
    onMouseUp: (e: MouseEvent<HTMLInputElement>) => {
      if (justFocused.current) e.preventDefault();
    },
    // Every click and tap ends here, so the next one places the cursor
    onClick: (e: MouseEvent<HTMLInputElement>) => {
      if (!justFocused.current) return;
      justFocused.current = false;
      e.currentTarget.select();
    },
    onBlur: () => {
      justFocused.current = false;
    },
  };
}
