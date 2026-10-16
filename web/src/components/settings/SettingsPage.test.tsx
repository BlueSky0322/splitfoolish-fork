// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { keys } from 'idb-keyval';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { writeOutbox } from '../../offline/outbox';
import { fakeServer, holdNext, renderApp, setupAppTests } from '../../testing/app';

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
   * reports as an error
   */
  const watchSignOut = () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => error.mockRestore());
    return () => error.mock.calls.some((args) => String(args[0]).includes('navigation'));
  };

  test('asks before signing out when changes have not reached the server, which signing out removes', async () => {
    renderApp(fakeServer(), '/?settings');
    const user = userEvent.setup();
    await screen.findByRole('textbox', { name: 'Display name' });
    // Made offline, not sent yet
    await writeOutbox('trip', [{ cid: 'c1', change: { op: 'removeItem', id: 'dinner' } }]);
    const signedOut = watchSignOut();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out with unsaved changes?' });
    expect(dialog.textContent).toContain("A split has changes that haven't reached the server");
    await user.click(screen.getByRole('button', { name: 'Stay signed in' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await keys()).toContain('outbox:trip');
    expect(signedOut()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(await screen.findByRole('button', { name: 'Sign out anyway' }));
    await waitFor(() => expect(signedOut()).toBe(true));
    expect(await keys()).not.toContain('outbox:trip');
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
});
