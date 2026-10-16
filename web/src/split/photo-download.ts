import { useState } from 'react';
import type { Attachment } from '@shared/api';
import { attachmentUrl } from '../api';
import { showError } from '../utils/notify';
import { makeZip } from '../utils/zip';

// Saving a split's photos to the device, each named for when it was added. Several at
// once go in one zip on a computer; a phone saves them one by one, as it would any photo.

const EXTENSIONS: Partial<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const two = (n: number) => String(n).padStart(2, '0');

/** "2026-10-11 21-14-05.jpg": when it was added, in local time (no colons, for Windows) */
export function photoFileName(photo: Pick<Attachment, 'createdAt' | 'contentType'>) {
  const d = new Date(photo.createdAt);
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  const time = `${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}`;
  return `${day} ${time}.${EXTENSIONS[photo.contentType] ?? 'jpg'}`;
}

/** Each photo's file name, with " (2)" and so on for any added in the same second */
export function photoFileNames(photos: Attachment[]) {
  const used = new Map<string, number>();
  return photos.map((photo) => {
    const name = photoFileName(photo);
    const n = (used.get(name) ?? 0) + 1;
    used.set(name, n);
    return n === 1 ? name : name.replace(/(\.\w+)$/, ` (${n})$1`);
  });
}

/** "Langkawi trip photos.zip", leaving out what file names can't hold */
export const zipFileName = (splitName: string) =>
  `${splitName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Split'} photos.zip`;

function save(href: string, name: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
}

/** Browsers can stop a page saving many files at once; a short wait between keeps them */
const SAVE_GAP_MS = 400;

async function fetchPhoto(splitId: string, photo: Attachment) {
  const res = await fetch(attachmentUrl(splitId, photo.id));
  if (!res.ok) throw new Error(`Couldn't fetch a photo (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Saves the photos. With `zip` (computers) more than one go in a single zip named for
 * the split; otherwise each is saved on its own.
 */
export async function downloadPhotos(
  splitId: string,
  splitName: string,
  photos: Attachment[],
  { zip }: { zip: boolean },
) {
  const names = photoFileNames(photos);
  if (!zip || photos.length === 1) {
    for (const [i, photo] of photos.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, SAVE_GAP_MS));
      save(attachmentUrl(splitId, photo.id), names[i]);
    }
    return;
  }
  const files = await Promise.all(photos.map((photo) => fetchPhoto(splitId, photo)));
  const blob = makeZip(
    photos.map((photo, i) => ({
      name: names[i],
      data: files[i],
      modified: new Date(photo.createdAt),
    })),
  );
  const url = URL.createObjectURL(blob);
  save(url, zipFileName(splitName));
  // Long enough for the browser to start saving it
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** downloadPhotos for a button: busy while the zip is made, and saying if it fails */
export function usePhotoDownload(splitId: string, splitName: string, { zip }: { zip: boolean }) {
  const [busy, setBusy] = useState(false);
  const download = async (photos: Attachment[]) => {
    setBusy(true);
    try {
      await downloadPhotos(splitId, splitName, photos, { zip });
    } catch (err) {
      showError(err, "Couldn't download those photos");
    } finally {
      setBusy(false);
    }
  };
  return { download, busy };
}
