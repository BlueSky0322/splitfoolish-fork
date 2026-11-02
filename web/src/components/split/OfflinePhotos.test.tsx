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
  test("on a phone, an item's photo waits through the app reopening, and goes once online", async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip', { size: 'phone' });
    const user = userEvent.setup();
    await user.click(await screen.findByText('Dinner'));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Edit item' }),
    );
    // The form, once it has taken the sheet's place
    const form = (await screen.findByRole('textbox', { name: 'Amount' })).closest('form')!;

    goOffline(server);
    await user.click(within(form).getByRole('button', { name: 'Add photo' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add photo' });
    await pickPhotos(user, within(sheet).getByRole('button', { name: /Choose from library/ }), [
      file('receipt.jpg'),
    ]);
    expect(
      await within(form).findByText('1 photo is kept on this device until it can be uploaded'),
    ).toBeTruthy();

    // Still offline when the app opens again: nothing has gone yet
    reopen(server, '/?s=trip', { size: 'phone' });
    await user.click(await screen.findByRole('tab', { name: 'Photos' }));
    expect(await screen.findByText('No photos yet')).toBeTruthy();
    expect(server.uploads).toEqual([]);

    // What was kept on the device goes once online, and shows on the Photos tab
    goOnline(server);
    expect(await screen.findByRole('button', { name: 'Photo of Dinner' })).toBeTruthy();
    // Shrunk once when picked; what was kept on the device is what went
    expect(await uploaded(server)).toEqual([
      { splitId: 'trip', itemId: 'dinner', photo: 'small receipt.jpg' },
    ]);
  }, 15_000);

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
  /** The form of the dinner, opened on a computer */
  const editDinner = async (server: FakeServer) => {
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByText('Dinner'));
    return { user, form: await screen.findByRole('dialog', { name: 'Edit item' }) };
  };

  test('one the server refuses is explained and not kept', async () => {
    const server = fakeServer(trip());
    server.failNext.photo = 409;
    const { user, form } = await editDinner(server);
    await pickPhotos(user, within(form).getByRole('button', { name: 'Add photo' }), [
      file('receipt.jpg'),
    ]);

    expect(await screen.findByText('Refused')).toBeTruthy();
    await waitFor(() =>
      expect(within(form).queryByRole('button', { name: 'Open receipt.jpg' })).toBeNull(),
    );
    expect(within(form).queryByText(/kept on this device until/)).toBeNull();

    // Opening the app again doesn't bring it back
    reopen(server, '/?s=trip');
    await userEvent.setup().click(await screen.findByRole('tab', { name: /^Photos/ }));
    expect(await screen.findByText('No photos yet')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.uploads).toEqual([]);
  });

  test("on a computer, the empty Photos tab points to the items, and an item's photo shows there", async () => {
    const server = fakeServer(trip());
    renderApp(server, '/?s=trip');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: /^Photos/ }));
    expect(await screen.findByText('No photos yet')).toBeTruthy();
    expect(screen.getByText('Add a receipt or photo on its item, and it shows here.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Sort photos/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /photo/i })).toBeNull();

    await user.click(screen.getByRole('tab', { name: /^Items/ }));
    await user.click(await screen.findByText('Dinner'));
    const form = await screen.findByRole('dialog', { name: 'Edit item' });
    await pickPhotos(user, within(form).getByRole('button', { name: 'Add photo' }), [
      file('receipt.jpg'),
    ]);
    await waitFor(() => expect(server.uploads).toHaveLength(1));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('tab', { name: /^Photos/ }));
    expect(await screen.findByRole('button', { name: 'Receipt for Dinner' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Photos/ }).textContent).toBe('Photos1');
  });
});

describe("an item's photos", () => {
  test('on a phone, Add photo offers the camera or the library', async () => {
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
