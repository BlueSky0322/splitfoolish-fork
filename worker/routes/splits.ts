// Splits: listing and creating them, and everything under one split. Routes under a
// split go through `member` (and `ownerOnly` where only the owner may act), except
// opening one, which checks membership in the same database round trip as the rest.

import { Hono } from 'hono';
import {
  AppEnv,
  Env,
  ID,
  MAX_NAME_LENGTH,
  Role,
  SPLIT,
  json,
  member,
  newId,
  notFound,
  ownerOnly,
  readJson,
  readName,
  splitRoom,
} from '../app';
import {
  deleteAttachment,
  deleteSplitPicture,
  getAttachment,
  getSplitPicture,
  listAttachmentsStatement,
  putSplitPicture,
  uploadAttachment,
} from '../photos';
import {
  CURRENCY,
  assembleMembers,
  getRateSource,
  memberProfileStatements,
  settingsStatements,
} from '../profiles';
import {
  applyChanges,
  assembleContent,
  contentStatements,
  deleteContentStatements,
  newInviteToken,
  removeAccessStatements,
} from '../split-content';
import { REFRESH_MAX_AGE_MS, RatePreference, getRate } from '../rates';
import { RETRY_AFTER_MS, reconvertSplit } from '../reconvert';
import { listSplitSummaries } from '../summaries';

const splits = new Hono<AppEnv>();

const MAX_ORDERED = 500;
const MAX_ITEM_NAMES = 500;
const SPLIT_ID = /^[A-Za-z0-9_-]{8,64}$/;

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
    getRateSource(env.DB, email)
      .then((prefer) =>
        reconvertSplit(env.DB, splitId, (from, to) =>
          getRate(env, from, to, undefined, { prefer }),
        ),
      )
      .catch((err) => console.error(err)),
  );

splits.get('/splits', async (c) =>
  json({ splits: await listSplitSummaries(c.env.DB, c.var.email) }),
);

// Your own order for your splits, as dragged in the app: every id, first to last
splits.put('/splits/order', async (c) => {
  const db = c.env.DB;
  const body = await readJson(c.req.raw);
  if (body instanceof Response) return body;
  const ids = body.ids;
  if (
    !Array.isArray(ids) ||
    ids.length > MAX_ORDERED ||
    !ids.every((id) => typeof id === 'string' && SPLIT_ID.test(id))
  ) {
    return json({ error: 'Send the split ids in order' }, 400);
  }
  if (ids.length === 0) return json({ ok: true });
  // Splits you're not in are skipped: the update only touches your own rows
  await db.batch(
    [...new Set(ids as string[])].map((id, position) =>
      db
        .prepare('UPDATE split_members SET sort_position = ? WHERE split_id = ? AND email = ?')
        .bind(position, id, c.var.email),
    ),
  );
  return json({ ok: true });
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
    .all();
  return json({ names: results });
});

