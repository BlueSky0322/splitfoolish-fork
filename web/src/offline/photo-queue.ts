import type { Position } from '../utils/here';
import type { Attachment } from '@shared/api';
import { api } from '../api';
import { newId } from '../utils/id';
import { shrinkImage } from '../utils/image';
import { showError } from '../utils/notify';
import { listCacheIds, onCacheCleared, readCache, removeCacheEntry, writeCache } from './cache';
import { reportKept } from './storage-health';
import { isOffline, isRetryable, readOutbox, requestBackgroundSync } from './outbox';
import { readPendingCreates, resumeCreates, whenCreated } from './pending-creates';

// Photos of a split and receipts on its items, kept on the device (IndexedDB) until
// they're uploaded, so one picked offline, or before its split or item reached the
// server, survives the app being closed. Each is shrunk once when picked, kept, then
// sent once there's a connection, the split is on the server and (for a receipt) its
// item is saved. At most two are shrunk or sent at a time, to spare a phone's memory.
// Like the rest of the device's cache, they're kept for the signed-in account only and
// forgotten with it.

/** A photo still to be uploaded, as the split page shows it */
export interface QueuedPhoto {
  id: string;
  splitId: string;
  /** The item it's a receipt for, or null for a photo of the split */
  itemId: string | null;
  /** The picked file's name */
  name: string;
  createdAt: number;
  /** The photo itself, while its split is open; null when it's only on the device */
  image: Blob | null;
  /** Being shrunk or sent now; otherwise waiting for a connection, its item or a retry */
  busy: boolean;
}

/** A photo as kept on the device: bytes rather than a Blob, which some browsers can't keep */
interface Kept {
  id: string;
  splitId: string;
  itemId: string | null;
  name: string;
  createdAt: number;
  type: string;
  bytes: ArrayBuffer;
  /** Where it was taken; missing from photos kept before places */
  place?: Position | null;
}

/** A photo this page knows of */
interface Held extends QueuedPhoto {
  /** Still being shrunk, so not on the device yet */
  preparing: boolean;
  /** Known to be on the device; one that isn't is sent from memory */
  onDevice: boolean;
  /** Where it was taken, read before it was shrunk; null when nobody said */
  place: Position | null;
}

// Also used by public/sw.js, which can't import them (photo-queue.test.ts checks they match)
export const PHOTO_PREFIX = 'photo:';
export const PHOTO_LOCK_PREFIX = 'sf-photo:';
const photoKey = (photo: { splitId: string; id: string }) =>
  `${PHOTO_PREFIX}${photo.splitId}:${photo.id}`;

/** Photos shrunk or sent at once */
export const MAX_PHOTOS_AT_ONCE = 2;
/** After a failure worth retrying, the next try waits this long, doubling up to the max */
const RETRY_MS = 3000;
const MAX_RETRY_MS = 60_000;

const held = new Map<string, Held>();
/** Photos on their way to the server from this page */
const sending = new Set<string>();
/** Photos uploaded or removed since this page started, not to be read back from the device */
const finished = new Set<string>();
/** Splits open on screen, and what they need from here */
const open = new Map<string, OpenSplit>();
/** Bumped when the account's photos are forgotten, so work begun before stops */
let generation = 0;
let lastCreatedAt = 0;

// ---------- What's shown ----------

let snapshot: readonly QueuedPhoto[] = [];
const listeners = new Set<() => void>();

function changed() {
  snapshot = [...held.values()].map(
    ({ id, splitId, itemId, name, createdAt, image, busy }): QueuedPhoto => ({
      id,
      splitId,
      itemId,
      name,
      createdAt,
      image,
      busy,
    }),
  );
  listeners.forEach((listener) => listener());
}

