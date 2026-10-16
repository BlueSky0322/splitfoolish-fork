// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest';
import { MAX_CHANGES, MAX_CHANGES_BYTES } from '@shared/api';
import { type Change, MAX_NOTES_LENGTH } from '@shared/types';
import { ApiError, api } from '../api';
import { useSaveQueue } from '../split/useSaveQueue';
import { backgroundSync, ok } from '../testing/sw';
import { assumeLastUser, setCacheUser } from './cache';
import { OUTBOX_PREFIX, type Queued, readOutbox, withOutbox, writeOutbox } from './outbox';
import { flushOfflineChanges, forgetOfflineWork, syncWhenOnline } from './sync';

// Saving a long queue of changes kept on the device: the server takes at most
// MAX_CHANGES in one request, so the queue goes in order, a request at a time, and each
// request's changes are crossed off only once saved. Whatever sends them (the open
// split, the page catching up, or the service worker) leaves the rest for next time.

vi.mock('../my-splits/my-splits', () => ({ reloadMySplits: () => Promise.resolve() }));

const change = (n: number): Change => ({ op: 'removeItem', id: `i${n}` });
const queued = (count: number, from = 1): Queued[] =>
  Array.from({ length: count }, (_, i) => ({ cid: `c${from + i}`, change: change(from + i) }));

/** Stands in for the server: answers each request in turn, recording what was sent */
function server(answers: ('ok' | ApiError)[] = ['ok']) {
  const sent: Change[][] = [];
  const spy = vi.spyOn(api, 'applyChanges').mockImplementation((_id, changes) => {
    const answer = answers[Math.min(sent.length, answers.length - 1)];
    sent.push(changes);
    if (changes.length > MAX_CHANGES) {
      return Promise.reject(new ApiError(400, `Send 1-${MAX_CHANGES} changes`));
    }
    if (bytes(changes) > MAX_CHANGES_BYTES) {
      return Promise.reject(new ApiError(413, 'Too large'));
    }
    return answer === 'ok' ? Promise.resolve({ ok: true }) : Promise.reject(answer);
  });
  return { sent, spy };
}

const bytes = (changes: Change[]) => new Blob([JSON.stringify({ changes })]).size;

// Long names in a script that takes three bytes a letter: a few kilobytes each
const bulky = (count: number): Queued[] =>
  Array.from({ length: count }, (_, i) => ({
    cid: `b${i}`,
    change: { op: 'renamePerson', id: `p${i}`, name: '漢'.repeat(MAX_NOTES_LENGTH) },
  }));

const busy = new ApiError(503, 'Busy');
const signedOut = new ApiError(401, 'Signed out');

/** The page on screen, or in the background (another app in front, say) */
function showPage(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

/** A split open on screen, saving through its queue */
function openSplit() {
  const events = {
    setStatus: vi.fn(),
    reload: vi.fn(() => Promise.resolve()),
    loadFailed: vi.fn(),
  };
  const { result, unmount } = renderHook(() => useSaveQueue('trip', events));
  return { saves: () => result.current.saves, events, unmount };
}

beforeEach(async () => {
  await setCacheUser('ryan@example.com');
});

afterEach(async () => {
  showPage('visible');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await forgetOfflineWork();
});

describe('the page catching up on changes kept for splits not open', () => {
  test(`sends ${MAX_CHANGES} in one request, and more in several, in order`, async () => {
    const { sent } = server();
    await writeOutbox('trip', queued(MAX_CHANGES + 1));
    await flushOfflineChanges();
    expect(sent.map((b) => b.length)).toEqual([MAX_CHANGES, 1]);
    expect(sent.flat()).toEqual(queued(MAX_CHANGES + 1).map((q) => q.change));
    expect(await readOutbox('trip')).toEqual([]);
  });

  test('keeps only what was not sent when a later request fails, for next time', async () => {
    const all = queued(2 * MAX_CHANGES + 1);
    const first = server(['ok', busy]);
    await writeOutbox('trip', all);
    await flushOfflineChanges();
    expect(first.sent.map((b) => b.length)).toEqual([MAX_CHANGES, MAX_CHANGES]);
    // Kept as if the app had been closed and opened again
    expect(await readOutbox('trip')).toEqual(all.slice(MAX_CHANGES));

    vi.restoreAllMocks();
    const second = server();
    await flushOfflineChanges();
    expect(second.sent.flat()).toEqual(all.slice(MAX_CHANGES).map((q) => q.change));
    expect(await readOutbox('trip')).toEqual([]);
  });
});

describe('saving changes too big to go in one request', () => {
  test('the page catching up sends them all, in requests the server takes', async () => {
    const { sent } = server();
    await writeOutbox('trip', bulky(30));
    await flushOfflineChanges();
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.flat()).toEqual(bulky(30).map((q) => q.change));
    expect(await readOutbox('trip')).toEqual([]);
  });

  test('an open split sends them all, in requests the server takes', async () => {
    const { sent } = server();
    const split = openSplit();
    act(() => bulky(30).forEach((q) => split.saves().queue(q.change)));
    await act(() => split.saves().whenSaved());
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.flat()).toEqual(bulky(30).map((q) => q.change));
    expect(await readOutbox('trip')).toEqual([]);
    split.unmount();
  });
});

