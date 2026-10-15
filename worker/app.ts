// What every route shares: the Worker's bindings, who's asking, and the checks that
// decide whether they may see or change a split.
//
// Routes (routes/*.ts) gate who gets in: membership, and ownership where only the owner
// may act. Rules that depend on a row (who uploaded a photo, which person is being linked
// or removed) are checked by the handler that loads that row, such as deleteAttachment
// and applyChanges. The work lives in the feature modules (photos, profiles, sharing,
// split-content, split-detail, summaries), which export two kinds of function: handlers,
// taking the database, the ids and person involved, then the request or its body, and
// answering with a Response; and statement builders, returning statements for a route
// to run in one batch with others. A route that is one short query keeps it.

import { createMiddleware } from 'hono/factory';
import type { Role } from '../shared/types';
import { AuthEnv } from './auth';
import { fail, notFound } from './http';
import { RatesEnv } from './rates';
import { MEMBER_HEADER, type RoomMessage, type SplitRoom } from './room';

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

/** Who is making a change, and their role in the split */
export interface Actor {
  email: string;
  role: Role;
}

export type AppEnv = {
  Bindings: Env;
  /**
   * email: the signed-in user. role: theirs in the split the route is about.
   * changedSplit: the split a change was saved to, told about once the response is ready.
   */
  Variables: { email: string; role: Role; changedSplit?: string };
};

const ID_CHARS = '[A-Za-z0-9_-]{8,64}';
/** A split, invite or attachment id in a path */
export const ID = `{${ID_CHARS}}`;
/** The same id sent in a body */
export const VALID_ID = new RegExp(`^${ID_CHARS}$`);
export const SPLIT = `/splits/:id${ID}`;

const MAX_BODY_BYTES = 256 * 1024;

/** Marks a split as just changed, for the order of My splits */
export const touchSplit = (db: D1Database, splitId: string) =>
  db.prepare('UPDATE splits SET updated_at = ? WHERE id = ?').bind(Date.now(), splitId);

/** Runs groups of statements in one batch, and hands back each group's results */
export async function batchGroups(
  db: D1Database,
  groups: D1PreparedStatement[][],
): Promise<D1Result<Record<string, unknown>>[][]> {
  const results = await db.batch<Record<string, unknown>>(groups.flat());
  let start = 0;
  return groups.map((group) => results.slice(start, (start += group.length)));
}

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

/** Opens a member's live-update socket in the split's room, tagged as theirs */
export const joinRoom = (env: Env, splitId: string, req: Request, email: string) => {
  const headers = new Headers(req.headers);
  headers.set(MEMBER_HEADER, email);
  return splitRoom(env, splitId).fetch(new Request(req, { headers }));
};

/** Closes the live-update sockets of people taken out of a split, after the response */
export const evictFromRoom = (
  env: Env,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
  splitId: string,
  emails: string[],
) => {
  if (emails.length === 0) return;
  const room = splitRoom(env, splitId);
  ctx.waitUntil(
    Promise.all(emails.map((email) => room.evict(email))).catch((err: unknown) =>
      console.error(err),
    ),
  );
};

/**
 * Whether a request came from a page on another site. Browsers say where a request
 * came from in Sec-Fetch-Site; older ones only in Origin.
 */
export function isCrossSite(req: Request, url: URL): boolean {
  const site = req.headers.get('Sec-Fetch-Site');
  if (site != null) return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.get('Origin');
  return origin != null && origin !== url.origin;
}

/** The tab that sent a request, as the app identifies itself */
export const clientId = (req: Request) => req.headers.get('X-Client-Id')?.slice(0, 64) ?? null;

export async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  // Turned away before reading when it says it's too big; checked again after, as the
  // header can be missing or wrong
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) {
    return fail('Too large', 413);
  }
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return fail('Too large', 413);
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (body == null || typeof body !== 'object') throw new Error();
    return body as Record<string, unknown>;
  } catch {
    return fail('Invalid JSON', 400);
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
export const membersOnly = createMiddleware<AppEnv>(async (c, next) => {
  const role = await getRole(c.env.DB, c.req.param('id')!, c.var.email);
  if (role == null) return notFound();
  c.set('role', role);
  await next();
});

/** After `membersOnly`: only the split's owner gets past */
export const ownerOnly = (error: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.var.role !== 'owner') return fail(error, 403);
    await next();
  });
