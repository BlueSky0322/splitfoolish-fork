// Joining a split: opening its share link gives you an invite, which you accept (and
// join) or decline from Invites

import { Hono } from 'hono';
import { AppEnv, ID, INVITE_TTL_MS, getRole, json, newId } from '../app';

const invites = new Hono<AppEnv>();

/**
 * Adds an editor (no-op if already a member), clears any pending invite for them, and
 * puts them in the bill: a guest with their name becomes them, otherwise they're added
 */
async function addEditor(db: D1Database, splitId: string, email: string) {
  const [profileRows, peopleRows] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT display_name AS displayName FROM profiles WHERE email = ?').bind(email),
    db
      .prepare('SELECT id, name, member_email AS memberEmail FROM people WHERE split_id = ?')
      .bind(splitId),
  ]);
  const people = peopleRows.results as { id: string; name: string; memberEmail: string | null }[];
  const displayName = (profileRows.results[0] as { displayName: string | null } | undefined)
    ?.displayName;

  const statements = [
    db
      .prepare(
        `INSERT OR IGNORE INTO split_members (split_id, email, role, joined_at)
         VALUES (?, ?, 'editor', ?)`,
      )
      .bind(splitId, email, Date.now()),
    db.prepare('DELETE FROM split_invites WHERE split_id = ? AND email = ?').bind(splitId, email),
  ];

  if (!people.some((p) => p.memberEmail === email)) {
    const name = displayName?.trim() || email.split('@')[0];
    const guest = people.find(
      (p) => p.memberEmail == null && p.name.toLowerCase() === name.toLowerCase(),
    );
    if (guest) {
      statements.push(
        db.prepare('UPDATE people SET member_email = ? WHERE id = ?').bind(email, guest.id),
      );
    } else {
      // Names are unique in a split; their account name is shown either way
      const taken = new Set(people.map((p) => p.name));
      const unique = [name, email].find((n) => !taken.has(n)) ?? `${email} ${newId()}`;
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO people (id, split_id, name, member_email, position)
             VALUES (?1, ?2, ?3, ?4,
               (SELECT coalesce(max(position), -1) + 1 FROM people WHERE split_id = ?2))`,
          )
          .bind(newId(), splitId, unique, email),
      );
    }
    statements.push(
      db.prepare('UPDATE splits SET updated_at = ? WHERE id = ?').bind(Date.now(), splitId),
    );
  }
  await db.batch(statements);
}

invites.get('/invites', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.split_id AS splitId, s.name AS splitName, i.invited_by AS invitedBy,
       p.display_name AS invitedByName, i.created_at AS createdAt, i.expires_at AS expiresAt
     FROM split_invites i JOIN splits s ON s.id = i.split_id
     LEFT JOIN profiles p ON p.email = i.invited_by
     WHERE i.email = ?1 AND i.expires_at > ?2
       AND NOT EXISTS (SELECT 1 FROM split_members m
                       WHERE m.split_id = i.split_id AND m.email = ?1)
     ORDER BY i.created_at DESC`,
  )
    .bind(c.var.email, Date.now())
    .all();
  return json({ invites: results });
});

invites.post(`/invites/:inviteId${ID}/:action{accept|decline}`, async (c) => {
  const db = c.env.DB;
  const email = c.var.email;
  const inviteId = c.req.param('inviteId');
  // Only the invited email can act on an invite; to anyone else it doesn't exist
  const invite = await db
    .prepare(
      'SELECT split_id AS splitId FROM split_invites WHERE id = ? AND email = ? AND expires_at > ?',
    )
    .bind(inviteId, email, Date.now())
    .first<{ splitId: string }>();
  if (invite == null) {
    return json(
      { error: 'This invite has expired or was withdrawn. Ask for the link again.' },
      404,
    );
  }

  if (c.req.param('action') === 'accept') {
    // Joining also clears the invite, so accepting twice lands in the split either way
    await addEditor(db, invite.splitId, email);
    return json({ id: invite.splitId });
  }
  await db.prepare('DELETE FROM split_invites WHERE id = ?').bind(inviteId).run();
  return json({ ok: true });
});

// Opening the share link gives you an invite to accept or decline; it doesn't join you
invites.post(`/join/:token${ID}`, async (c) => {
  const db = c.env.DB;
  const email = c.var.email;
  const split = await db
    .prepare(
      `SELECT s.id, m.email AS owner FROM splits s
       JOIN split_members m ON m.split_id = s.id AND m.role = 'owner'
       WHERE s.invite_token = ?`,
    )
    .bind(c.req.param('token'))
    .first<{ id: string; owner: string }>();
  if (split == null) return json({ error: 'This invite link is no longer valid' }, 404);

  // Already in it (the owner included): nothing to accept
  if ((await getRole(db, split.id, email)) != null) {
    return json({ status: 'member', id: split.id });
  }

  // Opening the link again keeps the same invite; an expired one starts over
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO split_invites (id, split_id, email, invited_by, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (split_id, email) DO UPDATE SET
         id = CASE WHEN expires_at > ?5 THEN id ELSE excluded.id END,
         invited_by = excluded.invited_by,
         created_at = CASE WHEN expires_at > ?5 THEN created_at ELSE excluded.created_at END,
         expires_at = CASE WHEN expires_at > ?5 THEN expires_at ELSE excluded.expires_at END`,
    )
    .bind(newId(), split.id, email, split.owner, now, now + INVITE_TTL_MS)
    .run();
  const invite = await db
    .prepare('SELECT id FROM split_invites WHERE split_id = ? AND email = ?')
    .bind(split.id, email)
    .first<{ id: string }>();
  return json({ status: 'invited', id: split.id, inviteId: invite!.id });
});

export default invites;
