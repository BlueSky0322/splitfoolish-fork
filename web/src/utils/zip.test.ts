import { describe, expect, test } from 'vitest';
import { crc32, makeZip } from './zip';

const bytes = (text: string) => new TextEncoder().encode(text);

/** Reads a zip back as an unzip tool does: from the end record, through the directory */
async function unzip(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  const end = buf.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  expect(at + view.getUint32(end + 12, true)).toBe(end);

  const files = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.slice(at + 46, at + 46 + nameLength));
    const time = view.getUint16(at + 12, true);
    const date = view.getUint16(at + 14, true);
    at += 46 + nameLength;

    // The local header agrees with the directory, and the data follows it
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 8, true)).toBe(0);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    const localName = view.getUint16(local + 26, true);
    const start = local + 30 + localName + view.getUint16(local + 28, true);
    const data = buf.slice(start, start + size);
    expect(crc32(data)).toBe(crc);
    files.push({ name, data, time, date });
  }
  return files;
}

describe('zip files', () => {
  test('checksums match the standard ones', () => {
    expect(crc32(bytes(''))).toBe(0);
    expect(crc32(bytes('hello'))).toBe(0x3610a686);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  test('holds each file, by name, exactly as given', async () => {
    const photo = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    const zip = makeZip([
      { name: '2026-10-11 21-14-05.jpg', data: photo, modified: new Date(2026, 9, 11, 21, 14, 5) },
      { name: 'Café receipt.png', data: bytes('png'), modified: new Date(2026, 9, 10, 8, 0, 0) },
    ]);
    expect(zip.type).toBe('application/zip');

    const files = await unzip(zip);
    expect(files.map((f) => f.name)).toEqual(['2026-10-11 21-14-05.jpg', 'Café receipt.png']);
    expect(files[0].data).toEqual(photo);
    expect(new TextDecoder().decode(files[1].data)).toBe('png');
    // 21:14:04 (to two seconds) on 11 Oct 2026
    expect(files[0].time).toBe((21 << 11) | (14 << 5) | 2);
    expect(files[0].date).toBe(((2026 - 1980) << 9) | (10 << 5) | 11);
  });

  test('an empty zip is still a zip', async () => {
    expect(await unzip(makeZip([]))).toEqual([]);
  });
});
