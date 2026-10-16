// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { notifications } from '@mantine/notifications';
import { renderHook } from '@testing-library/react';
import { get, keys, set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Attachment } from '@shared/api';
import type { Item } from '@shared/types';
import { ApiError, NetworkError, api } from '../api';
import { setCacheUser, writeCache } from './cache';
import { writeOutbox } from './outbox';
import { savePendingCreate } from './pending-creates';
import {
  addPhotos,
  forgetQueuedPhotos,
  openSplitPhotos,
  queuedPhotos,
  removeQueuedPhoto,
  resumePhotoUploads,
} from './photo-queue';
import { useKeepingWork } from './storage-health';
import { forgetOfflineWork } from './sync';

// Photos picked for a split or a receipt are kept on the device until uploaded: they
// survive the app closing, go once they can (online, the split on the server, the item
// saved), two at a time, oldest first, and only ever for the account that picked them.

/** Shrinking stands in for the browser's decoding, which jsdom can't do */
const shrink = vi.hoisted(() => ({
  image: vi.fn((file: Blob) =>
    Promise.resolve(new Blob([`small ${(file as File).name}`], { type: 'image/jpeg' })),
  ),
}));
vi.mock('../utils/image', async (original) => ({
  ...(await original<typeof import('../utils/image')>()),
  shrinkImage: (file: Blob) => shrink.image(file),
}));

let online = true;
let uploaded = 0;

/** The server keeping each photo it's sent, answering with what it stored */
function serverKeeps() {
  return vi
    .spyOn(api, 'uploadAttachment')
    .mockImplementation((splitId, _image, itemId): Promise<Attachment> => {
      uploaded++;
      return Promise.resolve({
        id: `${splitId}-photo-${uploaded}`,
        itemId,
        size: 10,
        contentType: 'image/jpeg',
        uploadedBy: 'ryan@example.com',
        createdAt: Date.now(),
      });
    });
}

/** A blob's bytes as text; jsdom's Blob can only be read through a FileReader */
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });

const file = (name: string) => new File([`big ${name}`], name, { type: 'image/jpeg' });

/** The photos kept on the device, by key */
const keptKeys = async () =>
  (await keys()).filter((k): k is string => typeof k === 'string' && k.startsWith('photo:'));

/** What's sent, by name, from each upload call: [splitId, itemId, the photo's text] */
const sentWith = async (spy: ReturnType<typeof serverKeeps>) =>
  Promise.all(
    spy.mock.calls.map(async ([splitId, image, itemId]) => [
      splitId,
      itemId,
      await readBlob(image),
    ]),
  );

/** Lets the queue's reads and writes of the device finish */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const goOnline = () => {
  online = true;
  window.dispatchEvent(new Event('online'));
};

/** A photo kept on the device by an earlier visit, as the queue keeps them */
const keptPhoto = (id: string, splitId: string, createdAt: number, itemId: string | null = null) =>
  writeCache(`photo:${splitId}:${id}`, {
    id,
    splitId,
    itemId,
    name: `${id}.jpg`,
    createdAt,
    type: 'image/jpeg',
    bytes: new TextEncoder().encode(`small ${id}.jpg`).buffer,
  });

beforeEach(async () => {
  online = true;
  uploaded = 0;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  await setCacheUser('ryan@example.com');
});

afterEach(async () => {
  vi.restoreAllMocks();
  shrink.image.mockClear();
  await forgetOfflineWork();
  delete (navigator as { onLine?: boolean }).onLine;
});

