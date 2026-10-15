// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  LAST_PAGE_KEY,
  SW_USER_KEY,
  assumeLastUser,
  clearCache,
  readCache,
  setCacheUser,
  writeCache,
} from './cache';

// One device can be used by more than one account: what's kept is only ever read back
// by the account that kept it

beforeEach(async () => {
  await clearCache();
  localStorage.clear();
});

describe('the device cache', () => {
  test("someone else signing in on this device can't read what was kept", async () => {
    await setCacheUser('ann@example.com');
    await writeCache('split-v2:trip', { name: 'Trip' });
    expect(await readCache('split-v2:trip')).toEqual({ name: 'Trip' });

    await setCacheUser('ben@example.com');
    expect(await readCache('split-v2:trip')).toBeUndefined();
    // The service worker sends only Ben's kept changes now
    expect(await get(SW_USER_KEY)).toBe('ben@example.com');
  });

  test('copies kept by older builds, in shapes no longer read, are dropped', async () => {
    await setCacheUser('ann@example.com');
    await set('me', { email: 'ann@example.com', value: {} });
    await set('split:trip', { email: 'ann@example.com', value: {} });
    await writeCache('split-v2:trip', { name: 'Trip' });

    await setCacheUser('ann@example.com');
    expect(await get('me')).toBeUndefined();
    expect(await get('split:trip')).toBeUndefined();
    expect(await readCache('split-v2:trip')).toEqual({ name: 'Trip' });
  });

  test('the same person signing in again keeps what was kept', async () => {
    await setCacheUser('ann@example.com');
    await writeCache('split-v2:trip', { name: 'Trip' });
    await setCacheUser('ann@example.com');
    expect(await readCache('split-v2:trip')).toEqual({ name: 'Trip' });
  });

  test('the page open stays for the first sign-in, but not for a different account', async () => {
    localStorage.setItem(LAST_PAGE_KEY, '?s=trip');
    await setCacheUser('ann@example.com');
    expect(localStorage.getItem(LAST_PAGE_KEY)).toBe('?s=trip');

    await setCacheUser('ben@example.com');
    expect(localStorage.getItem(LAST_PAGE_KEY)).toBeNull();
  });

  test('offline, the last person here is assumed', async () => {
    expect(assumeLastUser()).toBeNull();
    await setCacheUser('ann@example.com');
    expect(assumeLastUser()).toBe('ann@example.com');
  });
});
