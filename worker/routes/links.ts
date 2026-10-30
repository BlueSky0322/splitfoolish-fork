// Cards for links in notes: what a Google Maps link shows (links/preview.ts)

import { Hono } from 'hono';
import { type LinkPreview, isMapsLink } from '../../shared/links';
import type { AppEnv } from '../app';
import { fail, json } from '../http';
import { linkPreview } from '../links/preview';

/** Longer than any link a person pastes; a place's full address runs to a few hundred */
const MAX_LINK_LENGTH = 2000;

const links = new Hono<AppEnv>();

links.get('/link-preview', async (c) => {
  const url = c.req.query('url') ?? '';
  if (url.length > MAX_LINK_LENGTH || !isMapsLink(url)) {
    return fail('Only Google Maps links have a card', 400);
  }
  return json<LinkPreview>(await linkPreview(url, c.executionCtx));
});

export default links;
