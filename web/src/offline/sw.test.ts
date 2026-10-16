import 'fake-indexeddb/auto';
import { clear, get, keys, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MAX_CHANGES, MAX_CHANGES_BYTES, PHOTO_ID_PARAM } from '@shared/api';
import { MAX_NOTES_LENGTH } from '@shared/types';
import type { Change } from '@shared/types';
import { SW_USER_KEY } from './cache';
import { api } from '../api';
import { OUTBOX_PREFIX, classifySaveFailure, nextBatch, type Queued } from './outbox';
import { PHOTO_PREFIX } from './photo-queue';
import {
  type Answer,
  backgroundSync,
  fakeCaches,
  fetchThroughWorker,
  ok,
  photoOnDevice,
  respond,
} from '../testing/sw';

// The service worker (public/sw.js) sends what the app kept while offline, when the
// browser says the connection is back and the app isn't open. It runs here as it would
// in the browser: against the same IndexedDB the app writes, with the server stood in for.

const change = (n: number): Change => ({ op: 'removeItem', id: `i${n}` });
const queued = (count: number, from = 1): Queued[] =>
  Array.from({ length: count }, (_, i) => ({ cid: `c${from + i}`, change: change(from + i) }));
const keep = (email: string, value: Queued[] = queued(1)) =>
  set(`${OUTBOX_PREFIX}trip`, { email, value });
const kept = async () => (await get<{ value: Queued[] }>(`${OUTBOX_PREFIX}trip`))?.value;

beforeEach(async () => {
  await clear();
  await set(SW_USER_KEY, 'ryan@example.com');
});

describe('the service worker, sending offline changes', () => {
  test('sends the signed-in account’s changes, and crosses them off', async () => {
    await keep('ryan@example.com');
    const { outcome, fetch, batches } = await backgroundSync(ok);
    expect(outcome).toBe('done');
    expect(fetch).toHaveBeenCalledWith('/api/splits/trip/changes', expect.anything());
    expect(batches).toEqual([[change(1)]]);
    expect(await kept()).toBeUndefined();
  });

  test('leaves another account’s changes alone', async () => {
    await keep('ann@example.com');
    const { fetch } = await backgroundSync(ok);
    expect(fetch).not.toHaveBeenCalled();
    expect(await kept()).toEqual(queued(1));
  });
});

describe('the service worker, sending more changes than one request takes', () => {
  test(`sends ${MAX_CHANGES} in one request`, async () => {
    await keep('ryan@example.com', queued(MAX_CHANGES));
    const { outcome, batches } = await backgroundSync(ok);
    expect(outcome).toBe('done');
    expect(batches.map((b) => b.length)).toEqual([MAX_CHANGES]);
    expect(await kept()).toBeUndefined();
  });

  test('sends a longer queue in order, in requests the server takes', async () => {
    await keep('ryan@example.com', queued(2 * MAX_CHANGES + 50));
    const { outcome, batches } = await backgroundSync(ok);
    expect(outcome).toBe('done');
    expect(batches.map((b) => b.length)).toEqual([MAX_CHANGES, MAX_CHANGES, 50]);
    expect(batches.flat()).toEqual(queued(2 * MAX_CHANGES + 50).map((q) => q.change));
    expect(await kept()).toBeUndefined();
  });

  test('keeps what was not sent when a later request fails, and sends only that next time', async () => {
    const all = queued(MAX_CHANGES + 1);
    await keep('ryan@example.com', all);
    const first = await backgroundSync([ok, { status: 503 }]);
    expect(first.outcome).toBe('try later');
    expect(first.batches.map((b) => b.length)).toEqual([MAX_CHANGES, 1]);
    // The first request's changes are crossed off; the last waits, as it was
    expect(await kept()).toEqual(all.slice(MAX_CHANGES));

    const second = await backgroundSync(ok);
    expect(second.batches).toEqual([[all[MAX_CHANGES].change]]);
    expect(await kept()).toBeUndefined();
  });

  test('drops what is left when the server refuses a request, since it was built on it', async () => {
    await keep('ryan@example.com', queued(MAX_CHANGES + 1));
    const { outcome, batches } = await backgroundSync([{ status: 409, body: '{"error":"No"}' }]);
    expect(outcome).toBe('done');
    expect(batches).toHaveLength(1);
    expect(await kept()).toBeUndefined();
  });
});

