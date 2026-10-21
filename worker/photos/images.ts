// Reading an uploaded image and serving one back. Photos are stored in D1 next to the
// rest of the data, so they are private by default: served only through the Worker,
// with the same membership checks. They are shrunk in the browser before upload, to
// the sizes in shared/api.ts.

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
  return { bytes, contentType };
}

// D1 hands BLOBs back as an ArrayBuffer or an array of byte values depending on version
const toBytes = (data: ArrayBuffer | number[]) => new Uint8Array(data);

export function imageResponse(data: ArrayBuffer | number[], contentType: string) {
  return new Response(toBytes(data), {
    headers: {
      'Content-Type': contentType,
      // Ids and versions never point at different content, so browsers can keep them
      'Cache-Control': 'private, max-age=31536000, immutable',
      // Never treat the bytes as anything but the image type above
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
