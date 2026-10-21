// Reading an uploaded image and serving one back. Photos are stored in D1 next to the
// rest of the data, so they are private by default: served only through the Worker,
// with the same membership checks. They are shrunk in the browser before upload, to
// the sizes in shared/api.ts.

import { IMAGE_VIEWER_HEADER } from '../../shared/api';
import { bodyRefused, fail, readBody } from '../http';

/** The image type from the file's first bytes, so a mislabelled upload can't pass as an image */
function detectImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * The most pixels a photo may have on a side, and in all. The app sends photos 1600px
 * at most; an agent's may be a phone's full size. Far past that, one could take a lot of
 * memory to show, in each app that opens it, from a small file.
 */
export const MAX_IMAGE_SIDE = 8192;
export const MAX_IMAGE_PIXELS = 40_000_000;

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) =>
  ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + u16be(b, i + 2);
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** A JPEG's size, from its first frame header (SOF), without decoding it */
function jpegSize(b: Uint8Array): [number, number] | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    // Fill bytes, and markers with no length
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) return [u16be(b, i + 7), u16be(b, i + 5)];
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

/** An image's width and height from its header, or null when they can't be read */
export function imageSize(b: Uint8Array, contentType: string): [number, number] | null {
  if (contentType === 'image/jpeg') return jpegSize(b);
  if (contentType === 'image/png') return b.length >= 24 ? [u32be(b, 16), u32be(b, 20)] : null;
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X)
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(...b.slice(12, 16));
  if (chunk === 'VP8 ') return [u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff];
  if (chunk === 'VP8L') {
    return [
      1 + (((b[22] & 0x3f) << 8) | b[21]),
      1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    ];
  }
  if (chunk === 'VP8X') return [1 + u24le(b, 24), 1 + u24le(b, 27)];
  return null;
}

export interface Image {
  bytes: Uint8Array;
  contentType: string;
}

/** The image sent with a request, checked; or the answer refusing it */
export async function readImage(req: Request, maxBytes: number) {
  const bytes = await readBody(req, maxBytes);
  if (bytes === 'too large') return fail('That photo is too large', 413);
  if (bytes === 'too slow') return bodyRefused(bytes);
  return checkImage(bytes, maxBytes);
}

/** An image's bytes, checked; or the answer refusing them */
export function checkImage(bytes: Uint8Array, maxBytes: number): Image | Response {
  if (bytes.length > maxBytes) return fail('That photo is too large', 413);
  if (bytes.length === 0) return fail('No photo was sent', 400);
  const contentType = detectImageType(bytes);
  if (contentType == null) {
    return fail('Only JPEG, PNG and WebP photos are supported', 415);
  }
  // Without a size to read, browsers couldn't show it either: only a size too large is refused
  const size = imageSize(bytes, contentType);
  if (
    size != null &&
    (size[0] > MAX_IMAGE_SIDE || size[1] > MAX_IMAGE_SIDE || size[0] * size[1] > MAX_IMAGE_PIXELS)
  ) {
    return fail(`Photos can be up to ${MAX_IMAGE_SIDE} pixels on a side`, 413);
  }
  return { bytes, contentType };
}

// D1 hands BLOBs back as an ArrayBuffer or an array of byte values depending on version
const toBytes = (data: ArrayBuffer | number[]) => new Uint8Array(data);

/** Who asked for a picture, and the request, which may say which copy they already have */
export interface Viewing {
  req: Request;
  viewer: string;
}

/** Whether the browser's If-None-Match names `etag` (or any copy at all) */
const alreadyHas = (req: Request, etag: string) =>
  (req.headers.get('If-None-Match') ?? '')
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === etag || tag === '*');

/**
 * A picture, already checked as the viewer's to see. `version` names its content (a
 * photo's id, a picture's version), so the browser's copy is still good while it matches.
 * Browsers keep it but ask again each time, so access taken away, or another account
 * signed in on the same browser, is checked by the server before it's shown again; a
 * copy still good is answered without the bytes.
 */
export function imageResponse(
  { req, viewer }: Viewing,
  version: string | number,
  data: ArrayBuffer | number[],
  contentType: string,
) {
  const etag = `"${version}"`;
  const headers = {
    'Cache-Control': 'private, no-cache',
    'ETag': etag,
    [IMAGE_VIEWER_HEADER]: viewer,
  };
  if (alreadyHas(req, etag)) return new Response(null, { status: 304, headers });
  return new Response(toBytes(data), {
    headers: {
      ...headers,
      'Content-Type': contentType,
      // Never treat the bytes as anything but the image type above
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
