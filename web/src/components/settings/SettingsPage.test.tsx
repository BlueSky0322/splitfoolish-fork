// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { keys } from 'idb-keyval';
import { describe, expect, onTestFinished, test } from 'vitest';
import type { ConnectedAgent } from '@shared/api';
import { writeCache } from '../../offline/cache';
import { writeOutbox } from '../../offline/outbox';
import { PHOTO_PREFIX } from '../../offline/photo-queue';
import { flushOfflineChanges } from '../../offline/sync';
import { fakeServer, holdNext, renderApp, setupAppTests } from '../../testing/app';

/** The test browser vitest runs, with the console it reports what it can't do to */
interface TestBrowser {
  virtualConsole: {
    on(event: 'jsdomError', listener: (error: { type?: string; message: string }) => void): void;
    off(event: 'jsdomError', listener: (error: { type?: string; message: string }) => void): void;
  };
}

setupAppTests();

describe('Settings', () => {
  test('saves a new display name, beside the email from sign-in, which cannot be changed', async () => {
    const server = fakeServer();
    renderApp(server, '/?settings');
    const user = userEvent.setup();
    const name = await screen.findByRole('textbox', { name: 'Display name' });
    const email = screen.getByRole<HTMLInputElement>('textbox', { name: 'Email' });
    expect(email.value).toBe('ryan@example.com');
    expect(email.readOnly).toBe(true);

    await user.clear(name);
    await user.type(name, 'Ryan N{Enter}');
    await waitFor(() => expect(server.me.displayName).toBe('Ryan N'));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(server.me.email).toBe('ryan@example.com');
    expect(email.value).toBe('ryan@example.com');
  });

  test("a slow answer to an earlier save doesn't put back the name typed since", async () => {
    const server = fakeServer();
    renderApp(server, '/?settings');
    const user = userEvent.setup();
    const name = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Display name' });

    const first = holdNext(server, 'PATCH', '/api/me');
    await user.clear(name);
    await user.type(name, 'Ryan N{Enter}');
    await user.type(name, 'g{Enter}');
    await waitFor(() => expect(server.me.displayName).toBe('Ryan Ng'));

    // The first save's answer, still saying "Ryan N", arrives last
    first.release();
    expect(await screen.findByText('Saved')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(name.value).toBe('Ryan Ng');
    expect(screen.getAllByText('Ryan Ng').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ryan N')).toBeNull();
  });

  test("puts the name back and says so when it isn't saved", async () => {
    const server = fakeServer();
    server.failNext.profile = 500;
    renderApp(server, '/?settings');
    const user = userEvent.setup();
    const name = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Display name' });
    await user.clear(name);
    await user.type(name, 'Nope{Enter}');

    expect(await screen.findByText(/Something went wrong/)).toBeTruthy();
    await waitFor(() => expect(name.value).toBe('Ryan'));
    expect(screen.queryByText('Saved')).toBeNull();
    expect(server.me.displayName).toBe('Ryan');
  });

  /**
   * Watches for going to Cloudflare's sign-out page, which the test browser can't do and
   * reports to its console as not implemented
   */
  const watchSignOut = () => {
    const { virtualConsole } = (globalThis as unknown as { jsdom: TestBrowser }).jsdom;
    let navigated = false;
    const notice = (error: { type?: string; message: string }) => {
      if (error.type === 'not-implemented' && error.message.includes('navigation')) {
        navigated = true;
      }
    };
    virtualConsole.on('jsdomError', notice);
    onTestFinished(() => void virtualConsole.off('jsdomError', notice));
    return () => navigated;
  };

  test('asks before signing out when changes have not reached the server, which signing out removes', async () => {
    const server = fakeServer();
    renderApp(server, '/?settings');
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Display name' });
    // Made offline, not sent yet: the server can't be reached, so trying to send it again
    // (as the app does once signed in) keeps it
    server.health = 'unreachable';
    await writeOutbox('trip', [{ cid: 'c1', change: { op: 'removeItem', id: 'dinner' } }]);
    await flushOfflineChanges();
    const signedOut = watchSignOut();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out with unsaved changes?' });
    expect(dialog.textContent).toContain(
      "A split has changes or photos that haven't reached the server",
    );
    await user.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await keys()).toContain('outbox:trip');
    expect(signedOut()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(await screen.findByRole('button', { name: 'Sign out anyway' }));
    await waitFor(() => expect(signedOut()).toBe(true));
    expect(await keys()).not.toContain('outbox:trip');
  });

  test('asks before signing out when photos are still waiting to upload', async () => {
    renderApp(fakeServer(), '/?settings');
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Display name' });
    // A photo picked offline, kept until it can be uploaded
    await writeCache(`${PHOTO_PREFIX}trip:p1`, {
      id: 'p1',
      splitId: 'trip',
      itemId: null,
      name: 'beach.jpg',
      createdAt: 1,
      type: 'image/jpeg',
      bytes: new ArrayBuffer(8),
    });
    const signedOut = watchSignOut();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('dialog', { name: 'Sign out with unsaved changes?' }),
    ).toBeTruthy();
    expect(signedOut()).toBe(false);
  });

  test('signs out straight away when everything is saved', async () => {
    renderApp(fakeServer(), '/?settings');
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Display name' });
    await writeOutbox('trip', [{ cid: 'c1', change: { op: 'removeItem', id: 'dinner' } }]);
    await writeOutbox('trip', []);
    const signedOut = watchSignOut();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signedOut()).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test.each([
    ['on a computer', 'desktop'],
    ['on a phone', 'phone'],
  ] as const)('shows its menu %s while your account loads', async (_where, size) => {
    const server = fakeServer();
    const held = holdNext(server, 'GET', '/api/me');
    renderApp(server, size === 'phone' ? '/?settings' : '/?settings#profile', { size });

    expect(await screen.findByRole('button', { name: 'Currency' })).toBeTruthy();
    expect(
      screen.getByText(size === 'phone' ? 'Loading your account' : 'Loading your settings'),
    ).toBeTruthy();

    held.release();
    expect((await screen.findAllByText('ryan@example.com')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Loading your (account|settings)/)).toBeNull();
  });
});

// The AI apps this account let in over MCP, listed in Settings and disconnected one at a time
describe('Connected agents', () => {
  const agent = (id: string, name: string, scopes: ConnectedAgent['scopes'], day: number) => ({
    id,
    name,
    scopes,
    connectedAt: Date.UTC(2026, 9, day),
    returnsTo: null,
    approvedOn: null,
    lastUsedAt: null,
  });

  const listed = () =>
    within(screen.getByRole('list', { name: 'Connected agents' }))
      .getAllByRole('listitem')
      .map((row) => row.textContent);

  test('lists them newest first with what each may do, and disconnects one after asking', async () => {
    const server = fakeServer();
    server.agents = [
      agent('g1', 'Hermes', ['splits:read'], 3),
      agent('g2', 'Claude', ['splits:read', 'splits:write'], 12),
    ];
    renderApp(server, '/?settings#agents');
    const user = userEvent.setup();
    await screen.findByRole('list', { name: 'Connected agents' });
    expect(listed()).toEqual([
      expect.stringMatching(/^Claude.*Can see and change your splits · connected/),
      expect.stringMatching(/^Hermes.*Can see your splits · connected/),
    ]);

    // Kept when they think better of it
    await user.click(screen.getByRole('button', { name: 'Disconnect Hermes' }));
    await screen.findByRole('dialog', { name: 'Disconnect Hermes?' });
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.agents.map((a) => a.id)).toEqual(['g1', 'g2']);

    await user.click(screen.getByRole('button', { name: 'Disconnect Hermes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Hermes?' });
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.agents.map((a) => a.id)).toEqual(['g2']);
    expect(listed()).toEqual([expect.stringMatching(/^Claude/)]);
  });

  test('tells two connections of the same app apart by where they are from', async () => {
    const server = fakeServer();
    server.agents = [
      {
        ...agent('g1', 'Claude', ['splits:read', 'splits:write'], 16),
        returnsTo: { site: 'claude.ai' },
        approvedOn: 'Chrome on Windows',
      },
      // Connected before the device was noted
      { ...agent('g2', 'Claude', ['splits:read'], 15), returnsTo: { computer: true } },
    ];
    renderApp(server, '/?settings#agents');
    await screen.findByRole('list', { name: 'Connected agents' });
    expect(listed()).toEqual([
      expect.stringMatching(
        /^ClaudeThrough claude\.ai, allowed in Chrome on Windows · not used since .*Can see and change your splits · connected/,
      ),
      expect.stringMatching(
        /^ClaudeThrough an app on a computer · not used since .*Can see your splits · connected/,
      ),
    ]);
    // The page says what disconnecting does once, without the card repeating its title
    expect(screen.getAllByRole('heading', { name: 'Connected agents' })).toHaveLength(1);
  });

  test('says when each was last used, so one left behind stands out', async () => {
    const server = fakeServer();
    server.agents = [
      // Both through claude.ai: the connector added, then removed and added again there
      {
        ...agent('g1', 'Claude', ['splits:read'], 16),
        connectedAt: Date.UTC(2026, 9, 16, 14, 34),
        returnsTo: { site: 'claude.ai' },
      },
      {
        ...agent('g2', 'Claude', ['splits:read', 'splits:write'], 16),
        connectedAt: Date.UTC(2026, 9, 16, 15, 23),
        returnsTo: { site: 'claude.ai' },
        lastUsedAt: Date.now() - 5 * 60 * 1000,
      },
      // Connected since use was noted, and never used
      { ...agent('g3', 'Hermes', ['splits:read'], 16), connectedAt: Date.now() - 60 * 1000 },
    ];
    renderApp(server, '/?settings#agents');
    await screen.findByRole('list', { name: 'Connected agents' });
    expect(listed()).toEqual([
      expect.stringMatching(/^HermesNot used yetCan see your splits/),
      expect.stringMatching(/^ClaudeThrough claude\.ai · last used today .*Can see and change/),
      expect.stringMatching(/^ClaudeThrough claude\.ai · not used since Oct 22Can see your splits/),
    ]);
  });

  test('a disconnect the server refuses keeps the agent listed, and says so', async () => {
    const server = fakeServer();
    server.agents = [agent('g1', 'Hermes', ['splits:read'], 3)];
    server.failNext.agent = 500;
    renderApp(server, '/?settings#agents');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Disconnect Hermes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Hermes?' });
    const said = screen.queryAllByText(/Something went wrong/).length;
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    // Said once more than before (an earlier test's may still be showing)
    await waitFor(() =>
      expect(screen.queryAllByText(/Something went wrong/)).toHaveLength(said + 1),
    );
    expect(listed()).toEqual([expect.stringMatching(/^Hermes/)]);
    expect(server.agents).toHaveLength(1);
  });

  test('says when none are connected', async () => {
    renderApp(fakeServer(), '/?settings#agents');
    expect(await screen.findByText('No agents are connected.')).toBeTruthy();
  });
});
