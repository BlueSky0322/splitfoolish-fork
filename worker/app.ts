// What every route shares: the Worker's bindings, who's asking, and the checks that
// decide whether they may see or change a split.

import { createMiddleware } from 'hono/factory';
import { AuthEnv } from './auth';

export interface Env extends AuthEnv {
  DB: D1Database;
  ASSETS: Fetcher;
}

export type Role = 'owner' | 'editor';

export type AppEnv = {
  Bindings: Env;
  /** email: the signed-in user. role: theirs in the split the route is about */
  Variables: { email: string; role: Role };
};

/** A split, invite or attachment id in a path */
export const ID = '{[A-Za-z0-9_-]{8,64}}';
export const SPLIT = `/splits/:id${ID}`;

const MAX_BODY_BYTES = 256 * 1024;
export const MAX_NAME_LENGTH = 80;
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
  });

export const notFound = () => json({ error: 'Not found' }, 404);

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

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

export const readName = (body: Record<string, unknown>) => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null;
};

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
