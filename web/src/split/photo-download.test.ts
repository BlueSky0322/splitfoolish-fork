import { describe, expect, test } from 'vitest';
import type { Attachment } from '@shared/api';
import { photoFileName, photoFileNames, zipFileName } from './photo-download';

const at = new Date(2026, 9, 11, 21, 4, 5).getTime();
const photo = (id: string, createdAt: number, contentType = 'image/jpeg'): Attachment => ({
  id,
  itemId: null,
  size: 1,
  contentType,
  uploadedBy: 'ann@example.com',
  createdAt,
});

describe('downloaded photo names', () => {
  test('are when the photo was added, with its own kind of file', () => {
    expect(photoFileName(photo('a', at))).toBe('2026-10-11 21-04-05.jpg');
    expect(photoFileName(photo('b', at, 'image/png'))).toBe('2026-10-11 21-04-05.png');
    expect(photoFileName(photo('c', at, 'image/webp'))).toBe('2026-10-11 21-04-05.webp');
  });

  test('photos added in the same second are numbered, so none overwrites another', () => {
    expect(
      photoFileNames([photo('a', at), photo('b', at + 400), photo('c', at + 1000), photo('d', at)]),
    ).toEqual([
      '2026-10-11 21-04-05.jpg',
      '2026-10-11 21-04-05 (2).jpg',
      '2026-10-11 21-04-06.jpg',
      '2026-10-11 21-04-05 (3).jpg',
    ]);
  });

  test("the zip is named for the split, without characters file names can't hold", () => {
    expect(zipFileName('Langkawi trip')).toBe('Langkawi trip photos.zip');
    expect(zipFileName('Tokyo / Osaka: day 1?')).toBe('Tokyo   Osaka  day 1 photos.zip');
    expect(zipFileName('///')).toBe('Split photos.zip');
  });
});
