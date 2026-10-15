// What every route shares: the Worker's bindings, who's asking, and the checks that
// decide whether they may see or change a split.
//
// Routes (routes/*.ts) gate who gets in: membership, and ownership where only the owner
// may act. Rules that depend on a row (who uploaded a photo, which person is being linked
// or removed) are checked by the handler that loads that row, such as deleteAttachment
// and applyChanges. The work lives in the feature modules (photos, profiles, sharing,
// split-content, split-detail, summaries), which export three kinds of function:
// handlers, taking the database, the ids and person involved, then the request or its
// body, and answering with a Response; loaders, returning data shaped as in
// shared/api.ts for the route to send with json<T>(); and statement builders (named
// *Statement or *Statements), returning statements for a route to run in one batch with
// others. A route that is one short query keeps it. Reading requests is in http.ts, and
// telling the apps that have a split open about changes in room.ts.

import { createMiddleware } from 'hono/factory';
import type { Role } from '../shared/types';
import type { AuthEnv } from './auth';
import { fail, notFound } from './http';
import type { RatesEnv } from './rates';
import type { SplitRoom } from './room';

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

/** Marks a split as just changed, for the order of My splits */
export const touchSplitStatement = (db: D1Database, splitId: string) =>
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
