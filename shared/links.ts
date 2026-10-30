// Links in notes that the app shows as cards: Google Maps places, with their name,
// address and picture. The app picks them out; the Worker fetches what the card shows.

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
const ADDRESS = /^https?:\/\/([a-z0-9.-]+)(?::\d+)?(\/[^?#]*)?(?:[?#]|$)/i;

/**
 * A Google Maps address, as written: a shared place link (maps.app.goo.gl), or a map or
 * place on Google's sites. Plain text parsing, as shared code has no URL to lean on.
 */
export function isMapsLink(address: string) {
  const match = ADDRESS.exec(address);
  if (match == null) return false;
  const host = match[1].toLowerCase();
  const path = match[2] ?? '/';
  return (
    host === 'maps.app.goo.gl' ||
    (host === 'goo.gl' && path.startsWith('/maps')) ||
    MAPS_GOOGLE.test(host) ||
    (GOOGLE.test(host) && path.startsWith('/maps'))
  );
}
