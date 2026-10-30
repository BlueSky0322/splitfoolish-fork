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
