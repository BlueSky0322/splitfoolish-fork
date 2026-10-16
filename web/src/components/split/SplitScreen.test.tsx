// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import {
  fakeServer,
  item,
  liveRoom,
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
    // Ryan paid 90 and Ann 30, split evenly: Ann owes Ryan 30, the one transfer
    const settling = screen.getByText('Who pays who').closest('section')!;
    const transfer = within(settling).getByText(/^(Ann pays|Ryan pays|You pay) (Ann|Ryan)$/);
    expect(transfer.textContent).toBe('Ann pays Ryan');
    expect(within(transfer.parentElement!).getByText(/^RM\s?30\.00$/)).toBeTruthy();
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
    // Listening at the split's own live endpoint, in its room
    await waitFor(() => expect(liveRoom('trip')).toHaveLength(1));
    expect(new URL(liveRoom('trip')[0].url).pathname).toBe('/api/splits/trip/ws');

    server.splits.get('trip')!.items.push(item({ id: 'hotel', name: 'Hotel', cost: 200 }));
    liveRoom('trip')[0].hear({ type: 'changed', by: 'someone-else' });
    expect(await screen.findByText('Hotel')).toBeTruthy();
  });

  test('lets go of the live connection while offline, even one that has not opened yet', async () => {
    let online = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    try {
      renderApp(fakeServer(trip()), '/?s=trip');
      await screen.findByText('Dinner');
      await waitFor(() => expect(liveRoom('trip')).toHaveLength(1));

      online = false;
      window.dispatchEvent(new Event('offline'));
      expect(liveRoom('trip')).toHaveLength(0);
      // Back for a moment, and gone again before the new connection opens
      online = true;
      window.dispatchEvent(new Event('online'));
      online = false;
      window.dispatchEvent(new Event('offline'));
      expect(liveSockets()).toHaveLength(2);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(liveSockets().map((socket) => socket.readyState)).toEqual([3, 3]);

      // Back for good: one connection, to the same room
      online = true;
      window.dispatchEvent(new Event('online'));
      await waitFor(() => expect(liveRoom('trip')).toHaveLength(1));
      expect(liveSockets()).toHaveLength(3);
    } finally {
      // The browser's own answer again
      delete (navigator as { onLine?: boolean }).onLine;
    }
  });

  test('says so when someone removes you from the split while it is open', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    await screen.findByText('Dinner');
    await waitFor(() => expect(liveRoom('trip')).toHaveLength(1));

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
    await waitFor(() => expect(liveRoom('trip')).toHaveLength(1));

    liveSockets().at(-1)!.close(1006);
    // Missed while disconnected
    server.splits.get('trip')!.items.push(item({ id: 'hotel', name: 'Hotel', cost: 200 }));
    // The first retry waits a second, and joins the same room
    await waitFor(() => expect(liveRoom('trip')).toHaveLength(1), { timeout: 3000 });
    expect(liveSockets()).toHaveLength(2);
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
    swipe(tabContent('Ann pays Ryan'), [
      [300, 400],
      [280, 401],
      [100, 410],
    ]);
    expect(selectedTab()).toBe('Photos');
    expect(await screen.findByText(/No photos yet/)).toBeTruthy();
  });

  test("on a phone, the split's menu is a sheet", async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    const more = await screen.findByRole('button', { name: 'More' });
    await waitFor(() => expect(more.hasAttribute('disabled')).toBe(false));
    await user.click(more);
    const menu = await screen.findByRole('dialog');
    expect(within(menu).getByText('People')).toBeTruthy();
    expect(within(menu).getByText('Split settings')).toBeTruthy();
  });

  test('on a phone, only a long sideways swipe moves between tabs', async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'phone' });
    await screen.findByText('Dinner');

    // Scrolling down the list: decided by the first move, so drifting sideways after
    // doesn't turn it into a swipe
    swipe(tabContent('Dinner'), [
      [300, 400],
      [298, 380],
      [150, 390],
    ]);
    expect(selectedTab()).toBe('Items');
    // Sideways, but too short
    swipe(tabContent('Dinner'), [
      [300, 400],
      [280, 400],
      [250, 401],
    ]);
    expect(selectedTab()).toBe('Items');
    // Long enough: on to Settle up, and back again the other way
    swipe(tabContent('Dinner'), [
      [300, 400],
      [280, 400],
      [200, 402],
    ]);
    expect(selectedTab()).toBe('Settle up');
    expect(await screen.findByText('Ann pays Ryan')).toBeTruthy();
    swipe(tabContent('Ann pays Ryan'), [
      [100, 400],
      [120, 400],
      [300, 398],
    ]);
    expect(selectedTab()).toBe('Items');
    expect(await screen.findByText('Dinner')).toBeTruthy();
  });

  test('on a phone, swiping does nothing while picking items', async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'phone' });
    // A long press on an item starts picking
    fireEvent.pointerDown(await screen.findByText('Taxi'), {
      pointerType: 'touch',
      clientX: 50,
      clientY: 300,
    });
    const bar = await screen.findByRole('toolbar', { name: 'Selected items' });
    expect(within(bar).getByText('1 selected')).toBeTruthy();

    swipe(tabContent('Dinner'), [
      [300, 400],
      [280, 400],
      [100, 405],
    ]);
    expect(selectedTab()).toBe('Items');
    expect(screen.getByText('Dinner')).toBeTruthy();
    expect(screen.queryByText('Ann pays Ryan')).toBeNull();
  });

  test('on a computer, sorts items from the toolbar, either way round', async () => {
    renderApp(fakeServer(trip()), '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Taxi');
    const names = () => screen.getAllByText(/^(Dinner|Taxi)$/).map((el) => el.textContent);
    await user.click(screen.getByRole('button', { name: /^Sort: / }));
    await user.click(await screen.findByRole('menuitem', { name: 'Amount' }));
    await waitFor(() => expect(names()).toEqual(['Dinner', 'Taxi']));
    await user.click(screen.getByRole('button', { name: 'Sort: Amount, Largest first' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Smallest first' }));
    await waitFor(() => expect(names()).toEqual(['Taxi', 'Dinner']));
  });

  test('on a phone, an item duplicates from its own sheet, keeping its date', async () => {
    const server = fakeServer(trip());
    const taxi = structuredClone(server.splits.get('trip')!.items[1]);
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Taxi'));
    const detail = await screen.findByRole('dialog');
    await user.click(within(detail).getByRole('button', { name: 'Duplicate item' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Keep its date' }));

    // A new item, the same as the original down to when it was bought
    await waitFor(() => expect(server.splits.get('trip')!.items).toHaveLength(3));
    const copy = server.splits.get('trip')!.items[2];
    expect(copy.id).not.toBe(taxi.id);
    expect(copy).toEqual({ ...taxi, id: copy.id });
    expect(server.splits.get('trip')!.items[1]).toEqual(taxi);
    expect(await screen.findAllByText('Taxi')).toHaveLength(2);
  });

  test('on a computer, an item duplicates from the form, dated today', async () => {
    const server = fakeServer(trip());
    const taxi = structuredClone(server.splits.get('trip')!.items[1]);
    const before = Date.now();
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Taxi'));
    const form = await screen.findByRole('dialog');
    await user.click(within(form).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Dated today' }));

    await waitFor(() => expect(server.splits.get('trip')!.items).toHaveLength(3));
    const copy = server.splits.get('trip')!.items[2];
    expect(copy.id).not.toBe(taxi.id);
    expect(copy.createdAt).toBeGreaterThanOrEqual(before);
    expect(copy).toEqual({ ...taxi, id: copy.id, createdAt: copy.createdAt });
  });

  test('on a phone, the item form has no menu of its own', async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Taxi'));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Edit item' }),
    );
    expect(await screen.findByText('Edit item')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  test('on a phone, an item opens as it stands, with Edit a tap away', async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Taxi'));
    const detail = await screen.findByRole('dialog');
    expect(within(detail).getByText('Ann paid')).toBeTruthy();
    expect(within(detail).getAllByText('15.00')).toHaveLength(2);

    await user.click(within(detail).getByRole('button', { name: 'Edit item' }));
    expect(await screen.findByText('Edit item')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveProperty('value', '30');
  });

  test('on a phone, the item sheet shows who it is split between and asks before losing an entry', async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    const sheet = await screen.findByRole('dialog');
    await user.type(within(sheet).getByRole('textbox', { name: 'Amount' }), '50');
    await user.type(within(sheet).getByRole('textbox', { name: 'What it was for' }), 'Snacks');
    expect(within(sheet).getByText('2 of 2 people, RM 25.00 each')).toBeTruthy();

    // Tapping someone leaves them out
    await user.click(within(sheet).getByRole('checkbox', { name: 'Ann' }));
    expect(within(sheet).getByText('Not in')).toBeTruthy();
    expect(within(sheet).getByText('1 of 2 people, RM 50.00 each')).toBeTruthy();

    // Exact amounts that don't add up yet can't be added
    await user.click(within(sheet).getByText('Exact'));
    expect(within(sheet).getByText('RM 50.00 left of RM 50.00')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Add item' })).toHaveProperty(
      'disabled',
      true,
    );

    // Back asks first; Keep editing keeps it all
    window.history.back();
    expect(await screen.findByText('Discard this item?')).toBeTruthy();
    expect(screen.getByText("You've entered an amount and a name.")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByText('Discard this item?')).toBeNull());
    expect(within(sheet).getByRole('textbox', { name: 'Amount' })).toHaveProperty('value', '50');

    // Asked again, Discard closes both and takes their entries off together
    window.history.back();
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.search).toBe('?s=trip');
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

/** A finger on `el`, moving through `points` ([x, y]) and lifted at the last */
function swipe(el: Element, points: [number, number][]) {
  const at = ([clientX, clientY]: [number, number]) => [{ clientX, clientY }];
  fireEvent.touchStart(el, { touches: at(points[0]) });
  for (const point of points.slice(1)) fireEvent.touchMove(el, { touches: at(point) });
  fireEvent.touchEnd(el, { changedTouches: at(points[points.length - 1]) });
}

/** Under the tabs on a phone, where `shown` is: what's swiped */
const tabContent = (shown: string) => screen.getByText(shown).closest('[class*=_content_]')!;

const selectedTab = () => screen.getByRole('tab', { selected: true }).textContent;

async function renameTo(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getAllByRole('button', { name: 'More' })[0]);
  await user.click(await screen.findByRole('menuitem', { name: 'Split settings' }));
  const form = await screen.findByRole('dialog');
  const field = within(form).getByRole('textbox', { name: 'Name' });
  await user.clear(field);
  await user.type(field, name);
  await user.click(within(form).getByRole('button', { name: 'Save' }));
}
