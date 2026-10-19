// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Attachment } from '@shared/api';
import { photoFileName } from '../../split/photo-download';
import {
  fakeServer,
  item,
  readsAs,
  renderApp,
  setupAppTests,
  splitDetail,
} from '../../testing/app';

// The Photos tab on a computer: the split's photos and item receipts by day, which to
// show, details beside the open photo, removing several at once, and dropping files

setupAppTests();

/** Files the page saves: each link it clicks to download, and any zip it made */
function watchDownloads() {
  const saved: { name: string; href: string }[] = [];
  const zips: Blob[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, href: this.getAttribute('href') ?? '' });
  });
  Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      zips.push(blob);
      return 'blob:zip';
    }),
    revokeObjectURL: vi.fn(),
  });
  return { saved, zips };
}

/** A blob's bytes as text; jsdom's Blob can only be read through a FileReader */
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new TextDecoder('latin1').decode(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });

afterEach(() => {
  vi.restoreAllMocks();
});

const photo = (over: Partial<Attachment> & Pick<Attachment, 'id'>): Attachment => ({
  itemId: null,
  size: 2_400_000,
  contentType: 'image/jpeg',
  uploadedBy: 'ryan@example.com',
  createdAt: Date.UTC(2026, 9, 11, 13),
  ...over,
});

function trip() {
  const split = splitDetail('trip', [
    item({ id: 'dinner', name: 'Seafood dinner', cost: 248 }),
    item({ id: 'taxi', name: 'Taxi', cost: 30 }),
  ]);
  split.members.push({
    email: 'aisha@example.com',
    role: 'editor',
    displayName: 'Aisha',
    avatarVersion: null,
    paymentMethods: [],
  });
  split.attachments = [
    photo({ id: 'receipt', itemId: 'dinner', uploadedBy: 'aisha@example.com' }),
    photo({ id: 'beach', uploadedBy: 'aisha@example.com' }),
    photo({ id: 'sunset', createdAt: Date.UTC(2026, 9, 10, 13) }),
  ];
  return split;
}

async function openPhotos(server = fakeServer(trip())) {
  renderApp(server, '/?s=trip');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: /^Photos/ }));
  return { server, user };
}