describe('the service worker, sending changes too big to go all at once', () => {
  // Long names in a script that takes three bytes a letter: a few kilobytes each
  const bulky = (count: number): Queued[] =>
    Array.from({ length: count }, (_, i) => ({
      cid: `c${i}`,
      change: { op: 'renamePerson', id: `p${i}`, name: '漢'.repeat(MAX_NOTES_LENGTH) },
    }));

  test('keeps each request under the size the server takes, and sends them all in order', async () => {
    const all = bulky(30);
    await keep('ryan@example.com', all);
    const { outcome, fetch, batches } = await backgroundSync(ok);
    expect(outcome).toBe('done');
    expect(batches.length).toBeGreaterThan(1);
    for (const [, init] of fetch.mock.calls) {
      expect(new Blob([init.body as string]).size).toBeLessThanOrEqual(MAX_CHANGES_BYTES);
    }
    expect(batches.flat()).toEqual(all.map((q) => q.change));
    expect(await kept()).toBeUndefined();
  });

  test('splits a queue where the app would', async () => {
    const all = bulky(30);
    await keep('ryan@example.com', all);
    const { batches } = await backgroundSync(ok);
    const app: number[] = [];
    for (let left = all; left.length > 0; left = left.slice(app[app.length - 1])) {
      app.push(nextBatch(left).length);
    }
    expect(batches.map((b) => b.length)).toEqual(app);
  });

  test('still sends a change bigger than that on its own', async () => {
    const huge: Queued = {
      cid: 'big',
      change: { op: 'renamePerson', id: 'p', name: 'a'.repeat(MAX_CHANGES_BYTES) },
    };
    await keep('ryan@example.com', [huge, ...queued(2)]);
    const { outcome, batches } = await backgroundSync(ok);
    expect(outcome).toBe('done');
    expect(batches).toEqual([[huge.change], [change(1), change(2)]]);
  });
});

describe('the service worker, sending photos kept on the device', () => {
  /** A photo the app kept for `email`, as photo-queue.ts keeps them */
  const keepPhoto = (email: string, id: string, createdAt: number, itemId: string | null = null) =>
    set(`${PHOTO_PREFIX}trip:${id}`, {
      email,
      value: photoOnDevice(id, 'trip', createdAt, itemId),
    });
  const keptPhotos = async () =>
    (await keys()).filter((k) => typeof k === 'string' && k.startsWith(PHOTO_PREFIX));
  const saved = { status: 201, body: '{"id":"saved"}' };
  const text = (blob: Blob) => blob.text();

  test('sends them oldest first, each with its id, after the changes, and crosses them off', async () => {
    await keep('ryan@example.com');
    await keepPhoto('ryan@example.com', '00000000000000b2', 2, 'i1');
    await keepPhoto('ryan@example.com', '00000000000000a1', 1);
    const { outcome, fetch, photos } = await backgroundSync([ok, saved]);
    expect(outcome).toBe('done');
    // The changes first, so a receipt's item is saved before it
    expect(fetch.mock.calls.map(([path]) => path.split('?')[0])).toEqual([
      '/api/splits/trip/changes',
      '/api/splits/trip/attachments',
      '/api/splits/trip/attachments',
    ]);
    expect(photos.map((p) => p.path)).toEqual([
      `/api/splits/trip/attachments?${PHOTO_ID_PARAM}=00000000000000a1`,
      `/api/splits/trip/attachments?${PHOTO_ID_PARAM}=00000000000000b2&itemId=i1`,
    ]);
    expect(await Promise.all(photos.map((p) => text(p.body)))).toEqual([
      'small 00000000000000a1.jpg',
      'small 00000000000000b2.jpg',
    ]);
    expect(photos[0].body.type).toBe('image/jpeg');
    expect(await keptPhotos()).toEqual([]);
  });

  test('leaves another account’s photos alone', async () => {
    await keepPhoto('ann@example.com', '00000000000000a1', 1);
    const { photos } = await backgroundSync(saved);
    expect(photos).toEqual([]);
    expect(await keptPhotos()).toHaveLength(1);
  });

  test.each<[string, Answer]>([
    ['no connection', { networkError: true }],
    ['signed out', { status: 401 }],
    ['busy', { status: 429 }],
    ['down', { status: 503 }],
  ])('keeps them for next time when there is %s', async (_why, answer) => {
    await keepPhoto('ryan@example.com', '00000000000000a1', 1);
    await keepPhoto('ryan@example.com', '00000000000000b2', 2);
    const { outcome, photos } = await backgroundSync(answer);
    expect(outcome).toBe('try later');
    // Stopped at the first, which waits with the rest
    expect(photos).toHaveLength(1);
    expect(await keptPhotos()).toHaveLength(2);
  });

  test.each<[string, Answer]>([
    ['its item is gone', { status: 404, body: '{"error":"That item no longer exists"}' }],
    ['the split is full', { status: 409, body: '{"error":"A split can have up to 300 photos"}' }],
  ])('drops one the server refuses because %s, and sends the next', async (_why, refusal) => {
    await keepPhoto('ryan@example.com', '00000000000000a1', 1);
    await keepPhoto('ryan@example.com', '00000000000000b2', 2);
    const { outcome, photos } = await backgroundSync([refusal, saved]);
    expect(outcome).toBe('done');
    expect(photos).toHaveLength(2);
    expect(await keptPhotos()).toEqual([]);
  });
});

