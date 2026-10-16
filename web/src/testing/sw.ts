// The service worker (public/sw.js) run as it would be in the browser: against the same
// IndexedDB the app writes (fake-indexeddb), with the server stood in for.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { URL as NodeURL, fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { vi } from 'vitest';
import type { Change } from '@shared/types';
import { SYNC_TAG } from '../offline/outbox';

// Node's URL, since a browser-like test environment has its own
const source = readFileSync(
  fileURLToPath(new NodeURL('../../public/sw.js', import.meta.url)),
  'utf8',
);

/** How the server (or whatever is in the way) answers one request */
export type Answer =
  | { status: number; body?: string | null; redirected?: boolean; contentType?: string }
  | { networkError: true };

export const ok: Answer = { status: 200, body: '{"ok":true}' };

export function respond(answer: Answer) {
  if ('networkError' in answer) return Promise.reject(new TypeError('Failed to fetch'));
  const headers = answer.contentType ? { 'Content-Type': answer.contentType } : undefined;
  const res = new Response(answer.body ?? null, { status: answer.status, headers });
  if (answer.redirected) Object.defineProperty(res, 'redirected', { value: true });
  return Promise.resolve(res);
}

/** Where the app is served from, in these tests */
const ORIGIN = 'https://splitfoolish.test';

type Handlers = Record<string, (event: unknown) => void>;

/** Runs the service worker's script, returning the events it listens for */
function load(fetch: unknown, caches?: unknown): Handlers {
  const handlers: Handlers = {};
  runInNewContext(source, {
    self: {
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        (handlers[type] = handler),
      navigator: {},
      location: new URL(ORIGIN),
    },
    fetch,
    caches,
    indexedDB,
    Response,
    TextEncoder,
    URL,
  });
  return handlers;
}

/**
 * Loads the service worker, fires its background sync, and answers its requests in
 * turn with `answers` (the last one repeating)
 */
export async function backgroundSync(answers: Answer | Answer[]) {
  const list = Array.isArray(answers) ? answers : [answers];
  let answered = 0;
  // Called with (path, init), which the tests read back from fetch.mock.calls
  const fetch = vi.fn<[string, RequestInit], Promise<Response>>(() =>
    respond(list[Math.min(answered++, list.length - 1)]),
  );
  const handlers = load(fetch);
  let done: Promise<unknown> = Promise.resolve();
  handlers.sync({ tag: SYNC_TAG, waitUntil: (work: Promise<unknown>) => (done = work) });
  const outcome = await done.then(
    () => 'done',
    () => 'try later',
  );
  /** The changes each request carried */
  const batches = fetch.mock.calls
    .filter(([path]) => path.endsWith('/changes'))
    .map(([, init]) => (JSON.parse(init.body as string) as { changes: Change[] }).changes);
  return { outcome, fetch, batches };
}

/** The browser's caches, kept in memory by URL, and shared by each page load in a test */
export function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const urlOf = (request: Request | string) =>
    typeof request === 'string' ? request : request.url;
  return {
    stores,
    open: (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return Promise.resolve({
        match: (request: Request | string) => Promise.resolve(store.get(urlOf(request))?.clone()),
        put: (request: Request | string, response: Response) => {
          store.set(urlOf(request), response);
          return Promise.resolve();
        },
      });
    },
  };
}

/**
 * The page asks for `path` on the app's own address through the service worker, which
 * reaches the network (answering with `answer`) or answers from `caches`. The response
 * is null when the request fails, as with no connection.
 */
export async function fetchThroughWorker(
  path: string,
  answer: Answer,
  caches: ReturnType<typeof fakeCaches>,
) {
  const fetch = vi.fn(async () => {
    const res = await respond(answer);
    // From the app's own address, as the browser marks it
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  });
  const handlers = load(fetch, caches);
  let answered: Promise<Response> | null = null;
  handlers.fetch({
    request: new Request(`${ORIGIN}${path}`),
    respondWith: (r: Promise<Response>) => (answered = r),
  });
  if (answered == null) throw new Error(`The service worker left ${path} to the browser`);
  const response = await (answered as Promise<Response>).catch(() => null);
  return { fetch, response };
}
