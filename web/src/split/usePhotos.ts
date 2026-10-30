import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { api } from '../api';
import type { MetaChanges } from './state';
import type { SplitMeta } from './state';
import type { Attachment } from '@shared/api';
import { useProfile } from '../profile/ProfileContext';
import { type PhotoSource, locatePhotos } from './photo-places';
import type { Position } from '../utils/here';
import {
  type QueuedPhoto,
  addPhotos,
  openSplitPhotos,
  queuedPhotos,
  removeQueuedPhoto,
  subscribeQueuedPhotos,
} from '../offline/photo-queue';

export type { QueuedPhoto };

interface UsePhotosOptions {
  splitId: string;
  meta: SplitMeta | null;
  metaChanges: Pick<MetaChanges, 'addAttachment' | 'changeMeta'>;
  /** Resolves once queued changes are saved, so a new item exists before its photos */
  whenSaved: () => Promise<void>;
}

const NONE: QueuedPhoto[] = [];

// Receipt photos on items and photos of the whole split: adding them (through the
// device's photo queue, offline/photo-queue.ts, so they survive going offline or the app
// closing) and removing them, keeping the split's list of photos in step
export function usePhotos({ splitId, meta, metaChanges, whenSaved }: UsePhotosOptions) {
  const { addAttachment, changeMeta } = metaChanges;
  const all = useSyncExternalStore(subscribeQueuedPhotos, queuedPhotos);

  // While the split is open, its photos waiting on the device show here and go when they
  // can, each joining the split's photos once uploaded
  useEffect(
    () => openSplitPhotos(splitId, { whenSaved, onUploaded: addAttachment }),
    [splitId, whenSaved, addAttachment],
  );

  // Photos still to upload, per item id ('' for the split itself), shown meanwhile
  const queued = useMemo(() => {
    const byItem: Record<string, QueuedPhoto[]> = {};
    for (const photo of all) {
      if (photo.splitId !== splitId) continue;
      (byItem[photo.itemId ?? ''] ??= []).push(photo);
    }
    for (const list of Object.values(byItem)) list.sort((a, b) => a.createdAt - b.createdAt);
    return byItem;
  }, [all, splitId]);
  const queuedOf = useCallback((itemId: string | null) => queued[itemId ?? ''] ?? NONE, [queued]);

  // Where each was taken goes with it: what the photo says, and for one just taken here,
  // where the phone is if the account records that. Answers the first place found, for an
  // item that has none yet to take.
  const recordLocation = useProfile().profile?.settings.recordLocation ?? true;
  const upload = useCallback(
    async (
      files: File[],
      itemId: string | null,
      from: PhotoSource | (Position | null)[] = 'library',
    ) => {
      // The photos show at once; where they were taken is kept with them once known.
      // Photos picked for an item not yet added were located as they were picked.
      const places = Array.isArray(from)
        ? Promise.resolve(from)
        : locatePhotos(files, from, recordLocation);
      void addPhotos(splitId, itemId, files, places);
      return (await places).find((p) => p != null) ?? null;
    },
    [splitId, recordLocation],
  );

  /** Removes a photo still waiting to upload; it was only ever on this device */
  const removeQueued = useCallback((photo: QueuedPhoto) => void removeQueuedPhoto(photo.id), []);

  /** Removes them all at once: they go together, and come back together if that fails */
  const removeMany = useCallback(
    (gone: Attachment[]) => {
      const ids = new Set(gone.map((p) => p.id));
      return changeMeta(
        (m) => ({ ...m, attachments: m.attachments.filter((a) => !ids.has(a.id)) }),
        async () => void (await api.deleteAttachments(splitId, [...ids])),
        gone.length === 1 ? 'Could not remove that photo' : 'Could not remove those photos',
      );
    },
    [splitId, changeMeta],
  );

  const remove = useCallback((photo: Attachment) => removeMany([photo]), [removeMany]);

  const photosOf = (itemId: string | null) =>
    meta?.attachments.filter((a) => a.itemId === itemId) ?? [];

  return { upload, remove, removeMany, photosOf, queuedOf, removeQueued };
}