// How the app and the service worker each read an answer to sending changes. They must
// agree, or one keeps a change the other drops.
const answers: [string, Answer, 'sent' | 'retry' | 'refused' | 'gone'][] = [
  ['saved', ok, 'sent'],
  ['a JSON null', { status: 200, body: 'null' }, 'retry'],
  ['broken JSON', { status: 200, body: '{"ok":' }, 'retry'],
  ['a web page from a proxy', { status: 200, body: '<html>Gateway</html>' }, 'retry'],
  ['a sign-in redirect', { status: 200, body: '<html>Sign in</html>', redirected: true }, 'retry'],
  ['no connection', { networkError: true }, 'retry'],
  ['401', { status: 401, body: '{"error":"Not signed in"}' }, 'retry'],
  ['429', { status: 429, body: '{"error":"Too many"}' }, 'retry'],
  ['500', { status: 500, body: '{"error":"Oops"}' }, 'retry'],
  ['503', { status: 503, body: '{"error":"Converting"}' }, 'retry'],
  ['400', { status: 400, body: '{"error":"Invalid change"}' }, 'refused'],
  ['403', { status: 403, body: '{"error":"Not allowed"}' }, 'refused'],
  ['409', { status: 409, body: '{"error":"Changed meanwhile"}' }, 'refused'],
  ['404', { status: 404, body: '{"error":"Not found"}' }, 'gone'],
];

describe('reading the answer to sending changes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.each(answers)('the app: %s', async (_name, answer, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => respond(answer)),
    );
    const outcome = await api.applyChanges('trip', [change(1)]).then(
      () => 'sent',
      (err: unknown) => classifySaveFailure(err),
    );
    expect(outcome).toBe(expected);
  });

  test.each(answers)('the service worker: %s', async (_name, answer, expected) => {
    await keep('ryan@example.com');
    const { outcome } = await backgroundSync(answer);
    if (expected === 'retry') {
      expect(outcome).toBe('try later');
      expect(await kept()).toEqual(queued(1));
    } else {
      // Sent, or refused (the split gone included): either way not sent again
      expect(outcome).toBe('done');
      expect(await kept()).toBeUndefined();
    }
  });
});

// The PDF export's font is fetched from the app's own address the first time a PDF is
// made, and kept so a PDF can be made offline after
describe('the service worker, keeping the PDF font', () => {
  const FONT = '/fonts/NotoSansJP-subset-v2.ttf';

  test('keeps the font once fetched, and answers from the device after', async () => {
    const caches = fakeCaches();
    const font = { status: 200, body: 'font bytes', contentType: 'font/ttf' };
    const first = await fetchThroughWorker(FONT, font, caches);
    expect(first.fetch).toHaveBeenCalledTimes(1);
    expect(await first.response?.text()).toBe('font bytes');

    const offline = await fetchThroughWorker(FONT, { networkError: true }, caches);
    expect(offline.fetch).not.toHaveBeenCalled();
    expect(await offline.response?.text()).toBe('font bytes');
  });

  test('never keeps the app’s page, sent for a font it does not have', async () => {
    const caches = fakeCaches();
    const page = { status: 200, body: '<html>Splitfoolish</html>', contentType: 'text/html' };
    await fetchThroughWorker(FONT, page, caches);

    const next = await fetchThroughWorker(FONT, { networkError: true }, caches);
    expect(next.fetch).toHaveBeenCalledTimes(1);
    expect(next.response).toBeNull();
  });

  test('never keeps a failed answer', async () => {
    const caches = fakeCaches();
    await fetchThroughWorker(FONT, { status: 503, contentType: 'font/ttf' }, caches);
    const next = await fetchThroughWorker(
      FONT,
      { status: 200, body: 'font bytes', contentType: 'font/ttf' },
      caches,
    );
    expect(next.fetch).toHaveBeenCalledTimes(1);
    expect(await next.response?.text()).toBe('font bytes');
  });
});
