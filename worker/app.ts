// What every route shares: the Worker's bindings, who's asking, and the checks that
// decide whether they may see or change a split.

import { createMiddleware } from 'hono/factory';
import type { Role } from '../shared/types';
import { AuthEnv } from './auth';
import { json, notFound } from './http';
import { RatesEnv } from './rates';
import type { RoomMessage, SplitRoom } from './room';

export interface Env extends AuthEnv, RatesEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Changes per account per minute */
  API_LIMITER: RateLimit;
  /** One room per split, for telling the apps that have it open when it changes */
  SPLIT_ROOM: DurableObjectNamespace<SplitRoom>;
  /** How long a currency change may take before opening the split retries it; for tests */
  RECONVERT_RETRY_MS?: string;
}

export type { Role };

export type AppEnv = {
  Bindings: Env;
  /** email: the signed-in user. role: theirs in the split the route is about */
  Variables: { email: string; role: Role };
};

/** A split, invite or attachment id in a path */
export const ID = '{[A-Za-z0-9_-]{8,64}}';
export const SPLIT = `/splits/:id${ID}`;

const MAX_BODY_BYTES = 256 * 1024;
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** The room for a split, where everyone with it open is listening */
export const splitRoom = (env: Env, splitId: string) =>
  env.SPLIT_ROOM.get(env.SPLIT_ROOM.idFromName(splitId));

/**
 * Tells everyone with the split open that it changed, after the response is sent.
 * `by` is the tab that made the change (X-Client-Id), which ignores it.
 */
export const notifySplit = (
  env: Env,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
  splitId: string,
  by: string | null,
) => {
  const message: RoomMessage = { type: 'changed', by };
  ctx.waitUntil(
    splitRoom(env, splitId)
      .broadcast(JSON.stringify(message))
      .catch((err: unknown) => console.error(err)),
  );
};

/** The tab that sent a request, as the app identifies itself */
export const clientId = (req: Request) => req.headers.get('X-Client-Id')?.slice(0, 64) ?? null;

export async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  // Turned away before reading when it says it's too big; checked again after, as the
  // header can be missing or wrong
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) {
    return json({ error: 'Too large' }, 413);
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'Too large' }, 413);
  try {
    const body: unknown = JSON.parse(text);
    if (body == null || typeof body !== 'object') throw new Error();
    return body as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
}

export async function getRole(
  db: D1Database,
  splitId: string,
  email: string,
): Promise<Role | null> {
  const row = await db
    .prepare('SELECT role FROM split_members WHERE split_id = ? AND email = ?')
    .bind(splitId, email)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

/**
 * For routes under a split: only its members get past, as `role`. Others get the same
 * 404 as a missing split, so ids can't be probed.
 */
export const member = createMiddleware<AppEnv>(async (c, next) => {
  const role = await getRole(c.env.DB, c.req.param('id')!, c.var.email);
  if (role == null) return notFound();
  c.set('role', role);
  await next();
});

/** After `member`: only the split's owner gets past */
export const ownerOnly = (error: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.var.role !== 'owner') return json({ error }, 403);
    await next();
  });
