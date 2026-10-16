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
  | { status: number; body?: string | null; redirected?: boolean }
  | { networkError: true };

export const ok: Answer = { status: 200, body: '{"ok":true}' };

export function respond(answer: Answer) {
  if ('networkError' in answer) return Promise.reject(new TypeError('Failed to fetch'));
  const res = new Response(answer.body ?? null, { status: answer.status });
  if (answer.redirected) Object.defineProperty(res, 'redirected', { value: true });
  return Promise.resolve(res);
}

/**
 * Loads the service worker, fires its background sync, and answers its requests in
 * turn with `answers` (the last one repeating)
 */
export async function backgroundSync(answers: Answer | Answer[]) {
  const list = Array.isArray(answers) ? answers : [answers];
  const handlers: Record<string, (event: unknown) => void> = {};
  let answered = 0;
  // Called with (path, init), which the tests read back from fetch.mock.calls
  const fetch = vi.fn<[string, RequestInit], Promise<Response>>(() =>
    respond(list[Math.min(answered++, list.length - 1)]),
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
  /** The changes each request carried */
  const batches = fetch.mock.calls
    .filter(([path]) => path.endsWith('/changes'))
    .map(([, init]) => (JSON.parse(init.body as string) as { changes: Change[] }).changes);
  return { outcome, fetch, batches };
}
