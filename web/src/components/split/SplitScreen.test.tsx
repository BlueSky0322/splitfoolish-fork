// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { fakeServer, item, renderApp, splitDetail, setupAppTests } from '../../testing/app';

setupAppTests();

const trip = () =>
  splitDetail('trip', [
    item({ id: 'dinner', name: 'Dinner', cost: 90 }),
    item({ id: 'taxi', name: 'Taxi', cost: 30, payerId: 'ann' }),
  ]);

describe('the split page', () => {
  test('shows the items and who owes whom', async () => {
    renderApp(fakeServer(trip()), '/?s=trip');
    expect(await screen.findByText('Dinner')).toBeTruthy();
    expect(screen.getByText('Taxi')).toBeTruthy();
    // Ryan paid 90 and Ann 30, split evenly: Ann owes Ryan 30
    expect((await screen.findAllByText(/RM\s?30\.00/)).length).toBeGreaterThan(0);
  });

  test('adds an item typed as a sum, and sends it to the server', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');

    await user.click(screen.getAllByRole('button', { name: /^Add item$/ })[0]);
    const form = await screen.findByRole('dialog');
    await user.type(within(form).getByRole('textbox', { name: 'What it was for' }), 'Snacks');
    await user.type(within(form).getByRole('textbox', { name: 'Amount' }), '8*2');
    await user.click(within(form).getByRole('button', { name: /^(Add|Add item)$/ }));

    expect(await screen.findByText('Snacks')).toBeTruthy();
    await waitFor(() => expect(server.splits.get('trip')!.items).toHaveLength(3));
    expect(server.splits.get('trip')!.items[2]).toMatchObject({ name: 'Snacks', cost: 16 });
  });

  test('deletes an item with Undo, and Undo puts it back', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Taxi'));
    const form = await screen.findByRole('dialog');
    await user.click(within(form).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete item' }));

    await waitFor(() => expect(screen.queryByText('Taxi')).toBeNull());
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.map((i) => i.name)).toEqual(['Dinner']),
    );
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Taxi')).toBeTruthy();
    await waitFor(() => expect(server.splits.get('trip')!.items).toHaveLength(2));
  });

  test("explains that a split isn't there, or isn't shared with you", async () => {
    renderApp(fakeServer(), '/?s=missing');
    expect(await screen.findByText(/doesn't exist, or you don't have access/)).toBeTruthy();
  });
});
