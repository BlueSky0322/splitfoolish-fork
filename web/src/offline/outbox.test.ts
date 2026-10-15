import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ApiError, NetworkError } from '../api';
import { SW_USER_KEY } from './cache';
import {
  CREATE_PREFIX,
  LOCK_PREFIX,
  OUTBOX_PREFIX,
  Queued,
  SYNC_TAG,
  classifySaveFailure,
  isRetryable,
  stillToSend,
  withOutbox,
} from './outbox';

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
    const first = withOutbox('s1', step('first', 30, true));
    const second = withOutbox('s1', step('second', 1));
    const other = withOutbox('s2', step('other split', 1));
    await expect(first).rejects.toThrow('first');
    await Promise.all([second, other]);
    // The other split didn't wait; the same split's second call did
    expect(order).toEqual(['other split', 'first', 'second']);
  });
});

// The service worker sends the outbox while the app is closed. It can't import these,
// so it keeps its own copies, which have to match.
describe('the service worker', () => {
  const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

  test('uses the same keys, lock and sync tag as the app', () => {
    const twins = {
      SYNC_TAG,
      OUTBOX_PREFIX,
      CREATE_PREFIX,
      LOCK_PREFIX,
      USER_KEY: SW_USER_KEY,
    };
    for (const [name, value] of Object.entries(twins)) {
      expect(sw).toContain(`const ${name} = '${value}';`);
    }
  });

  test('tries again on the same answers as isRetryable', () => {
    for (const status of [401, 429, 500, 503]) {
      expect(isRetryable(new ApiError(status, ''))).toBe(true);
    }
    expect(isRetryable(new ApiError(409, ''))).toBe(false);
    expect(sw).toContain('res.status === 401 || res.status === 429 || res.status >= 500');
  });
});
