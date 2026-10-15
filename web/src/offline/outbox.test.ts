import { describe, expect, test } from 'vitest';
import { ApiError } from '../api';
import { Queued, isRetryable, saveFailure, stillToSend, withOutbox } from './outbox';

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
    [new TypeError('Failed to fetch'), 'retry'],
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
    expect(saveFailure(err)).toBe(kind);
  });

  test('the service worker and pending creates retry the same answers from the server', () => {
    expect([401, 429, 500, 503].every((s) => isRetryable(new ApiError(s, '')))).toBe(true);
    expect([400, 403, 404, 409].some((s) => isRetryable(new ApiError(s, '')))).toBe(false);
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
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
