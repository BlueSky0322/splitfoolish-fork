import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env } from '../app';
import type { ReconvertJob } from './reconvert';

// The reconvert queue's handler: conversions that failed the first time, tried again
// with backoff until they work or are given up on. The database, rates and rooms are
// stood in for; worker/test/api.test.ts runs the real thing end to end.

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
vi.mock('./reconvert', async (actual) => ({
  ...(await actual<typeof import('./reconvert')>()),
  reconvertSplit: vi.fn(),
}));
vi.mock('../accounts/profiles', () => ({
  getRatePreference: vi.fn(() => Promise.resolve('frankfurter')),
}));
vi.mock('./exchange-rates', () => ({ getRate: vi.fn() }));
vi.mock('../splits/room', () => ({ notifySplit: vi.fn() }));

const { reconvertSplit, retryDelaySeconds } = await import('./reconvert');
const { getRate } = await import('./exchange-rates');
const { notifySplit } = await import('../splits/room');
const { handleReconvertQueue, queueReconvert, retryDelay } = await import('./reconvert-queue');

const job = (splitId: string, since = 100): ReconvertJob => ({
  splitId,
  since,
  email: 'owner@example.com',
});

/** A message as the queue hands it over, recording whether it was acked or retried */
const message = (body: ReconvertJob, attempts = 1) => ({
  body,
  attempts,
  id: body.splitId,
  timestamp: new Date(),
  ack: vi.fn(),
  retry: vi.fn(),
});

const batchOf = (queue: string, messages: ReturnType<typeof message>[]) =>
  ({ queue, messages }) as unknown as MessageBatch<ReconvertJob>;

const env = { DB: {} } as Env;
const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('retrying a conversion', () => {
  test('a split it converts is done with, and its open apps are told', async () => {
    vi.mocked(reconvertSplit).mockResolvedValue(true);
    const msg = message(job('trip', 42));
    await handleReconvertQueue(batchOf('reconvert', [msg]), env, ctx);

    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
    expect(notifySplit).toHaveBeenCalledWith(env, ctx, 'trip', null);
    // For the change the job was queued for, at the rates its owner prefers
    const [, splitId, fetchRate, since] = vi.mocked(reconvertSplit).mock.calls[0];
    expect([splitId, since]).toEqual(['trip', 42]);
    await fetchRate('MYR', 'GBP');
    expect(getRate).toHaveBeenCalledWith(env, 'MYR', 'GBP', { prefer: 'frankfurter' });
  });

  test('a job with nothing to do (done already, or for an older change) is done with quietly', async () => {
    vi.mocked(reconvertSplit).mockResolvedValue(false);
    const msg = message(job('trip'));
    await handleReconvertQueue(batchOf('reconvert', [msg]), env, ctx);
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(notifySplit).not.toHaveBeenCalled();
  });

  test('a failure is tried again later, waiting longer each time', async () => {
    vi.mocked(reconvertSplit).mockRejectedValue(new Error('No rate for MYR to GBP right now'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = message(job('a'), 1);
    const third = message(job('b'), 3);
    await handleReconvertQueue(batchOf('reconvert', [first, third]), env, ctx);

    expect(first.ack).not.toHaveBeenCalled();
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(third.retry).toHaveBeenCalledWith({ delaySeconds: 240 });
    expect(notifySplit).not.toHaveBeenCalled();
  });

  test('one failure in a batch does not hold up the others', async () => {
    vi.mocked(reconvertSplit).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = message(job('a'));
    const working = message(job('b'));
    await handleReconvertQueue(batchOf('reconvert', [failing, working]), env, ctx);
    expect(failing.retry).toHaveBeenCalledOnce();
    expect(working.ack).toHaveBeenCalledOnce();
    expect(notifySplit).toHaveBeenCalledWith(env, ctx, 'b', null);
  });

  test('jobs given up on are logged and done with, without converting', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = message(job('stuck'), 9);
    await handleReconvertQueue(batchOf('reconvert-dlq', [msg]), env, ctx);
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(reconvertSplit).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith('gave up retrying a conversion', job('stuck'));
  });
});

describe('how long retries wait', () => {
  test('doubles from a minute, up to an hour', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(retryDelaySeconds)).toEqual([
      60, 120, 240, 480, 960, 1920, 3600, 3600, 3600,
    ]);
  });

  test('all 8 retries fit in the day a queued message is kept', () => {
    const total = [1, 2, 3, 4, 5, 6, 7, 8].reduce((sum, n) => sum + retryDelaySeconds(n), 30);
    expect(total).toBeLessThan(24 * 60 * 60);
  });

  test('the first retry waits half a minute; tests can set every wait', () => {
    expect(retryDelay({}, null)).toBe(30);
    expect(retryDelay({}, 2)).toBe(120);
    expect(retryDelay({ RECONVERT_RETRY_DELAY_S: '1' }, null)).toBe(1);
    expect(retryDelay({ RECONVERT_RETRY_DELAY_S: '1' }, 5)).toBe(1);
  });

  test('queues the retry after the first wait, and survives the queue being unavailable', async () => {
    const send = vi.fn(() => Promise.resolve());
    await queueReconvert({ RECONVERT_QUEUE: { send } } as unknown as Env, job('trip', 7));
    expect(send).toHaveBeenCalledWith(job('trip', 7), { delaySeconds: 30 });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn(() => Promise.reject(new Error('queue down')));
    await expect(
      queueReconvert({ RECONVERT_QUEUE: { send: failing } } as unknown as Env, job('trip')),
    ).resolves.toBeUndefined();
  });
});
