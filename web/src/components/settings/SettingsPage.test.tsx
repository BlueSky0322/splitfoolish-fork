// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
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
});