describe('keeping photos on the device', () => {
  test('a photo picked offline waits on the device, and goes from there after a reload', async () => {
    const upload = serverKeeps();
    online = false;
    await addPhotos('trip', null, [file('beach.jpg')]);

    // Shrunk once, shown as waiting, and kept for this account
    expect(shrink.image).toHaveBeenCalledTimes(1);
    const [photo] = queuedPhotos();
    expect(queuedPhotos()).toEqual([
      expect.objectContaining({ splitId: 'trip', itemId: null, name: 'beach.jpg', busy: false }),
    ]);
    expect(await keptKeys()).toEqual([`photo:trip:${photo.id}`]);
    expect(await get(`photo:trip:${photo.id}`)).toMatchObject({ email: 'ryan@example.com' });
    expect(upload).not.toHaveBeenCalled();

    // The app closes and opens again, still offline: it's picked up from the device
    forgetQueuedPhotos();
    expect(queuedPhotos()).toEqual([]);
    await resumePhotoUploads();
    expect(queuedPhotos()).toEqual([
      expect.objectContaining({ id: photo.id, name: 'beach.jpg', busy: false }),
    ]);
    await settle();
    expect(upload).not.toHaveBeenCalled();

    goOnline();
    await vi.waitFor(() => expect(queuedPhotos()).toEqual([]));
    // The shrunk photo, not shrunk again
    expect(await sentWith(upload)).toEqual([['trip', null, 'small beach.jpg']]);
    expect(shrink.image).toHaveBeenCalledTimes(1);
    expect(await keptKeys()).toEqual([]);
  });

  test("a photo the device can't keep is said so, and still goes while the app is open", async () => {
    const upload = serverKeeps();
    const keeping = renderHook(() => useKeepingWork());
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
    online = false;
    await addPhotos('trip', null, [file('beach.jpg')]);

    expect(queuedPhotos().map((p) => p.name)).toEqual(['beach.jpg']);
    expect(await keptKeys()).toEqual([]);
    await vi.waitFor(() => expect(keeping.result.current).toBe(false));

    write.mockRestore();
    goOnline();
    await vi.waitFor(() => expect(queuedPhotos()).toEqual([]));
    expect(await sentWith(upload)).toEqual([['trip', null, 'small beach.jpg']]);
    keeping.unmount();
  });

  test('a photo removed while it waits is never sent', async () => {
    const upload = serverKeeps();
    online = false;
    await addPhotos('trip', null, [file('beach.jpg'), file('sunset.jpg')]);
    const [beach] = queuedPhotos();

    expect(await removeQueuedPhoto(beach.id)).toBe(true);
    expect(queuedPhotos().map((p) => p.name)).toEqual(['sunset.jpg']);
    expect(await keptKeys()).toHaveLength(1);

    goOnline();
    await vi.waitFor(() => expect(queuedPhotos()).toEqual([]));
    expect(await sentWith(upload)).toEqual([['trip', null, 'small sunset.jpg']]);
  });

  test('photos kept for someone else are never shown or sent', async () => {
    const upload = serverKeeps();
    await set('photo:trip:anns', {
      email: 'ann@example.com',
      value: {
        id: 'anns',
        splitId: 'trip',
        itemId: null,
        name: 'anns.jpg',
        createdAt: 1,
        type: 'image/jpeg',
        bytes: new TextEncoder().encode('ann').buffer,
      },
    });

    // Not shown while offline, nor sent once online
    online = false;
    await resumePhotoUploads();
    expect(queuedPhotos()).toEqual([]);
    goOnline();
    await settle();
    expect(queuedPhotos()).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  test('someone else signing in forgets the photos waiting here', async () => {
    const upload = serverKeeps();
    online = false;
    await addPhotos('trip', null, [file('beach.jpg')]);
    expect(queuedPhotos()).toHaveLength(1);

    await setCacheUser('ann@example.com');
    expect(queuedPhotos()).toEqual([]);
    expect(await keptKeys()).toEqual([]);

    goOnline();
    await settle();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('sending them', () => {
  test('kept photos go oldest first, each split in turn', async () => {
    const upload = serverKeeps();
    // Kept in a different order from when they were picked
    await keptPhoto('c', 'trip', 300);
    await keptPhoto('a', 'trip', 100);
    await keptPhoto('d', 'bali', 50);
    await keptPhoto('b', 'trip', 200);

    await resumePhotoUploads();
    await vi.waitFor(() => expect(queuedPhotos()).toEqual([]));
    const sent = await sentWith(upload);
    expect(sent.filter(([split]) => split === 'trip').map(([, , text]) => text)).toEqual([
      'small a.jpg',
      'small b.jpg',
      'small c.jpg',
    ]);
    expect(sent.filter(([split]) => split === 'bali').map(([, , text]) => text)).toEqual([
      'small d.jpg',
    ]);
  });

  test('never more than two photos are shrunk or sent at once', async () => {
    // Every shrink and upload waits until the test lets it finish
    const working: (() => void)[] = [];
    let busy = 0;
    let most = 0;
    const work = <T>(result: T) =>
      new Promise<T>((resolve) => {
        busy++;
        most = Math.max(most, busy);
        working.push(() => {
          busy--;
          resolve(result);
        });
      });
    shrink.image.mockImplementation((f: Blob) =>
      work(new Blob([`small ${(f as File).name}`], { type: 'image/jpeg' })),
    );
    const names: string[] = [];
    vi.spyOn(api, 'uploadAttachment').mockImplementation(async (_splitId, image, itemId) => {
      names.push(await readBlob(image));
      return work({
        id: `p${names.length}`,
        itemId,
        size: 1,
        contentType: 'image/jpeg',
        uploadedBy: 'ryan@example.com',
        createdAt: 1,
      });
    });

    const picked = ['1', '2', '3', '4', '5'].map((n) => file(`${n}.jpg`));
    void addPhotos('trip', null, picked);
    for (let finished = 0; finished < 10; finished++) {
      await vi.waitFor(() => expect(working.length).toBeGreaterThan(0));
      expect(busy).toBeLessThanOrEqual(2);
      working.shift()!();
    }

    await vi.waitFor(() => expect(queuedPhotos()).toEqual([]));
    expect(most).toBe(2);
    expect(shrink.image).toHaveBeenCalledTimes(5);
    expect(names).toEqual(['1', '2', '3', '4', '5'].map((n) => `small ${n}.jpg`));
  });

  test.each([
    ['its item is gone', new ApiError(404, 'Gone', 'That item no longer exists')],
    ['the split is full', new ApiError(409, 'Full', 'A split can have up to 300 photos')],
    ['it is too large', new ApiError(413, 'Large', 'That photo is too large')],
  ])('one the server refuses because %s is dropped, saying why', async (_why, refusal) => {
    vi.spyOn(api, 'uploadAttachment').mockRejectedValue(refusal);
    const shown = vi.spyOn(notifications, 'show');
    await addPhotos('trip', 'dinner', [file('receipt.jpg')]);

    await vi.waitFor(() => expect(queuedPhotos()).toEqual([]));
    expect(await keptKeys()).toEqual([]);
    expect(shown).toHaveBeenCalledWith(
      expect.objectContaining({ color: 'red', message: refusal.explanation }),
    );
  });

  test.each([
    ['signed out', new ApiError(401, 'Signed out')],
    ['busy', new ApiError(429, 'Busy')],
    ['down', new ApiError(503, 'Down')],
    ['unreachable', new NetworkError('No answer')],
  ])('one that fails while the server is %s waits, and goes next time', async (_why, failure) => {
    const upload = serverKeeps();
    upload.mockRejectedValueOnce(failure);
    const shown = vi.spyOn(notifications, 'show');
    await addPhotos('trip', null, [file('beach.jpg')]);

    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(queuedPhotos()).toEqual([expect.objectContaining({ busy: false })]),
    );
    expect(await keptKeys()).toHaveLength(1);
    expect(shown).not.toHaveBeenCalled();

    // Back to the app (or online again): tried once more
    goOnline();
    await vi.waitFor(() => expect(queuedPhotos()).toEqual([]));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(await keptKeys()).toEqual([]);
  });
});

describe('waiting for the split and the item', () => {
  const dinner = { id: 'dinner', name: 'Dinner', cost: 80 } as Item;

  test('a receipt waits while adding its item is still kept on the device', async () => {
    const upload = serverKeeps();
    await writeOutbox('trip', [{ cid: 'c1', change: { op: 'addItem', item: dinner } }]);
    await addPhotos('trip', 'dinner', [file('receipt.jpg')]);
    await settle();
    expect(upload).not.toHaveBeenCalled();
    expect(queuedPhotos()).toEqual([expect.objectContaining({ busy: false })]);

    // Sent (by the service worker, say)
    await writeOutbox('trip', []);
    goOnline();
    await vi.waitFor(() => expect(queuedPhotos()).toEqual([]));
    expect(await sentWith(upload)).toEqual([['trip', 'dinner', 'small receipt.jpg']]);
  });

  test('on an open split, a receipt goes once its changes are saved, and joins its photos', async () => {
    const upload = serverKeeps();
    let saved = () => {};
    const whenSaved = vi.fn(() => new Promise<void>((resolve) => (saved = resolve)));
    const onUploaded = vi.fn();
    const close = openSplitPhotos('trip', { whenSaved, onUploaded });
    await addPhotos('trip', 'dinner', [file('receipt.jpg')]);
    await vi.waitFor(() => expect(whenSaved).toHaveBeenCalled());
    await settle();
    expect(upload).not.toHaveBeenCalled();
    // Shown from the device meanwhile, on its way
    expect(queuedPhotos()).toEqual([
      expect.objectContaining({ itemId: 'dinner', busy: true, image: expect.any(Blob) }),
    ]);

    saved();
    await vi.waitFor(() => expect(queuedPhotos()).toEqual([]));
    expect(onUploaded).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'trip-photo-1', itemId: 'dinner' }),
    );
    close();
  });

  test('a photo of a split made offline goes once the server has the split', async () => {
    const upload = serverKeeps();
    let created = () => {};
    const createSplit = vi
      .spyOn(api, 'createSplit')
      .mockImplementation(() => new Promise((resolve) => (created = () => resolve({ id: 'new' }))));
    await savePendingCreate({
      id: 'new',
      name: 'New',
      currency: 'MYR',
      summary: {} as Parameters<typeof savePendingCreate>[0]['summary'],
    });
    await addPhotos('new', null, [file('beach.jpg')]);

    await vi.waitFor(() => expect(createSplit).toHaveBeenCalledWith('new', 'New', 'MYR'));
    await settle();
    expect(upload).not.toHaveBeenCalled();

    created();
    await vi.waitFor(() => expect(queuedPhotos()).toEqual([]));
    expect(await sentWith(upload)).toEqual([['new', null, 'small beach.jpg']]);
  });
});
