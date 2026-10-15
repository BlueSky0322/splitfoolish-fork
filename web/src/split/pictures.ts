import { useSyncExternalStore } from 'react';
import { api } from '../api';
import { whenCreated } from '../offline/pending-creates';
import { shrinkAvatar } from '../utils/image';
import { patchListedSplit, sendMySplitsChange } from '../my-splits/my-splits';

// Split pictures being uploaded, shown from this device in the meantime

const previews = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The picture still uploading for a split, if any */
export const useSplitPicturePreview = (splitId: string) =>
  useSyncExternalStore(subscribe, () => previews.get(splitId) ?? null);

// Both follow sendMySplitsChange: shown in My splits straight away, a failure explained
// here, and resolving with the new picture version (or undefined after a failure)

/** Shows the picture straight away and uploads it once the split exists */
export async function uploadSplitPicture(splitId: string, file: File) {
  let url: string | null = null;
  try {
    return await sendMySplitsChange(async () => {
      const picture = await shrinkAvatar(file);
      url = URL.createObjectURL(picture);
      previews.set(splitId, url);
      notify();
      await whenCreated(splitId);
      const { pictureVersion } = await api.setSplitPicture(splitId, picture);
      patchListedSplit(splitId, { pictureVersion });
      return pictureVersion;
    }, 'Could not change the picture');
  } finally {
    // Keep the local copy a moment longer, so the uploaded one has time to load
    const shown = url;
    if (shown != null) {
      setTimeout(() => {
        if (previews.get(splitId) === shown) previews.delete(splitId);
        URL.revokeObjectURL(shown);
        notify();
      }, 3000);
    }
  }
}

export function removeSplitPicture(splitId: string) {
  patchListedSplit(splitId, { pictureVersion: null });
  return sendMySplitsChange(
    () => api.deleteSplitPicture(splitId).then(() => null),
    'Could not remove the picture',
  );
}