export function subscribeQueuedPhotos(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Every photo still to upload that this page knows of, oldest first within a split */
export const queuedPhotos = () => snapshot;

/** Splits with photos still to upload: kept on the device, or being got ready here */
export async function splitsWithQueuedPhotos(): Promise<Set<string>> {
  const splits = new Set(snapshot.map((photo) => photo.splitId));
  // Keys are <splitId>:<photo id>; another account's are gone once this one signs in
  for (const rest of await listCacheIds(PHOTO_PREFIX)) splits.add(rest.split(':')[0]);
  return splits;
}

function setBusy(photos: Held[], busy: boolean) {
  const changing = photos.filter((p) => p.busy !== busy);
  changing.forEach((p) => (p.busy = busy));
  if (changing.length > 0) changed();
}

function letGo(photo: Held) {
  finished.add(photo.id);
  if (held.get(photo.id) === photo) held.delete(photo.id);
  changed();
}

const byAge = (a: Held, b: Held) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
const photosOf = (splitId: string) =>
  [...held.values()].filter((p) => p.splitId === splitId).sort(byAge);

// ---------- At most two at a time ----------

let active = 0;
const waitingForSlot: (() => void)[] = [];

/** Waits for a turn, in the order asked; resolves with the function that ends it */
async function takeTurn(): Promise<() => void> {
  if (active < MAX_PHOTOS_AT_ONCE) active++;
  else await new Promise<void>((resolve) => waitingForSlot.push(resolve));
  return () => {
    const next = waitingForSlot.shift();
    // Handed straight to the next in line, so nobody can slip in between
    if (next) next();
    else active--;
  };
}

// ---------- Keeping them on the device ----------

/** A blob's bytes, read the way every browser can */
const readBytes = (blob: Blob) =>
  new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read that photo'));
    reader.readAsArrayBuffer(blob);
  });

/** A position kept with a photo, as read back from storage */
const isPosition = (value: unknown): value is Position =>
  typeof value === 'object' &&
  value != null &&
  typeof (value as Position).lat === 'number' &&
  typeof (value as Position).lng === 'number';

/** Kept by whichever build: only what still has everything an upload needs */
const isKept = (k: unknown): k is Kept =>
  typeof k === 'object' &&
  k != null &&
  typeof (k as Kept).id === 'string' &&
  typeof (k as Kept).splitId === 'string' &&
  ((k as Kept).itemId === null || typeof (k as Kept).itemId === 'string') &&
  typeof (k as Kept).name === 'string' &&
  typeof (k as Kept).createdAt === 'number' &&
  typeof (k as Kept).type === 'string' &&
  // Checked by name: read back from storage, it can come from another realm
  Object.prototype.toString.call((k as Kept).bytes) === '[object ArrayBuffer]';

const imageOf = (kept: Kept) => new Blob([kept.bytes], { type: kept.type });

/**
 * Reads the photos kept on the device for a split (or every split) into this page. Only
 * an open split's photos are held in memory; the rest are read again when they're sent.
 */
async function loadKept(splitId?: string) {
  const gen = generation;
  const prefix = splitId == null ? PHOTO_PREFIX : `${PHOTO_PREFIX}${splitId}:`;
  let any = false;
  for (const rest of await listCacheIds(prefix)) {
    // Read one at a time, so only one photo's bytes are in memory at once
    const kept = await readCache<unknown>(`${prefix}${rest}`);
    if (gen !== generation) return;
    // Someone else's, or uploaded meanwhile
    if (!isKept(kept) || finished.has(kept.id)) continue;
    const shown = open.has(kept.splitId);
    const known = held.get(kept.id);
    if (known) {
      if (shown && known.image == null) known.image = imageOf(kept);
    } else {
      held.set(kept.id, {
        id: kept.id,
        splitId: kept.splitId,
        itemId: kept.itemId,
        name: kept.name,
        createdAt: kept.createdAt,
        image: shown ? imageOf(kept) : null,
        busy: false,
        preparing: false,
        onDevice: true,
        place: isPosition(kept.place) ? kept.place : null,
      });
    }
    any = true;
  }
  if (any) changed();
}

/** Runs fn holding the photo's lock, so two tabs (or the service worker) never both send it */
function withPhotoLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  // The lock's promise settles as fn's does
  return locks ? (locks.request(`${PHOTO_LOCK_PREFIX}${id}`, fn) as Promise<T>) : fn();
}

// ---------- Sending ----------

/** What the open split page lends the queue */
export interface OpenSplit {
  /** Resolves once the split's queued changes are saved, so a new item exists first */
  whenSaved: () => Promise<void>;
  /** Shows a photo once it's uploaded */
  onUploaded: (photo: Attachment) => void;
}

/** Waits until the server has the split, if it was made on this device */
async function whenOnServer(splitId: string) {
  if ((await readPendingCreates()).some((c) => c.id === splitId)) await resumeCreates();
  await whenCreated(splitId);
}

/**
 * Whether a receipt's item is saved: the open split has sent its changes, and adding the
 * item isn't still waiting on the device (to be sent by the service worker, say)
 */
async function itemSaved(splitId: string, itemId: string, splitSaved: () => Promise<boolean>) {
  if (!(await splitSaved())) return false;
  const outbox = await readOutbox(splitId);
  return !outbox.some((q) => q.change.op === 'addItem' && q.change.item.id === itemId);
}

