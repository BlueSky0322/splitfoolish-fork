// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Attachment } from '@shared/api';
import { photoFileNames } from '../../split/photo-download';
import { fakeServer, item, renderApp, setupAppTests, splitDetail } from '../../testing/app';

// Picking photos on a phone's Photos tab: a long press starts it, taps add more, and
// the picked photos download one by one or are removed together

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
