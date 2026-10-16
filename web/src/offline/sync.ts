import { clearCache } from './cache';
import {
  readOutbox,
  readOutboxIds,
  sendQueued,
  withOutbox,
  writeOutbox,
  isOffline,
  isRetryable,
} from './outbox';
import { forgetOfflineCreates, resumeCreates, whenCreated } from './pending-creates';

// Sending what was kept on this device while offline (splits made, changes to them):
// once the signed-in account is known, and whenever the connection comes back. Then
// `refresh` runs, for what's shown to catch up. A split open on screen sends its own
// (useSaveQueue); this is for the rest, as the service worker does when it can.

let sending: Promise<number> | null = null;

/**
 * Creates splits and sends changes made on this device while offline (or before it
 * was closed), for every split. Resolves with how many splits had changes sent.
 */
export function flushOfflineChanges(): Promise<number> {
  if (isOffline()) return Promise.resolve(0);
  sending ??= (async () => {
    await resumeCreates();
    let sent = 0;
    for (const id of await readOutboxIds()) {
      try {
        await whenCreated(id);
      } catch {
        continue;
      }
      // Under the lock, so an open split (or the service worker) never sends them too
      const stop = await withOutbox(id, async () => {
        let left = await readOutbox(id);
        if (left.length === 0) return false;
        try {
          // Each request's changes are crossed off as it's saved, so a failure on a
          // later one keeps only what's still to send
          await sendQueued(id, left, async (saved) => {
            left = left.slice(saved.length);
            await writeOutbox(id, left);
          });
          sent++;
        } catch (err) {
          if (isRetryable(err)) return true;
          // Refused, or the split is gone: it shows as the server has it
          console.error(err);
        }
        await writeOutbox(id, []);
        return false;
      });
      if (stop) break;
    }
    return sent;
  })().finally(() => (sending = null));
  return sending;
}

/** Lets go of everything kept for this account: on signing out, and between tests */
export async function forgetOfflineWork() {
  sending = null;
  forgetOfflineCreates();
  await clearCache();
}

/**
 * Sends what's kept, as once signed in; refreshes when something went, or always when
 * asked
 */
export const syncOfflineChanges = (refresh: () => void, { always = false } = {}) =>
  void flushOfflineChanges()
    .then((sent) => {
      if (always || sent > 0) refresh();
    })
    // What couldn't be sent stays kept, for next time
    .catch((err: unknown) => console.error(err));

/**
 * Called once at start: back online, sends what was kept meanwhile, and refreshes either
 * way, since others' changes may have been missed while offline
 */
export function syncWhenOnline(refresh: () => void) {
  window.addEventListener('online', () => syncOfflineChanges(refresh, { always: true }));
}
