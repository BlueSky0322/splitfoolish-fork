import type { Attachment } from '@shared/api';
import { dayKey, dayLabel } from './grouping';

// How the Photos tab orders and groups the photos on a split's items: by the day they were
// added, or by their item's date, newest or oldest first

export type PhotoSortKey = 'added' | 'item';
export type PhotoSortDir = 'desc' | 'asc';

export interface PhotoView {
  sortKey: PhotoSortKey;
  sortDir: PhotoSortDir;
}

export const DEFAULT_PHOTO_VIEW: PhotoView = { sortKey: 'added', sortDir: 'desc' };

/** The orders a phone's sort menu offers, as a computer's does */
export const PHONE_PHOTO_SORTS: { sortKey: PhotoSortKey; sortDir: PhotoSortDir; label: string }[] =
  [
    { sortKey: 'added', sortDir: 'desc', label: 'Newest' },
    { sortKey: 'added', sortDir: 'asc', label: 'Oldest' },
    { sortKey: 'item', sortDir: 'desc', label: 'Item date, newest' },
    { sortKey: 'item', sortDir: 'asc', label: 'Item date, oldest' },
  ];

export interface PhotoDay {
  key: string;
  /** "Sat 11 Oct" */
  label: string;
  photos: Attachment[];
}

/** A photo on an item (a receipt): the only kind the tab shows */
export const isReceipt = (photo: Attachment) => photo.itemId != null;

/** The items' photos, by day: the day they were added, or their item's date */
export function photoDays(
  photos: Attachment[],
  itemDates: Map<string, number>,
  { sortKey, sortDir }: PhotoView,
): PhotoDay[] {
  const when = (photo: Attachment) =>
    (sortKey === 'item' && photo.itemId != null ? itemDates.get(photo.itemId) : undefined) ??
    photo.createdAt;
  const sign = sortDir === 'desc' ? -1 : 1;
  const sorted = photos
    .filter(isReceipt)
    .sort((a, b) => sign * (when(a) - when(b) || a.createdAt - b.createdAt));

  const days: PhotoDay[] = [];
  for (const photo of sorted) {
    const time = when(photo);
    const key = dayKey(time);
    const last = days.at(-1);
    if (last?.key === key) last.photos.push(photo);
    else days.push({ key, label: dayLabel(time), photos: [photo] });
  }
  return days;
}

const FILE_KINDS: Partial<Record<string, string>> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

/** "JPEG, 2.4 MB" */
export function fileLabel(photo: Pick<Attachment, 'contentType' | 'size'>) {
  const kind = FILE_KINDS[photo.contentType] ?? 'Image';
  const size =
    photo.size >= 1_000_000
      ? `${(photo.size / 1_000_000).toFixed(1)} MB`
      : `${Math.max(1, Math.round(photo.size / 1000))} KB`;
  return `${kind}, ${size}`;
}
