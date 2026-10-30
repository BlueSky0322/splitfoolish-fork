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

/** What a place is called: its name, or its position until a name is known */
export const placeLabel = (place: Place) =>
  place.name ?? `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;

/** What GET /api/place-name answers: what is at a position, or null when nothing's known */
export interface PlaceName {
  name: string | null;
}
