import { ApiError, api } from './api';
import {
  PendingCreate,
  isNetworkError,
  isOffline,
  readOutbox,
  readOutboxIds,
  readPendingCreates,
  removePendingCreate,
  requestBackgroundSync,
  savePendingCreate,
  withOutbox,
  writeOutbox,
} from './offline/outbox';

// Splits that are open on screen but still being created on the server. Each is kept
// on the device until the server has it, so one made offline is created once the
// connection is back. Loading or saving one waits for its creation first. Also sends
// changes kept for splits that aren't open, as the service worker does when it can.

const creating = new Map<string, Promise<void>>();
const MAX_RETRY_MS = 60_000;

const onceOnline = () =>
  new Promise<void>((resolve) =>
    window.addEventListener('online', () => resolve(), { once: true }),
  );

const wait = (ms: number) =>
  // Whichever comes first: the delay, or the connection coming back
  Promise.race([new Promise<void>((r) => setTimeout(r, ms)), onceOnline()]);

/** No connection, busy, or no exchange rate yet: nothing wrong with what was sent */
const tryLater = (err: unknown) =>
  isNetworkError(err) || (err instanceof ApiError && (err.status === 503 || err.status === 429));

/** Sends one create; true once the server has it, false to try again later */
const send = (create: PendingCreate) =>
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
    if (!tryLater(err)) {
      await removePendingCreate(create.id);
      throw err;
    }
    return false;
  });

async function run(create: PendingCreate) {
  for (let attempt = 0; ; attempt++) {
    if (isOffline()) {
      requestBackgroundSync();
      await onceOnline();
    }
    if (await send(create)) return;
    requestBackgroundSync();
    await wait(Math.min(MAX_RETRY_MS, 3000 * 2 ** attempt));
  }
}

function track(create: PendingCreate) {
  const existing = creating.get(create.id);
  if (existing) return existing;
  const done = run(create).finally(() => creating.delete(create.id));
  creating.set(create.id, done);
  return done;
}

/** Creates a split on the server, keeping it on the device until that's done */
export async function startCreate(create: PendingCreate) {
  await savePendingCreate(create);
  return track(create);
}

/** Carries on creating splits made on this device before it was last closed */
export async function resumeCreates() {
  for (const create of await readPendingCreates()) void track(create).catch(() => undefined);
}

let sending: Promise<number> | null = null;

/**
 * Creates splits and sends changes made on this device while offline (or before it
 * was closed), for every split. Resolves with how many splits had changes sent.
 */
export function sendKept(): Promise<number> {
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
          if (tryLater(err)) return true;
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

/** Splits still being created, to show in My splits until the server lists them */
export const pendingCreates = readPendingCreates;

/** Resolves once the split exists; rejects if creating it failed */
export const whenCreated = async (id: string) => {
  await creating.get(id);
};
