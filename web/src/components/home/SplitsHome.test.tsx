// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  test('shows where you stand in each split', async () => {
    renderApp(
      fakeServer(
        splitDetail('trip', [
          item({ id: 'dinner', name: 'Dinner', cost: 90 }),
          item({ id: 'taxi', name: 'Taxi', cost: 30, payerId: 'ann' }),
        ]),
      ),
    );
    // Ryan paid 90 and Ann 30, split evenly: Ryan is owed 30
    expect(await screen.findByText("You're owed")).toBeTruthy();
    expect((await screen.findAllByText(/RM\s?30\.00/)).length).toBeGreaterThan(0);
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

  test('on a phone, swiping a split archives it, and Archived brings it back', async () => {
    const server = fakeServer(
      splitDetail('trip', [item({ id: 'dinner', name: 'Dinner', cost: 90 })]),
    );
    renderApp(server, '/', { size: 'phone' });
    const user = userEvent.setup();
    const row = (await screen.findByText('Trip', {}, { timeout: 3000 })).closest('button')!;
    expect(within(row).getByText('2 people, 1 item')).toBeTruthy();
    // Ann owes Ryan 45 of the 90
    expect(within(row).getByText('45.00')).toBeTruthy();

    fireEvent.touchStart(row, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 120, clientY: 104 }] });
    fireEvent.touchEnd(row);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.queryByText('Trip')).toBeNull());
    await waitFor(() => expect(server.archived.has('trip')).toBe(true), { timeout: 3000 });

    await user.click(screen.getByRole('button', { name: 'Sort and filter' }));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('radio', { name: 'Archived' }));
    expect(await screen.findByText('Trip')).toBeTruthy();
  });

  test('on a phone, search finds items and splits by name', async () => {
    renderApp(
      fakeServer(splitDetail('trip', [item({ id: 'ramen', name: 'Ichiran ramen', cost: 30 })])),
      '/',
      { size: 'phone' },
    );
    const user = userEvent.setup();
    await screen.findByText('Trip', {}, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'ram');
    expect(await screen.findByText('Items')).toBeTruthy();
    expect(screen.getByText('30.00')).toBeTruthy();
    await user.clear(screen.getByRole('textbox', { name: 'Search' }));
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'tri');
    expect(await screen.findByRole('heading', { name: 'Splits', level: 2 })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Splits', level: 1 })).toBeTruthy();
  });

  test('on a phone, Invites is a tab of its own with accept and decline', async () => {
    const server = fakeServer();
    server.invites = [
      {
        kind: 'invite',
        id: 'inv',
        splitId: 'penang',
        splitName: 'Penang',
        invitedBy: 'mei@example.com',
        invitedByName: 'Mei',
        createdAt: Date.now() - 2 * 3_600_000,
        expiresAt: Date.now() + 86_400_000,
      },
    ];
    renderApp(server, '/?tab=invites', { size: 'phone' });
    const user = userEvent.setup();
    expect(await screen.findByText('Penang', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/^From Mei, /)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Decline Penang' }));
    await waitFor(() => expect(server.invites).toEqual([]));
    expect(await screen.findByText(/No invites right now/)).toBeTruthy();
  });

  test('on a computer, sorts splits by name, and back to your own order', async () => {
    const server = fakeServer(splitDetail('b', []));
    server.splits.set('a', { ...splitDetail('a'), name: 'Alps' });
    server.splits.set('z', { ...splitDetail('z'), name: 'Zurich' });
    renderApp(server);
    const user = userEvent.setup();
    await screen.findByText('Zurich', {}, { timeout: 3000 });
    const order = () => screen.getAllByText(/^(Trip|Alps|Zurich)$/).map((el) => el.textContent);
    expect(order()).toEqual(['Trip', 'Alps', 'Zurich']);

    await user.click(screen.getByRole('button', { name: 'Sort: Your order' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Name' }));
    expect(order()).toEqual(['Alps', 'Trip', 'Zurich']);
    await user.click(screen.getByRole('button', { name: 'Sort: Name' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Your order' }));
    expect(order()).toEqual(['Trip', 'Alps', 'Zurich']);
  });
});
