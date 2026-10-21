import { describe, expect, test } from 'vitest';
import { checkImage, imageSize } from './images';

// A photo's size, read from its header without decoding it, so one far larger than any
// photo needs to be is turned away. The headers are the first bytes of files a real
// encoder (Pillow) wrote at these sizes.

const bytes = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

const JPEG_PREFIX =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCA';

const files = {
  jpeg1600x1200: bytes(`${JPEG_PREFIX}SwBkADASI=`),
  jpeg9000x4: bytes(`${JPEG_PREFIX}AEIygDASI=`),
  png1600x1200: bytes(
    'iVBORw0KGgoAAAANSUhEUgAABkAAAASwCAIAAAAsYxHAAAAg8ElEQVR4nO3YMQHAIADAsDFJaEIssnDAS49EQQ==',
  ),
  png7000x7000: bytes(
    'iVBORw0KGgoAAAANSUhEUgAAG1gAABtYCAIAAAAW+SzYAAEAAElEQVR4nOzcQQGAIADAQCCSmQhLLFM4Ht4lWA==',
  ),
  // Lossy, lossless and extended WebP each keep their size in a different place
  webpLossy1600x1200: bytes(
    'UklGRqANAABXRUJQVlA4IJQNAABQlwGdASpABrAEPm02mUmkIyKhIAgAgA2JaW7hd2Ee3AfgAAAT2Ae+2TkPfQ==',
  ),
  webpLossless9000x4: bytes('UklGRiYAAABXRUJQVlA4TBkAAAAvJ+MAAAdQsiJXpv8BIUHC//cmI/qf9r8JAA=='),
  webpExtended8000x8000: bytes(
    'UklGRnzGAQBXRUJQVlA4WAoAAAAQAAAAPx8APx8AQUxQSK4JAAABB1DAiAiakCDB/9vtEZF6S0CS9P8/GdH/BA==',
  ),
};

describe('reading a photo’s size', () => {
  test.each([
    [files.jpeg1600x1200, 'image/jpeg', [1600, 1200]],
    [files.jpeg9000x4, 'image/jpeg', [9000, 4]],
    [files.png1600x1200, 'image/png', [1600, 1200]],
    [files.png7000x7000, 'image/png', [7000, 7000]],
    [files.webpLossy1600x1200, 'image/webp', [1600, 1200]],
    [files.webpLossless9000x4, 'image/webp', [9000, 4]],
    [files.webpExtended8000x8000, 'image/webp', [8000, 8000]],
  ])('%#: %s is read as %j', (file, type, size) => {
    expect(imageSize(file, type)).toEqual(size);
  });
});

describe('checking an uploaded photo', () => {
  test('takes one of a usual size', () => {
    expect(checkImage(files.jpeg1600x1200, 1_500_000)).toMatchObject({ contentType: 'image/jpeg' });
    expect(checkImage(files.webpLossy1600x1200, 1_500_000)).toMatchObject({
      contentType: 'image/webp',
    });
  });

  test.each([
    ['too wide', files.jpeg9000x4],
    ['too many pixels in all', files.png7000x7000],
    ['too many pixels, as extended WebP', files.webpExtended8000x8000],
    ['too wide, as lossless WebP', files.webpLossless9000x4],
  ])('refuses one %s, from its header alone', async (_why, file) => {
    const refused = checkImage(file, 1_500_000) as Response;
    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual({ error: 'Photos can be up to 8192 pixels on a side' });
  });

  test('takes one whose size it cannot read, which no browser could show large either', () => {
    const noFrame = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(7)]);
    expect(checkImage(noFrame, 1_500_000)).toMatchObject({ contentType: 'image/jpeg' });
  });
});
