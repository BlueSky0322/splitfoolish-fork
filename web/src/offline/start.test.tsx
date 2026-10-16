// @vitest-environment jsdom
import { act, screen } from '@testing-library/react';
import { get, set } from 'idb-keyval';
import { describe, expect, test, vi } from 'vitest';
import type { Profile, SplitSummary } from '@shared/api';
import { LAST_EMAIL_KEY, OPENED_FROM_DEVICE } from './cache';
import { type FakeServer, fakeServer, holdNext, renderApp, setupAppTests } from '../testing/app';

// Starting the app when the server can't answer in time. The service worker opens it
// from the copy it keeps, and says so (shell.test.ts); the app then shows the last
// account's saved splits after a moment, rather than waiting on the server. Opened from
// the network, it waits for the server to say who's signed in, as ever.

setupAppTests();

const RYAN = 'ryan@example.com';

const summary = (name: string): SplitSummary => ({
  id: 'kept',
  name,
  currency: 'MYR',
  role: 'owner',
  memberCount: 1,
  peopleCount: 1,
  itemCount: 0,
  totalCents: 0,
  settled: false,
  archived: false,
  myBalanceCents: 0,
  pictureVersion: null,
  updatedAt: 1,
});

/** What the app kept on this device the last time Ryan used it, as it keeps them */
async function keptFromLastTime(server: FakeServer) {
  localStorage.setItem(LAST_EMAIL_KEY, RYAN);
  await set('me-v2', { email: RYAN, value: server.me });
  await set('home-v2', { email: RYAN, value: { splits: [summary('Kept trip')], invites: [] } });
}

/** The page as the service worker sends it from its copy */
function openedFromDevice() {
  const meta = document.createElement('meta');
  meta.name = OPENED_FROM_DEVICE;
  meta.content = 'true';
  document.head.append(meta);
  return () => meta.remove();
}

/** The server takes its time with who's signed in and the list of splits */
const slow = (server: FakeServer) => [
  holdNext(server, 'GET', '/api/me'),
  holdNext(server, 'GET', '/api/splits'),
  holdNext(server, 'GET', '/api/invites'),
];

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe('starting with the server out of reach', () => {
  test('opened from the device, the last account’s saved splits show after a moment', async () => {
    const server = fakeServer();
    await keptFromLastTime(server);
    const done = openedFromDevice();
    slow(server);
    renderApp(server);

    expect((await screen.findAllByText('Kept trip', {}, { timeout: 4000 })).length).toBeGreaterThan(
      0,
    );
    done();
  });

  test('opened from the network, nothing kept shows until the server says who is signed in', async () => {
    const server = fakeServer();
    await keptFromLastTime(server);
    const held = slow(server);
    renderApp(server);

    await wait(2500);
    expect(screen.queryByText('Kept trip')).toBeNull();
    held.forEach((h) => h.release());
    // Signed in as the server says, and its list shown
    expect(await screen.findByText(RYAN)).toBeTruthy();
    expect(await screen.findByText('No splits yet. Start one with New split.')).toBeTruthy();
    // The kept copy, read once the server said who it is, lands before the next test
    await wait(100);
  });

  test('opened from the device with the server failing, the saved splits show', async () => {
    const server = fakeServer();
    await keptFromLastTime(server);
    server.health = 'down';
    const done = openedFromDevice();
    renderApp(server);

    expect((await screen.findAllByText('Kept trip')).length).toBeGreaterThan(0);
    // Signed in as Ryan, from his saved profile
    expect(await screen.findByText(RYAN)).toBeTruthy();
    expect(screen.queryByText("Couldn't reach Splitfoolish")).toBeNull();
    done();
  });

  test('someone else signed in meanwhile: what Ryan kept goes, and the app starts afresh', async () => {
    const server = fakeServer();
    await keptFromLastTime(server);
    // Ann signed in on Ryan's device; the server says so once it answers
    server.me = { ...server.me, email: 'ann@example.com', displayName: 'Ann' } satisfies Profile;
    const done = openedFromDevice();
    const [me] = slow(server);
    const reload = vi.fn();
    // The page's address as it is, but reloading is only noted: jsdom can't
    const real = window.location;
    vi.stubGlobal(
      'location',
      new Proxy({}, { get: (_, key) => (key === 'reload' ? reload : Reflect.get(real, key)) }),
    );
    renderApp(server);
    await screen.findAllByText('Kept trip', {}, { timeout: 4000 });

    me.release();
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(await get('home-v2')).toBeUndefined();
    expect(localStorage.getItem(LAST_EMAIL_KEY)).toBe('ann@example.com');
    done();
  });
});
