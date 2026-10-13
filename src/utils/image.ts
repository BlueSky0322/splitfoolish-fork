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
