// Finding a place by what it's called, for the item form's location search (as people
// type) and for receipts an agent reads ("Truz Tackles, Kuala Selangor"). Asked of Photon,
// komoot's search over OpenStreetMap that is made for searching as people type, by the
// Worker, so browsers never ask it themselves. Kept a week per search, near where it was
// asked from, and asked of nowhere else: OpenStreetMap's own search forbids searching as
// people type.

import {
  MAX_PLACE_SEARCH_LENGTH,
  type PlaceSuggestion,
  isPosition,
  roundCoord,
} from '../../shared/places';
import { readBody } from '../http';
import { nameOf } from './names';

const PHOTON = 'https://photon.komoot.io';
const FETCH_MS = 5_000;
/** A few places a phone can show at once */
const MAX_RESULTS = 5;
/** Five places' answer is a few kilobytes */
const MAX_ANSWER_BYTES = 256 * 1024;
const KEEP_S = 7 * 24 * 60 * 60;
/** komoot asks every app to say who it is */
const USER_AGENT = 'Splitfoolish place search (https://github.com/BlueSky0322/splitfoolish-fork)';

/** The parts of one of Photon's answers a place is made from */
export interface PhotonFeature {
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
}

/** One of Photon's places as the search offers it, or null when it says too little */
export function toSuggestion(feature: PhotonFeature): PlaceSuggestion | null {
  const [lng, lat] = Array.isArray(feature.geometry?.coordinates)
    ? (feature.geometry.coordinates as unknown[])
    : [];
  if (!isPosition(lat, lng)) return null;
  const p = feature.properties ?? {};
  const text = (key: string) => (typeof p[key] === 'string' && p[key].trim()) || undefined;
  const street = [text('street'), text('housenumber')].filter(Boolean).join(' ') || undefined;
  const name = nameOf({
    name: text('name'),
    address: {
      road: street,
      suburb: text('district') ?? text('locality'),
      city: text('city'),
      county: text('county'),
      state: text('state'),
    },
  });
  if (name == null) return null;
  // Everything about where it is that its name doesn't already say
  const parts = [street, text('district'), text('city'), text('state'), text('country')].filter(
    (part, i, all): part is string =>
      part != null && all.indexOf(part) === i && !name.split(', ').includes(part),
  );
  return {
    lat: roundCoord(lat as number),
    lng: roundCoord(lng as number),
    name,
    address: parts.join(', ') || null,
  };
}

/**
 * The places called `text`, best first, those near `near` ahead of others of the same
 * name. Null when the search can't be asked (down, slow or refusing), so the person is
 * told rather than shown nothing found.
 */
export async function searchPlaces(
  text: string,
  near: { lat: number; lng: number } | null,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
  base = PHOTON,
): Promise<PlaceSuggestion[] | null> {
  const words = text.trim().replace(/\s+/g, ' ').slice(0, MAX_PLACE_SEARCH_LENGTH);
  if (words.length < 2) return [];
  // Searches from about the same area (some 10 km) share their answer
  const area = near == null ? null : [near.lat.toFixed(1), near.lng.toFixed(1)];
  const key = new Request(
    `https://place-search.splitfoolish/${encodeURIComponent(words.toLowerCase())}/${area?.join(',') ?? 'anywhere'}`,
  );
  const cache = (caches as unknown as { default: Cache }).default;
  const kept = await cache.match(key);
  if (kept) return kept.json<PlaceSuggestion[]>();

  const query = new URLSearchParams({ q: words, limit: String(MAX_RESULTS), lang: 'en' });
  if (area) {
    query.set('lat', area[0]);
    query.set('lon', area[1]);
    // Nearby first even over better known places of the name, within about a city
    query.set('location_bias_scale', '0.1');
    query.set('zoom', '12');
  }
  let found: PlaceSuggestion[];
  try {
    const res = await fetch(`${base}/api/?${query.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const body = await readBody(res, MAX_ANSWER_BYTES, FETCH_MS);
    if (typeof body === 'string') return null;
    const { features } = JSON.parse(new TextDecoder().decode(body)) as {
      features?: PhotonFeature[];
    };
    found = (features ?? []).flatMap((f) => toSuggestion(f) ?? []);
  } catch {
    return null;
  }
  // The same spot twice (a shop and its building) is offered once
  found = found.filter((f, i) => found.findIndex((g) => g.name === f.name) === i);
  ctx.waitUntil(
    cache.put(
      key,
      new Response(JSON.stringify(found), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${KEEP_S}` },
      }),
    ),
  );
  return found;
}
