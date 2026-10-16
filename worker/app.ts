// What every route shares: the Worker's bindings, who's asking, and the checks that
// decide whether they may see or change a split.
//
// Routes (routes/*.ts) gate who gets in: membership, and ownership (or a rule from
// shared/rules.ts) where only the owner may act. Rules that depend on a row (who
// uploaded a photo, which person is being linked or removed) are checked by the handler
// that loads that row, such as deleteAttachments and applyChanges. The work lives in the
// feature folders, which export these kinds of function:
//   - handlers, taking the database, the ids and person involved, then the request or
//     its body, and answering with a Response;
//   - loaders, returning data shaped as in shared/api.ts for the route to send with
//     json<T>(), and assemblers (assemble*) shaping rows a route read in one batch;
//   - statement builders (*Statement, *Statements), returning statements for a route to
//     run in one batch with others, and planners (plan*), reading what they need first;
//   - actions, which write themselves and answer with what changed (a new token, say).
// The feature folders:
//   - accounts/: who's signed in (auth.ts), and their profile and settings (profiles.ts);
//   - splits/: a split itself (lifecycle.ts), what opening one sends (detail.ts), My
//     splits and search (summaries.ts), who has access (sharing.ts), and telling the
//     apps that have it open about changes (room.ts);
//   - bill/: a split's people and items, read (read.ts) and changed in batches
//     (changes.ts, checking each against model.ts with what input.ts reads);
//   - currency/: exchange rates, and converting a split's items into a new currency;
//   - photos/: photos on a split, and profile, split and payment QR pictures;
//   - mcp/: tools for agents at /mcp, signed in over OAuth (docs/mcp.md), which save
//     through the same saveChanges as the API.
// Reading requests and answering is in http.ts. Besides requests, the Worker takes
// messages from the reconvert queue: currency conversions to retry after a failed first
// attempt (currency/reconvert-queue.ts, wired in index.ts and wrangler.jsonc).

import { createMiddleware } from 'hono/factory';
import type { Role } from '../shared/types';
import type { AuthEnv } from './accounts/auth';
import { fail, notFound } from './http';
import type { RatesEnv } from './currency/exchange-rates';
import type { ReconvertJob } from './currency/reconvert';
import type { RoomEnv } from './splits/room';
import { ROW_ID_CHARS } from '../shared/api';

export interface Env extends AuthEnv, RatesEnv, RoomEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Changes per account per minute */
  API_LIMITER: RateLimit;
  /** How long a currency change may take before opening the split retries it; for tests */
  RECONVERT_RETRY_MS?: string;
  /** Conversions whose first attempt failed, retried with backoff (currency/reconvert-queue.ts) */
  RECONVERT_QUEUE: Queue<ReconvertJob>;
  /** Seconds between those retries, instead of the backoff; for tests */
  RECONVERT_RETRY_DELAY_S?: string;
  /**
   * Where this deployment lives (https://host), naming the MCP resource and its OAuth
   * issuer. MCP and OAuth stay off until it and OAUTH_KV are set (mcp/oauth.ts).
   */
  MCP_ORIGIN?: string;
  /** Other origins allowed to call /mcp from a browser, comma-separated (MCP Inspector) */
  MCP_ALLOWED_ORIGINS?: string;
  /** OAuth clients, grants and tokens, kept by the provider library (hashed) */
  OAUTH_KV?: KVNamespace;
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
/** Route constraint for a row's id, such as a payment method's */
export const ROW_ID_PARAM = `{${ROW_ID_CHARS}}`;
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