splits.post('/splits', async (c) => {
  const db = c.env.DB;
  const body = await readJson(c.req.raw);
  if (body instanceof Response) return body;
  const name = readName(body);
  if (name == null) return json({ error: `Name must be 1-${MAX_NAME_LENGTH} characters` }, 400);
  const currency = body.currency ?? 'MYR';
  if (typeof currency !== 'string' || !CURRENCY.test(currency)) {
    return json({ error: 'Invalid currency' }, 400);
  }

  // The app may pick the id, so it can open the new split before this finishes
  const id = typeof body.id === 'string' && /^[0-9a-f]{16}$/.test(body.id) ? body.id : newId();
  const now = Date.now();
  const created = await db
    .batch([
      db
        .prepare(
          `INSERT INTO splits (id, name, currency, invite_token, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
        )
        .bind(id, name, currency, newInviteToken(), now),
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
        if (String(err).includes('CONSTRAINT')) return false;
        throw err;
      },
    );
  if (!created) return json({ error: 'That split already exists' }, 409);
  return json({ id }, 201);
});

splits.get(SPLIT, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  // One round trip, membership check included: the database can be far from the user,
  // so every query costs
  const [roleRows, splitRows, memberRows, methodRows, inviteRows, attachmentRows, ...content] =
    await db.batch<Record<string, unknown>>([
      db
        .prepare(
          'SELECT role, share_token AS shareToken FROM split_members WHERE split_id = ? AND email = ?',
        )
        .bind(id, c.var.email),
      db
        .prepare(
          `SELECT s.name, s.currency, s.invite_token AS inviteToken,
             s.distributor_person_id AS distributorId, p.version AS pictureVersion,
             s.converting_since AS convertingSince
           FROM splits s LEFT JOIN split_pictures p ON p.split_id = s.id WHERE s.id = ?`,
        )
        .bind(id),
      ...memberProfileStatements(db, id),
      db
        .prepare(
          `SELECT i.id, i.email, i.invited_by AS invitedBy, p.display_name AS invitedByName,
             i.needs_approval = 1 AS needsApproval, i.created_at AS createdAt,
             i.expires_at AS expiresAt
           FROM split_invites i LEFT JOIN profiles p ON p.email = i.invited_by
           WHERE i.split_id = ? AND i.expires_at > ? ORDER BY i.created_at`,
        )
        .bind(id, Date.now()),
      listAttachmentsStatement(db, id),
      ...contentStatements(db, id),
    ]);
  const { role, shareToken } =
    (roleRows.results[0] as { role: Role; shareToken: string | null } | undefined) ?? {};
  const split = splitRows.results[0] as
    | {
        name: string;
        currency: string;
        inviteToken: string;
        distributorId: string | null;
        pictureVersion: number | null;
        convertingSince: number | null;
      }
    | undefined;
  // Non-members get the same 404 as a missing split, so ids can't be probed
  if (role == null || split == null) return notFound();

  // A conversion that should have finished by now (say, the rates were down): try again
  const converting = split.convertingSince != null;
  const retryAfter = Number(c.env.RECONVERT_RETRY_MS ?? RETRY_AFTER_MS);
  if (converting && Date.now() - split.convertingSince! >= retryAfter) {
    startReconvert(c.env, c.executionCtx, id, c.var.email);
  }

  return json({
    id,
    name: split.name,
    currency: split.currency,
    distributorId: split.distributorId,
    pictureVersion: split.pictureVersion,
    converting,
    role,
    members: assembleMembers([memberRows, methodRows]),
    invites:
      role === 'owner'
        ? inviteRows.results.map((i) => ({ ...i, needsApproval: Boolean(i.needsApproval) }))
        : undefined,
    // Everyone shares with their own link; a member's asks the owner to approve
    inviteToken: role === 'owner' ? split.inviteToken : shareToken ?? undefined,
    attachments: attachmentRows.results,
    ...assembleContent(content),
  });
});

// Live updates: a WebSocket that hears when anyone saves a change to the split. Opened
// from this site only, as the sign-in cookie rides along with it.
splits.get(`${SPLIT}/ws`, member, (c) => {
  const origin = c.req.header('Origin');
  if (origin != null && origin !== new URL(c.req.url).origin) {
    return json({ error: 'Not allowed from another site' }, 403);
  }
  return splitRoom(c.env, c.req.param('id')).fetch(c.req.raw);
});

// Split settings: rename, change currency
splits.patch(SPLIT, member, ownerOnly('Only the owner can change split settings'), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await readJson(c.req.raw);
  if (body instanceof Response) return body;
  const statements: D1PreparedStatement[] = [];
  if ('name' in body) {
    const name = readName(body);
    if (name == null) return json({ error: `Name must be 1-${MAX_NAME_LENGTH} characters` }, 400);
    statements.push(db.prepare('UPDATE splits SET name = ? WHERE id = ?').bind(name, id));
  }
  let converting = false;
  if ('currency' in body) {
    if (typeof body.currency !== 'string' || !CURRENCY.test(body.currency)) {
      return json({ error: 'Invalid currency' }, 400);
    }
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
    await db.batch([
      ...statements,
      db.prepare('UPDATE splits SET updated_at = ? WHERE id = ?').bind(Date.now(), id),
    ]);
  }
  if (converting) startReconvert(c.env, c.executionCtx, id, c.var.email);
  return json({ ok: true, converting });
});

splits.delete(SPLIT, member, ownerOnly('Only the owner can delete this split'), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  await db.batch([
    db
      .prepare(
        'DELETE FROM attachment_data WHERE id IN (SELECT id FROM attachments WHERE split_id = ?)',
      )
      .bind(id),
    db.prepare('DELETE FROM attachments WHERE split_id = ?').bind(id),
    ...deleteContentStatements(db, id),
    db.prepare('DELETE FROM split_invites WHERE split_id = ?').bind(id),
    db.prepare('DELETE FROM split_members WHERE split_id = ?').bind(id),
    db.prepare('DELETE FROM splits WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
});

// The bill (people and items); applyChanges decides what each role may change
splits.post(`${SPLIT}/changes`, member, async (c) => {
  const body = await readJson(c.req.raw);
  if (body instanceof Response) return body;
  // Looked up only if the changes need a rate
  let prefer: Promise<RatePreference> | null = null;
  return applyChanges(
    c.env.DB,
    c.req.param('id'),
    body,
    { email: c.var.email, role: c.var.role },
    async (from, to, recent) =>
      getRate(c.env, from, to, undefined, {
        prefer: await (prefer ??= getRateSource(c.env.DB, c.var.email)),
        maxAgeMs: recent ? REFRESH_MAX_AGE_MS : undefined,
      }),
  );
});

// The split's picture: anyone in it sees it, only the owner changes it
splits.get(`${SPLIT}/picture`, member, (c) => getSplitPicture(c.env.DB, c.req.param('id')));
splits.put(`${SPLIT}/picture`, member, ownerOnly('Only the owner can change the picture'), (c) =>
  putSplitPicture(c.req.raw, c.env.DB, c.req.param('id')),
);
splits.delete(`${SPLIT}/picture`, member, ownerOnly('Only the owner can change the picture'), (c) =>
  deleteSplitPicture(c.env.DB, c.req.param('id')),
);

// Photos can be added by any member, and removed by whoever added them or the owner
splits.post(`${SPLIT}/attachments`, member, (c) =>
  uploadAttachment(c.req.raw, c.env.DB, c.req.param('id'), c.var.email),
);
splits.get(`${SPLIT}/attachments/:attachmentId${ID}`, member, (c) =>
  getAttachment(c.env.DB, c.req.param('id'), c.req.param('attachmentId')),
);
splits.delete(`${SPLIT}/attachments/:attachmentId${ID}`, member, (c) =>
  deleteAttachment(
    c.env.DB,
    c.req.param('id'),
    c.req.param('attachmentId'),
    c.var.email,
    c.var.role === 'owner',
  ),
);

// New share links, the owner's and every member's; invites picked up from the old ones go
splits.post(
  `${SPLIT}/invite`,
  member,
  ownerOnly('Only the owner can reset the invite link'),
  async (c) => {
    const db = c.env.DB;
    const id = c.req.param('id');
    const inviteToken = newInviteToken();
    await db.batch([
      db.prepare('UPDATE splits SET invite_token = ? WHERE id = ?').bind(inviteToken, id),
      db
        .prepare(
          `UPDATE split_members SET share_token = lower(hex(randomblob(18)))
           WHERE split_id = ? AND role = 'editor'`,
        )
        .bind(id),
      db.prepare('DELETE FROM split_invites WHERE split_id = ?').bind(id),
    ]);
    return json({ inviteToken });
  },
);

splits.delete(
  `${SPLIT}/invites/:inviteId${ID}`,
  member,
  ownerOnly('Only the owner can revoke invites'),
  async (c) => {
    const { meta } = await c.env.DB.prepare(
      'DELETE FROM split_invites WHERE id = ? AND split_id = ?',
    )
      .bind(c.req.param('inviteId'), c.req.param('id'))
      .run();
    return meta.changes > 0 ? json({ ok: true }) : notFound();
  },
);

// Owners remove anyone but themselves; others can only remove themselves (leave)
splits.delete(`${SPLIT}/members/:email`, member, async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const email = c.var.email;
  const target = c.req.param('email').toLowerCase();

  const targetRow = await db
    .prepare('SELECT role FROM split_members WHERE split_id = ? AND email = ?')
    .bind(id, target)
    .first<{ role: Role }>();
  if (targetRow == null) return notFound();
  if (targetRow.role === 'owner') return json({ error: 'The owner cannot be removed' }, 400);
  if (c.var.role !== 'owner' && target !== email) {
    return json({ error: 'Only the owner can remove members' }, 403);
  }

  // Leaving is a choice and the link still works; being removed shuts the door
  if (target === email) {
    await db
      .prepare('DELETE FROM split_members WHERE split_id = ? AND email = ?')
      .bind(id, target)
      .run();
  } else {
    await db.batch(removeAccessStatements(db, id, target));
  }
  return json({ ok: true });
});

export default splits;
