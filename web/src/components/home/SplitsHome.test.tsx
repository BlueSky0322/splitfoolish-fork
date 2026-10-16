// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, onTestFinished, test, vi } from 'vitest';
import type { MyInvite } from '@shared/api';
import {
  fakeServer,
  holdNext,
  item,
  renderApp,
  splitDetail,
  setupAppTests,
} from '../../testing/app';

setupAppTests();

describe('My splits', () => {
  test.each([
    ['on a computer', 'desktop'],
    ['on a phone', 'phone'],
  ] as const)('holds the place of your splits %s until they arrive', async (_where, size) => {
    const server = fakeServer(splitDetail('trip'));
    const held = holdNext(server, 'GET', '/api/splits');
    renderApp(server, '/', { size });

    expect((await screen.findAllByText('Loading your splits')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Trip')).toBeNull();

    held.release();
    expect(await screen.findByText('Trip')).toBeTruthy();
    expect(screen.queryAllByText('Loading your splits')).toHaveLength(0);
  });

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

  test('on a phone, tap and hold a split to drag it into your own order, which is saved', async () => {
    const server = fakeServer(splitDetail('trip'));
    for (const [id, name] of [
      ['alps', 'Alps'],
      ['zurich', 'Zurich'],
    ]) {
      server.splits.set(id, { ...splitDetail(id), name });
    }
    renderApp(server, '/', { size: 'phone' });
    await screen.findByText('Zurich', {}, { timeout: 3000 });
    const order = () => screen.getAllByText(/^(Trip|Alps|Zurich)$/).map((el) => el.textContent);
    // Your order is where splits start, and where they can be moved
    expect(order()).toEqual(['Trip', 'Alps', 'Zurich']);
    const rows = layOutRows(['Trip', 'Alps', 'Zurich']);

    // Held, then dragged down past Zurich
    const trip = screen.getByText('Trip').closest('button')!;
    fireEvent.touchStart(trip, { touches: [{ clientX: 100, clientY: rows.center(0) }] });
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (const y of [rows.center(1), rows.center(2), rows.center(2) + 10]) {
      fireEvent.touchMove(trip, { touches: [{ clientX: 100, clientY: y }] });
    }
    // Touches stay with what the finger first touched, wherever it moves
    fireEvent.touchEnd(trip, { changedTouches: [{ clientX: 100, clientY: rows.center(2) }] });

    await waitFor(() => expect(order()).toEqual(['Alps', 'Zurich', 'Trip']));
    await waitFor(() => expect([...server.splits.keys()]).toEqual(['alps', 'zurich', 'trip']));
    // Still on My splits: the drop didn't open the split
    expect(window.location.search).toBe('');
  });

  test('on a phone, a quick swipe still shows Archive rather than dragging', async () => {
    renderApp(fakeServer(splitDetail('trip')), '/', { size: 'phone' });
    const row = (await screen.findByText('Trip', {}, { timeout: 3000 })).closest('button')!;
    fireEvent.touchStart(row, { touches: [{ clientX: 300, clientY: 34 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 120, clientY: 38 }] });
    fireEvent.touchEnd(row);
    expect(await screen.findByRole('button', { name: 'Archive' })).toBeTruthy();
  });

  test('on a phone, search finds items and splits by name, and opens what you tap', async () => {
    const server = fakeServer(
      splitDetail('trip', [
        item({ id: 'ramen', name: 'Ichiran ramen', cost: 30 }),
        item({ id: 'taxi', name: 'Taxi', cost: 12 }),
      ]),
    );
    server.splits.set('tokyo', {
      ...splitDetail('tokyo', [
        item({ id: 'bar', name: 'Ramen bar', cost: 45 }),
        item({ id: 'hotel', name: 'Hotel', cost: 400 }),
      ]),
      name: 'Tokyo',
    });
    renderApp(server, '/', { size: 'phone' });
    const user = userEvent.setup();
    await screen.findByText('Tokyo', {}, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const search = screen.getByRole('textbox', { name: 'Search' });

    // Items from every split whose name matches, with the split each is in; no split is
    // called anything like it
    await user.type(search, 'ram');
    expect(await screen.findByRole('heading', { name: 'Items', level: 2 })).toBeTruthy();
    expect(results('Items')).toEqual([
      expect.stringMatching(/^Ichiran ramenTrip, .*30\.00$/),
      expect.stringMatching(/^Ramen barTokyo, .*45\.00$/),
    ]);
    expect(screen.queryByRole('heading', { name: 'Splits', level: 2 })).toBeNull();

    // Splits by name, and no items when none match
    await user.clear(search);
    await user.type(search, 'tri');
    expect(await screen.findByRole('heading', { name: 'Splits', level: 2 })).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Items', level: 2 })).toBeNull(),
    );
    expect(results('Splits')).toEqual([expect.stringMatching(/Trip2 people$/)]);

    // Tapping an item opens the split it's in
    await user.clear(search);
    await user.type(search, 'bar');
    await screen.findByRole('heading', { name: 'Items', level: 2 });
    await user.click(screen.getByRole('button', { name: /^Ramen bar\s*Tokyo, / }));
    await waitFor(() => expect(window.location.search).toBe('?s=tokyo'));
    expect(await screen.findByText('Hotel')).toBeTruthy();
  });

  test('on a phone, Cancel closes search', async () => {
    renderApp(fakeServer(splitDetail('trip')), '/', { size: 'phone' });
    const user = userEvent.setup();
    await screen.findByText('Trip', {}, { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'tri');
    expect(await screen.findByRole('heading', { name: 'Splits', level: 2 })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Splits', level: 1 })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Search' })).toBeNull();
  });

  test('on a phone, Invites is a tab of its own, where an invite can be declined', async () => {
    const server = fakeServer();
    server.invites = [invite('penang', 'Penang')];
    renderApp(server, '/?tab=invites', { size: 'phone' });
    const user = userEvent.setup();
    expect(await screen.findByText('Penang', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/^From Mei, /)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Decline Penang' }));
    await waitFor(() => expect(server.invites).toEqual([]));
    expect(await screen.findByText(/No invites right now/)).toBeTruthy();
    expect(server.splits.has('penang')).toBe(false);
  });

  test('on a phone, accepting an invite joins that split and opens it, leaving the others', async () => {
    const server = fakeServer();
    server.notJoined = [
      {
        ...splitDetail('penang', [item({ id: 'laksa', name: 'Laksa', cost: 20 })]),
        name: 'Penang',
      },
      { ...splitDetail('ipoh'), name: 'Ipoh' },
    ];
    server.invites = [invite('penang', 'Penang'), invite('ipoh', 'Ipoh')];
    renderApp(server, '/?tab=invites', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Accept Penang' }, { timeout: 3000 }),
    );

    await waitFor(() => expect(window.location.search).toBe('?s=penang'));
    expect(await screen.findByText('Laksa')).toBeTruthy();
    expect([...server.splits.keys()]).toEqual(['penang']);
    expect(server.invites.map((i) => i.splitId)).toEqual(['ipoh']);
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

/** An invite from Mei to a split you're not in yet */
const invite = (splitId: string, splitName: string): MyInvite => ({
  kind: 'invite',
  id: `invite-${splitId}`,
  splitId,
  splitName,
  invitedBy: 'mei@example.com',
  invitedByName: 'Mei',
  createdAt: Date.now() - 2 * 3_600_000,
  expiresAt: Date.now() + 86_400_000,
});

/** What each search result under `heading` says, in order */
const results = (heading: 'Items' | 'Splits') =>
  within(screen.getByRole('heading', { name: heading, level: 2 }).closest('section')!)
    .getAllByRole('button')
    .map((button) => button.textContent);

/**
 * Where the phone's split rows are on screen, as the browser lays them out (jsdom has no
 * layout): one under the other, 68 pixels tall, in the order of `names`
 */
function layOutRows(names: string[]) {
  const ROW = 68;
  const rowOf = (el: Element) => names.findIndex((name) => el.textContent?.includes(name));
  const measured = vi.spyOn(Element.prototype, 'getBoundingClientRect');
  onTestFinished(() => measured.mockRestore());
  measured.mockImplementation(function (this: Element) {
    // The rows themselves (each holds one split's button), and the list around them
    const at = this.parentElement?.children.length === names.length ? rowOf(this) : -1;
    if (at >= 0) return new DOMRect(0, at * ROW, 390, ROW);
    if ([...this.children].some((child) => rowOf(child) >= 0)) {
      return new DOMRect(0, 0, 390, names.length * ROW);
    }
    // Everything else, as jsdom measures it
    return new DOMRect();
  });
  return { center: (i: number) => i * ROW + ROW / 2 };
}