describe('saving while the app is in the background or closing', () => {
  /** The browser: a keepalive request bigger than it allows fails before it goes */
  function browser() {
    const sent: { keepalive: boolean; changes: Change[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_path: string, init: RequestInit) => {
        const body = init.body as string;
        if (init.keepalive && new Blob([body]).size > 64 * 1024) {
          return Promise.reject(new TypeError('Failed to fetch'));
        }
        sent.push({
          keepalive: init.keepalive === true,
          changes: (JSON.parse(body) as { changes: Change[] }).changes,
        });
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );
    return sent;
  }

  test('a hidden page sends long changes so they finish after it goes, small enough to be let through', async () => {
    const sent = browser();
    showPage('hidden');
    const split = openSplit();
    act(() => bulky(30).forEach((q) => split.saves().queue(q.change)));
    await act(() => split.saves().whenSaved());
    expect(sent.every((r) => r.keepalive)).toBe(true);
    expect(sent.flatMap((r) => r.changes)).toEqual(bulky(30).map((q) => q.change));
    expect(await readOutbox('trip')).toEqual([]);
    split.unmount();
  });

  test('a page on screen sends them as ordinary requests', async () => {
    const sent = browser();
    const split = openSplit();
    act(() => queued(2).forEach((q) => split.saves().queue(q.change)));
    await act(() => split.saves().whenSaved());
    expect(sent.map((r) => r.keepalive)).toEqual([false]);
    split.unmount();
  });
});

describe('the page coming back to the foreground', () => {
  test('sends what was kept for splits not open, and refreshes what is shown', async () => {
    const { sent } = server();
    const refresh = vi.fn();
    onTestFinished(syncWhenOnline(refresh));
    showPage('hidden');
    await writeOutbox('trip', queued(2));

    showPage('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent).toEqual([[change(1), change(2)]]);
    expect(await readOutbox('trip')).toEqual([]);
  });

  test('sends them when the browser brings the page back from its memory', async () => {
    const { sent } = server();
    onTestFinished(syncWhenOnline(() => {}));
    await writeOutbox('trip', queued(1));
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    await vi.waitFor(() => expect(sent).toEqual([[change(1)]]));
  });

  test('sends nothing while it stays in the background', async () => {
    const { sent } = server();
    onTestFinished(syncWhenOnline(() => {}));
    await writeOutbox('trip', queued(1));
    showPage('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await flushOfflineChanges().then(
      () => undefined,
      () => undefined,
    );
    // Only the call above sent it, not the page going to the background
    expect(sent).toEqual([[change(1)]]);
  });
});

describe('an open split saving its changes', () => {
  test('sends a long queue in requests the server takes, each change once', async () => {
    const { sent } = server();
    const split = openSplit();
    act(() => queued(MAX_CHANGES + 1).forEach((q) => split.saves().queue(q.change)));
    await act(() => split.saves().whenSaved());
    expect(sent.map((b) => b.length)).toEqual([MAX_CHANGES, 1]);
    expect(sent.flat()).toEqual(queued(MAX_CHANGES + 1).map((q) => q.change));
    expect(await readOutbox('trip')).toEqual([]);
    split.unmount();
  });

  test('signed out, it stops trying on a timer, and sends once back in the app', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    onTestFinished(() => void vi.useRealTimers());
    const { sent } = server([signedOut, 'ok']);
    const split = openSplit();
    act(() => split.saves().queue(change(1)));
    await act(() => split.saves().save());
    expect(sent).toHaveLength(1);

    // Ten minutes on, nothing more was tried: each try would only fail until they sign in
    for (let minute = 0; minute < 10; minute++) {
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      // Time for a try begun then to reach the server, through the device's storage
      for (let tick = 0; tick < 20; tick++) await new Promise((r) => setImmediate(r));
    }
    expect(sent).toHaveLength(1);
    expect(await readOutbox('trip')).toHaveLength(1);

    // Signed in again, and back to the app
    act(() => void split.saves().resume());
    await act(() => split.saves().whenSaved());
    expect(sent).toEqual([[change(1)], [change(1)]]);
    expect(await readOutbox('trip')).toEqual([]);
    split.unmount();
  });

  test('a failure after an earlier request keeps the rest, in order, across a reload', async () => {
    const first = server(['ok', busy]);
    const split = openSplit();
    act(() => queued(MAX_CHANGES + 1).forEach((q) => split.saves().queue(q.change)));
    await act(() => split.saves().save());
    expect(first.sent.map((b) => b.length)).toEqual([MAX_CHANGES, 1]);
    // The first request's changes are crossed off; the last is still on the device
    expect((await readOutbox('trip')).map((q) => q.change)).toEqual([change(MAX_CHANGES + 1)]);
    split.unmount();

    // Opened again (say, after the app was closed): only the unsent change goes
    vi.restoreAllMocks();
    const second = server();
    const reopened = openSplit();
    await act(() => reopened.saves().pickUpOutbox());
    await act(() => reopened.saves().whenSaved());
    expect(second.sent).toEqual([[change(MAX_CHANGES + 1)]]);
    expect(await readOutbox('trip')).toEqual([]);
    reopened.unmount();
  });
});

describe('handing changes between the page and the service worker', () => {
  test('changes made offline and sent by the service worker are not sent again by the page', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const { sent } = server();
    const split = openSplit();
    act(() => queued(MAX_CHANGES + 1).forEach((q) => split.saves().queue(q.change)));
    // Kept on the device as they're made; the page's last write lands before the
    // service worker takes the lock (Web Locks order them in a browser)
    await withOutbox('trip', () => Promise.resolve());
    expect(await readOutbox('trip')).toHaveLength(MAX_CHANGES + 1);

    // The service worker sends them all, while the page is in the background
    const sw = await backgroundSync(ok);
    expect(sw.batches.map((b) => b.length)).toEqual([MAX_CHANGES, 1]);
    expect(await get(`${OUTBOX_PREFIX}trip`)).toBeUndefined();

    // Back online, the page sees they're gone and sends nothing
    vi.unstubAllGlobals();
    await act(() => split.saves().save());
    expect(sent).toEqual([]);
    split.unmount();
  });

  test('someone else signing in after offline work keeps it theirs, and the service worker sends theirs', async () => {
    // Alice was offline: the app carried on as her
    await setCacheUser('alice@example.com');
    expect(assumeLastUser()).toBe('alice@example.com');
    await writeOutbox('alices', queued(1));

    // Online, Bob signs in on the same device and makes a change
    await setCacheUser('bob@example.com');
    await writeOutbox('bobs', queued(1, 50));
    expect(await get(`${OUTBOX_PREFIX}bobs`)).toMatchObject({ email: 'bob@example.com' });
    expect(await get(`${OUTBOX_PREFIX}alices`)).toBeUndefined();

    const sw = await backgroundSync(ok);
    expect(sw.fetch.mock.calls.map(([path]) => path)).toEqual(['/api/splits/bobs/changes']);
  });
});