/** Sends one photo: false when it should be tried again later */
async function upload(photo: Held, gen: number): Promise<boolean> {
  try {
    return await withPhotoLock(photo.id, async () => {
      const kept = await readCache<unknown>(photoKey(photo));
      if (gen !== generation || held.get(photo.id) !== photo) return true;
      let image: Blob;
      if (isKept(kept)) image = imageOf(kept);
      // The device couldn't keep it (private browsing, say): the copy here goes instead
      else if (!photo.onDevice && photo.image) image = photo.image;
      else {
        // Sent or removed in another tab
        letGo(photo);
        return true;
      }
      // With its own id: if the answer is lost and it's sent again, it isn't added twice
      const place = isKept(kept) && isPosition(kept.place) ? kept.place : photo.place;
      const added = await api.uploadAttachment(photo.splitId, image, photo.itemId, photo.id, place);
      if (gen !== generation) return true;
      await removeCacheEntry(photoKey(photo));
      open.get(photo.splitId)?.onUploaded(added);
      letGo(photo);
      return true;
    });
  } catch (err) {
    if (gen !== generation) return true;
    if (isRetryable(err)) {
      setBusy([photo], false);
      return false;
    }
    // Refused (its item is gone, too large, too many photos): it can't go, so it's dropped
    await removeCacheEntry(photoKey(photo));
    letGo(photo);
    showError(err, 'Could not add that photo');
    return true;
  }
}

const retries = new Map<string, { attempt: number; timer?: ReturnType<typeof setTimeout> }>();

function retryLater(splitId: string) {
  // Offline, the connection coming back resumes them instead
  if (isOffline()) return;
  const retry = retries.get(splitId) ?? { attempt: 0 };
  clearTimeout(retry.timer);
  const delay = Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** retry.attempt++);
  retry.timer = setTimeout(() => void sendSplit(splitId), delay);
  retries.set(splitId, retry);
}

function retryDone(splitId: string) {
  clearTimeout(retries.get(splitId)?.timer);
  retries.delete(splitId);
}

/** Sends what can go of a split's photos, oldest first */
async function sendSplitOnce(splitId: string, gen: number) {
  if (isOffline()) {
    setBusy(photosOf(splitId), false);
    return;
  }
  setBusy(
    photosOf(splitId).filter((p) => !p.preparing),
    true,
  );
  try {
    await whenOnServer(splitId);
  } catch (err) {
    if (gen !== generation) return;
    // The split was never made on the server, so its photos have nowhere to go
    const lost = photosOf(splitId).filter((p) => !p.preparing && !sending.has(p.id));
    for (const photo of lost) {
      await removeCacheEntry(photoKey(photo));
      letGo(photo);
    }
    if (lost.length > 0) showError(err, 'Could not add those photos');
    return;
  }

  let later = false;
  let saved: Promise<boolean> | null = null;
  const splitSaved = () =>
    (saved ??= (open.get(splitId)?.whenSaved() ?? Promise.resolve()).then(
      () => true,
      () => false,
    ));
  const started: Promise<void>[] = [];
  for (const photo of photosOf(splitId)) {
    if (gen !== generation) return;
    // Later ones wait for it, so they go in the order they were picked
    if (photo.preparing) break;
    if (sending.has(photo.id)) continue;
    if (photo.itemId != null && !(await itemSaved(splitId, photo.itemId, splitSaved))) {
      setBusy([photo], false);
      later = true;
      continue;
    }
    const done = await takeTurn();
    if (gen !== generation || held.get(photo.id) !== photo || isOffline()) {
      done();
      if (isOffline()) break;
      continue;
    }
    sending.add(photo.id);
    started.push(
      upload(photo, gen)
        .then((sent) => {
          if (!sent) later = true;
        })
        .finally(() => {
          sending.delete(photo.id);
          done();
        }),
    );
  }
  await Promise.all(started);
  if (gen !== generation) return;
  if (later) retryLater(splitId);
  else retryDone(splitId);
}

const runs = new Map<string, Promise<void>>();
const again = new Set<string>();

/** Sends a split's photos; asked again while it's under way, it goes round once more */
function sendSplit(splitId: string): Promise<void> {
  const running = runs.get(splitId);
  if (running) {
    again.add(splitId);
    return running;
  }
  const gen = generation;
  const run = (async () => {
    do {
      again.delete(splitId);
      await sendSplitOnce(splitId, gen).catch((err: unknown) => console.error(err));
    } while (again.has(splitId) && gen === generation);
    // Whatever didn't go waits for the next chance
    if (gen === generation) {
      setBusy(
        photosOf(splitId).filter((p) => !p.preparing && !sending.has(p.id)),
        false,
      );
    }
  })().finally(() => {
    if (runs.get(splitId) === run) runs.delete(splitId);
  });
  runs.set(splitId, run);
  return run;
}

