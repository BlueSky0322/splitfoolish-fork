import { listCacheIds, readCache, removeCacheEntry, writeCache } from './cache';
import type { Change } from '../../../shared/types';
import type { SplitSummary } from '../../../shared/api';
import { ApiError, NetworkError } from '../api';

// Changes not yet saved, kept on the device (IndexedDB) so they survive the app being
// closed, killed or offline. The app sends them when it can; if it's closed, the
// service worker's background sync (sw.js) sends them when the connection is back.
// Both take the same lock per split, so a change is never sent twice.

/** A change waiting to be sent; cid tells the app which ones the service worker sent */
export interface Queued {
  cid: string;
  change: Change;
}

/** A split created on this device that the server hasn't got yet */
export interface PendingCreate {
  id: string;
  name: string;
  currency: string;
  /** Shown in My splits until the server lists it */
  summary: SplitSummary;
}

// The keys and lock below are also used by public/sw.js, which can't import them: a
// change here needs the same change there (outbox.test.ts checks they match)
export const OUTBOX_PREFIX = 'outbox:';
export const CREATE_PREFIX = 'create:';
export const LOCK_PREFIX = 'sf-outbox:';
const outboxKey = (splitId: string) => `${OUTBOX_PREFIX}${splitId}`;
const createKey = (splitId: string) => `${CREATE_PREFIX}${splitId}`;
export const SYNC_TAG = 'sf-outbox';

// Without Web Locks, calls in this page still take turns
const chains = new Map<string, Promise<unknown>>();

/** Runs fn holding a split's outbox lock; the service worker takes the same one */
export function withOutbox<T>(splitId: string, fn: () => Promise<T>): Promise<T> {
  const name = `${LOCK_PREFIX}${splitId}`;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks) return locks.request(name, fn);
  const run = (chains.get(name) ?? Promise.resolve()).then(fn, fn);
  // The next in line runs whether this one succeeded or not; its caller hears the failure
  chains.set(
    name,
    run.catch(() => undefined),
  );
  return run;
}

export const readOutbox = async (splitId: string) =>
  (await readCache<Queued[]>(outboxKey(splitId))) ?? [];

export const writeOutbox = (splitId: string, queued: Queued[]) =>
  queued.length > 0 ? writeCache(outboxKey(splitId), queued) : removeCacheEntry(outboxKey(splitId));

export const savePendingCreate = (create: PendingCreate) =>
  writeCache(createKey(create.id), create);

export const removePendingCreate = (id: string) => removeCacheEntry(createKey(id));

/** Splits with changes kept on this device */
export const readOutboxIds = () => listCacheIds(OUTBOX_PREFIX);

/** Splits created on this device that the server hasn't confirmed yet */
export async function readPendingCreates(): Promise<PendingCreate[]> {
  const ids = await listCacheIds(CREATE_PREFIX);
  const found = await Promise.all(ids.map((id) => readCache<PendingCreate>(createKey(id))));
  return found.filter((c): c is PendingCreate => c != null);
}

/** Asks the service worker to send what's waiting once there's a connection */
export function requestBackgroundSync() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) =>
      (
        reg as ServiceWorkerRegistration & { sync?: { register: (t: string) => Promise<void> } }
      ).sync?.register(SYNC_TAG),
    )
    .catch(() => {
      // Not supported (Safari, Firefox): the app sends them next time it's open
    });
}

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * A failure for want of a connection: the request never reached the server, or the
 * browser says it's offline (when any failure is put down to that)
 */
export const isOfflineFailure = (err: unknown) => err instanceof NetworkError || isOffline();

/**
 * What's still to send, given what this page queued, which of those it had written to
 * the outbox, and what the outbox holds now: a change written there that's since gone
 * was sent by someone else (the service worker, or another tab). Changes queued since
 * the last write are kept either way.
 */
export function stillToSend(pending: Queued[], written: Set<string>, inOutbox: Set<string>) {
  const left = pending.filter((q) => !written.has(q.cid) || inOutbox.has(q.cid));
  return { left, sentElsewhere: left.length < pending.length };
}

/** What a failed save means: the split is gone, the server refused it, or try again */
export function classifySaveFailure(err: unknown): 'gone' | 'refused' | 'retry' {
  if (err instanceof ApiError && err.status === 404) return 'gone';
  if (err instanceof ApiError && !isRetryable(err)) return 'refused';
  return 'retry';
}

/**
 * Whether a failed send is worth trying again: no connection, busy (429), something
 * wrong on the server's side (5xx, including no exchange rate yet), or signed out (401).
 * Anything else is the server refusing the change itself. public/sw.js follows the
 * same rule.
 */
export const isRetryable = (err: unknown) =>
  isOfflineFailure(err) ||
  (err instanceof ApiError && (err.status === 401 || err.status === 429 || err.status >= 500));
