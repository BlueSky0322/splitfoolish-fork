import { useSyncExternalStore } from 'react';
import { installState, promptInstall, subscribeInstall } from '../install';

/** Whether and how this browser can install the app (see install.ts) */
export function useInstall() {
  const state = useSyncExternalStore(subscribeInstall, installState);
  return {
    ...state,
    /** Something to offer: the browser's prompt, or the Share menu steps on iOS */
    available: !state.installed && (state.canPrompt || state.ios),
    prompt: promptInstall,
  };
}
