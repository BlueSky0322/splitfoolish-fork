// Who has access to a split: its members, the share links that bring new ones in, and
// the invites those links give out. Routes check who may act; this does the work.

import { touchSplit } from './app';
import { newId } from './http';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** A share link's token, hard to guess */
export const newInviteToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Takes an account out of a split: their membership goes, the person they were in the
 * bill stays as a guest, and the share link changes (withdrawing invites picked up from
 * it) so the old one can't bring them back
 */
export const removeAccessStatements = (db: D1Database, splitId: string, email: string) => [
  db.prepare('DELETE FROM split_members WHERE split_id = ? AND email = ?').bind(splitId, email),
  // The link changes below, so invites picked up from the old one go too
  db.prepare('DELETE FROM split_invites WHERE split_id = ?').bind(splitId),
  db
    .prepare('UPDATE people SET member_email = NULL WHERE split_id = ? AND member_email = ?')
    .bind(splitId, email),
  db.prepare('UPDATE splits SET invite_token = ? WHERE id = ?').bind(newInviteToken(), splitId),
];

/** Someone leaving by choice: only their membership (and their own link) goes */
export const leaveStatement = (db: D1Database, splitId: string, email: string) =>
  db.prepare('DELETE FROM split_members WHERE split_id = ? AND email = ?').bind(splitId, email);

/**
 * New share links, the owner's and every member's; invites picked up from the old ones
 * go. Returns the owner's new token.
 */
export async function resetShareLinks(db: D1Database, splitId: string) {
  const { results: editors } = await db
    .prepare(`SELECT email FROM split_members WHERE split_id = ? AND role = 'editor'`)
    .bind(splitId)
    .all<{ email: string }>();
  const inviteToken = newInviteToken();
  await db.batch([
    db.prepare('UPDATE splits SET invite_token = ? WHERE id = ?').bind(inviteToken, splitId),
    ...editors.map(({ email }) =>
      db
        .prepare('UPDATE split_members SET share_token = ? WHERE split_id = ? AND email = ?')
        .bind(newInviteToken(), splitId, email),
    ),
    db.prepare('DELETE FROM split_invites WHERE split_id = ?').bind(splitId),
  ]);
  return inviteToken;
}

/**
 * Gives someone who opened a share link an invite: from the owner's link one to accept,
 * from a member's (`sharer`) a request for the owner to approve. Returns the invite.
 */
export async function openInvite(
  db: D1Database,
  splitId: string,
  email: string,
  link: { owner: string; sharer: string | null },
) {
  // One per person per split: opening a link again keeps it, an expired one starts over,
  // and an invite from the owner's link is never turned back into a request
  const now = Date.now();
  const live = 'expires_at > ?5';
  await db
    .prepare(
      `INSERT INTO split_invites
         (id, split_id, email, invited_by, needs_approval, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?6, ?5, ?7)
       ON CONFLICT (split_id, email) DO UPDATE SET
         id = CASE WHEN ${live} THEN id ELSE excluded.id END,
         invited_by = CASE WHEN ${live} AND needs_approval <= excluded.needs_approval
           THEN invited_by ELSE excluded.invited_by END,
         needs_approval = CASE WHEN ${live} THEN min(needs_approval, excluded.needs_approval)
           ELSE excluded.needs_approval END,
         created_at = CASE WHEN ${live} THEN created_at ELSE excluded.created_at END,
         expires_at = CASE WHEN ${live} THEN expires_at ELSE excluded.expires_at END`,
    )
    .bind(
      newId(),
      splitId,
      email,
      link.sharer ?? link.owner,
      now,
      link.sharer == null ? 0 : 1,
      now + INVITE_TTL_MS,
    )
    .run();
  const invite = await db
    .prepare(
      'SELECT id, needs_approval AS needsApproval FROM split_invites WHERE split_id = ? AND email = ?',
    )
    .bind(splitId, email)
    .first<{ id: string; needsApproval: number }>();
  return invite!;
}

/**
 * Adds an editor (no-op if already a member), clears any pending invite for them, and
 * puts them in the bill: a guest with their name becomes them, otherwise they're added
 */
export async function addEditor(db: D1Database, splitId: string, email: string) {
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
        `INSERT OR IGNORE INTO split_members (split_id, email, role, joined_at, share_token)
         VALUES (?, ?, 'editor', ?, ?)`,
      )
      .bind(splitId, email, Date.now(), newInviteToken()),
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
    statements.push(touchSplit(db, splitId));
  }
  await db.batch(statements);
}
