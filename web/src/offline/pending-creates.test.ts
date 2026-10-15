import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../api';
import type { PendingCreate } from './outbox';

// The network and the device are stood in for: what's kept, and what the server says
const kept = new Map<string, PendingCreate>();
const createSplit = vi.fn<[id: string, name: string, currency: string], Promise<unknown>>();

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: { createSplit: (...args: [string, string, string]) => createSplit(...args) },
}));
vi.mock('./outbox', async (original) => ({
  ...(await original<typeof import('./outbox')>()),
  savePendingCreate: (c: PendingCreate) => Promise.resolve(void kept.set(c.id, c)),
  removePendingCreate: (id: string) => Promise.resolve(void kept.delete(id)),
  readPendingCreates: () => Promise.resolve([...kept.values()]),
  requestBackgroundSync: () => {},
}));

// Retries also wait for the connection to come back, which the page hears about
vi.stubGlobal('window', new EventTarget());

const { startCreate, whenCreated } = await import('./pending-creates');

const create = (id: string): PendingCreate => ({
  id,
  name: 'Trip',
  currency: 'MYR',
  summary: {} as PendingCreate['summary'],
});

beforeEach(() => {
  kept.clear();
  createSplit.mockReset();
});

describe('creating a split made on this device', () => {
  test('is done once the server has it, and forgotten here', async () => {
    createSplit.mockResolvedValue({ id: 'one' });
    await startCreate(create('one'));
    await expect(whenCreated('one')).resolves.toBeUndefined();
    expect(kept.has('one')).toBe(false);
  });

  test('counts an earlier try that got through (409) as done', async () => {
    createSplit.mockRejectedValue(new ApiError(409, 'That split already exists'));
    await startCreate(create('two'));
    expect(kept.has('two')).toBe(false);
  });

  test('gives up on a refusal, and changes waiting for it are told so', async () => {
    createSplit.mockRejectedValue(new ApiError(400, 'Invalid currency'));
    await expect(startCreate(create('three'))).rejects.toThrow('Invalid currency');
    await expect(whenCreated('three')).rejects.toThrow('Invalid currency');
    expect(kept.has('three')).toBe(false);
  });

  test('tries again after the server was busy, keeping it on the device meanwhile', async () => {
    vi.useFakeTimers();
    createSplit
      .mockRejectedValueOnce(new ApiError(503, 'Busy'))
      .mockResolvedValueOnce({ id: 'four' });
    const done = startCreate(create('four'));
    await vi.advanceTimersByTimeAsync(10);
    expect(kept.has('four')).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    await done;
    expect(createSplit).toHaveBeenCalledTimes(2);
    expect(kept.has('four')).toBe(false);
    vi.useRealTimers();
  });

  test('takes any split it never started as already there', async () => {
    await expect(whenCreated('made-elsewhere')).resolves.toBeUndefined();
  });
});
