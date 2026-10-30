import { isPosition, roundCoord } from './places';

// Links in notes: the web addresses typed in them, and the Google Maps ones the app shows
// as cards with the place's name, address and picture (the Worker fetches what the card
// shows), and that give an item its place.

/** What a link's card shows; title is null when the page said nothing useful */
export interface LinkPreview {
  /** The link as written in the notes */
  url: string;
  title: string | null;
  address: string | null;
  /** A line more, such as the rating and kind of place */
  detail: string | null;
  /** A picture of the place, or a map of it */
  image: string | null;
  /** Where the link goes, as shown under the card ("maps.app.goo.gl") */
  site: string;
  /** Where on the map, when the link says (a dropped pin always does), for a small map */
  position: { lat: number; lng: number } | null;
}

/** google.com, google.com.my, google.co.uk and the like */
const GOOGLE = /^(www\.)?google(\.com?)?(\.[a-z]{2})?$/;
const MAPS_GOOGLE = /^maps\.google(\.com?)?(\.[a-z]{2})?$/;

/** The host and path of an http(s) address, without sign-in details; null otherwise */
const HOST_AND_PATH = /^https?:\/\/([a-z0-9.-]+)(?::\d+)?(\/[^?#]*)?(?:[?#]|$)/i;

/**
 * A Google Maps address, as written: a shared place link (maps.app.goo.gl, or Google's
 * newer share.google, which may turn out to be a place), or a map or place on Google's
 * sites. Plain text parsing, as shared code has no URL to lean on.
 */
export function isMapsLink(address: string) {
  const match = HOST_AND_PATH.exec(address);
  if (match == null) return false;
  const host = match[1].toLowerCase();
  const path = match[2] ?? '/';
  return (
    host === 'maps.app.goo.gl' ||
    host === 'share.google' ||
    (host === 'goo.gl' && path.startsWith('/maps')) ||
    MAPS_GOOGLE.test(host) ||
    (GOOGLE.test(host) && path.startsWith('/maps'))
  );
}

/** A run of text, or a web address in it with where it goes */
export interface TextPart {
  text: string;
  href?: string;
}

// http(s) addresses and www. ones, up to a space or a quote; punctuation after an
// address, and a bracket that closes none opened in it, belong to the sentence
const ADDRESS = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}]$/;

/** Text split into its plain runs and the web addresses typed in it, in order */
export function findLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let from = 0;
  for (const match of text.matchAll(ADDRESS)) {
    let address = match[0];
    while (TRAILING.test(address)) {
      const last = address.at(-1)!;
      const opener = { ')': '(', ']': '[', '}': '{' }[last];
      if (opener != null && address.split(opener).length > address.split(last).length - 1) break;
      address = address.slice(0, -1);
    }
    const at = match.index;
    if (at > from) parts.push({ text: text.slice(from, at) });
    parts.push({ text: address, href: /^www\./i.test(address) ? `https://${address}` : address });
    from = at + address.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}

/** More than a few would bury the notes they come from */
export const MAX_MAPS_LINKS = 5;

/** The different Google Maps links in some notes, in order, up to a few */
export const mapsLinksIn = (text: string) =>
  [
    ...new Set(
      findLinks(text).flatMap((p) => (p.href != null && isMapsLink(p.href) ? [p.href] : [])),
    ),
  ].slice(0, MAX_MAPS_LINKS);

/** A decimal coordinate in an address: 3.881664, -95.6, 101 */
const COORD = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
/** Two of them as a shared position writes them: "3.88,100.80", "3.88,+100.80", "3.88, 100.80" */
const PAIR = String.raw`${COORD}(?:,|%2C)(?:\+|%20|\s)*${COORD}`;
/** A dropped pin: a position shared on its own, which names no place */
const PIN_FORMS = [
  // ?q=3.881664,100.803786, or ?query=… (api=1 links)
  new RegExp(String.raw`[?&](?:q|query)=${PAIR}(?:&|#|$)`),
  // A search for, or place at, a position: /maps/search/3.887047,+100.804389
  new RegExp(String.raw`/maps/(?:search|place)/${PAIR}(?:[/?#]|$)`),
];
const POSITION_FORMS = [
  ...PIN_FORMS,
  // A place's own pin: !3d3.12!4d101.6
  new RegExp(String.raw`!3d${COORD}!4d${COORD}`),
  // The map's centre: /@3.12,101.6,17z
  new RegExp(String.raw`/@${COORD},${COORD}`),
];

/**
 * Where on the map a Maps address points, when the address itself says (a dropped pin,
 * a place's pin, the map's centre); null when it doesn't (a short link, until followed).
 * With `pinOnly`, only a dropped pin's: a place's link names it, which its card shows.
 */
export function positionInLink(
  address: string,
  { pinOnly = false } = {},
): { lat: number; lng: number } | null {
  for (const form of pinOnly ? PIN_FORMS : POSITION_FORMS) {
    const found = form.exec(address);
    if (found == null) continue;
    const [lat, lng] = [Number(found[1]), Number(found[2])];
    return isPosition(lat, lng) ? { lat: roundCoord(lat), lng: roundCoord(lng) } : null;
  }
  return null;
}
