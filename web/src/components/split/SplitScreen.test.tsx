// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import 'fake-indexeddb/auto';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import {
  fakeServer,
  item,
  liveRoom,
  liveSockets,
  person,
  readsAs,
  renderApp,
  setupAppTests,
  splitDetail,
} from '../../testing/app';
import { LIVE_REMOVED_CODE } from '@shared/api';
import { CONVERT_POLL_MS } from '../../split/useSplit';

setupAppTests();

const trip = () =>
  splitDetail('trip', [
    item({ id: 'dinner', name: 'Dinner', cost: 90 }),
    item({ id: 'taxi', name: 'Taxi', cost: 30, payerId: 'ann' }),
  ]);

describe('the split page', () => {
  // Adds Snacks from the item form, for the amount typed
  const addSnacks = async (user: ReturnType<typeof userEvent.setup>, amount = '16') => {
    await user.click(screen.getAllByRole('button', { name: /^Add item$/ })[0]);
    const form = await screen.findByRole('dialog');
    await user.type(within(form).getByRole('textbox', { name: 'What it was for' }), 'Snacks');
    await user.type(within(form).getByRole('textbox', { name: 'Amount' }), amount);
    await user.click(within(form).getByRole('button', { name: /^(Add|Add item)$/ }));
  };

  test('shows the items and who owes whom', async () => {
    renderApp(fakeServer(trip()), '/?s=trip');
    expect(await screen.findByText('Dinner')).toBeTruthy();
    expect(screen.getByText('Taxi')).toBeTruthy();
    // Ryan paid 90 and Ann 30, split evenly: Ann owes Ryan 30, the one transfer
    const settling = screen.getByText('Who pays who').closest('section')!;
    const transfer = within(settling).getByText(
      readsAs(/^(Ann pays|Ryan pays|You pay) (Ann|Ryan)$/),
    );
    expect(transfer.textContent).toBe('Ann pays Ryan');
    // The amount is on the row's first line, above the names
    const row = transfer.parentElement!.parentElement!;
    expect(within(row).getByText(/^RM\s?30\.00$/)).toBeTruthy();
  });

  test('an item for one person says who paid for whom, or that it was their own', async () => {
    const server = fakeServer(
      splitDetail('trip', [
        item({ id: 'gift', name: 'Gift', cost: 40, participantIds: ['ann'] }),
        item({ id: 'socks', name: 'Socks', cost: 15, participantIds: ['me'] }),
        item({ id: 'taxi', name: 'Taxi', cost: 30 }),
      ]),
    );
    renderApp(server, '/?s=trip');
    const gift = (await screen.findByText('Gift')).closest('button')!;
    expect(within(gift).getByText(readsAs('Ryan paid for Ann'))).toBeTruthy();
    const socks = screen.getByText('Socks').closest('button')!;
    expect(within(socks).getByText(readsAs("Ryan's own"))).toBeTruthy();
    expect(within(socks).queryByText(/between|paid for/)).toBeNull();
    // Shared ones say how
    const taxi = screen.getByText('Taxi').closest('button')!;
    expect(within(taxi).queryByText(readsAs(/paid for/))).toBeNull();
  });

  test("your share shows only on items you're on", async () => {
    const items = () =>
      splitDetail('trip', [
        item({ id: 'gift', name: 'Gift', cost: 40, payerId: 'ann', participantIds: ['ann'] }),
        item({ id: 'socks', name: 'Socks', cost: 15, participantIds: ['me'] }),
      ]);
    renderApp(fakeServer(items()), '/?s=trip');
    const giftRow = (await screen.findByText('Gift')).closest('button')!.parentElement!;
    expect(within(giftRow).queryByText(/Your share/)).toBeNull();
    const socksRow = screen.getByText('Socks').closest('button')!.parentElement!;
    expect(within(socksRow).getByText(/^Your share RM\s?15\.00$/)).toBeTruthy();

    // Phones: no ", yours 0.00" on someone else's item
    cleanup();
    renderApp(fakeServer(items()), '/?s=trip', { size: 'phone' });
    const gift = (await screen.findByText('Gift')).closest('button')!;
    expect(gift.textContent).not.toMatch(/yours/);
    const socks = screen.getByText('Socks').closest('button')!;
    expect(socks.textContent).toMatch(/yours 15\.00/);

    // The table leaves the cell empty, with nothing in its place
    await userEvent.setup().click(screen.getByLabelText('Table view'));
    const giftCells = (await screen.findByText('Gift')).closest('[role="row"]')!;
    expect(giftCells.textContent).not.toContain('—');
    expect(giftCells.textContent).not.toMatch(/(^|[^4])0\.00/);
    const socksCells = screen.getByText('Socks').closest('[role="row"]')!;
    expect(socksCells.textContent).toMatch(/15\.00.*15\.00/);
  });

  test('saves a change once when its answer was lost, and what was added after it', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');
    // Saved, but the answer never comes back, so the app still has it to send
    server.loseNext.changes = true;
    await addSnacks(user);
    await waitFor(() => expect(server.sent).toHaveLength(1));
    // Something else is added; both go again, with the ids they were sent with
    await user.click(screen.getByText('Taxi'));
    const form = await screen.findByRole('dialog', { name: 'Edit item' });
    const name = within(form).getByRole('textbox', { name: 'What it was for' });
    await user.clear(name);
    await user.type(name, 'Cab');
    await user.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(
        server.splits
          .get('trip')!
          .items.map((i) => i.name)
          .sort(),
      ).toEqual(['Cab', 'Dinner', 'Snacks']),
    );
    const [first, again] = server.sent;
    expect(again.changes[0]).toEqual(first.changes[0]);
    expect(screen.queryByText(/couldn't be saved|Refused/i)).toBeNull();
  }, 15_000);

  test('adds an item typed as a sum, and sends it to the server', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');
    await addSnacks(user, '8*2');

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

  test('marks a transfer as paid, which settles it; the payment can be deleted, with Undo', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');
    const settling = screen.getByText('Who pays who').closest('section')!;
    await user.click(within(settling).getByRole('button', { name: 'Mark as paid' }));
    // Prefilled with who pays whom and how much; one tap records it
    const form = await screen.findByRole('dialog');
    expect(within(form).getByRole('textbox', { name: 'Amount' })).toHaveProperty('value', '30.00');
    await user.click(within(form).getByRole('button', { name: 'Record payment' }));

    expect(await screen.findByText('Everyone is settled up.')).toBeTruthy();
    const payments = screen.getByRole('heading', { name: 'Payments' }).closest('section')!;
    expect(within(payments).getByText(readsAs('Ann paid Ryan'))).toBeTruthy();
    expect(within(payments).getByText(/^RM\s?30\.00$/)).toBeTruthy();
    await waitFor(() =>
      expect(server.splits.get('trip')!.payments).toMatchObject([
        { fromId: 'ann', toId: 'me', amount: 30, itemId: null },
      ]),
    );

    await user.click(within(payments).getByRole('button', { name: 'Payment actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete payment' }));
    expect(await screen.findByText(readsAs('Ann pays Ryan'))).toBeTruthy();
    await waitFor(() => expect(server.splits.get('trip')!.payments).toEqual([]));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Everyone is settled up.')).toBeTruthy();
    await waitFor(() => expect(server.splits.get('trip')!.payments).toHaveLength(1));
  });

  test('moving items to another day says so, with Undo to put each back on its own date', async () => {
    const split = trip();
    split.items[1].createdAt = Date.UTC(2026, 9, 8, 12);
    const server = fakeServer(split);
    const before = server.splits.get('trip')!.items.map((i) => i.createdAt);
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Taxi');
    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByText('Dinner'));
    await user.click(screen.getByText('Taxi'));
    await user.click(screen.getByRole('button', { name: 'Change date' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByText('Yesterday'));
    await user.click(dialog.getByRole('button', { name: 'Move' }));

    expect(await screen.findByText(/^Moved 2 items to /)).toBeTruthy();
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.map((i) => i.createdAt)).not.toEqual(before),
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    // Each back on the date it had, not both on one
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.map((i) => i.createdAt)).toEqual(before),
    );
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

  test("says so when this device can't keep changes, and still saves them while open", async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');
    // Storage full: the browser gives up on each write
    const put = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'put')!
      .value as IDBObjectStore['put'];
    const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = put.apply(this, args);
      this.transaction.abort();
      return request;
    });
    await addSnacks(user);

    expect(await screen.findByText(/storage is full or blocked/)).toBeTruthy();
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.map((i) => i.name)).toContain('Snacks'),
    );

    // Room again: the next change is kept, and the notice goes
    write.mockRestore();
    await addSnacks(user);
    await waitFor(() => expect(screen.queryByText(/storage is full or blocked/)).toBeNull());
  });

  test('while the items are being converted, checks on them only while the app is on screen', async () => {
    // Intervals only, set before the page starts checking; timeouts stay real, for waitFor
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const split = trip();
    split.converting = true;
    renderApp(fakeServer(split), '/?s=trip');
    await screen.findByText('Dinner');
    const loads = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(([url, init]) => url === '/api/splits/trip' && init?.method === 'GET')
        .length;
    const show = async (state: 'visible' | 'hidden') => {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      // Async, so the check it starts is under way before looking for it
      await act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        return Promise.resolve();
      });
    };
    onTestFinished(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });
    const tick = () => act(() => vi.advanceTimersByTime(CONVERT_POLL_MS));

    // On screen, it checks every few seconds
    const start = loads();
    await tick();
    await waitFor(() => expect(loads()).toBeGreaterThan(start));

    // In the background, it doesn't
    await show('hidden');
    const before = loads();
    await tick();
    await tick();
    expect(loads()).toBe(before);

    // Back: checks straight away
    await show('visible');
    await waitFor(() => expect(loads()).toBeGreaterThan(before));
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
      {
        id: 'receipt',
        itemId: 'taxi',
        size: 1,
        contentType: 'image/jpeg',
        uploadedBy: 'ryan@example.com',
        createdAt: 1,
      },
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
    expect(await screen.findByText(readsAs('Ann pays Ryan'))).toBeTruthy();
    expect(screen.queryByText('Dinner')).toBeNull();

    // A swipe moves on to the next tab
    swipe(tabContent('Ann pays Ryan'), [
      [300, 400],
      [280, 401],
      [100, 410],
    ]);
    expect(selectedTab()).toBe('Photos');
    expect(await screen.findByRole('button', { name: 'Take photo' })).toBeTruthy();
  });

  test('on a phone, the item sheet records who paid their part back, and the Payments page lists it', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Dinner'));
    const detail = await screen.findByRole('dialog');
    await user.click(within(detail).getByRole('button', { name: 'Ann paid back' }));
    // Her part of the dinner, for the dinner, to Ryan who paid: 45, but she owes only 30
    // overall (she paid for the taxi), so 30
    const save = await screen.findByRole('button', { name: 'Record payment' });
    const form = save.closest('form')!;
    expect(within(form).getByRole('textbox', { name: 'Amount' })).toHaveProperty('value', '30.00');
    expect(within(form).getByText('For Dinner')).toBeTruthy();
    await user.click(save);
    await waitFor(() =>
      expect(server.splits.get('trip')!.payments).toMatchObject([
        { fromId: 'ann', toId: 'me', amount: 30, itemId: 'dinner' },
      ]),
    );

    // Every payment, on a page of its own from the menu; Back returns to the split
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(within(await screen.findByRole('dialog')).getByText('Payments'));
    expect(await screen.findByRole('heading', { name: 'Payments' })).toBeTruthy();
    expect(window.location.search).toBe('?s=trip&payments');
    expect(screen.getByText(readsAs('Ann paid Ryan'))).toBeTruthy();
    expect(screen.getByText(/for Dinner/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back to Trip' }));
    await waitFor(() => expect(window.location.search).toBe('?s=trip'));
    expect(await screen.findByText('Dinner')).toBeTruthy();
  });

  test('Paid back is offered only to someone who still owes money, and becomes a tag once paid', async () => {
    // Ryan paid 90 for dinner, Ann 20 for the taxi: Ryan is owed 35 overall, Ann owes 35
    const owed = () =>
      splitDetail('trip', [
        item({ id: 'dinner', name: 'Dinner', cost: 90 }),
        item({ id: 'taxi', name: 'Taxi', cost: 20, payerId: 'ann' }),
      ]);
    const server = fakeServer(owed());
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    const open = async (name: string) => {
      await user.click(await screen.findByText(name));
      return within(await screen.findByRole('dialog'));
    };
    const close = async () => {
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    };

    // Ryan's 10 of the taxi is already in what he's owed: nothing to pay back
    const taxi = await open('Taxi');
    expect(taxi.getByRole('list', { name: "Each person's part" }).textContent).toContain('Ryan');
    expect(taxi.queryByRole('button', { name: /paid back$/ })).toBeNull();
    await close();

    // Ann's 45 of the dinner, up to the 35 she owes
    await user.click((await open('Dinner')).getByRole('button', { name: 'Ann paid back' }));
    const save = await screen.findByRole('button', { name: 'Record payment' });
    expect(within(save.closest('form')!).getByRole('textbox', { name: 'Amount' })).toHaveProperty(
      'value',
      '35.00',
    );
    await user.click(save);
    await waitFor(() =>
      expect(server.splits.get('trip')!.payments).toMatchObject([{ fromId: 'ann', amount: 35 }]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Settled now: her part says it was paid back, with nothing more to record
    const parts = (await open('Dinner')).getByRole('list', { name: "Each person's part" });
    const ann = within(parts)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Ann'))!;
    expect(within(ann).getByText('Paid back')).toBeTruthy();
    expect(within(ann).queryByRole('button')).toBeNull();
  });

  test("on a computer, Record payment is in an item's menu only while someone on it owes money", async () => {
    renderApp(
      fakeServer(
        splitDetail('trip', [
          item({ id: 'dinner', name: 'Dinner', cost: 90 }),
          item({ id: 'taxi', name: 'Taxi', cost: 20, payerId: 'ann' }),
        ]),
      ),
      '/?s=trip',
    );
    const user = userEvent.setup();
    const menuOf = async (name: string) => {
      await user.click(await screen.findByText(name));
      await user.click(within(await screen.findByRole('dialog')).getByLabelText('More actions'));
      return (await screen.findAllByRole('menuitem')).map((m) => m.textContent);
    };
    // Only Ryan shares the taxi with Ann who paid, and he is owed money
    expect(await menuOf('Taxi')).not.toContain('Record payment');
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await menuOf('Dinner')).toContain('Record payment');
  });

  test('web addresses in notes open as short links: in the item sheet on a phone, from the form on desktop', async () => {
    const noted = () =>
      splitDetail('trip', [
        item({
          id: 'dinner',
          name: 'Dinner',
          cost: 90,
          notes: 'Menu at https://example.com/menu, booked under Ryan',
        }),
      ]);
    renderApp(fakeServer(noted()), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Dinner'));
    const sheet = await screen.findByRole('dialog');
    // Read as where it goes, without https://
    const link = within(sheet).getByRole('link', { name: 'example.com/menu' });
    expect(sheet.textContent).not.toContain('https://');
    // The address alone, not the comma after it, in a new tab
    expect(link.getAttribute('href')).toBe('https://example.com/menu');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(sheet.textContent).toContain(', booked under Ryan');

    // Desktop reads notes in the form: the address is offered under them
    cleanup();
    renderApp(fakeServer(noted()), '/?s=trip');
    await user.click(await screen.findByText('Dinner'));
    const form = await screen.findByRole('dialog');
    expect(within(form).getByRole('textbox', { name: 'Notes' })).toHaveProperty(
      'value',
      'Menu at https://example.com/menu, booked under Ryan',
    );
    const chip = within(form).getByRole('link', { name: 'example.com/menu' });
    expect(chip.getAttribute('href')).toBe('https://example.com/menu');
    expect(chip.getAttribute('target')).toBe('_blank');
  });

  test('Google Maps links in notes show as cards with the place, on a phone and on desktop', async () => {
    const APW = 'https://maps.app.goo.gl/apw123';
    const OTHER = 'https://maps.app.goo.gl/unknown';
    const PIN = 'https://goo.gl/maps/pin123';
    // Shared from Google: a place it names, and something that isn't a place
    const SHARED = 'https://share.google/kopi168';
    const NOT_PLACE = 'https://share.google/article';
    const server = () => {
      const s = fakeServer(
        splitDetail('trip', [
          item({
            id: 'coffee',
            name: 'Coffee',
            cost: 30,
            notes: `Met at ${APW} then ${OTHER}, parked at ${PIN}, menu at https://example.com/menu, coffee at ${SHARED} ${NOT_PLACE}`,
          }),
        ]),
      );
      s.linkPreviews.set(APW, {
        title: 'A Place Where - APW',
        address: '29, Jalan Riong, Bangsar, 59100 Kuala Lumpur',
        detail: null,
        image: 'https://lh5.googleusercontent.com/p/apw',
        site: 'maps.app.goo.gl',
        position: { lat: 3.1297, lng: 101.6744 },
      });
      // A dropped pin: named by OpenStreetMap, with no picture of its own
      s.linkPreviews.set(PIN, {
        title: 'Jalan Sungai Besar, Sabak Bernam',
        address: 'Dropped pin',
        detail: null,
        image: null,
        site: 'goo.gl',
        position: { lat: 3.88166, lng: 100.80379 },
      });
      s.linkPreviews.set(SHARED, {
        title: 'Kedai Kopi 168',
        address: null,
        detail: null,
        image: null,
        site: 'share.google',
        position: null,
      });
      return s;
    };
    const user = userEvent.setup();
    const cardsIn = async (where: HTMLElement) => {
      // The place once Google has said what it is; a link it says nothing about stays a pin
      const card = await within(where).findByRole('link', {
        name: 'A Place Where - APW, on Google Maps',
      });
      expect(card.getAttribute('href')).toBe(APW);
      expect(card.getAttribute('target')).toBe('_blank');
      expect(within(card).getByText('29, Jalan Riong, Bangsar, 59100 Kuala Lumpur')).toBeTruthy();
      expect(card.querySelector('img')!.getAttribute('src')).toBe(
        'https://lh5.googleusercontent.com/p/apw',
      );
      const plain = within(where).getByRole('link', { name: 'Open in Google Maps' });
      expect(plain.getAttribute('href')).toBe(OTHER);
      // The pin shows a small map of where it is, centred on its tile
      const pin = within(where).getByRole('link', {
        name: 'Jalan Sungai Besar, Sabak Bernam, on Google Maps',
      });
      expect(pin.getAttribute('href')).toBe(PIN);
      expect(within(pin).getByText('Dropped pin')).toBeTruthy();
      expect(within(pin).getByText('© OpenStreetMap')).toBeTruthy();
      expect([...pin.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toContain(
        'https://tile.openstreetmap.org/16/51118/32060.png',
      );
      // A place shared from Google is a card with its name; anything else shared, none
      const shared = within(where).getByRole('link', { name: 'Kedai Kopi 168, on Google Maps' });
      expect(shared.getAttribute('href')).toBe(SHARED);
      await waitFor(() =>
        expect(
          [...where.querySelectorAll('a')].filter(
            (a) => a.getAttribute('href') === NOT_PLACE && a.getAttribute('aria-label'),
          ),
        ).toEqual([]),
      );
    };

    renderApp(server(), '/?s=trip', { size: 'phone' });
    await user.click(await screen.findByText('Coffee'));
    const sheet = await screen.findByRole('dialog');
    await cardsIn(sheet);
    // In the text, a Maps link reads as its place, other addresses as where they go
    const notes = sheet.querySelector('p')!;
    expect(notes.textContent).toBe(
      'Met at A Place Where - APW then maps.app.goo.gl/unknown, parked at Jalan Sungai Besar, Sabak Bernam, menu at example.com/menu, coffee at Kedai Kopi 168 share.google/article',
    );
    expect(
      within(notes).getByRole('link', { name: 'A Place Where - APW' }).getAttribute('href'),
    ).toBe(APW);
    expect(within(notes).getByRole('link', { name: 'example.com/menu' })).toBeTruthy();

    // Desktop: the cards under the notes, and only the other address in the list of links
    cleanup();
    renderApp(server(), '/?s=trip');
    await user.click(await screen.findByText('Coffee'));
    const form = await screen.findByRole('dialog');
    await cardsIn(form);
    expect(within(form).queryByRole('link', { name: APW })).toBeNull();
    expect(within(form).getByRole('link', { name: 'example.com/menu' })).toBeTruthy();
  });

  test('the owner links a guest to a member, taking the account off the person it joined as', async () => {
    // Ann joined under her account after the owner had added her as a guest
    const detail = splitDetail('trip', [item({ id: 'dinner', name: 'Dinner', cost: 90 })]);
    detail.members.push({
      email: 'ann@example.com',
      role: 'editor',
      displayName: 'Ann Lee',
      avatarVersion: null,
      paymentMethods: [],
    });
    detail.people.push(person('ann2', 'Ann Lee', 'ann@example.com'));
    const server = fakeServer(detail);
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit people' }));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByText('Ann'));
    expect(within(sheet).getByText('Guest, without an account')).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: 'Link to an account' }));
    const choices = within(sheet).getByRole('group', { name: 'Link to an account' });
    // The member is offered with where the account is now
    const annLee = within(choices).getByRole('button', { name: /Ann Lee.*now Ann Lee/ });
    await user.click(annLee);
    // The guest is now that account, named by it, and the person she joined as is a guest
    expect(within(sheet).getByText('ann@example.com')).toBeTruthy();
    await waitFor(() =>
      expect(server.splits.get('trip')!.people.map((p) => [p.id, p.name, p.memberEmail])).toEqual([
        ['me', 'Ryan', 'ryan@example.com'],
        ['ann', 'Ann Lee', 'ann@example.com'],
        ['ann2', 'Ann Lee', null],
      ]),
    );
    // Someone with an account isn't offered the option
    expect(within(sheet).queryByRole('button', { name: 'Link to an account' })).toBeNull();
  });

  test('Settle up shows where the money went, by category or by person, and a slice opens in detail', async () => {
    const spent = () =>
      splitDetail('trip', [
        item({ id: 'dinner', name: 'Dinner', cost: 90, category: 'food' }),
        item({ id: 'taxi', name: 'Taxi', cost: 30, category: 'transport', payerId: 'ann' }),
        item({
          id: 'snacks',
          name: 'Snacks',
          cost: 12.5,
          category: 'food',
          participantIds: ['ann'],
        }),
      ]);
    renderApp(fakeServer(spent()), '/?s=trip');
    const user = userEvent.setup();
    const spending = (await screen.findByText('Spending')).closest('section')!;
    const middle = () => within(spending).getByRole('status').textContent;
    // The whole in the middle, then each category as a row with its amount and share
    expect(middle()).toBe('132.50MYR · 3 items');
    const slices = within(spending).getByRole('group', { name: 'Slices' });
    const rows = () =>
      within(slices)
        .getAllByRole('button')
        .filter((b) => b.hasAttribute('aria-expanded'))
        .map((r) => r.textContent);
    expect(rows()).toEqual(['FoodRM 102.5077%', 'TransportRM 30.0023%']);

    // Tapping a row holds it in the middle and opens it in detail: who paid for it,
    // then its items, largest first
    const food = within(slices).getByRole('button', { name: /^Food/ });
    await user.click(food);
    expect(food.getAttribute('aria-expanded')).toBe('true');
    expect(middle()).toBe('102.50Food77%');
    const details = within(spending).getByRole('region', { name: 'Food in detail' });
    expect(within(details).getByText('All paid by Ryan')).toBeTruthy();
    const parts = () =>
      within(within(details).getByRole('list', { name: 'Food items' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent);
    expect(parts()).toEqual([
      expect.stringMatching(/^Dinner.+RM\s?90\.00$/),
      expect.stringMatching(/^Snacks.+RM\s?12\.50$/),
    ]);
    // An item in it opens, as from the list
    await user.click(within(details).getByRole('button', { name: /^Dinner/ }));
    const form = await screen.findByRole('dialog');
    expect(within(form).getByRole('textbox', { name: 'What it was for' })).toHaveProperty(
      'value',
      'Dinner',
    );
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Tapping it again closes it, and the whole comes back once the pointer leaves
    await user.click(food);
    expect(within(spending).queryByRole('region', { name: 'Food in detail' })).toBeNull();
    await user.unhover(food);
    expect(middle()).toBe('132.50MYR · 3 items');
    // The ring's slices say the same, for a screen reader
    const ring = within(spending).getByRole('group', { name: 'Spending by categories' });
    expect(
      within(ring)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Food, RM 102.50, 77%', 'Transport, RM 30.00, 23%']);

    // By who paid: a person in detail is their spending by category
    await user.click(within(spending).getByRole('radio', { name: 'Paid by' }));
    expect(rows()).toEqual(['RyanRM 102.5077%', 'AnnRM 30.0023%']);
    await user.click(within(slices).getByRole('button', { name: /^Ann/ }));
    const ann = within(spending).getByRole('region', { name: 'Ann in detail' });
    expect(within(ann).getByText('By category').parentElement!.textContent).toBe(
      'By categoryTransport RM 30.00',
    );
    // By whose share it was: each item at their part of it, out of what it cost
    await user.click(within(spending).getByRole('radio', { name: 'Shares' }));
    // Ann: 45 + 15 + 12.50; Ryan: 45 + 15
    expect(rows()).toEqual(['AnnRM 72.5055%', 'RyanRM 60.0045%']);
    await user.click(within(slices).getByRole('button', { name: /^Ann/ }));
    const share = within(spending).getByRole('region', { name: 'Ann in detail' });
    expect(within(share).getByText(/Food · of RM\s?90\.00/)).toBeTruthy();
    expect(within(share).getByText('By category').parentElement!.textContent).toBe(
      'By categoryFood RM 57.50Transport RM 15.00',
    );
  });

  test('the share image shows where the money went, and gives up the item list first when full', async () => {
    renderApp(
      fakeServer(
        splitDetail('trip', [
          item({ id: 'dinner', name: 'Dinner', cost: 90, category: 'food' }),
          item({ id: 'taxi', name: 'Taxi', cost: 30, category: 'transport', payerId: 'ann' }),
        ]),
      ),
      '/?s=trip',
    );
    // A card is too tall while it lists the items; without them it fits
    const tall = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.textContent?.includes('Taxi') ? 2000 : 1000;
      });
    onTestFinished(() => tall.mockRestore());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Share as image' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share as image' });
    const card = within(dialog).getByText('Who pays who').parentElement!;
    // Each category with its amount and share of the whole, the total in the middle
    const legend = within(card).getByText('Food').parentElement!.parentElement!;
    expect([...legend.children].map((row) => row.textContent)).toEqual([
      'FoodRM 90.0075%',
      'TransportRM 30.0025%',
    ]);
    expect(within(card).getByText('2 items')).toBeTruthy();
    // One slice of the ring for each
    expect(legend.previousElementSibling!.querySelectorAll('path')).toHaveLength(2);
    expect(within(card).queryByText('Taxi')).toBeNull();
  });

  test('a new item is Other unless a category is picked, and an item without one shows as Other', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');
    await addSnacks(user);
    await waitFor(() =>
      expect(server.splits.get('trip')!.items.find((i) => i.name === 'Snacks')).toMatchObject({
        category: 'other',
      }),
    );
    // An older item with none stored is grouped and charted as Other, never left out
    await user.click(screen.getByRole('button', { name: 'By day' }));
    await user.click(await screen.findByRole('menuitem', { name: 'By category' }));
    // One group of Other holds all three items; nothing is "Uncategorised" anywhere
    const header = (await screen.findAllByText('Other')).find((el) =>
      el.parentElement?.textContent?.startsWith('OtherRM 136.00'),
    );
    expect(header).toBeTruthy();
    expect(screen.queryByText('Uncategorised')).toBeNull();
  }, 10_000);

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
    expect(await screen.findByText(readsAs('Ann pays Ryan'))).toBeTruthy();
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
    expect(screen.queryByText(readsAs('Ann pays Ryan'))).toBeNull();
  });

  test('on a phone, Back closes a sheet opened over picked items first, then stops picking', async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    fireEvent.pointerDown(await screen.findByText('Taxi'), {
      pointerType: 'touch',
      clientX: 50,
      clientY: 300,
    });
    const bar = await screen.findByRole('toolbar', { name: 'Selected items' });
    await user.click(within(bar).getByRole('button', { name: 'Change date' }));
    await screen.findByRole('dialog');

    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const still = screen.getByRole('toolbar', { name: 'Selected items' });
    expect(within(still).getByText('1 selected')).toBeTruthy();

    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected items' })).toBeNull(),
    );
    expect(window.location.search).toBe('?s=trip');
    expect(screen.getByText('Taxi')).toBeTruthy();
  });

  test('on a tablet, Back stops picking items and stays on the split', async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'tablet' });
    fireEvent.pointerDown(await screen.findByText('Taxi'), {
      pointerType: 'touch',
      clientX: 50,
      clientY: 300,
    });
    await screen.findByRole('toolbar', { name: 'Selected items' });
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected items' })).toBeNull(),
    );
    expect(window.location.search).toBe('?s=trip');
    expect(screen.getByText('Taxi')).toBeTruthy();
  });

  test('a long press cut short by leaving the split picks nothing later', async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'phone' });
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    onTestFinished(() => {
      delete (navigator as { vibrate?: unknown }).vibrate;
    });
    const taxi = await screen.findByText('Taxi');
    vi.useFakeTimers();
    fireEvent.pointerDown(taxi, { pointerType: 'touch', clientX: 50, clientY: 300 });
    // The finger is still down when the page goes away
    cleanup();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    expect(vibrate).not.toHaveBeenCalled();
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

  test('on a phone, grouping and sorting items are picked from menus, and kept', async () => {
    const server = fakeServer(
      splitDetail('trip', [
        item({ id: 'dinner', name: 'Dinner', cost: 90, createdAt: Date.UTC(2026, 9, 10, 12) }),
        item({ id: 'taxi', name: 'Taxi', cost: 30, createdAt: Date.UTC(2026, 9, 11, 12) }),
        item({ id: 'brunch', name: 'Brunch', cost: 12, createdAt: Date.UTC(2026, 9, 12, 12) }),
      ]),
    );
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await screen.findByText('Taxi');
    const names = () => screen.getAllByText(/^(Dinner|Taxi|Brunch)$/).map((el) => el.textContent);
    const menuItems = async () =>
      (await screen.findAllByRole('menuitem')).map((el) => el.textContent);

    // Every grouping is listed, so No grouping is one tap, not three
    await user.click(screen.getByRole('button', { name: 'Group items: By day' }));
    expect(await menuItems()).toEqual([
      'No grouping',
      'By day',
      'By week',
      'By month',
      'By payer',
      'By category',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'No grouping' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Group items: No grouping' })).toBeTruthy();
    expect(names()).toEqual(['Brunch', 'Taxi', 'Dinner']);

    // Straight from Newest to A to Z, past the sorts in between
    await user.click(screen.getByRole('button', { name: 'Sort items: Newest' }));
    expect(await menuItems()).toEqual(['Newest', 'Oldest', 'Largest', 'A–Z']);
    await user.click(screen.getByRole('menuitem', { name: 'A–Z' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(await screen.findByRole('button', { name: 'Sort items: A–Z' })).toBeTruthy();
    expect(names()).toEqual(['Brunch', 'Dinner', 'Taxi']);
    // Kept with the account, as on a computer
    await waitFor(() =>
      expect(server.me.settings).toMatchObject({
        itemsGroupBy: 'none',
        itemsSortKey: 'name',
        itemsSortDir: 'asc',
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Sort items: A–Z' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Largest' }));
    expect(await screen.findByRole('button', { name: 'Sort items: Largest' })).toBeTruthy();
    expect(names()).toEqual(['Dinner', 'Taxi', 'Brunch']);
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

  test('on a phone, an item opens as it stands, with Edit a tap away and no menu in the form', async () => {
    renderApp(fakeServer(trip()), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Taxi'));
    const detail = await screen.findByRole('dialog');
    expect(within(detail).getByText(readsAs('Ann paid'))).toBeTruthy();
    expect(within(detail).getAllByText('15.00')).toHaveLength(2);

    await user.click(within(detail).getByRole('button', { name: 'Edit item' }));
    expect(await screen.findByText('Edit item')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Amount' })).toHaveProperty('value', '30');
    // Its actions are on the sheet it opened from
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
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
const tabContent = (shown: string) =>
  screen.getByText(readsAs(shown)).closest('[class*=_content_]')!;

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
