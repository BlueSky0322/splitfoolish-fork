// The Worker: the app's files for everything outside /api, and the API itself. Every
// API request passes the cross-site check and sign-in before reaching a route.

import { Hono } from 'hono';
import { AppEnv, Env, json, notFound } from './app';
import { getUserEmail } from './auth';
import invites from './routes/invites';
import me from './routes/me';
import splits from './routes/splits';

/**
 * True for a change (not a read) started by another site. The sign-in cookie rides
 * along with such requests, so without this a page elsewhere could, say, open a share
 * link or post changes on someone's behalf. Browsers say where a request came from in
 * Sec-Fetch-Site; older ones only in Origin.
 */
export function isCrossSiteWrite(req: Request, url: URL): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  const site = req.headers.get('Sec-Fetch-Site');
  if (site != null) return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.get('Origin');
  return origin != null && origin !== url.origin;
}

const api = new Hono<AppEnv>().basePath('/api');

api.use('*', async (c, next) => {
  if (isCrossSiteWrite(c.req.raw, new URL(c.req.url))) {
    return json({ error: 'Not allowed from another site' }, 403);
  }
  const email = await getUserEmail(c.req.raw, c.env);
  if (email == null) return json({ error: 'Not signed in' }, 401);
  c.set('email', email);
  await next();
});

api.route('/', me);
api.route('/', splits);
api.route('/', invites);

api.notFound(() => notFound());

// Answer in JSON like every other error, so the app can show it, rather than
// Cloudflare's error page
api.onError((err) => {
  console.error(err);
  return json({ error: 'Something went wrong. Try again in a moment.' }, 500);
});

export default {
  fetch(req, env, ctx): Response | Promise<Response> {
    if (!new URL(req.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    return api.fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
