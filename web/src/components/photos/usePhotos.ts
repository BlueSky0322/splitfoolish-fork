import { notifications } from '@mantine/notifications';
import { useCallback, useState } from 'react';
import { Attachment, api } from '../../api';
import { SplitMeta } from '../../hooks/useSplit';
import { shrinkImage } from '../../utils/image';

interface UsePhotosOptions {
  splitId: string;
  meta: SplitMeta | null;
  setMeta: (update: (meta: SplitMeta | null) => SplitMeta | null) => void;
  /** Resolves once queued changes are saved, so a new item exists before its photos */
  whenSaved: () => Promise<void>;
}

const fail = (err: unknown, fallback: string) =>
  notifications.show({ color: 'red', message: err instanceof Error ? err.message : fallback });

// Receipt photos on items and photos of the whole split: shrinking, uploading and
// removing them, keeping the split's list of photos in step
export function usePhotos({ splitId, meta, setMeta, whenSaved }: UsePhotosOptions) {
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
        fail(err, 'Could not save the item first');
        return;
      }
      await Promise.all(
        files.map(async (file) => {
          try {
            const photo = await shrinkImage(file);
            const added = await api.uploadPhoto(splitId, photo, itemId);
            setMeta((m) => (m ? { ...m, attachments: [...m.attachments, added] } : m));
          } catch (err) {
            fail(err, 'Could not add that photo');
          } finally {
            done(key, file);
          }
        }),
      );
    },
    [splitId, setMeta, whenSaved],
  );

  const remove = useCallback(
    async (photo: Attachment) => {
      // Hide it straight away; put it back if the server says no
      setMeta((m) =>
        m ? { ...m, attachments: m.attachments.filter((a) => a.id !== photo.id) } : m,
      );
      try {
        await api.deletePhoto(splitId, photo.id);
      } catch (err) {
        setMeta((m) => (m ? { ...m, attachments: [...m.attachments, photo] } : m));
        fail(err, 'Could not remove that photo');
      }
    },
    [splitId, setMeta],
  );

  const photosOf = (itemId: string | null) =>
    meta?.attachments.filter((a) => a.itemId === itemId) ?? [];

  /** Forgets photos of an item that was deleted (the server removed them with it) */
  const forgetItem = useCallback(
    (itemId: string) =>
      setMeta((m) =>
        m ? { ...m, attachments: m.attachments.filter((a) => a.itemId !== itemId) } : m,
      ),
    [setMeta],
  );

  return { upload, remove, photosOf, forgetItem, uploading };
}
