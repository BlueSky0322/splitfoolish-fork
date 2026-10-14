// The Worker: the app's files for everything outside /api, and the API itself. Every
// API request passes the cross-site check and sign-in before reaching a route.

import { Hono } from 'hono';
import { AppEnv, Env, clientId, json, notFound, notifySplit } from './app';
import { getUserEmail } from './auth';
import invites from './routes/invites';
import me from './routes/me';
import rates from './routes/rates';
import splits from './routes/splits';

export { SplitRoom } from './room';

/** A split's id in an API path, for the routes under /api/splits/:id */
const SPLIT_PATH = /^\/api\/splits\/([A-Za-z0-9_-]{8,64})(?:\/|$)/;

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

// Each account gets a limited number of changes a minute; reading is never limited
api.use('*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
  const { success } = await c.env.API_LIMITER.limit({ key: c.var.email });
  if (!success) return json({ error: 'Too many changes, slow down a moment.' }, 429);
  await next();
});

// Any change saved under a split tells the apps that have it open. Invites aren't under
// /splits, so their routes do this themselves.
api.use('*', async (c, next) => {
  await next();
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.res.status >= 400) return;
  const id = new URL(c.req.url).pathname.match(SPLIT_PATH)?.[1];
  if (id) notifySplit(c.env, c.executionCtx, id, clientId(c.req.raw));
});

api.route('/', me);
api.route('/', splits);
api.route('/', invites);
api.route('/', rates);

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
