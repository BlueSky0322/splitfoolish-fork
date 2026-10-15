import { useCallback, useState } from 'react';
import { api } from '../api';
import type { MetaChanges } from './state';
import type { SplitMeta } from './state';
import { shrinkImage } from '../utils/image';
import type { Attachment } from '@shared/api';
import { showError } from '../utils/notify';

interface UsePhotosOptions {
  splitId: string;
  meta: SplitMeta | null;
  metaChanges: Pick<MetaChanges, 'addAttachment' | 'changeMeta'>;
  /** Resolves once queued changes are saved, so a new item exists before its photos */
  whenSaved: () => Promise<void>;
}

// Receipt photos on items and photos of the whole split: shrinking, uploading and
// removing them, keeping the split's list of photos in step
export function usePhotos({ splitId, meta, metaChanges, whenSaved }: UsePhotosOptions) {
  const { addAttachment, changeMeta } = metaChanges;
  // Photos on their way up, per item id ('' for the split itself), shown meanwhile
  const [uploading, setUploading] = useState<Record<string, File[]>>({});

  const adding = (key: string, files: File[]) =>
    setUploading((u) => ({ ...u, [key]: [...(u[key] ?? []), ...files] }));
  const done = (key: string, file: File) =>
    setUploading((u) => ({ ...u, [key]: (u[key] ?? []).filter((f) => f !== file) }));

  const upload = useCallback(
    async (files: File[], itemId: string | null) => {
      const key = itemId ?? '';
      adding(key, files);
      try {
        await whenSaved();
      } catch (err) {
        files.forEach((f) => done(key, f));
        showError(err, 'Could not save the item first');
        return;
      }
      await Promise.all(
        files.map(async (file) => {
          try {
            const photo = await shrinkImage(file);
            const added = await api.uploadAttachment(splitId, photo, itemId);
            addAttachment(added);
          } catch (err) {
            showError(err, 'Could not add that photo');
          } finally {
            done(key, file);
          }
        }),
      );
    },
    [splitId, addAttachment, whenSaved],
  );

  const remove = useCallback(
    (photo: Attachment) =>
      changeMeta(
        (m) => ({ ...m, attachments: m.attachments.filter((a) => a.id !== photo.id) }),
        async () => void (await api.deleteAttachment(splitId, photo.id)),
        'Could not remove that photo',
      ),
    [splitId, changeMeta],
  );

  const photosOf = (itemId: string | null) =>
    meta?.attachments.filter((a) => a.itemId === itemId) ?? [];

  return { upload, remove, photosOf, uploading };
}
