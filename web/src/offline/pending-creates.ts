import { ApiError, api } from '../api';
import type { PendingCreate } from './outbox';
import {
  isOffline,
  isRetryable,
  readOutbox,
  readOutboxIds,
  readPendingCreates,
  removePendingCreate,
  requestBackgroundSync,
  savePendingCreate,
  withOutbox,
  writeOutbox,
} from './outbox';

// Splits that are open on screen but still being created on the server. Each is kept
// on the device until the server has it, so one made offline is created once the
// connection is back. Loading or saving one waits for its creation first. Also sends
// changes kept for splits that aren't open, as the service worker does when it can.

const creating = new Map<string, Promise<void>>();
/** Creates that failed for good on this page; changes to these splits aren't sent */
const failed = new Map<string, unknown>();
const MAX_RETRY_MS = 60_000;

/** Lets go of creates under way on this page: on signing out, and between tests */
export function forgetOfflineCreates() {
  creating.clear();
  failed.clear();
}

const onceOnline = () =>
  new Promise<void>((resolve) =>
    window.addEventListener('online', () => resolve(), { once: true }),
  );

/** Whichever comes first: the delay, or the connection coming back */
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('online', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    window.addEventListener('online', done);
  });

/** Sends one create; true once the server has it, false to try again later */
const sendCreateOnce = (create: PendingCreate) =>
  withOutbox(create.id, async () => {
    // The service worker may have sent it while this page was asleep
    if (!(await readPendingCreates()).some((c) => c.id === create.id)) return true;
    try {
      await api.createSplit(create.id, create.name, create.currency);
    } catch (err) {
      // Already there: an earlier try got through
      if (!(err instanceof ApiError && err.status === 409)) throw err;
    }
    await removePendingCreate(create.id);
    return true;
  }).catch(async (err: unknown) => {
    if (!isRetryable(err)) {
      await removePendingCreate(create.id);
      throw err;
    }
    return false;
  });

/** Keeps trying until the server has it, waiting longer each time and for a connection */
async function createUntilDone(create: PendingCreate) {
  for (let attempt = 0; ; attempt++) {
    if (isOffline()) {
      requestBackgroundSync();
      await onceOnline();
    }
    if (await sendCreateOnce(create)) return;
    requestBackgroundSync();
    await wait(Math.min(MAX_RETRY_MS, 3000 * 2 ** attempt));
  }
}

/** Starts creating it, unless that's already under way on this page */
function ensureCreating(create: PendingCreate) {
  const existing = creating.get(create.id);
  if (existing) return existing;
  const done = createUntilDone(create)
    .catch((err: unknown) => {
      failed.set(create.id, err);
      throw err;
    })
    .finally(() => creating.delete(create.id));
  creating.set(create.id, done);
  return done;
}

/** Creates a split on the server, keeping it on the device until that's done */
export async function startCreate(create: PendingCreate) {
  await savePendingCreate(create);
  return ensureCreating(create);
}

/** Carries on creating splits made on this device before it was last closed */
export async function resumeCreates() {
  for (const create of await readPendingCreates()) {
    // A failure is kept with the split (whenCreated rejects for it) and explained there
    void ensureCreating(create).catch(() => undefined);
  }
}

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
        const queued = await readOutbox(id);
        if (queued.length === 0) return false;
        try {
          await api.applyChanges(
            id,
            queued.map((q) => q.change),
          );
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
 * Waits for a create started on this page, if there is one, and rejects if creating
 * that split failed. Any other split is taken to exist already.
 */
export const whenCreated = async (id: string) => {
  if (failed.has(id)) throw failed.get(id);
  await creating.get(id);
};
