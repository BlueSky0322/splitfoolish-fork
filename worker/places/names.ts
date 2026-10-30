// What is at a place, for the line under an item or photo: OpenStreetMap's name for it
// ("Truz Tackles, Kuala Selangor", or the road and town when the spot has no name of its
// own). Looked up by the Worker, so people's browsers never ask OpenStreetMap
// themselves, and kept a month per spot (about 11 m), within Nominatim's usage policy:
// cached, identified, and only as people set places.

import { MAX_PLACE_NAME_LENGTH, plusCodeLabel } from '../../shared/places';

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const FETCH_MS = 5_000;
const KEEP_S = 30 * 24 * 60 * 60;
/** Nominatim asks every app to say who it is */
const USER_AGENT = 'Splitfoolish place names (https://github.com/BlueSky0322/splitfoolish-fork)';

/** The parts of Nominatim's answer a name is made from */
interface Found {
  name?: string;
  address?: Record<string, string | undefined>;
}

/**
 * "Name, Town": the spot's own name, else its road, then the town it's in. A spot known
 * only by its area (out in the country, on a road with no name) is its plus code there,
 * as Google Maps writes it ("G444+HQ Sekinchan, Selangor"), when `at` says where it is.
 */
export function nameOf(found: Found, at?: { lat: number; lng: number }): string | null {
  const a = found.address ?? {};
  const own = found.name?.trim() || a.road || a.neighbourhood || a.suburb;
  const town = a.city ?? a.town ?? a.village ?? a.municipality ?? a.district ?? a.county;
  const parts = (own ? [own, town ?? a.state] : [town, a.state]).filter(
    (p, i, all): p is string => !!p && all.indexOf(p) === i,
  );
  if (!own && at && parts.length > 0) return plusCodeLabel(at.lat, at.lng, parts.join(', '));
  const name = parts.join(', ');
  if (name === '') return null;
  return name.length <= MAX_PLACE_NAME_LENGTH
    ? name
    : `${name.slice(0, MAX_PLACE_NAME_LENGTH - 1)}…`;
}

/** The town (or district) and state a spot is in: "Bagan Datuk, Perak" */
export function areaOf(found: Found): string | null {
  const a = found.address ?? {};
  const town = a.city ?? a.town ?? a.village ?? a.municipality ?? a.district ?? a.county;
  const parts = [town, a.state].filter((p, i, all): p is string => !!p && all.indexOf(p) === i);
  return parts.join(', ') || null;
}

/** What OpenStreetMap says about a spot: its name and its area, or null when it can't be asked */
async function lookUp(
  lat: number,
  lng: number,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
): Promise<{ name: string | null; area: string | null } | null> {
  // Nearby spots share a name: a phone's fix moves by a few metres between tries
  const [la, ln] = [lat.toFixed(4), lng.toFixed(4)];
  // v3: the area kept beside the name, for dropped pins named by their plus code
  const key = new Request(`https://place-names.splitfoolish/v3/${la},${ln}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const kept = await cache.match(key);
  if (kept) return kept.json<{ name: string | null; area: string | null }>();

  let found: Found;
  try {
    const query = new URLSearchParams({ format: 'jsonv2', lat: la, lon: ln, zoom: '18' });
    const res = await fetch(`${NOMINATIM}?${query.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(FETCH_MS),
    });
    // Busy or down: not kept, so it's asked again next time
    if (!res.ok) return null;
    found = await res.json<Found>();
  } catch {
    return null;
  }
  const known = { name: nameOf(found, { lat, lng }), area: areaOf(found) };
  ctx.waitUntil(
    cache.put(
      key,
      new Response(JSON.stringify(known), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${KEEP_S}` },
      }),
    ),
  );
  return known;
}

/** The name OpenStreetMap has for a spot, or null when it has none or can't be asked */
export const placeName = async (
  lat: number,
  lng: number,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
) => (await lookUp(lat, lng, ctx))?.name ?? null;

/** The town and state a spot is in, or null when OpenStreetMap doesn't say */
export const placeArea = async (
  lat: number,
  lng: number,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
) => (await lookUp(lat, lng, ctx))?.area ?? null;
