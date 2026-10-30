// What a Google Maps link in an item's notes shows as a card: the place's name, address
// and picture, from the tags Google's page carries for link previews. Only Google Maps
// addresses are fetched, and every redirect must stay on them, so this can't be used to
// reach anywhere else. A share.google link goes on through Google Search, whose page is
// never fetched: the place's name is read from the address it redirects to. Read in
// bounded size and time, and kept a week per link.

import { type LinkPreview, isMapsLink, positionInLink } from '../../shared/links';
import { isPosition, plusCodeLabel, roundCoord } from '../../shared/places';
import { readBody } from '../http';
import { placeArea } from '../places/names';

/** Short links redirect once or twice before the place's page */
const MAX_REDIRECTS = 5;
const FETCH_MS = 5_000;
/** The tags are in the page's head; a place's page is about 250 KB */
const MAX_PAGE_BYTES = 1024 * 1024;
const KEEP_S = 7 * 24 * 60 * 60;

/** Google's own words when a page is about no place in particular */
const GENERIC_TITLES = new Set(['Google Maps']);
const GENERIC_DESCRIPTION = /^Find local businesses/;

/** What a card for `address` shows: from the cache when it was looked up this week */
export async function linkPreview(
  address: string,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
): Promise<LinkPreview> {
  // v3: dropped pins named by their plus code
  const key = new Request(`https://link-preview.splitfoolish/v3/${encodeURIComponent(address)}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const kept = await cache.match(key);
  if (kept) return kept.json<LinkPreview>();
  const preview = await fetchPreview(address, (lat, lng) => placeArea(lat, lng, ctx));
  // A page that couldn't be read is tried again next time rather than kept
  if (preview.title != null) {
    ctx.waitUntil(
      cache.put(
        key,
        new Response(JSON.stringify(preview), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${KEEP_S}` },
        }),
      ),
    );
  }
  return preview;
}

/** The town and state a spot is in (places/names.ts), for a pin Google gives no name */
type AreaAt = (lat: number, lng: number) => Promise<string | null>;

/**
 * Looks the link up: follows its redirects within Google Maps, then reads the page's
 * tags. A dropped pin (a shared position, which Google's page names nothing) is named as
 * Google Maps names one: its plus code, short with the town `areaAt` says it's in
 * ("VRM3+R4 Bagan Datuk, Perak"), else in full.
 */
export async function fetchPreview(
  address: string,
  areaAt: AreaAt = () => Promise.resolve(null),
): Promise<LinkPreview> {
  const found = await readPreview(address);
  if (found.title != null || found.position == null) return found;
  const { lat, lng } = found.position;
  const area = await areaAt(lat, lng).catch(() => null);
  return { ...found, title: plusCodeLabel(lat, lng, area), address: null };
}

async function readPreview(address: string): Promise<LinkPreview> {
  const start = new URL(address);
  const empty: LinkPreview = {
    url: address,
    title: null,
    address: null,
    detail: null,
    image: null,
    site: start.hostname.replace(/^www\./, ''),
    position: null,
  };
  // The last Google Maps address on the way: where the page is fetched from, and what
  // names the place when the page can't be read
  let url = start;
  let page: Response | null = null;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS && page == null; hop++) {
      const res = await fetch(url, {
        redirect: 'manual',
        headers: { 'Accept': 'text/html', 'User-Agent': 'Splitfoolish link preview' },
        signal: AbortSignal.timeout(FETCH_MS),
      });
      const next = res.headers.get('Location');
      if (res.status >= 300 && res.status < 400 && next != null) {
        await res.body?.cancel();
        const to = new URL(next, url);
        // A share.google link's way to its place, which names it
        if (isPlaceSearch(to)) {
          url = to;
          break;
        }
        // Somewhere else (a consent page, say): not followed
        if (!isMapsLink(to.href) && !isShareHop(to)) break;
        url = to;
      } else {
        page = res;
      }
    }
  } catch {
    // Unreachable or too slow: what the address itself says is all there is
  }
  // A share link that isn't a place (a search or an article, say) names nothing
  const named =
    isMapsLink(url.href) || isPlaceSearch(url) ? placeFromUrl(url) : { title: null, address: null };
  const fromUrl = { ...named, position: positionFromUrl(url) };
  if (page == null || !page.ok) return { ...empty, ...fromUrl };
  const body = await readBody(page, MAX_PAGE_BYTES, FETCH_MS);
  if (typeof body === 'string') return { ...empty, ...fromUrl };
  const tags = metaTags(new TextDecoder().decode(body));

  const title = tags.get('og:title');
  const description = tags.get('og:description');
  const image = tags.get('og:image');
  if (title == null || GENERIC_TITLES.has(title)) return { ...empty, ...fromUrl };
  // "A Place Where - APW · 29, Jalan Riong, Bangsar, 59100 Kuala Lumpur"
  const [name, ...rest] = title.split(' · ');
  return {
    ...empty,
    title: name.trim(),
    address: rest.join(' · ').trim() || fromUrl.address,
    detail: description != null && !GENERIC_DESCRIPTION.test(description) ? description : null,
    // Google's map of the place is drawn as a small map of its position instead
    image: image != null && /^https:\/\//.test(image) && !/staticmap/.test(image) ? image : null,
    position: fromUrl.position ?? positionFromMap(image),
  };
}

