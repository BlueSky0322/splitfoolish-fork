// The font a split's PDF is written in: Noto Sans JP, cut down to Latin and Japanese
// (scripts/subset-font.sh). Fetched the first time someone makes a PDF and kept for
// the rest of the visit; the service worker keeps it on the device after that.

export const FONT_URL = '/fonts/NotoSansJP-subset-v2.ttf';

let loading: Promise<string> | null = null;

/** The bytes as base64, which is how jsPDF takes a font */
function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** A TrueType font starts 00 01 00 00; anything else (a sign-in page, say) is not one */
const isTrueType = (bytes: Uint8Array) =>
  bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0;

async function fetchFont() {
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`Couldn't load the PDF font (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!isTrueType(bytes)) throw new Error("Couldn't load the PDF font");
  return toBase64(bytes);
}

/** The font as base64, fetched once; if that fails, the next call tries again */
export function loadFont(): Promise<string> {
  loading ??= fetchFont().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}
