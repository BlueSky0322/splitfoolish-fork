// Where a photo was taken, as the camera wrote it into the JPEG (its EXIF GPS tags). The
// photo is shrunk before upload, which drops these, so they're read from the original
// first. Only the start of the file is read: EXIF sits at the very beginning.

/** How much of the file to look through for the EXIF block */
const HEAD_BYTES = 128 * 1024;

const GPS_IFD_POINTER = 0x8825;
const GPS_LATITUDE_REF = 1;
const GPS_LATITUDE = 2;
const GPS_LONGITUDE_REF = 3;
const GPS_LONGITUDE = 4;
const TYPE_ASCII = 2;
const TYPE_RATIONAL = 5;

/** Where a JPEG was taken, or null when it doesn't say (or isn't a JPEG) */
export async function photoPosition(file: Blob): Promise<{ lat: number; lng: number } | null> {
  try {
    return readPosition(new DataView(await file.slice(0, HEAD_BYTES).arrayBuffer()));
  } catch {
    // A file cut short or written oddly says nothing about where it was taken
    return null;
  }
}

/** The GPS position in a JPEG's opening bytes, or null */
export function readPosition(view: DataView): { lat: number; lng: number } | null {
  if (view.getUint16(0) !== 0xffd8) return null;
  // Each segment: a 0xFFxx marker and its length; EXIF is APP1 starting "Exif\0\0"
  let at = 2;
  while (at + 4 <= view.byteLength) {
    const marker = view.getUint16(at);
    const length = view.getUint16(at + 2);
    if (marker === 0xffe1 && view.getUint32(at + 4) === 0x45786966) {
      return readTiff(view, at + 10);
    }
    // The image data itself: no EXIF after this
    if (marker === 0xffda || (marker & 0xff00) !== 0xff00) return null;
    at += 2 + length;
  }
  return null;
}

function readTiff(view: DataView, tiff: number) {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (at: number) => view.getUint16(tiff + at, little);
  const u32 = (at: number) => view.getUint32(tiff + at, little);
  /** A directory's entries as tag, type, count and where the value is (or the value) */
  const entries = (dir: number) =>
    Array.from({ length: u16(dir) }, (_, i) => {
      const at = dir + 2 + i * 12;
      return { tag: u16(at), type: u16(at + 2), count: u32(at + 4), value: at + 8 };
    });

  const gpsPointer = entries(u32(4)).find((e) => e.tag === GPS_IFD_POINTER);
  if (gpsPointer == null) return null;
  const gps = new Map(entries(u32(gpsPointer.value)).map((e) => [e.tag, e]));

  const ref = (tag: number) => {
    const e = gps.get(tag);
    return e?.type === TYPE_ASCII ? String.fromCharCode(view.getUint8(tiff + e.value)) : null;
  };
  /** Degrees, minutes and seconds, each a fraction, as decimal degrees */
  const degrees = (tag: number) => {
    const e = gps.get(tag);
    if (e?.type !== TYPE_RATIONAL || e.count !== 3) return null;
    const at = u32(e.value);
    const part = (i: number) => {
      const below = u32(at + i * 8 + 4);
      return below === 0 ? NaN : u32(at + i * 8) / below;
    };
    return part(0) + part(1) / 60 + part(2) / 3600;
  };

  const lat = degrees(GPS_LATITUDE);
  const lng = degrees(GPS_LONGITUDE);
  const latRef = ref(GPS_LATITUDE_REF);
  const lngRef = ref(GPS_LONGITUDE_REF);
  if (lat == null || lng == null || latRef == null || lngRef == null) return null;
  const position = { lat: latRef === 'S' ? -lat : lat, lng: lngRef === 'W' ? -lng : lng };
  // Cameras without a fix write zeros; anything out of range is nonsense
  if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null;
  if (Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180) return null;
  if (position.lat === 0 && position.lng === 0) return null;
  return position;
}
