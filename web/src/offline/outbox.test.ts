// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { URL as NodeURL, fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError, NetworkError } from '../api';
import { CLIENT_ID_HEADER } from '@shared/api';
import { backgroundSync, ok, respond } from '../testing/sw';
import { clearCache, listCacheIds, setCacheUser, writeCache } from './cache';
import { type PendingCreate, readPendingCreates, savePendingCreate } from './pending-creates';
import type { Queued } from './outbox';
import {
  SYNC_TAG,
  classifySaveFailure,
  isRetryable,
  readOutbox,
  stillToSend,
  withOutbox,
  writeOutbox,
} from './outbox';
import { PHOTO_LOCK_PREFIX, PHOTO_PREFIX } from './photo-queue';
import { forgetOfflineWork } from './sync';

const swSource = readFileSync(
  fileURLToPath(new NodeURL('../../public/sw.js', import.meta.url)),
  'utf8',
);

const q = (cid: string): Queued => ({ cid, change: { op: 'removeItem', id: cid } });

describe('stillToSend', () => {
  test('drops changes written to the outbox that are no longer there: sent by someone else', () => {
    const pending = [q('a'), q('b'), q('c')];
    const { left, sentElsewhere } = stillToSend(pending, new Set(['a', 'b']), new Set(['b']));
    expect(left.map((x) => x.cid)).toEqual(['b', 'c']);
    expect(sentElsewhere).toBe(true);
  });

  test('keeps changes queued since the last write, and everything still waiting', () => {
    const pending = [q('a'), q('b')];
    const { left, sentElsewhere } = stillToSend(pending, new Set(['a']), new Set(['a']));
    expect(left.map((x) => x.cid)).toEqual(['a', 'b']);
    expect(sentElsewhere).toBe(false);
  });
});

describe('what a failed send means', () => {
  test.each([
    [new NetworkError('No connection'), 'retry'],
    [new ApiError(503, 'Converting'), 'retry'],
    [new ApiError(500, 'Something went wrong'), 'retry'],
    [new ApiError(429, 'Too many changes'), 'retry'],
    [new ApiError(401, 'Not signed in'), 'retry'],
    [new ApiError(404, 'Not found'), 'gone'],
    [new ApiError(409, 'Invalid item'), 'refused'],
    [new ApiError(400, 'Send 1-50 changes'), 'refused'],
    // Anything else (storage failing, say) isn't the change's fault either
    [new Error('IndexedDB is closed'), 'retry'],
  ])('%s: %s', (err, kind) => {
    expect(classifySaveFailure(err)).toBe(kind);
  });

  test('the service worker and pending creates retry the same answers from the server', () => {
    expect([401, 429, 500, 503].every((s) => isRetryable(new ApiError(s, '')))).toBe(true);
    expect([400, 403, 404, 409].some((s) => isRetryable(new ApiError(s, '')))).toBe(false);
    expect(isRetryable(new NetworkError('No connection'))).toBe(true);
    // A mistake in the app is not a lost connection
    expect(isRetryable(new TypeError('x is undefined'))).toBe(false);
  });
});

describe('withOutbox', () => {
  test('takes turns per split without Web Locks, even after a failure', async () => {
    const order: string[] = [];
    const step =
      (name: string, ms: number, fail = false) =>
      () =>
        new Promise<void>((resolve, reject) =>
          setTimeout(() => {
            order.push(name);
            if (fail) reject(new Error(name));
            else resolve();
          }, ms),
        );
    vi.useFakeTimers();
    try {
      const first = withOutbox('s1', step('first', 30, true));
      const second = withOutbox('s1', step('second', 1));
      const other = withOutbox('s2', step('other split', 1));
      const failed = expect(first).rejects.toThrow('first');
      await vi.advanceTimersByTimeAsync(40);
      await failed;
      await Promise.all([second, other]);
    } finally {
      vi.useRealTimers();
    }
    // The other split didn't wait; the same split's second call did
    expect(order).toEqual(['other split', 'first', 'second']);
  });
});

