import { useEffect, useRef } from 'react';
import { useIsMobile } from './useBreakpoints';

// On phones, Back (the Android gesture, the iOS edge swipe) closes whatever is open on
// top before it leaves the page: each sheet, menu or dialog adds a history entry when it
// opens and closes when that entry is left. Closing one any other way takes its entry
// back off, so Back never steps through layers that are already gone.

interface Layer {
  id: number;
  /** Back was pressed with this layer on top. False keeps it open. */
  onBack: () => boolean | void;
}

const LAYER_KEY = 'sfLayer';
const layers: Layer[] = [];
let nextId = 1;
// Set while this code itself goes back, so that popstate isn't taken as the user's
let selfBack = 0;

const layerOf = (state: unknown) =>
  typeof state === 'object' && state != null ? (state as Record<string, unknown>)[LAYER_KEY] : null;

function onPopState() {
  if (selfBack > 0) {
    selfBack--;
    return;
  }
  const top = layers.at(-1);
  // The entry now showing is the top layer's own: Back wasn't about it
  if (top == null || layerOf(window.history.state) === top.id) return;
  if (top.onBack() === false) {
    // Kept open (say, to ask about unsaved changes): it needs its entry back
    window.history.pushState({ [LAYER_KEY]: top.id }, '');
    return;
  }
  layers.pop();
}

if (typeof window !== 'undefined') window.addEventListener('popstate', onPopState);

/**
 * Lets Back close this layer while `opened` (phones only). `onBack` closes it, or
 * returns false to keep it open.
 */
export function useBackDismiss(opened: boolean, onBack: () => boolean | void) {
  const isMobile = useIsMobile();
  const latest = useRef(onBack);
  latest.current = onBack;

  useEffect(() => {
    if (!opened || !isMobile) return;
    const layer: Layer = { id: nextId++, onBack: () => latest.current() };
    layers.push(layer);
    window.history.pushState({ [LAYER_KEY]: layer.id }, '');
    return () => {
      const at = layers.indexOf(layer);
      // Already taken off by Back
      if (at === -1) return;
      layers.splice(at, 1);
      // Closed some other way: its entry comes off too, unless the page moved on since
      if (layerOf(window.history.state) === layer.id) {
        selfBack++;
        window.history.back();
      }
    };
  }, [opened, isMobile]);
}

/** Whether a layer is open over the page; the page's own Back handling waits for it */
export const hasOpenLayer = () => layers.length > 0;
