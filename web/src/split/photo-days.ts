import type { Attachment } from '@shared/api';
import { dayKey, dayLabel } from './grouping';

// How the Photos tab orders and groups a split's photos: by the day they were added, or
// by their item's date, newest or oldest first, and which kinds it shows

export type PhotoSortKey = 'added' | 'item';
export type PhotoSortDir = 'desc' | 'asc';
export type PhotoFilter = 'all' | 'receipts' | 'split';

export interface PhotoView {
  sortKey: PhotoSortKey;
  sortDir: PhotoSortDir;
  filter: PhotoFilter;
}

export const DEFAULT_PHOTO_VIEW: PhotoView = { sortKey: 'added', sortDir: 'desc', filter: 'all' };

/** The orders a phone's sort button steps through, as a computer's sort menu offers */
export const PHONE_PHOTO_SORTS: { sortKey: PhotoSortKey; sortDir: PhotoSortDir; label: string }[] =
  [
    { sortKey: 'added', sortDir: 'desc', label: 'Newest' },
    { sortKey: 'added', sortDir: 'asc', label: 'Oldest' },
    { sortKey: 'item', sortDir: 'desc', label: 'Item date, newest' },
    { sortKey: 'item', sortDir: 'asc', label: 'Item date, oldest' },
  ];

/** The kinds a phone's filter button steps through, in order */
export const PHOTO_FILTERS: { filter: PhotoFilter; label: string }[] = [
  { filter: 'all', label: 'All' },
  { filter: 'receipts', label: 'Receipts' },
  { filter: 'split', label: 'Split photos' },
];

/** The next in a list after the one that matches, back to the first after the last */
export const nextOf = <T>(list: T[], matches: (entry: T) => boolean) =>
  list[(list.findIndex(matches) + 1) % list.length];

export interface PhotoDay {
  key: string;
  /** "Sat 11 Oct" */
  label: string;
  photos: Attachment[];
}

const isReceipt = (photo: Attachment) => photo.itemId != null;

export const photoCounts = (photos: Attachment[]) => {
  const receipts = photos.filter(isReceipt).length;
  return { all: photos.length, receipts, split: photos.length - receipts };
};

const shows = (filter: PhotoFilter) => (photo: Attachment) =>
  filter === 'all' || (filter === 'receipts') === isReceipt(photo);

/**
 * The photos shown, by day. Sorted by item date, a receipt goes with its item's date
 * and a photo of the split keeps the day it was added.
 */
export function photoDays(
  photos: Attachment[],
  itemDates: Map<string, number>,
  { sortKey, sortDir, filter }: PhotoView,
): PhotoDay[] {
  const when = (photo: Attachment) =>
    (sortKey === 'item' && photo.itemId != null ? itemDates.get(photo.itemId) : undefined) ??
    photo.createdAt;
  const sign = sortDir === 'desc' ? -1 : 1;
  const sorted = photos
    .filter(shows(filter))
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
