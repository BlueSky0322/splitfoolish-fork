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
  return opened[0];
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

    goOffline(server);
    await pickPhotos(user, await screen.findByRole('button', { name: 'Choose from library' }), [
      file('beach.jpg'),
    ]);
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
    expect(await screen.findByText('Drop photos here')).toBeTruthy();
    expect(screen.queryByText('Waiting to upload')).toBeNull();

    // Opening the app again doesn't bring it back
    reopen(server, '/?s=trip');
    await userEvent.setup().click(await screen.findByRole('tab', { name: /^Photos/ }));
    expect(await screen.findByText('Drop photos here')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Waiting to upload')).toBeNull();
    expect(server.uploads).toEqual([]);
  });
});

describe('adding the first photos', () => {
  test('on a computer, the empty tab is the place to choose them, with no toolbar', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /^Photos/ }));
    expect(await screen.findByText('Drop photos here')).toBeTruthy();
    expect(screen.getByText('JPEG, PNG, HEIC or WebP')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Sort photos/ })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Show' })).toBeNull();

    const chooser = await pickPhotos(user, screen.getByRole('button', { name: 'Choose photos' }), [
      file('beach.jpg'),
      file('pool.jpg'),
    ]);
    expect(chooser.multiple).toBe(true);
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Photo of the split' })).toHaveLength(2),
    );
    expect(screen.queryByText('Drop photos here')).toBeNull();
    expect(screen.getByRole('button', { name: /^Sort photos/ })).toBeTruthy();
    expect((await uploaded(server)).map((u) => u.photo)).toEqual([
      'small beach.jpg',
      'small pool.jpg',
    ]);
  });

  test('on a computer, a filter with none says so, and Show all photos goes back', async () => {
    const split = trip();
    split.attachments = [
      {
        id: 'beach',
        itemId: null,
        size: 1000,
        contentType: 'image/jpeg',
        uploadedBy: 'ryan@example.com',
        createdAt: Date.UTC(2026, 9, 11, 9),
      },
    ];
    renderApp(fakeServer(split), '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /^Photos/ }));
    await user.click(await screen.findByText('Receipts'));
    expect(await screen.findByText('No receipts yet')).toBeTruthy();
    expect(screen.getByText('Add one on its item and it shows here.')).toBeTruthy();
    expect(screen.queryByText('Drop photos here')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show all photos' }));
    expect(await screen.findByRole('button', { name: 'Photo of the split' })).toBeTruthy();
    expect(screen.queryByText('No receipts yet')).toBeNull();
  });

  test('on a phone, the empty tab offers the camera or the library, and no Add photos button', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Photos' }));
    expect(
      await screen.findByText('Photos for the whole split. Receipts for one item go on that item.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add photos' })).toBeNull();

    const camera = await pickPhotos(user, screen.getByRole('button', { name: 'Take photo' }), [
      file('beach.jpg'),
    ]);
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(camera.multiple).toBe(false);
    expect(await screen.findByRole('button', { name: 'Photo of the split' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Take photo' })).toBeNull();

    // Once there are photos, Add photos opens a sheet with the same two choices
    await user.click(screen.getByRole('button', { name: 'Add photos' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add photos' });
    expect(within(sheet).getByText('Opens the camera')).toBeTruthy();
    const library = await pickPhotos(
      user,
      within(sheet).getByRole('button', { name: /Choose from library/ }),
      [file('pool.jpg'), file('sunset.jpg')],
    );
    expect(library.multiple).toBe(true);
    expect(library.hasAttribute('capture')).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add photos' })).toBeNull());
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Photo of the split' })).toHaveLength(3),
    );
    expect((await uploaded(server)).map((u) => u.photo)).toEqual([
      'small beach.jpg',
      'small pool.jpg',
      'small sunset.jpg',
    ]);
  });
});

describe("an item's photos", () => {
  test('on a phone, Add photo offers the camera or the library, as the Photos tab does', async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add item' }));
    const form = await screen.findByRole('dialog', { name: /Add item/ });
    await user.click(within(form).getByRole('button', { name: 'Add photo' }));

    const sheet = await screen.findByRole('dialog', { name: 'Add photo' });
    expect(within(sheet).getByText('Opens the camera')).toBeTruthy();
    const camera = await pickPhotos(
      user,
      within(sheet).getByRole('button', { name: /Take photo/ }),
      [file('receipt.jpg')],
    );
    expect(camera.getAttribute('capture')).toBe('environment');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add photo' })).toBeNull());
    expect(await within(form).findByRole('button', { name: 'Open receipt.jpg' })).toBeTruthy();

    await user.click(within(form).getByRole('button', { name: 'Add photo' }));
    const again = await screen.findByRole('dialog', { name: 'Add photo' });
    const library = await pickPhotos(
      user,
      within(again).getByRole('button', { name: /Choose from library/ }),
      [file('menu.jpg')],
    );
    expect(library.multiple).toBe(true);
    expect(await within(form).findByRole('button', { name: 'Open menu.jpg' })).toBeTruthy();
    // Still the item form, with both waiting for the item to be added
    expect(screen.getByRole('dialog', { name: /Add item/ })).toBe(form);
  }, 15_000);
});
