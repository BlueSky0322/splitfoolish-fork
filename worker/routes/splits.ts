// Splits: listing and creating them, and everything under one split. Routes under a
// split go through `membersOnly` (and `ownerOnly` where only the owner may act), except
// opening one, which checks membership in the same database round trip as the rest.

import { Hono } from 'hono';
import type {
  ChangesBody,
  CreateSplitBody,
  Created,
  ShareTokenResult,
  ItemNameUse,
  ItemNames,
  RatePreference,
  SplitDetail,
  SplitList,
  SplitOrderBody,
  SplitPatch,
  UpdateSplitResult,
} from '../../shared/api';
import { MAX_NAME_LENGTH } from '../../shared/types';
import type { AppEnv, Env } from '../app';
import {
  ID,
  SPLIT,
  VALID_ID,
  batchGroups,
  getRole,
  membersOnly,
  ownerOnly,
  touchSplitStatement,
} from '../app';
import {
  json,
  notFound,
  readName,
  fail,
  ok,
  isClientId,
  isConstraintError,
  isCrossSite,
  isCurrency,
  readJson,
} from '../http';
import {
  deleteAttachment,
  deleteSplitPicture,
  putSplitPicture,
  serveAttachment,
  serveSplitPicture,
  uploadAttachment,
} from '../photos';
import { getRatePreference, settingsStatements } from '../profiles';
import { REFRESH_MAX_AGE_MS, getRate } from '../rates';
import { RETRY_AFTER_MS, reconvertSplit } from '../reconvert';
import { evictFromRoom, joinRoom } from '../room';
import {
  deleteAccessStatements,
  leaveStatement,
  newShareToken,
  removeAccessStatements,
  resetShareLinks,
} from '../sharing';
import { applyChanges, deleteContentStatements } from '../split-content';
import { assembleSplitDetail, splitDetailStatements } from '../split-detail';
import { listSplitSummaries } from '../summaries';

const splits = new Hono<AppEnv>();

const MAX_ORDERED = 500;
const MAX_ITEM_NAMES = 500;

/** How long a conversion may take before opening the split retries it */
const retryAfterMs = (env: Env) => {
  const configured = Number.parseInt(env.RECONVERT_RETRY_MS ?? '', 10);
  return Number.isNaN(configured) ? RETRY_AFTER_MS : configured;
};

/**
 * Converts the split's items after the response is sent, at rates from the source the
 * person who set it off prefers; failures are retried later
 */
const startReconvert = (
  env: Env,
  ctx: { waitUntil: (p: Promise<unknown>) => void },
  splitId: string,
  email: string,
) =>
  ctx.waitUntil(
    getRatePreference(env.DB, email)
      .then((prefer) =>
        reconvertSplit(env.DB, splitId, (from, to) => getRate(env, from, to, { prefer })),
      )
      .catch((err) => console.error(err)),
  );

// Any change saved under a split tells the apps that have it open, once it succeeds
splits.use(`${SPLIT}/*`, async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') c.set('changedSplit', c.req.param('id'));
  await next();
});

splits.get('/splits', async (c) =>
  json<SplitList>({ splits: await listSplitSummaries(c.env.DB, c.var.email) }),
);

// Your own order for your splits, as dragged in the app: every id, first to last
splits.put('/splits/order', async (c) => {
  const db = c.env.DB;
  const body = await readJson<SplitOrderBody>(c.req.raw);
  if (body instanceof Response) return body;
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_ORDERED ||
    !ids.every((id) => typeof id === 'string' && VALID_ID.test(id))
  ) {
    return fail('Send the split ids in order', 400);
  }
  if (ids.length === 0) return ok();
  // Splits you're not in are skipped: the update only touches your own rows
  await db.batch(
    [...new Set(ids as string[])].map((id, position) =>
      db
        .prepare('UPDATE split_members SET sort_position = ? WHERE split_id = ? AND email = ?')
        .bind(position, id, c.var.email),
    ),
  );
  return ok();
});

