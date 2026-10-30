import type { Attachment } from '@shared/api';
import { useMemo, useState } from 'react';
import {
  DEFAULT_PHOTO_VIEW,
  type PhotoView,
  photoCounts,
  photoDays,
} from '../../../split/photo-days';
import { useSplitState } from '../../../split/SplitStateContext';
import { useSplitPage } from '../SplitPageContext';
import type { PhotoSource } from '../../../split/photo-places';
import { useConfirmRemovePhotos } from './useConfirmRemovePhotos';

/**
 * What both Photos tabs (a computer's and a phone's) show, worked out once: the photos by
 * day in the order and kinds chosen, those photos in one line for the viewer with each
 * one's place in it, how many there are of each kind, the split's photos still being
 * added, and which of the picked ones are still there. Removing asks first; render
 * `confirmDialog` alongside.
 */
export function usePhotoGallery(selected: ReadonlySet<string>) {
  const { meta, photos, canRemovePhoto } = useSplitPage();
  const { items } = useSplitState().state;
  const [view, setView] = useState<PhotoView>(DEFAULT_PHOTO_VIEW);
  const { confirm, dialog: confirmDialog } = useConfirmRemovePhotos();

  const all = useMemo(() => meta?.attachments ?? [], [meta?.attachments]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const days = useMemo(
    () => photoDays(all, new Map(items.map((i) => [i.id, i.createdAt])), view),
    [all, items, view],
  );
  const shown = useMemo(() => days.flatMap((d) => d.photos), [days]);
  const indexOf = useMemo(() => new Map(shown.map((p, i) => [p.id, i])), [shown]);
  // Picked photos still there (one removed elsewhere drops out)
  const chosen = shown.filter((p) => selected.has(p.id));

  return {
    view,
    setView,
    all,
    days,
    shown,
    /** Where a photo is among those shown, for the viewer */
    indexOf,
    counts: photoCounts(all),
    itemById,
    queued: photos.queuedOf(null),
    chosen,
    canRemoveChosen: chosen.length > 0 && chosen.every(canRemovePhoto),
    /** Removes one photo once confirmed; undefined when this account may not */
    removerOf: (photo: Attachment) =>
      canRemovePhoto(photo) ? () => confirm(1, () => photos.remove(photo)) : undefined,
    confirm,
    confirmDialog,
    /** Adds photos to the split itself, not an item */
    add: (files: File[], from?: PhotoSource) => void photos.upload(files, null, from),
  };
}
