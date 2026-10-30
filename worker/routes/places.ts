// Names for places (places/names.ts), and places found by name (places/search.ts)

import { Hono } from 'hono';
import type { PlaceName, PlaceSearch } from '../../shared/places';
import { MAX_PLACE_SEARCH_LENGTH, isPosition } from '../../shared/places';
import type { AppEnv } from '../app';
import { fail, json } from '../http';
import { placeName } from '../places/names';
import { searchPlaces } from '../places/search';

const places = new Hono<AppEnv>();

places.get('/place-name', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  if (c.req.query('lat') == null || c.req.query('lng') == null || !isPosition(lat, lng)) {
    return fail('Give lat and lng as a position on the map', 400);
  }
  return json<PlaceName>({ name: await placeName(lat, lng, c.executionCtx) });
});

places.get('/place-search', async (c) => {
  const text = c.req.query('q') ?? '';
  if (text.length > MAX_PLACE_SEARCH_LENGTH) {
    return fail(`Search for at most ${MAX_PLACE_SEARCH_LENGTH} characters`, 400);
  }
  // Near where the person is, or the split's other places, when the app knows
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  const near = c.req.query('lat') != null && isPosition(lat, lng) ? { lat, lng } : null;
  // Without a place to go by, the country the person is asking from, as Cloudflare sees it
  const from = (c.req.raw as { cf?: { country?: unknown } }).cf?.country;
  const found = await searchPlaces(text, near, c.executionCtx, {
    base: c.env.PHOTON_BASE,
    // XX is Cloudflare's for not knowing
    country: typeof from === 'string' && /^[A-Z]{2}$/.test(from) && from !== 'XX' ? from : null,
  });
  if (found == null) return fail("Place search isn't answering. Try again in a moment.", 503);
  return json<PlaceSearch>({ places: found });
});

export default places;
