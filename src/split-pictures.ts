import { useSyncExternalStore } from 'react';
import { api } from './api';
import { reloadHomeData, updateHomeData } from './hooks/useHomeData';
import { whenCreated } from './pending-creates';
import { AVATAR, shrinkImage } from './utils/image';

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

/** Shows the picture straight away and uploads it once the split exists */
export async function uploadSplitPicture(
  splitId: string,
  file: File,
  onSaved?: (pictureVersion: number) => void,
) {
  const picture = await shrinkImage(file, AVATAR.maxSide, AVATAR.maxBytes);
  const url = URL.createObjectURL(picture);
  previews.set(splitId, url);
  notify();
  try {
    await whenCreated(splitId);
    const { pictureVersion } = await api.setSplitPicture(splitId, picture);
    updateHomeData((data) => ({
      splits: data.splits?.map((s) => (s.id === splitId ? { ...s, pictureVersion } : s)),
    }));
    onSaved?.(pictureVersion);
  } finally {
    // Keep the local copy a moment longer, so the uploaded one has time to load
    setTimeout(() => {
      if (previews.get(splitId) === url) previews.delete(splitId);
      URL.revokeObjectURL(url);
      notify();
    }, 3000);
  }
}

export async function removeSplitPicture(splitId: string) {
  updateHomeData((data) => ({
    splits: data.splits?.map((s) => (s.id === splitId ? { ...s, pictureVersion: null } : s)),
  }));
  try {
    await api.removeSplitPicture(splitId);
  } catch (err) {
    void reloadHomeData();
    throw err;
  }
}
