// Finding a place by what it's called, for the item form's location search (as people
// type) and for receipts an agent reads ("Truz Tackles, Kuala Selangor"). Asked of Photon,
// komoot's search over OpenStreetMap that is made for searching as people type, by the
// Worker, so browsers never ask it themselves. Only places in the country searched from
// are offered, nearby ones first. Kept a week per search and area, and asked of nowhere
// else: OpenStreetMap's own search forbids searching as people type.

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
/** Which country an area is in doesn't change */
const KEEP_COUNTRY_S = 30 * 24 * 60 * 60;
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

type Ctx = { waitUntil: (p: Promise<unknown>) => void };

const cache = () => (caches as unknown as { default: Cache }).default;

/** The country an area is in ("MY"), from Photon; null when it can't say */
async function countryAt(area: string[], ctx: Ctx, base: string): Promise<string | null> {
  const key = new Request(`https://place-country.splitfoolish/${area.join(',')}`);
  const kept = await cache().match(key);
  if (kept) return (await kept.json<{ country: string | null }>()).country;
  let country: string | null;
  try {
    const query = new URLSearchParams({ lat: area[0], lon: area[1], limit: '1' });
    const res = await fetch(`${base}/reverse?${query.toString()}`, {
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
    const code = features?.[0]?.properties?.countrycode;
    // Out at sea there's no country, and that's kept too
    country = typeof code === 'string' && /^[A-Z]{2}$/i.test(code) ? code.toUpperCase() : null;
  } catch {
    return null;
  }
  ctx.waitUntil(
    cache().put(
      key,
      new Response(JSON.stringify({ country }), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `max-age=${KEEP_COUNTRY_S}`,
        },
      }),
    ),
  );
  return country;
}

/**
 * The places called `text`, best first: in the country `near` is in (else `country`,
 * where the person is asking from), those near `near` ahead of others of the same name.
 * Null when the search can't be asked (down, slow or refusing), so the person is told
 * rather than shown nothing found.
 */
export async function searchPlaces(
  text: string,
  near: { lat: number; lng: number } | null,
  ctx: Ctx,
  { base = PHOTON, country = null }: { base?: string; country?: string | null } = {},
): Promise<PlaceSuggestion[] | null> {
  const words = text.trim().replace(/\s+/g, ' ').slice(0, MAX_PLACE_SEARCH_LENGTH);
  if (words.length < 2) return [];
  // Searches from about the same area (some 10 km) share their answer
  const area = near == null ? null : [near.lat.toFixed(1), near.lng.toFixed(1)];
  const within = (area && (await countryAt(area, ctx, base))) ?? country?.toUpperCase() ?? null;
  const key = new Request(
    `https://place-search.splitfoolish/${encodeURIComponent(words.toLowerCase())}/${area?.join(',') ?? 'anywhere'}/${within ?? 'everywhere'}`,
  );
  const kept = await cache().match(key);
  if (kept) return kept.json<PlaceSuggestion[]>();

  const query = new URLSearchParams({ q: words, limit: String(MAX_RESULTS), lang: 'en' });
  if (within) query.set('countrycode', within);
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
  // The same spot twice (a shop and its building) is offered once; a chain's branches,
  // each at its own address, all are
  found = found.filter(
    (f, i) => found.findIndex((g) => g.name === f.name && g.address === f.address) === i,
  );
  ctx.waitUntil(
    cache().put(
      key,
      new Response(JSON.stringify(found), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${KEEP_S}` },
      }),
    ),
  );
  return found;
}
