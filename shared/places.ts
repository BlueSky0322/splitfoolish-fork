// Where an item was paid for, or a photo taken: a point on the map and, once known, what
// is there ("Truz Tackles, Kuala Selangor"). The app and the Worker check them the same way.

export interface Place {
  lat: number;
  lng: number;
  /** What is there, looked up or typed; null until it's known */
  name: string | null;
}

export const MAX_PLACE_NAME_LENGTH = 120;

/** Kept to 5 decimal places, about a metre: as close as a phone's fix ever is */
export const roundCoord = (degrees: number) => Math.round(degrees * 1e5) / 1e5;

/** A latitude and longitude that are on the map */
export const isPosition = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

/** A place as the API takes it: a position on the map and a name of a sensible length */
export function isPlace(value: unknown): value is Place {
  if (typeof value !== 'object' || value == null) return false;
  const { lat, lng, name } = value as Record<string, unknown>;
  return (
    isPosition(lat, lng) &&
    (name === null ||
      (typeof name === 'string' && name.trim() !== '' && name.length <= MAX_PLACE_NAME_LENGTH))
  );
}

/** The place at the precision it's kept at, its name trimmed */
export const toPlace = (lat: number, lng: number, name: string | null = null): Place => ({
  lat: roundCoord(lat),
  lng: roundCoord(lng),
  name: name?.trim() || null,
});

/** Opens the place in the phone's maps app (or Google Maps on the web) */
export const mapsUrl = ({ lat, lng }: Place) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

// Plus codes (Open Location Code, an open standard Google Maps shows for places with no
// address): 10 characters, a box about 14 m across

const PLUS_CODE_DIGITS = '23456789CFGHJMPQRVWX';
/** The smallest box a 10-character code names: 1/8000 of a degree each way */
const PLUS_CODE_STEPS = 8000;

/** A position's plus code in full: 6PH5G444+HQ */
export function plusCode(lat: number, lng: number) {
  // Latitude stops just short of the pole; longitude goes round the world
  const north = Math.min(Math.max(lat + 90, 0), 180 - 1 / PLUS_CODE_STEPS);
  const east = (((lng + 180) % 360) + 360) % 360;
  // Whole steps, rounded first so a position on a line isn't put a step short by how
  // floating point adds (as Open Location Code's own implementations do)
  let y = Math.floor(Math.round(north * PLUS_CODE_STEPS * 1e6) / 1e6);
  let x = Math.floor(Math.round(east * PLUS_CODE_STEPS * 1e6) / 1e6);
  const pairs: string[] = [];
  for (let i = 0; i < 5; i++) {
    pairs.unshift(PLUS_CODE_DIGITS[Math.floor(y % 20)] + PLUS_CODE_DIGITS[Math.floor(x % 20)]);
    y = Math.floor(y / 20);
    x = Math.floor(x / 20);
  }
  const code = pairs.join('');
  return `${code.slice(0, 8)}+${code.slice(8)}`;
}

/**
 * A position as Google Maps names a spot with no address: its plus code, short with the
 * town it's in ("G444+HQ Sekinchan, Selangor", as the town says the rest), else in full
 */
export const plusCodeLabel = (lat: number, lng: number, town: string | null = null) =>
  town ? `${plusCode(lat, lng).slice(4)} ${town}` : plusCode(lat, lng);

/** A plus code as typed, full (6PM2VRJ3+MG) or short (VRJ3+MG), then a town if any */
const PLUS_CODE_TYPED =
  /^\s*((?:[23456789CFGHJMPQRVWX]{2}){2,4}\+[23456789CFGHJMPQRVWX]{2})(?:[\s,]+(.*))?$/i;

/** A plus code someone typed: the code, whether it's whole, and the town after it */
export function readPlusCode(text: string) {
  const found = PLUS_CODE_TYPED.exec(text);
  if (found == null) return null;
  const code = found[1].toUpperCase();
  return { code, full: code.indexOf('+') === 8, town: found[2]?.trim() || null };
}

/** The middle of a full 10-character plus code's box */
function decodeFull(code: string) {
  const digits = code.replace('+', '');
  let [lat, lng, step] = [-90, -180, 20];
  for (let i = 0; i < 10; i += 2) {
    lat += PLUS_CODE_DIGITS.indexOf(digits[i]) * step;
    lng += PLUS_CODE_DIGITS.indexOf(digits[i + 1]) * step;
    if (i < 8) step /= 20;
  }
  return { lat: lat + step / 2, lng: lng + step / 2 };
}

/**
 * Where a plus code is: a full one by itself, a short one (VRJ3+MG) as the nearest such
 * box to `near` (the town it was given with, or where the person is), as Open Location
 * Code recovers them. Null for a short code with nothing to go by.
 */
export function plusCodePosition(code: string, near: { lat: number; lng: number } | null) {
  const missing = 8 - code.indexOf('+');
  if (missing === 0) {
    const at = decodeFull(code);
    return { lat: roundCoord(at.lat), lng: roundCoord(at.lng) };
  }
  if (near == null) return null;
  // The digits the short code leaves out are the nearby place's, then the nearest box of
  // that size around it is taken, across a line if that's closer
  const at = decodeFull(plusCode(near.lat, near.lng).slice(0, missing) + code);
  const size = 20 ** (2 - missing / 2);
  let { lat, lng } = at;
  if (near.lat + size / 2 < lat && lat - size >= -90) lat -= size;
  else if (near.lat - size / 2 > lat && lat + size <= 90) lat += size;
  if (near.lng + size / 2 < lng) lng -= size;
  else if (near.lng - size / 2 > lng) lng += size;
  return { lat: roundCoord(lat), lng: roundCoord(((((lng + 180) % 360) + 360) % 360) - 180) };
}

/** What a place is called: its name, or its plus code when nothing's known */
export const placeLabel = (place: Place) => place.name ?? plusCodeLabel(place.lat, place.lng);

/** What GET /api/place-name answers: what is at a position, or null when nothing's known */
export interface PlaceName {
  name: string | null;
}

/** The longest search for a place that's sent on */
export const MAX_PLACE_SEARCH_LENGTH = 100;

/** A place found by searching for it, as the location search offers it */
export interface PlaceSuggestion {
  lat: number;
  lng: number;
  /** What it's kept as: the spot and its town ("Truz Tackles, Kuala Selangor") */
  name: string;
  /** Where it is, in full, to tell places of the same name apart */
  address: string | null;
}

/** What GET /api/place-search answers: the best matches first */
export interface PlaceSearch {
  places: PlaceSuggestion[];
}