// ---------- When to try ----------

let listening = false;

/** Back online or back to the app: everything kept for this account is tried again */
function listenForResume() {
  if (listening) return;
  listening = true;
  window.addEventListener('online', () => void resumePhotoUploads());
  window.addEventListener('offline', () =>
    setBusy(
      [...held.values()].filter((p) => !p.preparing && !sending.has(p.id)),
      false,
    ),
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void resumePhotoUploads();
  });
}

/**
 * Picks up photos kept on the device (for one split, or every split of this account)
 * and sends those that can go. Call once the account is known, and when a split opens.
 */
export async function resumePhotoUploads(splitId?: string) {
  listenForResume();
  await loadKept(splitId);
  const splits =
    splitId != null ? [splitId] : [...new Set([...held.values()].map((p) => p.splitId))];
  await Promise.all(splits.map(sendSplit));
}

/**
 * While a split is open: its waiting photos are shown, and its receipts wait for its
 * changes to be saved. Returns the function to call when it closes.
 */
export function openSplitPhotos(splitId: string, hooks: OpenSplit): () => void {
  open.set(splitId, hooks);
  void resumePhotoUploads(splitId);
  return () => {
    if (open.get(splitId) === hooks) open.delete(splitId);
  };
}

// ---------- Adding and removing ----------

/**
 * Shrinks a picked photo and keeps it on the device, with where it was taken once that's
 * known; false if it can't be read
 */
async function prepare(photo: Held, file: Blob, gen: number, place: Promise<Position | null>) {
  const done = await takeTurn();
  try {
    let image: Blob;
    try {
      image = await shrinkImage(file);
    } catch (err) {
      if (gen === generation) {
        letGo(photo);
        showError(err, 'Could not add that photo');
      }
      return false;
    }
    photo.place = await place.catch(() => null);
    if (gen !== generation || held.get(photo.id) !== photo) return false;
    try {
      const { id, splitId, itemId, name, createdAt } = photo;
      const bytes = await readBytes(image);
      photo.onDevice = await writeCache<Kept>(photoKey(photo), {
        id,
        splitId,
        itemId,
        name,
        createdAt,
        type: image.type || 'image/jpeg',
        bytes,
        place: photo.place,
      });
      // Not kept (storage full, say): the app says so
      reportKept(photo.onDevice);
      // Kept: the service worker sends it if the app closes first
      if (photo.onDevice) requestBackgroundSync();
    } catch {
      // Not kept: it's sent from memory, and lost if the app closes first
    }
    if (gen !== generation) return false;
    photo.image = image;
    photo.preparing = false;
    changed();
    return true;
  } finally {
    done();
  }
}

/**
 * Adds photos to a split, or receipts to one of its items. They show at once, and are
 * shrunk and kept on the device (resolving once they are), then uploaded when they can.
 * `places` says where each was taken, read from the original before it's shrunk.
 */
export async function addPhotos(
  splitId: string,
  itemId: string | null,
  files: File[],
  places: Promise<(Position | null)[]> = Promise.resolve([]),
) {
  listenForResume();
  const gen = generation;
  const picked = files.map((file): Held => {
    // Kept in the order picked, even when picked in the same moment
    lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1);
    return {
      id: newId(),
      splitId,
      itemId,
      name: file.name,
      createdAt: lastCreatedAt,
      image: file,
      busy: true,
      preparing: true,
      onDevice: false,
      place: null,
    };
  });
  for (const photo of picked) held.set(photo.id, photo);
  changed();
  await Promise.all(
    picked.map(async (photo, i) => {
      if (
        await prepare(
          photo,
          files[i],
          gen,
          places.then((all) => all[i] ?? null),
        )
      ) {
        void sendSplit(splitId);
      }
    }),
  );
}

/** Removes a photo that's waiting; one on its way up can't be stopped, so stays */
export async function removeQueuedPhoto(id: string) {
  const photo = held.get(id);
  if (photo == null || sending.has(id) || photo.preparing) return false;
  letGo(photo);
  await removeCacheEntry(photoKey(photo));
  return true;
}

/**
 * Lets go of the photos this page holds, leaving what's on the device: when the device's
 * cache is emptied (taking them with it), and between tests
 */
export function forgetQueuedPhotos() {
  generation++;
  held.clear();
  sending.clear();
  finished.clear();
  runs.clear();
  again.clear();
  retries.forEach((retry) => clearTimeout(retry.timer));
  retries.clear();
  changed();
}

onCacheCleared(forgetQueuedPhotos);
