// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, item, renderApp, splitDetail, setupAppTests } from '../../testing/app';

setupAppTests();

describe('My splits', () => {
  test('lists your splits, and opens one', async () => {
    renderApp(fakeServer(splitDetail('trip', [item({ id: 'dinner', name: 'Dinner', cost: 90 })])));
    const user = userEvent.setup();
    await user.click(await screen.findByText('Trip'));
    expect(await screen.findByText('Dinner')).toBeTruthy();
    expect(window.location.search).toBe('?s=trip');
  });

  test('makes a new split, and goes to it', async () => {
    const server = fakeServer();
    renderApp(server);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'New split' }))[0]);
    const form = await screen.findByRole('dialog');
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Bali');
    await user.click(within(form).getByRole('button', { name: 'Create split' }));

    await waitFor(() => expect([...server.splits.values()].map((s) => s.name)).toEqual(['Bali']));
    expect(server.splits.values().next().value).toMatchObject({ currency: 'MYR' });
    await waitFor(() => expect(window.location.search).toMatch(/^\?s=/));
  });
});
