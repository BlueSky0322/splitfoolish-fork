import { useSyncExternalStore } from 'react';

// Whether the phone's bottom tabs show: hidden while something else takes the bottom
// of the screen, such as the bar for items being picked

let hidden = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Hides the tabs while `hide` is true; each true is undone by a false */
export function setTabsHidden(hide: boolean) {
  hidden += hide ? 1 : -1;
  for (const listener of listeners) listener();
}

export const useTabsHidden = () => useSyncExternalStore(subscribe, () => hidden > 0);
