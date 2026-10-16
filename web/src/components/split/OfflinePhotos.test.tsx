// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { forgetOfflineCreates } from '../../offline/pending-creates';
import { forgetQueuedPhotos } from '../../offline/photo-queue';
import { queryClient } from '../../query-client';
import {
  type FakeServer,
  fakeServer,
  item,
  renderApp,
  setupAppTests,
  splitDetail,
} from '../../testing/app';

// Photos and receipts picked without a connection: they show as waiting, are still
// there when the app is opened again, can be removed meanwhile, and are uploaded once
// the connection is back (a receipt after its item is saved). Online, they go at once.

setupAppTests();

// jsdom can't decode images: shrinking just marks the photo, so the test can tell it
// was shrunk before it was kept and sent
vi.mock('../../utils/image', async (original) => ({
  ...(await original<typeof import('../../utils/image')>()),
  shrinkImage: (file: Blob) =>
    Promise.resolve(new Blob([`small ${(file as File).name}`], { type: 'image/jpeg' })),
}));

let online = true;

beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  // Photos still on this device are shown from it
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as { onLine?: boolean }).onLine;
});

const trip = () => splitDetail('trip', [item({ id: 'dinner', name: 'Dinner', cost: 80 })]);

const goOffline = (server: FakeServer) => {
  online = false;
  server.health = 'unreachable';
  window.dispatchEvent(new Event('offline'));
};

const goOnline = (server: FakeServer) => {
  server.health = 'up';
  online = true;
  window.dispatchEvent(new Event('online'));
};

/** The app closed and opened again: only what was kept on the device is left */
function reopen(server: FakeServer, path: string, options?: Parameters<typeof renderApp>[2]) {
  cleanup();
  queryClient.clear();
  forgetQueuedPhotos();
  forgetOfflineCreates();
  renderApp(server, path, options);
}

const file = (name: string) => new File([`big ${name}`], name, { type: 'image/jpeg' });

/** Picks files in the chooser a button opens */
async function pickPhotos(
  user: ReturnType<typeof userEvent.setup>,
  button: HTMLElement,
  files: File[],
) {
  // The chooser the button opens
  const opened: HTMLInputElement[] = [];
  const opening = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement,
  ) {
    opened.push(this);
  });
  await user.click(button);
  opening.mockRestore();
  expect(opened.map((input) => input.type)).toEqual(['file']);
  await user.upload(opened[0], files);
}

/** A blob's bytes as text; jsdom's Blob can only be read through a FileReader */
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });

const uploaded = (server: FakeServer) =>
  Promise.all(
    server.uploads.map(async (u) => ({
      splitId: u.splitId,
      itemId: u.itemId,
      photo: await readBlob(u.image),
    })),
  );

