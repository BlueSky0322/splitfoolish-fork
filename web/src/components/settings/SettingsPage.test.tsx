// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, renderApp, setupAppTests } from '../../testing/app';

setupAppTests();

describe('Settings', () => {
  test('saves a new display name when you leave the field', async () => {
    const server = fakeServer();
    renderApp(server, '/?settings');
    const user = userEvent.setup();
    const name = await screen.findByRole('textbox', { name: 'Display name' });
    await user.clear(name);
    await user.type(name, 'Ryan N{Enter}');

    await waitFor(() => expect(server.me.displayName).toBe('Ryan N'));
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  test('shows the email from sign-in, which cannot be changed', async () => {
    renderApp(fakeServer(), '/?settings');
    const email = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Email' });
    expect(email.value).toBe('ryan@example.com');
    expect(email.readOnly).toBe(true);
  });
});
