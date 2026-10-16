// The Worker: the app's files for everything outside /api, and the API itself. Every
// API request passes the cross-site check and sign-in before reaching a route.

import { Hono } from 'hono';
import type { AppEnv, Env } from './app';
import { clientId, fail, isCrossSiteWrite, notFound } from './http';
import { getUserEmail } from './auth';
import invites from './routes/invites';
import me from './routes/me';
import rates from './routes/rates';
import splits from './routes/splits';
import type { ReconvertJob } from './reconvert';
import { handleReconvertQueue } from './reconvert-queue';
import { notifySplit } from './room';

export { SplitRoom } from './room';

const api = new Hono<AppEnv>().basePath('/api');

api.use('*', async (c, next) => {
  if (isCrossSiteWrite(c.req.raw, new URL(c.req.url))) {
    return fail('Not allowed from another site', 403);
  }
  const email = await getUserEmail(c.req.raw, c.env);
  if (email == null) return fail('Not signed in', 401);
  c.set('email', email);
  await next();
});

// Each account gets a limited number of changes a minute; reading is never limited
api.use('*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
  const { success } = await c.env.API_LIMITER.limit({ key: c.var.email });
  if (!success) return fail('Too many changes, slow down a moment.', 429);
  await next();
});

// A route that saves a change to a split says which (changedSplit), and the apps that
// have it open are told once it has succeeded
api.use('*', async (c, next) => {
  await next();
  const splitId = c.var.changedSplit;
  if (splitId != null && c.res.status < 400) {
    notifySplit(c.env, c.executionCtx, splitId, clientId(c.req.raw));
  }
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
  return fail('Something went wrong. Try again in a moment.', 500);
});

export default {
  fetch(req, env, ctx): Response | Promise<Response> {
    if (!new URL(req.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    return api.fetch(req, env, ctx);
  },
  // Conversions to retry, and the ones given up on (reconvert-queue.ts)
  queue: handleReconvertQueue,
} satisfies ExportedHandler<Env, ReconvertJob>;
