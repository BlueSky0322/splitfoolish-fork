// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import {
  fakeServer,
  item,
  liveSockets,
  renderApp,
  setupAppTests,
  splitDetail,
} from '../../testing/app';
import { LIVE_REMOVED_CODE } from '@shared/api';

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

  test('shows what someone else saves, as soon as the server says so', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    await screen.findByText('Dinner');
    await waitFor(() => expect(liveSockets().at(-1)?.readyState).toBe(1));

    server.splits.get('trip')!.items.push(item({ id: 'hotel', name: 'Hotel', cost: 200 }));
    liveSockets().at(-1)!.hear({ type: 'changed', by: 'someone-else' });
    expect(await screen.findByText('Hotel')).toBeTruthy();
  });

  test('says so when someone removes you from the split while it is open', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    await screen.findByText('Dinner');
    await waitFor(() => expect(liveSockets().at(-1)?.readyState).toBe(1));

    server.splits.delete('trip');
    liveSockets().at(-1)!.close(LIVE_REMOVED_CODE);
    expect(await screen.findByText(/doesn't exist, or you don't have access/)).toBeTruthy();
    expect(liveSockets()).toHaveLength(1);
  });

  // What the app does when a save doesn't go through
  const addSnacks = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getAllByRole('button', { name: /^Add item$/ })[0]);
    const form = await screen.findByRole('dialog');
    await user.type(within(form).getByRole('textbox', { name: 'What it was for' }), 'Snacks');
    await user.type(within(form).getByRole('textbox', { name: 'Amount' }), '16');
    await user.click(within(form).getByRole('button', { name: /^(Add|Add item)$/ }));
  };

  test('a change the server refuses is explained and undone', async () => {
    const server = fakeServer(trip());
    server.failNext.changes = 409;
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');
    await addSnacks(user);

    expect(await screen.findByText('Refused')).toBeTruthy();
    // Reloaded to what the server has
    await waitFor(() => expect(screen.queryByText('Snacks')).toBeNull());
    expect(server.splits.get('trip')!.items).toHaveLength(2);
  });

  test('a change made without a connection waits, and goes once it is back', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');
    server.health = 'unreachable';
    await addSnacks(user);

    expect(await screen.findByText(/Offline · 1 change waiting/)).toBeTruthy();
    expect(screen.getByText('Snacks')).toBeTruthy();
    expect(server.sent).toEqual([]);

    server.health = 'up';
    window.dispatchEvent(new Event('online'));
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.map((i) => i.name)).toContain('Snacks'),
    );
  });

  test('a dropped live connection reconnects and catches up', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    await screen.findByText('Dinner');
    await waitFor(() => expect(liveSockets().at(-1)?.readyState).toBe(1));

    liveSockets().at(-1)!.close(1006);
    // Missed while disconnected
    server.splits.get('trip')!.items.push(item({ id: 'hotel', name: 'Hotel', cost: 200 }));
    // The first retry waits a second
    await waitFor(() => expect(liveSockets()).toHaveLength(2), { timeout: 3000 });
    expect(await screen.findByText('Hotel')).toBeTruthy();
  });

  test("a change that doesn't reach the server is kept, and sent on Retry", async () => {
    const server = fakeServer(trip());
    server.failNext.changes = 500;
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');
    await addSnacks(user);

    expect(await screen.findByText(/Couldn't save your latest changes/)).toBeTruthy();
    expect(screen.getByText('Snacks')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Retry now' })[0]);
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.map((i) => i.name)).toContain('Snacks'),
    );
    await waitFor(() => expect(screen.queryByText(/Couldn't save your latest changes/)).toBeNull());
  });

  test('asks before deleting an item whose photos would go with it', async () => {
    const split = trip();
    split.attachments = [
      { id: 'receipt', itemId: 'taxi', size: 1, uploadedBy: 'ryan@example.com', createdAt: 1 },
    ];
    const server = fakeServer(split);
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete Taxi' }));

    const ask = await screen.findByRole('dialog', { name: 'Delete Taxi?' });
    expect(within(ask).getByText(/A photo will be deleted too/)).toBeTruthy();
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Taxi')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Delete Taxi' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Delete Taxi?' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.map((i) => i.name)).toEqual(['Dinner']),
    );
  });

  test('on a phone, leads with where you stand, with settling up and photos as tabs', async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    expect(await screen.findByText('Dinner')).toBeTruthy();
    // Ryan paid 90 and Ann 30 of 120 split evenly: Ann owes Ryan 30
    expect(screen.getByText("You're owed")).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Settle up/ }));
    expect(screen.getByRole('tab', { name: 'Settle up' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(await screen.findByText('Ann pays Ryan')).toBeTruthy();
    expect(screen.queryByText('Dinner')).toBeNull();

    // A swipe moves on to the next tab
    const content = screen.getByText('Ann pays Ryan').closest('[class*=content]')!;
    fireEvent.touchStart(content, { touches: [{ clientX: 300, clientY: 400 }] });
    fireEvent.touchEnd(content, { changedTouches: [{ clientX: 100, clientY: 410 }] });
    expect(screen.getByRole('tab', { name: 'Photos' }).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText(/No photos yet/)).toBeTruthy();

    // The split's menu is a sheet
    await user.click(screen.getByRole('button', { name: 'More' }));
    const menu = await screen.findByRole('dialog');
    expect(within(menu).getByText('People')).toBeTruthy();
    expect(within(menu).getByText('Split settings')).toBeTruthy();
  });

  test("explains that a split isn't there, or isn't shared with you", async () => {
    renderApp(fakeServer(), '/?s=missing');
    expect(await screen.findByText(/doesn't exist, or you don't have access/)).toBeTruthy();
  });

  test('the owner adds someone to the bill', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');

    await user.click(screen.getByRole('button', { name: 'Edit people' }));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByRole('textbox', { name: 'Add someone' }), 'Ben');
    await user.click(within(sheet).getByRole('button', { name: 'Add' }));

    expect(await within(sheet).findByText('Ben')).toBeTruthy();
    await waitFor(() =>
      expect(server.sent.flatMap((b) => b.changes)).toContainEqual(
        expect.objectContaining({ op: 'addPerson', name: 'Ben' }),
      ),
    );
  });

  test('an editor sees the people, without changing who is in the bill', async () => {
    const split = trip();
    split.role = 'editor';
    renderApp(fakeServer(split), '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');

    await user.click(screen.getByRole('button', { name: 'See people' }));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('Ann')).toBeTruthy();
    expect(within(sheet).queryByRole('textbox', { name: 'Add someone' })).toBeNull();
  });

  test('renames the split from its settings, here and in My splits', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');

    await renameTo(user, 'Bali trip');
    expect(await screen.findByRole('heading', { name: 'Bali trip' })).toBeTruthy();
    await waitFor(() => expect(server.splits.get('trip')!.name).toBe('Bali trip'));
    expect((await screen.findAllByText('Bali trip')).length).toBeGreaterThan(1);
  });

  test('a refused rename shows the name the server has, and says why', async () => {
    const server = fakeServer(trip());
    server.failNext.settings = 409;
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');

    await renameTo(user, 'Bali trip');
    expect(await screen.findByText('Refused')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Trip' })).toBeTruthy();
    expect(server.splits.get('trip')!.name).toBe('Trip');
  });

  test('withdraws an invite from the sharing dialog', async () => {
    const split = trip();
    split.invites = [
      {
        id: 'inv',
        email: 'dev@example.com',
        invitedBy: split.members[0].email,
        invitedByName: 'Ryan',
        needsApproval: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + 86_400_000,
      },
    ];
    const server = fakeServer(split);
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');

    await user.click(screen.getByRole('button', { name: 'Share' }));
    await user.click(
      await screen.findByRole('button', { name: 'Withdraw invite for dev@example.com' }),
    );
    await waitFor(() => expect(screen.queryByText('dev@example.com')).toBeNull());
    expect(server.splits.get('trip')!.invites).toEqual([]);
  });
});

async function renameTo(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getAllByRole('button', { name: 'More' })[0]);
  await user.click(await screen.findByRole('menuitem', { name: 'Split settings' }));
  const form = await screen.findByRole('dialog');
  const field = within(form).getByRole('textbox', { name: 'Name' });
  await user.clear(field);
  await user.type(field, name);
  await user.click(within(form).getByRole('button', { name: 'Save' }));
}
