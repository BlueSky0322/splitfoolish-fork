import { flushOfflineChanges } from './pending-creates';

// Sending what was kept on this device while offline (splits made, changes to them):
// once the signed-in account is known, and whenever the connection comes back. Then
// `refresh` runs, for what's shown to catch up.

/** Sends what's kept; refreshes when something went, or always when asked */
const flush = (refresh: () => void, { always = false } = {}) =>
  void flushOfflineChanges()
    .then((sent) => {
      if (always || sent > 0) refresh();
    })
    // What couldn't be sent stays kept, for next time
    .catch((err: unknown) => console.error(err));

/** Once signed in: sends what was kept before the app was last closed */
export const syncAfterSignIn = (refresh: () => void) => flush(refresh);

/**
 * Called once at start: back online, sends what was kept meanwhile, and refreshes either
 * way, since others' changes may have been missed while offline
 */
export function syncWhenOnline(refresh: () => void) {
  window.addEventListener('online', () => flush(refresh, { always: true }));
}
