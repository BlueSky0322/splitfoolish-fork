// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Attachment } from '@shared/api';
import { photoFileNames } from '../../split/photo-download';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// A phone's Photos tab: the photos on the split's items, in the orders a computer's menu
// offers; a long press starts picking, taps add more, and the picked photos download one
// by one or are removed together

setupAppTests();

afterEach(() => {
  vi.restoreAllMocks();
});

const photo = (id: string, createdAt: number, itemId: string | null = null): Attachment => ({
  id,
  itemId,
  size: 1000,
  contentType: 'image/jpeg',
  uploadedBy: 'ryan@example.com',
  createdAt,
});

function trip() {
  const split = splitDetail('trip', [
    item({ id: 'bar', name: 'Beach bar', cost: 40, createdAt: Date.UTC(2026, 9, 11, 8) }),
    item({ id: 'dinner', name: 'Dinner', cost: 80 }),
    item({ id: 'hotel', name: 'Hotel', cost: 300, createdAt: Date.UTC(2026, 9, 9, 12) }),
  ]);
  split.attachments = [
    photo('beach', Date.UTC(2026, 9, 11, 9), 'bar'),
    photo('receipt', Date.UTC(2026, 9, 11, 13), 'dinner'),
    photo('sunset', Date.UTC(2026, 9, 10, 18), 'hotel'),
    // A photo of the split itself, on no item, from before: never shown
    photo('group', Date.UTC(2026, 9, 11, 15)),
  ];
  return split;
}

async function openPhotos(server = fakeServer(trip())) {
  renderApp(server, '/?s=trip', { size: 'phone' });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: 'Photos' }));
  await screen.findByRole('button', { name: 'Photo of Dinner' });
  return { server, user };
}

/** Holds a finger on it until picking starts */
async function longPress(el: HTMLElement) {
  fireEvent.pointerDown(el, { pointerType: 'touch', clientX: 50, clientY: 300 });
  return screen.findByRole('toolbar', { name: 'Selected photos' });
}