// Names of items in your splits, most recent first, for suggesting as you type one.
// Each name once (ignoring case), with the category it was last given.
splits.get('/item-names', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT name, category, uses FROM (
       SELECT i.name, i.category, count(*) OVER (PARTITION BY lower(i.name)) AS uses,
         row_number() OVER (PARTITION BY lower(i.name) ORDER BY i.created_at DESC) AS n,
         max(i.created_at) OVER (PARTITION BY lower(i.name)) AS last
       FROM items i JOIN split_members m ON m.split_id = i.split_id AND m.email = ?
     ) WHERE n = 1 ORDER BY last DESC LIMIT ?`,
  )
    .bind(c.var.email, MAX_ITEM_NAMES)
    .all<ItemNameUse>();
  return json<ItemNames>({ names: results });
});

splits.post('/splits', async (c) => {
  const db = c.env.DB;
  const body = await readJson<CreateSplitBody>(c.req.raw);
  if (body instanceof Response) return body;
  const name = readName(body.name);
  if (name == null) return fail(`Name must be 1-${MAX_NAME_LENGTH} characters`, 400);
  const { id, currency } = body;
  if (!isCurrency(currency)) return fail('Invalid currency', 400);
  // The app picks the id, so it can open the new split before this finishes
  if (!isClientId(id)) return fail('Invalid split id', 400);
  const now = Date.now();
  const created = await db
    .batch([
      db
        .prepare(
          `INSERT INTO splits (id, name, currency, invite_token, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
        )
        .bind(id, name, currency, newShareToken(), now),
      // New splits default to the currency used last
      ...settingsStatements(db, c.var.email, { lastCurrency: currency }),
      db
        .prepare(
          `INSERT INTO split_members (split_id, email, role, joined_at) VALUES (?, ?, 'owner', ?)`,
        )
        .bind(id, c.var.email, now),
    ])
    .then(
      () => true,
      (err) => {
        // That id is already taken
        if (isConstraintError(err)) return false;
        throw err;
      },
    );
  if (!created) return fail('That split already exists', 409);
  return json<Created>({ id }, 201);
});

splits.get(SPLIT, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const opened = assembleSplitDetail(
    id,
    await batchGroups(db, splitDetailStatements(db, id, c.var.email)),
  );
  if (opened == null) return notFound();

  // A conversion that should have finished by now (say, the rates were down): try again
  const since = opened.convertingSince;
  if (since != null && Date.now() - since >= retryAfterMs(c.env)) {
    startReconvert(c.env, c.executionCtx, id, c.var.email);
  }
  return json<SplitDetail>(opened.detail);
});

// Live updates: a WebSocket that hears when anyone saves a change to the split. Opened
// from this site only, as the sign-in cookie rides along with it.
splits.get(`${SPLIT}/ws`, membersOnly, (c) => {
  if (isCrossSite(c.req.raw, new URL(c.req.url))) {
    return fail('Not allowed from another site', 403);
  }
  return joinRoom(c.env, c.req.param('id'), c.req.raw, c.var.email);
});

// Split settings: rename, change currency
splits.patch(
  SPLIT,
  membersOnly,
  ownerOnly('Only the owner can change split settings'),
  async (c) => {
    const db = c.env.DB;
    const id = c.req.param('id');
    const body = await readJson<SplitPatch>(c.req.raw);
    if (body instanceof Response) return body;
    const statements: D1PreparedStatement[] = [];
    if ('name' in body) {
      const name = readName(body.name);
      if (name == null) return fail(`Name must be 1-${MAX_NAME_LENGTH} characters`, 400);
      statements.push(db.prepare('UPDATE splits SET name = ? WHERE id = ?').bind(name, id));
    }
    let converting = false;
    if ('currency' in body) {
      if (!isCurrency(body.currency)) return fail('Invalid currency', 400);
      // Items are converted afterwards, in the background. Until that's done, plain items
      // are still in the currency the split had before this conversion started.
      const changed = await db
        .prepare('SELECT 1 FROM splits WHERE id = ? AND currency != ?')
        .bind(id, body.currency)
        .first();
      if (changed) {
        converting = true;
        statements.push(
          db
            .prepare(
              `UPDATE splits SET converting_from = coalesce(converting_from, currency),
               converting_since = ?, currency = ? WHERE id = ?`,
            )
            .bind(Date.now(), body.currency, id),
        );
      }
    }
    if (statements.length > 0) {
      await db.batch([...statements, touchSplitStatement(db, id)]);
    }
    if (converting) startReconvert(c.env, c.executionCtx, id, c.var.email);
    return json<UpdateSplitResult>({ ok: true, converting });
  },
);

