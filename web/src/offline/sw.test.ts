import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MAX_CHANGES } from '@shared/api';
import type { Change } from '@shared/types';
import { SW_USER_KEY } from './cache';
import { api } from '../api';
import { OUTBOX_PREFIX, classifySaveFailure, type Queued } from './outbox';
import {
  type Answer,
  backgroundSync,
  fakeCaches,
  fetchThroughWorker,
  ok,
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
