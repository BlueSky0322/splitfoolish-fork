import { listCacheIds, readCache, removeCacheEntry, writeCache } from './cache';
import { reportKept } from './storage-health';
import { type ChangesBody, MAX_CHANGES, MAX_CHANGES_BYTES } from '@shared/api';
import type { Change } from '@shared/types';
import { ApiError, NetworkError, api } from '../api';

// Changes not yet saved, kept on the device (IndexedDB) so they survive the app being
// closed, killed or offline. The app sends them when it can; if it's closed, the
// service worker's background sync (sw.js) sends them when the connection is back.
// Both take the same lock per split, so a change is never sent twice.

/**
 * A change waiting to be sent. cid tells the app which ones the service worker sent, and
 * the server which it has saved already. currency is the split's when it was made, which
 * its plain amounts are in (missing on ones kept before it was noted).
 */
export interface Queued {
  cid: string;
  change: Change;
  currency?: string;
}

// The keys and lock below are also used by public/sw.js, which can't import them: a
// change here needs the same change there (outbox.test.ts checks they match)
export const OUTBOX_PREFIX = 'outbox:';
export const LOCK_PREFIX = 'sf-outbox:';
const outboxKey = (splitId: string) => `${OUTBOX_PREFIX}${splitId}`;
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

const utf8 = new TextEncoder();
/** The request body's size around its changes, ids and currencies */
const WRAPPER_BYTES = utf8.encode('{"changes":[],"ids":[],"currencies":[]}').length;

/**
 * What's sent for these changes: each with its id, and the currency each was made in
 * when every one of them says (sw.js sends the same)
 */
export function changesBody(batch: Queued[]): ChangesBody {
  const currencies = batch.map((q) => q.currency);
  return {
    changes: batch.map((q) => q.change),
    ids: batch.map((q) => q.cid),
    ...(currencies.every((c) => c != null) && { currencies: currencies as string[] }),
  };
}

/**
 * The changes that go in the next request, in order: at most MAX_CHANGES, and no more
 * than MAX_CHANGES_BYTES of JSON, but always at least one
 */
export function nextBatch(queued: Queued[]): Queued[] {
  let bytes = WRAPPER_BYTES;
  let count = 0;
  for (const q of queued.slice(0, MAX_CHANGES)) {
    // Each change after the first also takes a comma, in each of the three lists
    bytes +=
      utf8.encode(JSON.stringify([q.change, q.cid, q.currency ?? null])).length -
      2 +
      (count > 0 ? 3 : 0);
    if (count > 0 && bytes > MAX_CHANGES_BYTES) break;
    count++;
  }
  return queued.slice(0, count);
}

/**
 * Sends queued changes in order, as many at a time as the server takes. The server
 * applies each request's changes all or none; `onSaved` hears each request's changes
 * once saved, to cross them off, so a failure later on leaves only what wasn't sent.
 */
export async function sendQueued(
  splitId: string,
  queued: Queued[],
  onSaved: (saved: Queued[]) => Promise<void> = () => Promise.resolve(),
) {
  for (let left = queued; left.length > 0; ) {
    const batch = nextBatch(left);
    await api.applyChanges(splitId, changesBody(batch));
    left = left.slice(batch.length);
    await onSaved(batch);
  }
}

/**
 * Kept from whichever build queued it, so read as unknown and kept only if it's still a
 * change; the server checks each one again anyway
 */
const isQueued = (q: unknown): q is Queued =>
  typeof q === 'object' &&
  q != null &&
  typeof (q as Queued).cid === 'string' &&
  typeof (q as Queued).change?.op === 'string';

export async function readOutbox(splitId: string): Promise<Queued[]> {
  const kept = await readCache<unknown>(outboxKey(splitId));
  return Array.isArray(kept) ? kept.filter(isQueued) : [];
}

/**
 * Keeps a split's unsent changes, resolving with whether the device did; if it can't,
 * the app says so (storage-health)
 */
export async function writeOutbox(splitId: string, queued: Queued[]): Promise<boolean> {
  if (queued.length === 0) return removeCacheEntry(outboxKey(splitId));
  const kept = await writeCache(outboxKey(splitId), queued);
  reportKept(kept);
  return kept;
}

/** Splits with changes kept on this device */
export const readOutboxIds = () => listCacheIds(OUTBOX_PREFIX);

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
  isOtherAccount(err) ||
  (err instanceof ApiError && (err.status === 401 || err.status === 429 || err.status >= 500));

/**
 * Made as another account than the one signed in now: kept for that account, and not
 * sent again until it's back (public/sw.js keeps it too)
 */
export const isOtherAccount = (err: unknown) =>
  err instanceof ApiError && err.code === 'account_mismatch';
