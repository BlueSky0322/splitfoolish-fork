import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { clear, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { SW_USER_KEY } from './cache';
import { ApiError } from '../api';
import { OUTBOX_PREFIX, SYNC_TAG, isRetryable } from './outbox';

// The service worker (public/sw.js) sends what the app kept while offline, when the
// browser says the connection is back and the app isn't open. It runs here as it would
// in the browser: against the same IndexedDB the app writes, with the server stood in for.

const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

/** Loads the service worker with `answer` as the server, and fires its background sync */
async function backgroundSync(answer: number, body?: string) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const fetch = vi.fn((_path: string, init: RequestInit) =>
    Promise.resolve(new Response(body ?? init.body ?? null, { status: answer })),
  );
  runInNewContext(source, {
    self: {
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        (handlers[type] = handler),
      navigator: {},
    },
    fetch,
    indexedDB,
    Response,
    URL,
  });
  let done: Promise<unknown> = Promise.resolve();
  handlers.sync({ tag: SYNC_TAG, waitUntil: (work: Promise<unknown>) => (done = work) });
  const outcome = await done.then(
    () => 'done',
    () => 'try later',
  );
  return { outcome, fetch };
}

const change = { op: 'removeItem', id: 'i1' };
const keep = (email: string) =>
  set(`${OUTBOX_PREFIX}trip`, { email, value: [{ cid: 'c1', change }] });

beforeEach(async () => {
  await clear();
  await set(SW_USER_KEY, 'ryan@example.com');
});

describe('the service worker, sending offline changes', () => {
  test('sends the signed-in account’s changes, and crosses them off', async () => {
    await keep('ryan@example.com');
    const { outcome, fetch } = await backgroundSync(200);
    expect(outcome).toBe('done');
    expect(fetch).toHaveBeenCalledWith('/api/splits/trip/changes', expect.anything());
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ changes: [change] });
    expect(await get(`${OUTBOX_PREFIX}trip`)).toBeUndefined();
  });

  test.each([401, 429, 500, 503])(
    'keeps them to try later on %i, as the app does',
    async (status) => {
      await keep('ryan@example.com');
      const { outcome } = await backgroundSync(status);
      expect(outcome).toBe('try later');
      expect(await get(`${OUTBOX_PREFIX}trip`)).toBeDefined();
      expect(isRetryable(new ApiError(status, ''))).toBe(true);
    },
  );

  test('keeps them when something other than the API answers, as the app does', async () => {
    await keep('ryan@example.com');
    const { outcome } = await backgroundSync(200, '<html>Gateway</html>');
    expect(outcome).toBe('try later');
    expect(await get(`${OUTBOX_PREFIX}trip`)).toBeDefined();
  });

  test('drops changes the server refuses; the app shows the split as the server has it', async () => {
    await keep('ryan@example.com');
    const { outcome } = await backgroundSync(409);
    expect(outcome).toBe('done');
    expect(isRetryable(new ApiError(409, ''))).toBe(false);
    expect(await get(`${OUTBOX_PREFIX}trip`)).toBeUndefined();
  });

  test('leaves another account’s changes alone', async () => {
    await keep('ann@example.com');
    const { fetch } = await backgroundSync(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(await get(`${OUTBOX_PREFIX}trip`)).toBeDefined();
  });
});
