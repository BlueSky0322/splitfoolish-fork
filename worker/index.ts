// The Worker: the app's files for everything outside /api, and the API itself. Every
// API request passes the cross-site check and sign-in before reaching a route. Agents
// reach the MCP tools at /mcp, signing in over OAuth (/oauth/*, /.well-known/*): see
// mcp/oauth.ts.

import { Hono } from 'hono';
import type { AppEnv, Env } from './app';
import { clientId, fail, isCrossSiteWrite, notFound } from './http';
import { EXPECTED_ACCOUNT_HEADER } from '../shared/api';
import { getUserEmail } from './accounts/auth';
import invites from './routes/invites';
import places from './routes/places';
import me from './routes/me';
import rates from './routes/rates';
import splits from './routes/splits';
import type { ReconvertJob } from './currency/reconvert';
import { handleReconvertQueue } from './currency/reconvert-queue';
import { notifySplit } from './splits/room';
import { isOAuthPath } from './mcp/paths';

export { SplitRoom } from './splits/room';

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

// A write says whose it is: one made as another account than the one signed in now (a
// change kept on the device from before someone else signed in, or a tab left open) is
// refused before it changes anything, and the app keeps it for that account. Apps too
// old to say are refused once REQUIRE_EXPECTED_ACCOUNT is on, with a status they keep
// their changes for, until they update.
api.use('*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
  const expected = c.req.header(EXPECTED_ACCOUNT_HEADER);
  if (expected == null) {
    if (c.env.REQUIRE_EXPECTED_ACCOUNT === 'true') {
      return fail('Update the app to save this.', 503, 'client_update_required');
    }
    return next();
  }
  if (expected.trim().toLowerCase() !== c.var.email.toLowerCase()) {
    return fail('Signed in as someone else.', 409, 'account_mismatch');
  }
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
api.route('/', places);

api.notFound(() => notFound());

// Answer in JSON like every other error, so the app can show it, rather than
// Cloudflare's error page
api.onError((err) => {
  console.error(err);
  return fail('Something went wrong. Try again in a moment.', 500);
});

export default {
  fetch(req, env, ctx): Response | Promise<Response> {
    const path = new URL(req.url).pathname;
    // Never the app's page: an agent asking here gets its protocol's answer or a 404.
    // Loaded only here, so the MCP and OAuth libraries stay out of every other request
    if (isOAuthPath(path)) {
      return import('./mcp/oauth').then((m) => m.handleOAuthRoute(req, env, ctx));
    }
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);
    return api.fetch(req, env, ctx);
  },
  // Conversions to retry, and the ones given up on (currency/reconvert-queue.ts)
  queue: handleReconvertQueue,
} satisfies ExportedHandler<Env, ReconvertJob>;
