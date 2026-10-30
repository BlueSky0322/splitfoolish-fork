// What is at a place, for the line under an item or photo: OpenStreetMap's name for it
// ("Truz Tackles, Kuala Selangor", or the road and town when the spot has no name of its
// own). Looked up by the Worker, so people's browsers never ask OpenStreetMap
// themselves, and kept a month per spot (about 11 m), within Nominatim's usage policy:
// cached, identified, and only as people set places.

import { MAX_PLACE_NAME_LENGTH } from '../../shared/places';

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

/** "Name, Town": the spot's own name, else its road, then the town it's in */
export function nameOf(found: Found): string | null {
  const a = found.address ?? {};
  const own = found.name?.trim() || a.road || a.neighbourhood || a.suburb;
  const town = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state;
  const parts = [own, town].filter((p, i, all): p is string => !!p && all.indexOf(p) === i);
  const name = parts.join(', ');
  if (name === '') return null;
  return name.length <= MAX_PLACE_NAME_LENGTH
    ? name
    : `${name.slice(0, MAX_PLACE_NAME_LENGTH - 1)}…`;
}

/** The name OpenStreetMap has for a spot, or null when it has none or can't be asked */
export async function placeName(
  lat: number,
  lng: number,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
): Promise<string | null> {
  // Nearby spots share a name: a phone's fix moves by a few metres between tries
  const [la, ln] = [lat.toFixed(4), lng.toFixed(4)];
  const key = new Request(`https://place-names.splitfoolish/${la},${ln}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const kept = await cache.match(key);
  if (kept) return (await kept.json<{ name: string | null }>()).name;

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
  const name = nameOf(found);
  ctx.waitUntil(
    cache.put(
      key,
      new Response(JSON.stringify({ name }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${KEEP_S}` },
      }),
    ),
  );
  return name;
}
