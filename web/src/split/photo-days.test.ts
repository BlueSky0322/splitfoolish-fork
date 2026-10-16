import { describe, expect, test } from 'vitest';
import type { Attachment } from '@shared/api';
import { DEFAULT_PHOTO_VIEW, fileLabel, photoCounts, photoDays } from './photo-days';

const day = (d: number, hour = 12) => new Date(2025, 9, d, hour).getTime();

const photo = (id: string, createdAt: number, itemId: string | null = null): Attachment => ({
  id,
  itemId,
  size: 1000,
  contentType: 'image/jpeg',
  uploadedBy: 'ann@example.com',
  createdAt,
});

const photos = [
  photo('beach', day(10, 9)),
  photo('dinner-receipt', day(11, 20), 'dinner'),
  photo('sunset', day(11, 19)),
  photo('taxi-receipt', day(11, 8), 'taxi'),
];
// The taxi was on the 9th, though its receipt was added on the 11th
const itemDates = new Map([
  ['dinner', day(11, 18)],
  ['taxi', day(9, 7)],
]);

const ids = (days: ReturnType<typeof photoDays>) => days.map((d) => d.photos.map((p) => p.id));

describe('the Photos tab on a computer', () => {
  test('shows the newest first, by the day each was added', () => {
    const days = photoDays(photos, itemDates, DEFAULT_PHOTO_VIEW);
    expect(ids(days)).toEqual([['dinner-receipt', 'sunset', 'taxi-receipt'], ['beach']]);
    expect(days[0].label).toBe(
      new Date(day(11)).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }),
    );
  });

  test('oldest first turns the days and the photos in them around', () => {
    const days = photoDays(photos, itemDates, { ...DEFAULT_PHOTO_VIEW, sortDir: 'asc' });
    expect(ids(days)).toEqual([['beach'], ['taxi-receipt', 'sunset', 'dinner-receipt']]);
  });

  test("by item date, a receipt goes with its item's day and a split photo keeps its own", () => {
    const days = photoDays(photos, itemDates, { ...DEFAULT_PHOTO_VIEW, sortKey: 'item' });
    expect(ids(days)).toEqual([['sunset', 'dinner-receipt'], ['beach'], ['taxi-receipt']]);
  });

  test('a receipt whose item is gone keeps the day it was added', () => {
    const days = photoDays(photos, new Map(), { ...DEFAULT_PHOTO_VIEW, sortKey: 'item' });
    expect(ids(days)).toEqual([['dinner-receipt', 'sunset', 'taxi-receipt'], ['beach']]);
  });

  test('shows only receipts, or only photos of the split, and counts each', () => {
    expect(
      ids(photoDays(photos, itemDates, { ...DEFAULT_PHOTO_VIEW, filter: 'receipts' })),
    ).toEqual([['dinner-receipt', 'taxi-receipt']]);
    expect(ids(photoDays(photos, itemDates, { ...DEFAULT_PHOTO_VIEW, filter: 'split' }))).toEqual([
      ['sunset'],
      ['beach'],
    ]);
    expect(photoCounts(photos)).toEqual({ all: 4, receipts: 2, split: 2 });
  });

  test('describes the file by its kind and size', () => {
    expect(fileLabel({ contentType: 'image/jpeg', size: 2_400_000 })).toBe('JPEG, 2.4 MB');
    expect(fileLabel({ contentType: 'image/webp', size: 312_400 })).toBe('WebP, 312 KB');
    expect(fileLabel({ contentType: 'image/png', size: 200 })).toBe('PNG, 1 KB');
  });
});
