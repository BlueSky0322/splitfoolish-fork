// Splits: listing and creating them, and everything under one split. Routes under a
// split go through `member` (and `ownerOnly` where only the owner may act), except
// opening one, which checks membership in the same database round trip as the rest.

import { Hono } from 'hono';
import {
  AppEnv,
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
import { listSplitSummaries } from '../summaries';

const splits = new Hono<AppEnv>();

splits.get('/splits', async (c) =>
  json({ splits: await listSplitSummaries(c.env.DB, c.var.email) }),
);

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
        .prepare('SELECT role FROM split_members WHERE split_id = ? AND email = ?')
        .bind(id, c.var.email),
      db
        .prepare(
          `SELECT s.name, s.currency, s.invite_token AS inviteToken,
             s.distributor_person_id AS distributorId, p.version AS pictureVersion
           FROM splits s LEFT JOIN split_pictures p ON p.split_id = s.id WHERE s.id = ?`,
        )
        .bind(id),
      ...memberProfileStatements(db, id),
      db
        .prepare(
          `SELECT id, email, created_at AS createdAt, expires_at AS expiresAt
           FROM split_invites WHERE split_id = ? AND expires_at > ? ORDER BY created_at`,
        )
        .bind(id, Date.now()),
      listAttachmentsStatement(db, id),
      ...contentStatements(db, id),
    ]);
  const role = (roleRows.results[0] as { role: Role } | undefined)?.role;
  const split = splitRows.results[0] as
    | {
        name: string;
        currency: string;
        inviteToken: string;
        distributorId: string | null;
        pictureVersion: number | null;
      }
    | undefined;
  // Non-members get the same 404 as a missing split, so ids can't be probed
  if (role == null || split == null) return notFound();

  return json({
    id,
    name: split.name,
    currency: split.currency,
    distributorId: split.distributorId,
    pictureVersion: split.pictureVersion,
    role,
    members: assembleMembers([memberRows, methodRows]),
    invites: role === 'owner' ? inviteRows.results : undefined,
    inviteToken: role === 'owner' ? split.inviteToken : undefined,
    attachments: attachmentRows.results,
    ...assembleContent(content),
  });
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
  if ('currency' in body) {
    if (typeof body.currency !== 'string' || !CURRENCY.test(body.currency)) {
      return json({ error: 'Invalid currency' }, 400);
    }
    statements.push(
      db.prepare('UPDATE splits SET currency = ? WHERE id = ?').bind(body.currency, id),
    );
  }
  if (statements.length > 0) {
    await db.batch([
      ...statements,
      db.prepare('UPDATE splits SET updated_at = ? WHERE id = ?').bind(Date.now(), id),
    ]);
  }
  return json({ ok: true });
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
  return applyChanges(c.env.DB, c.req.param('id'), body, {
    email: c.var.email,
    role: c.var.role,
  });
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

// A new share link; invites picked up from the old one go with it
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
