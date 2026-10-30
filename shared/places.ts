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

/** One coordinate as Google Maps writes it: 3°52'54.0"N */
function dms(degrees: number, positive: string, negative: string) {
  // In tenths of a second, so 59.96" carries into the next minute rather than reading 60.0"
  const tenths = Math.round(Math.abs(degrees) * 36_000);
  const d = Math.floor(tenths / 36_000);
  const m = Math.floor((tenths % 36_000) / 600);
  const s = (tenths % 600) / 10;
  const pad = (n: number, width: number) => n.toFixed(width === 4 ? 1 : 0).padStart(width, '0');
  return `${d}°${pad(m, 2)}'${pad(s, 4)}"${degrees < 0 ? negative : positive}`;
}

/** A position as Google Maps shows a dropped pin: 3°52'54.0"N 100°48'13.6"E */
export const coordsLabel = (lat: number, lng: number) =>
  `${dms(lat, 'N', 'S')} ${dms(lng, 'E', 'W')}`;

/** What a place is called: its name, or where it is on the map when nothing's known */
export const placeLabel = (place: Place) => place.name ?? coordsLabel(place.lat, place.lng);

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
