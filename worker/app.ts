// What every route shares: the Worker's bindings, who's asking, and the checks that
// decide whether they may see or change a split.
//
// Routes (routes/*.ts) gate who gets in: membership, and ownership (or a rule from
// shared/rules.ts) where only the owner may act. Rules that depend on a row (who
// uploaded a photo, which person is being linked or removed) are checked by the handler
// that loads that row, such as deleteAttachment and applyChanges. The work lives in the
// feature modules (photos, profiles, sharing, splits, split-content, split-detail,
// summaries), which export three kinds of function: handlers, taking the database, the
// ids and person involved, then the request or its body, and answering with a
// Response; loaders, returning data shaped as in shared/api.ts for the route to send
// with json<T>(); and statement builders (named *Statement or *Statements), returning
// statements for a route to run in one batch with others. Reading requests is in
// http.ts, and telling the apps that have a split open about changes in room.ts.

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

export type AppEnv = {
  Bindings: Env;
  /**
   * email: the signed-in user. role: theirs in the split the route is about.
   * changedSplit: the split a change was saved to, told about once the response is ready.
   */
  Variables: { email: string; role: Role; changedSplit?: string };
};

const ID_CHARS = '[A-Za-z0-9_-]{8,64}';
/** A split, invite or attachment id in a path: the constraint after its :param */
export const ID_PARAM = `{${ID_CHARS}}`;
/** The same id sent in a body */
export const ID_PATTERN = new RegExp(`^${ID_CHARS}$`);
/** The path of one split, which the routes under it extend */
export const SPLIT_PATH = `/splits/:id${ID_PARAM}`;

/** Marks a split as just changed, for the order of My splits */
export const touchSplitStatement = (db: D1Database, splitId: string) =>
  db.prepare('UPDATE splits SET updated_at = ? WHERE id = ?').bind(Date.now(), splitId);

/** Runs groups of statements in one batch, and hands back each group's results */
export async function batchGroups(
  db: D1Database,
  groups: D1PreparedStatement[][],
): Promise<D1Result[][]> {
  const results = await db.batch(groups.flat());
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

/** After `membersOnly`: only members whose role `can` allows get past */
export const allowedIf = (can: (role: Role) => boolean, error: string) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!can(c.var.role)) return fail(error, 403);
    await next();
  });

/** After `membersOnly`: only the split's owner gets past */
export const ownerOnly = (error: string) => allowedIf((role) => role === 'owner', error);