describe('picking photos on a phone', () => {
  test('a long press picks a photo, and taps pick more or let go', async () => {
    const { user } = await openPhotos();
    const bar = await longPress(screen.getByRole('button', { name: 'Photo of Hotel' }));
    expect(within(bar).getByText('1 selected')).toBeTruthy();
    // The bar takes the sort menu's place
    expect(screen.queryByRole('button', { name: /^Sort photos/ })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Photo of Dinner' }));
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    // A tap while picking picks, rather than opening the photo
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Photo of Dinner', checked: true }));
    await user.click(within(bar).getByRole('button', { name: 'All' }));
    expect(within(bar).getByText('3 selected')).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: 'Stop selecting' }));
    expect(screen.queryByRole('toolbar', { name: 'Selected photos' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Sort photos/ })).toBeTruthy();
  });

  test('picked photos download one by one, each named for when it was added', async () => {
    const saved: { name: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ name: this.download, href: this.getAttribute('href') ?? '' });
    });
    const { user } = await openPhotos();
    const bar = await longPress(screen.getByRole('button', { name: 'Photo of Dinner' }));
    await user.click(screen.getByRole('checkbox', { name: 'Photo of Hotel' }));
    await user.click(within(bar).getByRole('button', { name: 'Download photos' }));

    // Newest first, as shown: the receipt, then the sunset a day before
    const [, receipt, sunset] = trip().attachments;
    const names = photoFileNames([receipt, sunset]);
    await waitFor(() =>
      expect(saved).toEqual([
        { name: names[0], href: '/api/splits/trip/attachments/receipt' },
        { name: names[1], href: '/api/splits/trip/attachments/sunset' },
      ]),
    );
  });

  test('picked photos are removed together, after asking', async () => {
    const { server, user } = await openPhotos();
    const bar = await longPress(screen.getByRole('button', { name: 'Photo of Dinner' }));
    await user.click(screen.getByRole('checkbox', { name: 'Photo of Beach bar' }));
    await user.click(within(bar).getByRole('button', { name: 'Remove photos' }));
    const question = await screen.findByRole('dialog', { name: 'Remove 2 photos?' });
    expect(server.splits.get('trip')!.attachments).toHaveLength(4);
    await user.click(within(question).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(server.splits.get('trip')!.attachments.map((a) => a.id)).toEqual(['sunset', 'group']),
    );
    expect(screen.queryByRole('toolbar', { name: 'Selected photos' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Photo of/ })).toHaveLength(1);
  });

  test('Back lets go of the picked photos and stays on the split', async () => {
    await openPhotos();
    await longPress(screen.getByRole('button', { name: 'Photo of Dinner' }));
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.queryByRole('toolbar', { name: 'Selected photos' })).toBeNull(),
    );
    expect(window.location.search).toBe('?s=trip');
    expect(screen.getByRole('tab', { name: 'Photos' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('ordering photos on a phone', () => {
  /** The photos in the order shown, by id */
  const shownOrder = () =>
    screen
      .getAllByRole('button', { name: /^Photo of/ })
      .map((tile) => tile.querySelector('img')!.getAttribute('src')!.split('/').at(-1));
  const days = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

  /** Opens the menu behind a toolbar pill and picks one of what it lists */
  async function choose(user: ReturnType<typeof userEvent.setup>, pill: RegExp, option: string) {
    await user.click(screen.getByRole('button', { name: pill }));
    await user.click(await screen.findByRole('menuitem', { name: option }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  }

  test('the sort menu offers every order a computer does, and any is one tap away', async () => {
    const { user } = await openPhotos();
    const sort = () => screen.getByRole('button', { name: /^Sort photos/ });
    // Newest added first: the receipt was added after the beach, on the same day
    expect(sort().getAttribute('aria-label')).toBe('Sort photos: Newest');
    expect(shownOrder()).toEqual(['receipt', 'beach', 'sunset']);
    expect(days()).toEqual(['Sun, Oct 11', 'Sat, Oct 10']);

    await user.click(sort());
    expect((await screen.findAllByRole('menuitem')).map((el) => el.textContent)).toEqual([
      'Newest',
      'Oldest',
      'Item date, newest',
      'Item date, oldest',
    ]);
    await user.keyboard('{Escape}');

    // By item date, each photo goes with its item: the receipt with its dinner on the
    // 10th, the sunset with the hotel on the 9th
    await choose(user, /^Sort photos/, 'Item date, newest');
    expect(sort().getAttribute('aria-label')).toBe('Sort photos: Item date, newest');
    expect(shownOrder()).toEqual(['beach', 'receipt', 'sunset']);
    expect(days()).toEqual(['Sun, Oct 11', 'Sat, Oct 10', 'Fri, Oct 9']);

    await choose(user, /^Sort photos/, 'Oldest');
    expect(sort().getAttribute('aria-label')).toBe('Sort photos: Oldest');
    expect(shownOrder()).toEqual(['sunset', 'beach', 'receipt']);

    await choose(user, /^Sort photos/, 'Item date, oldest');
    expect(shownOrder()).toEqual(['sunset', 'receipt', 'beach']);

    await choose(user, /^Sort photos/, 'Newest');
    expect(sort().getAttribute('aria-label')).toBe('Sort photos: Newest');
    expect(shownOrder()).toEqual(['receipt', 'beach', 'sunset']);
  });

  test('tapping a photo opens that one, in the order shown', async () => {
    const { user } = await openPhotos();
    await choose(user, /^Sort photos/, 'Oldest');
    // Oldest first: the receipt is now last of three
    await user.click(screen.getByRole('button', { name: 'Photo of Dinner' }));
    const shown = await screen.findByRole('img', { name: 'Photo 3 of 3' });
    expect(shown.getAttribute('src')).toBe('/api/splits/trip/attachments/receipt');
  });

  test('with photos only of the split itself, on no item, the tab says how to add one', async () => {
    const split = trip();
    split.attachments = split.attachments.filter((a) => a.itemId == null);
    renderApp(fakeServer(split), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Photos' }));
    expect(await screen.findByText('No photos yet')).toBeTruthy();
    expect(screen.getByText('Add a receipt or photo on its item, and it shows here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Photo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sort photos/ })).toBeNull();
    // Nothing on the tab adds photos to the split itself
    expect(screen.queryByRole('button', { name: /photo/i })).toBeNull();
  });
});
