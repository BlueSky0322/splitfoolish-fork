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

  test('says when an invite link no longer works', async () => {
    renderApp(fakeServer(), '/?join=old');
    expect(await screen.findByText('This invite link no longer works')).toBeTruthy();
  });
});