/** Google's redirect from a share.google link on to what was shared */
const isShareHop = (url: URL) =>
  url.protocol === 'https:' &&
  url.hostname === 'www.google.com' &&
  url.pathname === '/share.google';

/** Where a shared place goes on Google: a search for it, marked as a place (sh/x/loc) */
const isPlaceSearch = (url: URL) =>
  url.protocol === 'https:' &&
  /^(www\.)?google(\.com?)?(\.[a-z]{2})?$/.test(url.hostname) &&
  url.pathname === '/search' &&
  (url.searchParams.get('source') ?? '').startsWith('sh/x/loc');

/** Google's own map of nowhere in particular, for a page it can't place: the whole USA */
const NOWHERE = '37.0625,-95.677068';

/** The position a place page's map is centred on, unless it's Google's map of nowhere */
function positionFromMap(image: string | undefined): LinkPreview['position'] {
  if (image == null || !/staticmap/.test(image)) return null;
  const center = /[?&]center=(-?[\d.]+)(?:%2C|,)(-?[\d.]+)/i.exec(image);
  if (center == null || `${center[1]},${center[2]}` === NOWHERE) return null;
  const [lat, lng] = [Number(center[1]), Number(center[2])];
  return isPosition(lat, lng) ? { lat: roundCoord(lat), lng: roundCoord(lng) } : null;
}

/** Where on the map a Maps address points, when it says (shared/links.ts) */
export const positionFromUrl = (url: URL): LinkPreview['position'] => positionInLink(url.href);

/**
 * The place a Maps address names in itself: /maps/place/<name>/..., or ?q=<name, address>
 * as phones share them
 */
export function placeFromUrl(url: URL): Pick<LinkPreview, 'title' | 'address'> {
  const place = /\/maps\/place\/([^/@]+)/.exec(url.pathname)?.[1];
  const words = place ?? url.searchParams.get('q');
  if (words == null) return { title: null, address: null };
  let text: string;
  try {
    text = decodeURIComponent(words.replace(/\+/g, ' ')).trim();
  } catch {
    return { title: null, address: null };
  }
  // Just a position ("3.1297,101.6744") names no place
  if (text === '' || /^-?[\d.]+\s*,\s*\+?-?[\d.]+$/.test(text)) {
    return { title: null, address: null };
  }
  const [name, ...rest] = text.split(',');
  return { title: name.trim(), address: rest.join(',').trim() || null };
}

const ENTITIES: Record<string, string> = {
  'amp': '&',
  'lt': '<',
  'gt': '>',
  'quot': '"',
  'apos': "'",
  '#39': "'",
};

const decodeEntities = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

/** A page's <meta property="og:..." content="..."> tags, in either attribute order */
export function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/gi)) {
    const property = /\bproperty="([^"]+)"/i.exec(tag)?.[1];
    const content = /\bcontent="([^"]*)"/i.exec(tag)?.[1];
    if (property != null && content != null && !tags.has(property)) {
      tags.set(property, decodeEntities(content));
    }
  }
  return tags;
}
