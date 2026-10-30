// Names for places (places/names.ts)

import { Hono } from 'hono';
import type { PlaceName } from '../../shared/places';
import { isPosition } from '../../shared/places';
import type { AppEnv } from '../app';
import { fail, json } from '../http';
import { placeName } from '../places/names';

const places = new Hono<AppEnv>();

places.get('/place-name', async (c) => {
  const lat = Number(c.req.query('lat'));
  const lng = Number(c.req.query('lng'));
  if (c.req.query('lat') == null || c.req.query('lng') == null || !isPosition(lat, lng)) {
    return fail('Give lat and lng as a position on the map', 400);
  }
  return json<PlaceName>({ name: await placeName(lat, lng, c.executionCtx) });
});

export default places;