splits.delete(SPLIT, membersOnly, ownerOnly('Only the owner can delete this split'), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  await db.batch([
    ...deleteContentStatements(db, id),
    ...deleteAccessStatements(db, id),
    db.prepare('DELETE FROM splits WHERE id = ?').bind(id),
  ]);
  return ok();
});

// The bill (people and items); applyChanges decides what each role may change
splits.post(`${SPLIT}/changes`, membersOnly, async (c) => {
  const body = await readJson<ChangesBody>(c.req.raw);
  if (body instanceof Response) return body;
  // Looked up only if the changes need a rate
  let prefer: Promise<RatePreference> | null = null;
  return applyChanges(c.env.DB, c.req.param('id'), { email: c.var.email, role: c.var.role }, body, {
    fetchRate: async (from, to, recent) =>
      getRate(c.env, from, to, {
        prefer: await (prefer ??= getRatePreference(c.env.DB, c.var.email)),
        maxAgeMs: recent ? REFRESH_MAX_AGE_MS : undefined,
      }),
    onAccessRemoved: (emails) => evictFromRoom(c.env, c.executionCtx, c.req.param('id'), emails),
  });
});

// The split's picture: anyone in it sees it, only the owner changes it
splits.get(`${SPLIT}/picture`, membersOnly, (c) => serveSplitPicture(c.env.DB, c.req.param('id')));
splits.put(
  `${SPLIT}/picture`,
  membersOnly,
  ownerOnly('Only the owner can change the picture'),
  (c) => putSplitPicture(c.env.DB, c.req.param('id'), c.req.raw),
);
splits.delete(
  `${SPLIT}/picture`,
  membersOnly,
  ownerOnly('Only the owner can change the picture'),
  (c) => deleteSplitPicture(c.env.DB, c.req.param('id')),
);

// Photos can be added by any member, and removed by whoever added them or the owner
splits.post(`${SPLIT}/attachments`, membersOnly, (c) =>
  uploadAttachment(c.env.DB, c.req.param('id'), c.var.email, c.req.raw),
);
splits.get(`${SPLIT}/attachments/:attachmentId${ID}`, membersOnly, (c) =>
  serveAttachment(c.env.DB, c.req.param('id'), c.req.param('attachmentId')),
);
splits.delete(`${SPLIT}/attachments/:attachmentId${ID}`, membersOnly, (c) =>
  deleteAttachment(c.env.DB, c.req.param('id'), c.req.param('attachmentId'), {
    email: c.var.email,
    role: c.var.role,
  }),
);

// New share links, the owner's and every member's; invites picked up from the old ones go
splits.post(
  `${SPLIT}/invite`,
  membersOnly,
  ownerOnly('Only the owner can reset the invite link'),
  async (c) =>
    json<ShareTokenResult>({ shareToken: await resetShareLinks(c.env.DB, c.req.param('id')) }),
);

splits.delete(
  `${SPLIT}/invites/:inviteId${ID}`,
  membersOnly,
  ownerOnly('Only the owner can revoke invites'),
  async (c) => {
    await c.env.DB.prepare('DELETE FROM split_invites WHERE id = ? AND split_id = ?')
      .bind(c.req.param('inviteId'), c.req.param('id'))
      .run();
    // Already gone is fine, as for every other delete: the result is the same
    return ok();
  },
);

// Owners remove anyone but themselves; others can only remove themselves (leave)
splits.delete(`${SPLIT}/members/:email`, membersOnly, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const email = c.var.email;
  const target = c.req.param('email').toLowerCase();

  const targetRole = await getRole(db, id, target);
  // Already gone is fine, as for every other delete: the result is the same
  if (targetRole == null) return ok();
  if (targetRole === 'owner') return fail('The owner cannot be removed', 400);
  if (c.var.role !== 'owner' && target !== email) {
    return fail('Only the owner can remove members', 403);
  }

  // Leaving is a choice and the link still works; being removed shuts the door
  await db.batch(
    target === email ? [leaveStatement(db, id, target)] : removeAccessStatements(db, id, target),
  );
  evictFromRoom(c.env, c.executionCtx, id, [target]);
  return ok();
});

export default splits;
