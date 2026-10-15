import { del, keys } from 'idb-keyval';
import { readCache, writeCache } from '../split-cache';
import type { Change } from '../../../shared/types';
import type { SplitSummary } from '../../../shared/api';

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

const outboxKey = (splitId: string) => `outbox:${splitId}`;
const createKey = (splitId: string) => `create:${splitId}`;
export const SYNC_TAG = 'sf-outbox';

// Without Web Locks, calls in this page still take turns
const chains = new Map<string, Promise<unknown>>();

/** Runs fn holding a split's outbox lock; the service worker takes the same one */
export function withOutbox<T>(splitId: string, fn: () => Promise<T>): Promise<T> {
  const name = `sf-outbox:${splitId}`;
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks) return locks.request(name, fn);
  const run = (chains.get(name) ?? Promise.resolve()).then(fn, fn);
  chains.set(
    name,
    run.catch(() => undefined),
  );
  return run;
}

export const readOutbox = async (splitId: string) =>
  (await readCache<Queued[]>(outboxKey(splitId))) ?? [];

export const writeOutbox = (splitId: string, queued: Queued[]) =>
  queued.length > 0
    ? writeCache(outboxKey(splitId), queued)
    : del(outboxKey(splitId)).catch(() => undefined);

export const savePendingCreate = (create: PendingCreate) =>
  writeCache(createKey(create.id), create);

export const removePendingCreate = (id: string) => del(createKey(id)).catch(() => undefined);

/** Splits with changes kept on this device */
export async function readOutboxIds(): Promise<string[]> {
  try {
    return (await keys())
      .filter((k): k is string => typeof k === 'string' && k.startsWith('outbox:'))
      .map((k) => k.slice('outbox:'.length));
  } catch {
    return [];
  }
}

/** Splits created on this device that the server hasn't confirmed yet */
export async function readPendingCreates(): Promise<PendingCreate[]> {
  try {
    const all = (await keys()).filter(
      (k): k is string => typeof k === 'string' && k.startsWith('create:'),
    );
    const found = await Promise.all(all.map((k) => readCache<PendingCreate>(k)));
    return found.filter((c): c is PendingCreate => c != null);
  } catch {
    return [];
  }
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

/** A fetch that failed to reach the server at all, rather than an answer from it */
export const isNetworkError = (err: unknown) => err instanceof TypeError || isOffline();