describe('photos picked offline', () => {
  test('on a phone, a photo waits through the app reopening, and goes once online', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Photos' }));
    expect(await screen.findByText(/No photos yet/)).toBeTruthy();

    goOffline(server);
    await pickPhotos(user, screen.getByRole('button', { name: 'Add photos' }), [file('beach.jpg')]);
    expect(await screen.findByText('Waiting to upload')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove beach.jpg' })).toBeTruthy();

    // Still offline when the app opens again: the photo is still there, still waiting
    reopen(server, '/?s=trip', { size: 'phone' });
    await user.click(await screen.findByRole('tab', { name: 'Photos' }));
    expect(await screen.findByText('Waiting to upload')).toBeTruthy();
    expect(server.uploads).toEqual([]);

    goOnline(server);
    expect(await screen.findByRole('button', { name: 'Photo of the split' })).toBeTruthy();
    expect(screen.queryByText('Waiting to upload')).toBeNull();
    // Shrunk once when picked; what was kept on the device is what went
    expect(await uploaded(server)).toEqual([
      { splitId: 'trip', itemId: null, photo: 'small beach.jpg' },
    ]);
  });

  test("a receipt removed from its item's form while it waits is never uploaded", async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Dinner'));
    const form = await screen.findByRole('dialog', { name: 'Edit item' });

    goOffline(server);
    await pickPhotos(user, within(form).getByRole('button', { name: 'Add photo' }), [
      file('receipt.jpg'),
      file('menu.jpg'),
    ]);
    expect(
      await within(form).findByText('2 photos are kept on this device until they can be uploaded'),
    ).toBeTruthy();
    expect(within(form).getByText('Images · 2')).toBeTruthy();

    // One not sent yet goes without asking
    await user.click(within(form).getByRole('button', { name: 'Remove receipt.jpg' }));
    expect(
      await within(form).findByText('1 photo is kept on this device until it can be uploaded'),
    ).toBeTruthy();
    expect(within(form).queryByRole('button', { name: 'Open receipt.jpg' })).toBeNull();
    expect(within(form).getByRole('button', { name: 'Open menu.jpg' })).toBeTruthy();

    goOnline(server);
    await waitFor(() => expect(server.splits.get('trip')!.attachments).toHaveLength(1));
    expect(await uploaded(server)).toEqual([
      { splitId: 'trip', itemId: 'dinner', photo: 'small menu.jpg' },
    ]);
    await waitFor(() => expect(within(form).queryByText(/kept on this device until/)).toBeNull());
    expect(within(form).getByRole('button', { name: 'Open photo 1' })).toBeTruthy();
  }, 15_000);

  test("a new item's receipt goes after the item, even when the app reopens before", async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await screen.findByText('Dinner');

    goOffline(server);
    await user.click(screen.getAllByRole('button', { name: /^Add item$/ })[0]);
    const form = await screen.findByRole('dialog');
    await user.type(within(form).getByRole('textbox', { name: 'What it was for' }), 'Snacks');
    await user.type(within(form).getByRole('textbox', { name: 'Amount' }), '16');
    await pickPhotos(user, within(form).getByRole('button', { name: 'Add photo' }), [
      file('receipt.jpg'),
    ]);
    await user.click(within(form).getByRole('button', { name: /^(Add|Add item)$/ }));
    expect(await screen.findByText(/Offline · 1 change waiting/)).toBeTruthy();

    reopen(server, '/?s=trip');
    await user.click(await screen.findByText('Snacks'));
    const edit = await screen.findByRole('dialog', { name: 'Edit item' });
    expect(
      await within(edit).findByText('1 photo is kept on this device until it can be uploaded'),
    ).toBeTruthy();
    expect(server.uploads).toEqual([]);

    // The server only takes a receipt for an item it has, so the item went first
    goOnline(server);
    await waitFor(() => expect(server.uploads).toHaveLength(1));
    const snacks = server.splits.get('trip')!.items.find((i) => i.name === 'Snacks')!;
    expect(await uploaded(server)).toEqual([
      { splitId: 'trip', itemId: snacks.id, photo: 'small receipt.jpg' },
    ]);
    expect(await within(edit).findByRole('button', { name: 'Open photo 1' })).toBeTruthy();
  }, 15_000);
});

describe('photos picked online', () => {
  const openPhotos = async (server: FakeServer) => {
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /^Photos/ }));
    return user;
  };

  test('go straight up, in the order picked', async () => {
    const server = fakeServer(trip());
    const user = await openPhotos(server);
    await pickPhotos(user, screen.getByRole('button', { name: 'Add photos' }), [
      file('beach.jpg'),
      file('sunset.jpg'),
      file('pool.jpg'),
    ]);

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Photo of the split' })).toHaveLength(3),
    );
    expect(screen.queryByText('Waiting to upload')).toBeNull();
    expect((await uploaded(server)).map((u) => u.photo)).toEqual([
      'small beach.jpg',
      'small sunset.jpg',
      'small pool.jpg',
    ]);
  });

  test('one the server refuses is explained and not kept', async () => {
    const server = fakeServer(trip());
    server.failNext.photo = 409;
    const user = await openPhotos(server);
    await pickPhotos(user, screen.getByRole('button', { name: 'Add photos' }), [file('beach.jpg')]);

    expect(await screen.findByText('Refused')).toBeTruthy();
    expect(await screen.findByText(/No photos yet/)).toBeTruthy();
    expect(screen.queryByText('Waiting to upload')).toBeNull();

    // Opening the app again doesn't bring it back
    reopen(server, '/?s=trip');
    await userEvent.setup().click(await screen.findByRole('tab', { name: /^Photos/ }));
    expect(await screen.findByText(/No photos yet/)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Waiting to upload')).toBeNull();
    expect(server.uploads).toEqual([]);
  });
});
