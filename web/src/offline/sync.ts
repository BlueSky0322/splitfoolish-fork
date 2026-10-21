import { cacheUser, clearCache } from './cache';
import {
  readOutbox,
  readOutboxIds,
  sendQueued,
  withOutbox,
  writeOutbox,
  isOffline,
  isRetryable,
} from './outbox';
import {
  forgetOfflineCreates,
  readPendingCreates,
  resumeCreates,
  whenCreated,
} from './pending-creates';
import { splitsWithQueuedPhotos } from './photo-queue';
import { reportKept } from './storage-health';

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

/**
 * How many splits have work on this device the server hasn't got yet (changes, photos,
 * or the split itself), which signing out would lose
 */
export async function countUnsentSplits(): Promise<number> {
  const unsent = new Set((await readPendingCreates()).map((c) => c.id));
  for (const id of await readOutboxIds()) {
    if ((await readOutbox(id)).length > 0) unsent.add(id);
  }
  for (const id of await splitsWithQueuedPhotos()) unsent.add(id);
  return unsent.size;
}

/**
 * Lets go of everything kept for this account, on signing out. Other accounts' unsent
 * work, kept from before someone else signed in, stays theirs; `everyone` lets go of
 * that too (between tests).
 */
export async function forgetOfflineWork({ everyone = false } = {}) {
  sending = null;
  forgetOfflineCreates();
  const leaving = cacheUser();
  await clearCache((owner) => !everyone && leaving != null && owner !== leaving);
  reportKept(true);
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
 * way, since others' changes may have been missed while offline. Coming back to the app
 * (from another app, or reopened from the browser's memory) sends what's kept too, as
 * the service worker can't on every browser.
 */
export function syncWhenOnline(refresh: () => void) {
  const online = () => syncOfflineChanges(refresh, { always: true });
  const shown = () => {
    if (document.visibilityState === 'visible') syncOfflineChanges(refresh);
  };
  const restored = (event: PageTransitionEvent) => {
    if (event.persisted) syncOfflineChanges(refresh);
  };
  window.addEventListener('online', online);
  document.addEventListener('visibilitychange', shown);
  window.addEventListener('pageshow', restored);
  // For tests: the app listens for as long as it's open
  return () => {
    window.removeEventListener('online', online);
    document.removeEventListener('visibilitychange', shown);
    window.removeEventListener('pageshow', restored);
  };
}