// The service worker sends the outbox while the app is closed. It can't import the app's
// keys, lock and sync tag, so it keeps its own copies. Here it runs against what the app
// itself kept, to show the two still find each other's work.
describe('the service worker and the app', () => {
  const create: PendingCreate = {
    id: 'bali',
    name: 'Bali',
    currency: 'IDR',
    summary: {} as PendingCreate['summary'],
  };

  beforeEach(() => setCacheUser('ryan@example.com'));
  afterEach(async () => {
    vi.unstubAllGlobals();
    await forgetOfflineWork();
  });

  test('the service worker sends what the app kept, for whoever the app says is signed in', async () => {
    await savePendingCreate(create);
    await writeOutbox('bali', [q('a'), q('b')]);

    // Woken by the app's own sync tag
    const { outcome, fetch, batches } = await backgroundSync(ok);
    expect(outcome).toBe('done');
    // The new split first, then its changes, each saying it's the service worker sending
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      '/api/splits',
      '/api/splits/bali/changes',
    ]);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
      id: 'bali',
      name: 'Bali',
      currency: 'IDR',
    });
    expect(batches).toEqual([[q('a').change, q('b').change]]);
    for (const [, init] of fetch.mock.calls) {
      expect(init.headers).toMatchObject({ [CLIENT_ID_HEADER]: 'background-sync' });
    }
    // Crossed off where the app looks
    expect(await readPendingCreates()).toEqual([]);
    expect(await readOutbox('bali')).toEqual([]);
  });

  test('both take the same lock for a split', async () => {
    const taken: string[] = [];
    const locks = {
      request: (name: string, fn: () => Promise<unknown>) => {
        taken.push(name);
        return fn();
      },
    };
    await writeOutbox('bali', [q('a')]);
    runServiceWorker({ navigator: { locks } }).sync();
    await vi.waitFor(async () => expect(await readOutbox('bali')).toEqual([]));
    const swLock = taken.splice(0);
    expect(swLock).toHaveLength(1);

    vi.stubGlobal('navigator', { locks });
    await withOutbox('bali', () => Promise.resolve());
    expect(taken).toEqual(swLock);
  });

  test('both take the same lock for a photo, and read it where the app keeps it', async () => {
    const taken: string[] = [];
    const locks = {
      request: (name: string, fn: () => Promise<unknown>) => {
        taken.push(name);
        return fn();
      },
    };
    await setCacheUser('ryan@example.com');
    const id = '00000000000000a1';
    await writeCache(`${PHOTO_PREFIX}bali:${id}`, {
      id,
      splitId: 'bali',
      itemId: null,
      name: 'beach.jpg',
      createdAt: 1,
      type: 'image/jpeg',
      bytes: new ArrayBuffer(4),
    });
    runServiceWorker({ navigator: { locks } }).sync();
    await vi.waitFor(async () => expect(await listCacheIds(PHOTO_PREFIX)).toEqual([]));
    expect(taken).toEqual([`${PHOTO_LOCK_PREFIX}${id}`]);
  });

  test('the pictures the service worker keeps are the ones the app clears on signing out', async () => {
    const opened: string[] = [];
    const deleted: string[] = [];
    const caches = {
      open: (name: string) => {
        opened.push(name);
        return Promise.resolve({ match: () => Promise.resolve(undefined), put: () => {} });
      },
      delete: (name: string) => {
        deleted.push(name);
        return Promise.resolve(true);
      },
    };
    const picture = runServiceWorker({ location: { origin: 'https://app.test' } }, { caches });
    await picture.fetch('https://app.test/api/splits/bali/picture');
    expect(opened).toHaveLength(1);

    vi.stubGlobal('caches', caches);
    await clearCache();
    expect(deleted).toEqual(opened);
  });
});

/**
 * public/sw.js loaded on its own, with `self` and globals of a test's choosing, answering
 * every request with ok: for what backgroundSync doesn't stand in for
 */
function runServiceWorker(self: object, globals: object = {}) {
  const handlers: Record<string, (event: unknown) => void> = {};
  runInNewContext(swSource, {
    self: {
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        (handlers[type] = handler),
      navigator: {},
      ...self,
    },
    fetch: () => respond(ok),
    indexedDB,
    Blob,
    Response,
    TextEncoder,
    URL,
    URLSearchParams,
    ...globals,
  });
  return {
    sync: () => handlers.sync({ tag: SYNC_TAG, waitUntil: () => {} }),
    /** A page asking for `url`; resolves once the service worker has answered */
    fetch: (url: string) =>
      new Promise<unknown>((resolve) =>
        handlers.fetch({
          request: { url, method: 'GET', mode: 'no-cors' },
          respondWith: (answer: Promise<unknown>) => resolve(answer),
          waitUntil: () => {},
        }),
      ),
  };
}
