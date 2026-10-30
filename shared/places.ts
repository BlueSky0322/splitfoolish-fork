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
