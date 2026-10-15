// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, renderApp, setupAppTests } from './testing/app';

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
    server.signedIn = false;
    renderApp(server);
    expect(await screen.findByText("You're signed out")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
});
