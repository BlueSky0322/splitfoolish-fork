import { describe, expect, test } from 'vitest';
import { photoPosition, readPosition } from './exif';

/**
 * A JPEG's opening bytes with an EXIF block holding a GPS position, written as a camera
 * would: degrees, minutes and seconds as fractions, with N/S and E/W
 */
function jpegWithGps(
  { lat, latRef, lng, lngRef }: { lat: number[]; latRef: string; lng: number[]; lngRef: string },
  little: boolean,
) {
  const tiff = new DataView(new ArrayBuffer(200));
  const u16 = (at: number, v: number) => tiff.setUint16(at, v, little);
  const u32 = (at: number, v: number) => tiff.setUint32(at, v, little);
  tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
  u16(2, 42);
  u32(4, 8);
  // IFD0 at 8: one entry, the GPS directory's place
  u16(8, 1);
  u16(10, 0x8825);
  u16(12, 4);
  u32(14, 1);
  u32(18, 26);
  // GPS directory at 26: four entries
  u16(26, 4);
  const entry = (i: number, tag: number, type: number, count: number, value: number) => {
    const at = 28 + i * 12;
    u16(at, tag);
    u16(at + 2, type);
    u32(at + 4, count);
    u32(at + 8, value);
  };
  entry(0, 1, 2, 2, 0);
  tiff.setUint8(28 + 8, latRef.charCodeAt(0));
  entry(1, 2, 5, 3, 100);
  entry(2, 3, 2, 2, 0);
  tiff.setUint8(28 + 12 + 12 + 8, lngRef.charCodeAt(0));
  entry(3, 4, 5, 3, 124);
  const rationals = (at: number, [d, m, s]: number[]) =>
    [d, m, Math.round(s * 100)].forEach((n, i) => {
      u32(at + i * 8, n);
      u32(at + i * 8 + 4, i === 2 ? 100 : 1);
    });
  rationals(100, lat);
  rationals(124, lng);

  const bytes = new Uint8Array(4 + 10 + 200 + 4);
  bytes.set([0xff, 0xd8, 0xff, 0xe1, 0, 8 + 200]);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6);
  bytes.set(new Uint8Array(tiff.buffer), 12);
  bytes.set([0xff, 0xda, 0, 2], 212);
  return bytes;
}

// Truz Tackles, Kuala Selangor: 3°20'24.6"N 101°15'1.8"E
const kualaSelangor = { lat: [3, 20, 24.6], latRef: 'N', lng: [101, 15, 1.8], lngRef: 'E' };

describe('where a photo was taken', () => {
  test.each([
    ['big-endian', false],
    ['little-endian', true],
  ])('reads the GPS position a camera wrote, %s', async (_name, little) => {
    const position = await photoPosition(new Blob([jpegWithGps(kualaSelangor, little)]));
    expect(position!.lat).toBeCloseTo(3.34017, 5);
    expect(position!.lng).toBeCloseTo(101.2505, 5);
  });

  test('south and west are negative', () => {
    const bytes = jpegWithGps(
      { lat: [33, 52, 4], latRef: 'S', lng: [151, 12, 36], lngRef: 'W' },
      true,
    );
    const position = readPosition(new DataView(bytes.buffer));
    expect(position!.lat).toBeCloseTo(-33.8678, 4);
    expect(position!.lng).toBeCloseTo(-151.21, 4);
  });

  test('says nothing for a photo without a position, one with no fix, or not a JPEG', async () => {
    const noFix = jpegWithGps({ lat: [0, 0, 0], latRef: 'N', lng: [0, 0, 0], lngRef: 'E' }, true);
    expect(readPosition(new DataView(noFix.buffer))).toBeNull();
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]);
    expect(readPosition(new DataView(plain.buffer))).toBeNull();
    expect(await photoPosition(new Blob(['\x89PNG not a jpeg']))).toBeNull();
    // Cut off in the middle of its EXIF block
    expect(
      await photoPosition(new Blob([jpegWithGps(kualaSelangor, true).slice(0, 60)])),
    ).toBeNull();
  });
});
