// Photos are shrunk in the browser before upload: phone photos are several MB, and a
// receipt is perfectly readable at 1600px. The server stores up to 1.5 MB per photo.

const MAX_BYTES = 1_400_000;
/** Profile pictures are small and square-ish; the server takes up to 256 KB */
export const AVATAR = { maxSide: 512, maxBytes: 240_000 };

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // Applies the photo's rotation, so portrait shots stay upright
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to an <img>, which some browsers decode more formats with
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** A JPEG no larger than maxSide pixels on its longest side, and under the upload limit */
export async function shrinkImage(file: Blob, maxSide = 1600, maxBytes = MAX_BYTES): Promise<Blob> {
  const image = await decode(file);
  let scale = Math.min(1, maxSide / Math.max(image.width, image.height));

  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d');
    if (ctx == null) throw new Error('Could not read that photo');
    // JPEG has no transparency: put PNG screenshots on white rather than black
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, 'image/jpeg', 0.82);
    if (blob == null) throw new Error('Could not read that photo');
    if (blob.size <= maxBytes) return blob;
    scale *= 0.75;
  }
  throw new Error('That photo is too large');
}

/** Near-white or see-through: the frame some pictures come with */
const isBlank = (d: Uint8ClampedArray, i: number) =>
  d[i + 3] < 24 || (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235);

/**
 * The part of a picture inside any plain white or see-through frame around it (say, a
 * round picture saved on a transparent square), so a round avatar shows the picture
 * edge to edge. Takes at most a quarter off each side.
 */
function framedArea(image: ImageBitmap | HTMLImageElement) {
  const scale = Math.min(1, 256 / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const whole = { x: 0, y: 0, width: image.width, height: image.height };
  if (ctx == null) return whole;
  ctx.drawImage(image, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const rowBlank = (y: number) => {
    for (let x = 0; x < w; x++) if (!isBlank(d, (y * w + x) * 4)) return false;
    return true;
  };
  const colBlank = (x: number) => {
    for (let y = 0; y < h; y++) if (!isBlank(d, (y * w + x) * 4)) return false;
    return true;
  };
  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;
  while (top < h / 4 && rowBlank(top)) top++;
  while (bottom > (h * 3) / 4 && rowBlank(bottom)) bottom--;
  while (left < w / 4 && colBlank(left)) left++;
  while (right > (w * 3) / 4 && colBlank(right)) right--;
  return {
    x: left / scale,
    y: top / scale,
    width: (right - left + 1) / scale,
    height: (bottom - top + 1) / scale,
  };
}

/**
 * A profile or split picture: any frame trimmed, then the middle square, so it fills
 * the round avatar whatever shape it started as
 */
export async function shrinkAvatar(file: Blob): Promise<Blob> {
  const image = await decode(file);
  const area = framedArea(image);
  const side = Math.min(area.width, area.height);
  const sx = area.x + (area.width - side) / 2;
  const sy = area.y + (area.height - side) / 2;
  let out = Math.min(AVATAR.maxSide, Math.round(side));

  for (let attempt = 0; attempt < 5; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.max(1, out);
    const ctx = canvas.getContext('2d');
    if (ctx == null) throw new Error('Could not read that picture');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, 'image/jpeg', 0.85);
    if (blob == null) throw new Error('Could not read that picture');
    if (blob.size <= AVATAR.maxBytes) return blob;
    out = Math.round(out * 0.75);
  }
  throw new Error('That picture is too large');
}
