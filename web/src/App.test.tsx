// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, renderApp, setupAppTests, splitDetail } from './testing/app';

setupAppTests();

describe('the app', () => {
  test('gets around from the sidebar', async () => {
    renderApp(fakeServer());
    const user = userEvent.setup();
    const sidebar = await screen.findByRole('navigation', { name: 'Main' });
    await user.click(within(sidebar).getByText('Settings'));
    expect(await screen.findByRole('textbox', { name: 'Display name' })).toBeTruthy();
    await user.click(within(sidebar).getByRole('button', { name: 'Convert' }));
    expect(await screen.findByRole('textbox', { name: 'Amount' })).toBeTruthy();
    await user.click(within(sidebar).getByRole('button', { name: 'My splits' }));
    expect(await screen.findByRole('heading', { name: 'My splits' })).toBeTruthy();
  });

  test('on a phone, gets around with the bottom tabs, and Back never steps through them', async () => {
    renderApp(fakeServer(splitDetail('trip')), '/', { size: 'phone' });
    const user = userEvent.setup();
    const tabs = await screen.findByRole('navigation', { name: 'Sections' });
    const depth = window.history.length;

    await user.click(within(tabs).getByRole('button', { name: 'Convert' }));
    expect(window.location.search).toBe('?convert');
    await user.click(within(tabs).getByRole('button', { name: /Invites/ }));
    expect(window.location.search).toBe('?tab=invites');
    // Tabs replace each other
    expect(window.history.length).toBe(depth);

    // Inside a split, Splits goes back to the list it was opened from
    await user.click(within(tabs).getByRole('button', { name: 'Splits' }));
    await user.click(await screen.findByText('Trip'));
    await waitFor(() => expect(window.location.search).toBe('?s=trip'));
    await user.click(within(tabs).getByRole('button', { name: 'Splits' }));
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  test('on a phone, Back closes a sheet before leaving the page', async () => {
    renderApp(fakeServer(splitDetail('trip')), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    // Enabled once the split has loaded
    const more = await screen.findByRole('button', { name: 'More' });
    await waitFor(() => expect(more.hasAttribute('disabled')).toBe(false));
    await user.click(more);
    expect(await screen.findByRole('dialog')).toBeTruthy();

    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.search).toBe('?s=trip');

    // A sheet opened from another (People, from the menu) is the one Back closes
    await user.click(more);
    await user.click(
      within(await screen.findByRole('dialog')).getByText('People', { exact: true }),
    );
    expect(await screen.findByText('Add someone')).toBeTruthy();
    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.search).toBe('?s=trip');
  });

  test('asks you to sign in again once signed out', async () => {
    const server = fakeServer();
    server.health = 'signedOut';
    renderApp(server);
    expect(await screen.findByText("You're signed out")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  test("says when the server can't be reached, and tries again", async () => {
    const server = fakeServer();
    server.health = 'down';
    renderApp(server);
    const user = userEvent.setup();
    expect(await screen.findByText("Couldn't reach Splitfoolish")).toBeTruthy();
    expect(screen.queryByText("You're signed out")).toBeNull();

    server.health = 'up';
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'My splits' })).toBeTruthy();
  });

  test("an invite link that can't be checked just now can be tried again", async () => {
    const server = fakeServer(splitDetail('trip'));
    server.failNext.join = 500;
    renderApp(server, '/?join=token');
    const user = userEvent.setup();
    expect(await screen.findByText("Couldn't open the invite")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(window.location.search).toBe('?s=trip'));
  });

  test('an invite link waits in Invites, and accepting it opens the split', async () => {
    const server = fakeServer();
    server.notJoined = [{ ...splitDetail('bali'), name: 'Bali', shareToken: 'bali-link' }];
    renderApp(server, '/?join=bali-link');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Accept Bali' }));
    await waitFor(() => expect(window.location.search).toBe('?s=bali'));
    expect(server.splits.has('bali')).toBe(true);
    expect(server.invites).toEqual([]);
  });

  test('says when an invite link no longer works', async () => {
    renderApp(fakeServer(), '/?join=old');
    expect(await screen.findByText('This invite link no longer works')).toBeTruthy();
  });
});