describe('the Photos tab on a computer', () => {
  test('shows every photo by day, beside Items, with the page button to add more', async () => {
    await openPhotos();
    expect(screen.getByRole('tab', { name: /^Photos/ }).textContent).toBe('Photos3');
    expect(screen.getByRole('tab', { name: /^Items/ }).textContent).toBe('Items2');
    expect(screen.getByRole('button', { name: 'Add photos' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add item' })).toBeNull();
    // The balances step aside; the people stay, so the tabs don't move
    expect(screen.queryByText('Who pays who')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit people' })).toBeTruthy();

    const days = screen.getAllByRole('region');
    expect(days).toHaveLength(2);
    expect(within(days[0]).getByText('2 photos')).toBeTruthy();
    expect(
      within(days[0]).getByRole('button', { name: 'Receipt for Seafood dinner' }),
    ).toBeTruthy();
    expect(within(days[1]).getByText('1 photo')).toBeTruthy();
  });

  test('shows only receipts, or only photos of the split', async () => {
    const { user } = await openPhotos();
    await user.click(screen.getByRole('radio', { name: /^Receipts/ }));
    expect(screen.getByRole('button', { name: 'Receipt for Seafood dinner' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Photo of the split' })).toBeNull();

    await user.click(screen.getByRole('radio', { name: /^Split photos/ }));
    expect(screen.getAllByRole('button', { name: 'Photo of the split' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^Receipt for/ })).toBeNull();
  });

  test('oldest first puts the earlier day on top', async () => {
    const { user } = await openPhotos();
    await user.click(screen.getByRole('button', { name: /^Sort photos/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Oldest first' }));
    await waitFor(() => expect(within(screen.getAllByRole('region')[0]).getByText('1 photo')));
  });

  test('an open receipt shows its item, your share and who added it, and opens the item', async () => {
    const { user } = await openPhotos();
    await user.click(screen.getByRole('button', { name: 'Receipt for Seafood dinner' }));
    const viewer = within(await screen.findByRole('dialog'));
    expect(viewer.getByRole('heading', { name: 'Seafood dinner' })).toBeTruthy();
    expect(viewer.getByText('RM 248.00')).toBeTruthy();
    // Ryan and Ann share it equally
    expect(viewer.getByText('RM 124.00')).toBeTruthy();
    expect(viewer.getByText(readsAs(/^Aisha, /))).toBeTruthy();

    await user.click(viewer.getByRole('button', { name: 'Open item' }));
    expect(await screen.findByText('Edit item')).toBeTruthy();
  });

  test('an open photo of the split says who added it and what file it is', async () => {
    const { user } = await openPhotos();
    await user.click(screen.getAllByRole('button', { name: 'Photo of the split' })[0]);
    const viewer = within(await screen.findByRole('dialog'));
    expect(viewer.getByText(readsAs('Added by Aisha'))).toBeTruthy();
    expect(viewer.getByText('JPEG, 2.4 MB')).toBeTruthy();
    expect(viewer.getByText('Trip')).toBeTruthy();
    // After the receipt shown before it
    expect(viewer.getByText('2 of 3')).toBeTruthy();
  });

  test("a receipt removed from its item's form asks first", async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Seafood dinner'));
    const form = await screen.findByRole('dialog', { name: 'Edit item' });
    await user.click(within(form).getByRole('button', { name: 'Remove photo 1' }));
    const question = await screen.findByRole('dialog', { name: 'Remove this photo?' });
    expect(server.splits.get('trip')!.attachments).toHaveLength(3);
    await user.click(within(question).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(server.splits.get('trip')!.attachments.map((a) => a.id)).toEqual(['beach', 'sunset']),
    );
  });

  test('removing the open photo asks first, and Cancel keeps it', async () => {
    const { server, user } = await openPhotos();
    await user.click(screen.getByRole('button', { name: 'Receipt for Seafood dinner' }));
    const viewer = await screen.findByRole('dialog');
    await user.click(within(viewer).getByRole('button', { name: 'Remove photo' }));
    const question = await screen.findByRole('dialog', { name: 'Remove this photo?' });
    expect(within(question).getByText(/removed for everyone in the split/)).toBeTruthy();
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(server.splits.get('trip')!.attachments).toHaveLength(3);
    // Still looking at it
    expect(within(viewer).getByRole('heading', { name: 'Seafood dinner' })).toBeTruthy();

    await user.click(within(viewer).getByRole('button', { name: 'Remove photo' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Remove this photo?' })).getByRole(
        'button',
        { name: 'Remove' },
      ),
    );
    await waitFor(() =>
      expect(server.splits.get('trip')!.attachments.map((a) => a.id)).toEqual(['beach', 'sunset']),
    );
  });

  test('selects a whole day and removes it in one go, after asking', async () => {
    const { server, user } = await openPhotos();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getAllByRole('button', { name: 'Select day' })[0]);
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Select receipt for Seafood dinner' }).ariaChecked,
    ).toBe('true');

    // Asks first; Cancel removes nothing and keeps them picked
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    let question = await screen.findByRole('dialog', { name: 'Remove 2 photos?' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.splits.get('trip')!.attachments).toHaveLength(3);
    expect(screen.getByText('2 selected')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    question = await screen.findByRole('dialog', { name: 'Remove 2 photos?' });
    await user.click(within(question).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(server.splits.get('trip')!.attachments.map((a) => a.id)).toEqual(['sunset']),
    );
    expect(screen.getAllByRole('region')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: /^Photos/ }).textContent).toBe('Photos1');
  });

  test('downloads several photos as one zip, each named for when it was added', async () => {
    const { saved, zips } = watchDownloads();
    const { user } = await openPhotos();
    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getAllByRole('button', { name: 'Select day' })[0]);
    await user.click(screen.getByRole('button', { name: 'Download zip' }));

    await waitFor(() => expect(saved).toEqual([{ name: 'Trip photos.zip', href: 'blob:zip' }]));
    // Both were added in the same second, so the second is numbered
    const name = photoFileName(photo({ id: 'receipt' }));
    const zip = await readBlob(zips[0]);
    expect(zip).toContain(`${name}photo receipt`);
    expect(zip).toContain(`${name.replace('.jpg', ' (2).jpg')}photo beach`);
  });

  test('one photo downloads on its own, named for when it was added', async () => {
    const { saved, zips } = watchDownloads();
    const { user } = await openPhotos();
    await user.click(screen.getByRole('checkbox', { name: 'Select receipt for Seafood dinner' }));
    await user.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() =>
      expect(saved).toEqual([
        {
          name: photoFileName(photo({ id: 'receipt' })),
          href: '/api/splits/trip/attachments/receipt',
        },
      ]),
    );
    expect(zips).toEqual([]);
  });

  test("someone who isn't the owner can't remove photos others added", async () => {
    const split = trip();
    split.role = 'editor';
    await openPhotos(fakeServer(split));
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Select receipt for Seafood dinner' }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' }).hasAttribute('disabled')).toBe(true);
  });

  test('dragging photos over the tab shows where they go', async () => {
    await openPhotos();
    const day = screen.getAllByRole('region')[0];
    const files = {
      types: ['Files'],
      items: [
        { kind: 'file', type: 'image/jpeg' },
        { kind: 'file', type: 'image/png' },
      ],
      files: [],
    };
    fireEvent.dragEnter(day, { dataTransfer: files });
    expect(screen.getByText('Drop to add 2 photos')).toBeTruthy();
    expect(screen.getByText(/added as split photos/)).toBeTruthy();
    fireEvent.dragLeave(day, { dataTransfer: files });
    expect(screen.queryByText('Drop to add 2 photos')).toBeNull();
  });
});
