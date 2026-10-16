// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Attachment } from '@shared/api';
import { photoFileNames } from '../../split/photo-download';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// A phone's Photos tab: its buttons order and filter the photos as a computer's menu
// does; a long press starts picking, taps add more, and the picked photos download one
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
  const split = splitDetail('trip', [item({ id: 'dinner', name: 'Dinner', cost: 80 })]);
  split.attachments = [
    photo('beach', Date.UTC(2026, 9, 11, 9)),
    photo('receipt', Date.UTC(2026, 9, 11, 13), 'dinner'),
    photo('sunset', Date.UTC(2026, 9, 10, 18)),
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
    const [first] = screen.getAllByRole('button', { name: 'Photo of the split' });
    const bar = await longPress(first);
    expect(within(bar).getByText('1 selected')).toBeTruthy();
    // The bar takes the header's place, and Add photos steps aside
    expect(screen.queryByRole('button', { name: 'Add photos' })).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Photo of Dinner' }));
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    // A tap while picking picks, rather than opening the photo
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Photo of Dinner', checked: true }));
    await user.click(within(bar).getByRole('button', { name: 'All' }));
    expect(within(bar).getByText('3 selected')).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: 'Stop selecting' }));
    expect(screen.queryByRole('toolbar', { name: 'Selected photos' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add photos' })).toBeTruthy();
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
    await user.click(screen.getAllByRole('checkbox', { name: 'Photo of the split' })[1]);
    await user.click(within(bar).getByRole('button', { name: 'Download photos' }));

    // Newest first, as shown: the receipt, then the sunset a day before
    const [receipt, , sunset] = trip().attachments.sort((a, b) => b.createdAt - a.createdAt);
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
    await user.click(screen.getAllByRole('checkbox', { name: 'Photo of the split' })[0]);
    await user.click(within(bar).getByRole('button', { name: 'Remove photos' }));
    const question = await screen.findByRole('dialog', { name: 'Remove 2 photos?' });
    expect(server.splits.get('trip')!.attachments).toHaveLength(3);
    await user.click(within(question).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(server.splits.get('trip')!.attachments.map((a) => a.id)).toEqual(['sunset']),
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

describe('ordering and filtering photos on a phone', () => {
  /** The photos in the order shown, by id */
  const shownOrder = () =>
    screen
      .getAllByRole('button', { name: /^Photo of/ })
      .map((tile) => tile.querySelector('img')!.getAttribute('src')!.split('/').at(-1));
  const days = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

  test('the sort button steps through the orders a computer offers, by day', async () => {
    const { user } = await openPhotos();
    const sort = () => screen.getByRole('button', { name: /^Sort photos/ });
    // Newest added first: the receipt was added after the beach, on the same day
    expect(sort().getAttribute('aria-label')).toBe('Sort photos: Newest');
    expect(shownOrder()).toEqual(['receipt', 'beach', 'sunset']);
    expect(days()).toEqual(['Sun, Oct 11', 'Sat, Oct 10']);

    await user.click(sort());
    expect(sort().getAttribute('aria-label')).toBe('Sort photos: Oldest');
    expect(shownOrder()).toEqual(['sunset', 'beach', 'receipt']);

    // By item date, the receipt goes with its dinner on the 10th; other photos keep
    // the day they were added
    await user.click(sort());
    expect(sort().getAttribute('aria-label')).toBe('Sort photos: Item date, newest');
    expect(shownOrder()).toEqual(['beach', 'sunset', 'receipt']);
    expect(days()).toEqual(['Sun, Oct 11', 'Sat, Oct 10']);
    await user.click(sort());
    expect(shownOrder()).toEqual(['receipt', 'sunset', 'beach']);

    await user.click(sort());
    expect(sort().getAttribute('aria-label')).toBe('Sort photos: Newest');
    expect(shownOrder()).toEqual(['receipt', 'beach', 'sunset']);
  });

  test('tapping a photo opens that one, in the order shown', async () => {
    const { user } = await openPhotos();
    await user.click(screen.getByRole('button', { name: /^Sort photos/ }));
    // Oldest first: the receipt is now last of three
    await user.click(screen.getByRole('button', { name: 'Photo of Dinner' }));
    const shown = await screen.findByRole('img', { name: 'Photo 3 of 3' });
    expect(shown.getAttribute('src')).toBe('/api/splits/trip/attachments/receipt');
  });

  test('the filter button shows receipts or split photos, with how many, and All picks those', async () => {
    const { user } = await openPhotos();
    const show = () => screen.getByRole('button', { name: /^Show:/ });
    expect(show().getAttribute('aria-label')).toBe('Show: All, 3');

    await user.click(show());
    expect(show().getAttribute('aria-label')).toBe('Show: Receipts, 1');
    expect(shownOrder()).toEqual(['receipt']);

    await user.click(show());
    expect(show().getAttribute('aria-label')).toBe('Show: Split photos, 2');
    expect(shownOrder()).toEqual(['beach', 'sunset']);
    // Picking all picks the photos shown, not the hidden receipt
    const bar = await longPress(screen.getAllByRole('button', { name: 'Photo of the split' })[0]);
    await user.click(within(bar).getByRole('button', { name: 'All' }));
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    // The buttons step aside while picking, as Add photos does
    expect(screen.queryByRole('button', { name: /^Show:/ })).toBeNull();
    await user.click(within(bar).getByRole('button', { name: 'Stop selecting' }));

    await user.click(show());
    expect(show().getAttribute('aria-label')).toBe('Show: All, 3');
    expect(shownOrder()).toHaveLength(3);
  });

  test('a filter with nothing in it says so', async () => {
    const split = trip();
    split.attachments = split.attachments.filter((a) => a.itemId == null);
    renderApp(fakeServer(split), '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Photos' }));
    await user.click(await screen.findByRole('button', { name: /^Show:/ }));
    expect(screen.getByText('No receipts yet. Add one on its item.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Photo of/ })).toBeNull();
  });
});
