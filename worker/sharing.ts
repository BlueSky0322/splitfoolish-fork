// Who has access to a split: its members, the share links that bring new ones in, and
// the invites those links give out. Routes check who may act; this does the work.

import type { AcceptResult, MyInvite } from '../shared/api';
import { touchSplitStatement } from './app';
import { fail, json, newId, ok } from './http';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** A share link's token, hard to guess */
export const newShareToken = () =>
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
  db.prepare('UPDATE splits SET invite_token = ? WHERE id = ?').bind(newShareToken(), splitId),
];

/** Everyone's access to a split, for deleting it: its invites, then its members */
export const deleteAccessStatements = (db: D1Database, splitId: string) => [
  db.prepare('DELETE FROM split_invites WHERE split_id = ?').bind(splitId),
  db.prepare('DELETE FROM split_members WHERE split_id = ?').bind(splitId),
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
  const shareToken = newShareToken();
  await db.batch([
    db.prepare('UPDATE splits SET invite_token = ? WHERE id = ?').bind(shareToken, splitId),
    ...editors.map(({ email }) =>
      db
        .prepare('UPDATE split_members SET share_token = ? WHERE split_id = ? AND email = ?')
        .bind(newShareToken(), splitId, email),
    ),
    db.prepare('DELETE FROM split_invites WHERE split_id = ?').bind(splitId),
  ]);
  return shareToken;
}

/**
 * Gives someone who opened a share link an invite: from the owner's link one to accept,
 * from a member's (`sharer`) a request for the owner to approve. Returns the invite.
 */
export async function inviteFromShareLink(
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
  const [profileRows, peopleRows] = await db.batch([
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
      .bind(splitId, email, Date.now(), newShareToken()),
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
    statements.push(touchSplitStatement(db, splitId));
  }
  await db.batch(statements);
}

/** Whether two people are in a split together, so each can see the other's pictures */
export async function sharesSplit(db: D1Database, viewer: string, email: string) {
  if (viewer === email) return true;
  const shared = await db
    .prepare(
      `SELECT 1 FROM split_members a JOIN split_members b ON a.split_id = b.split_id
       WHERE a.email = ? AND b.email = ? LIMIT 1`,
    )
    .bind(viewer, email)
    .first();
  return shared != null;
}

/**
 * Someone's invites: to them, to accept (or, when they asked through a member's link,
 * waiting for the owner); and to splits they own, people asking to join. Requests first.
 */
export async function listInvites(db: D1Database, email: string): Promise<MyInvite[]> {
  const now = Date.now();
  const [mine, requests] = await db.batch([
    // To me: invites to accept, and my requests waiting for the owner
    db
      .prepare(
        `SELECT i.id, i.split_id AS splitId, s.name AS splitName, i.invited_by AS invitedBy,
           p.display_name AS invitedByName, i.needs_approval AS needsApproval,
           o.email AS owner, op.display_name AS ownerName,
           i.created_at AS createdAt, i.expires_at AS expiresAt
         FROM split_invites i JOIN splits s ON s.id = i.split_id
         JOIN split_members o ON o.split_id = i.split_id AND o.role = 'owner'
         LEFT JOIN profiles p ON p.email = i.invited_by
         LEFT JOIN profiles op ON op.email = o.email
         WHERE i.email = ?1 AND i.expires_at > ?2
           AND NOT EXISTS (SELECT 1 FROM split_members m
                           WHERE m.split_id = i.split_id AND m.email = ?1)
         ORDER BY i.created_at DESC`,
      )
      .bind(email, now),
    // To splits I own: people asking to join through someone's link
    db
      .prepare(
        `SELECT i.id, i.split_id AS splitId, s.name AS splitName, i.email,
           jp.display_name AS name, i.invited_by AS invitedBy,
           p.display_name AS invitedByName, i.created_at AS createdAt,
           i.expires_at AS expiresAt
         FROM split_invites i JOIN splits s ON s.id = i.split_id
         JOIN split_members o ON o.split_id = i.split_id AND o.role = 'owner' AND o.email = ?1
         LEFT JOIN profiles jp ON jp.email = i.email
         LEFT JOIN profiles p ON p.email = i.invited_by
         WHERE i.needs_approval = 1 AND i.expires_at > ?2
           AND NOT EXISTS (SELECT 1 FROM split_members m
                           WHERE m.split_id = i.split_id AND m.email = i.email)
         ORDER BY i.created_at DESC`,
      )
      .bind(email, now),
  ]);
  type Base = Omit<MyInvite, 'kind'>;
  type Mine = Base & { needsApproval: number; owner: string; ownerName: string | null };
  type Request = Base & { email: string; name: string | null };
  return [
    ...(requests.results as Request[]).map((r): MyInvite => ({ ...r, kind: 'request' })),
    ...(mine.results as Mine[]).map(
      ({ needsApproval, owner, ownerName, ...r }): MyInvite =>
        needsApproval ? { ...r, kind: 'sent', owner, ownerName } : { ...r, kind: 'invite' },
    ),
  ];
}

export type InviteAction = 'accept' | 'decline';

const GONE = 'This invite has expired or was withdrawn. Ask for the link again.';

/** Withdraws an invite to a split; one already gone is left as it is */
export const revokeInviteStatement = (db: D1Database, splitId: string, inviteId: string) =>
  db.prepare('DELETE FROM split_invites WHERE id = ? AND split_id = ?').bind(inviteId, splitId);

/**
 * Accepts or declines an invite. The person it's for accepts (joins) or declines it, or
 * withdraws their request; for a request, the split's owner approves (accepts) or
 * declines it. Anyone else gets the same answer as for an invite that doesn't exist.
 * onChanged hears which split's list of who's waiting, or who's in, it changes.
 */
export async function answerInvite(
  db: D1Database,
  inviteId: string,
  email: string,
  action: InviteAction,
  onChanged: (splitId: string) => void,
) {
  const invite = await db
    .prepare(
      `SELECT i.split_id AS splitId, i.email, i.needs_approval AS needsApproval,
         o.email AS owner
       FROM split_invites i
       JOIN split_members o ON o.split_id = i.split_id AND o.role = 'owner'
       WHERE i.id = ? AND i.expires_at > ?`,
    )
    .bind(inviteId, Date.now())
    .first<{ splitId: string; email: string; needsApproval: number; owner: string }>();
  const isInvitee = invite?.email === email;
  const isApprover = invite?.needsApproval === 1 && invite.owner === email;
  if (invite == null || (!isInvitee && !isApprover)) return fail(GONE, 404);
  onChanged(invite.splitId);

  if (action === 'decline') {
    await db.prepare('DELETE FROM split_invites WHERE id = ?').bind(inviteId).run();
    return ok();
  }
  if (isApprover) {
    // Approving joins them; they asked, so there's nothing more for them to accept
    await addEditor(db, invite.splitId, invite.email);
    return json<AcceptResult>({ id: invite.splitId });
  }
  if (invite.needsApproval === 1) {
    return fail('The owner needs to approve this first', 403);
  }
  // Joining also clears the invite, so accepting twice lands in the split either way
  await addEditor(db, invite.splitId, email);
  return json<AcceptResult>({ id: invite.splitId });
}

/**
 * The split a share link opens, its owner, and whose link it is: null (sharer) for the
 * owner's own, else the member who shared it. Null when no link has that token.
 */
export const findShareLink = (db: D1Database, token: string) =>
  db
    .prepare(
      `SELECT s.id, o.email AS owner, NULL AS sharer FROM splits s
         JOIN split_members o ON o.split_id = s.id AND o.role = 'owner'
         WHERE s.invite_token = ?1
       UNION ALL
       SELECT m.split_id, o.email, m.email FROM split_members m
         JOIN split_members o ON o.split_id = m.split_id AND o.role = 'owner'
         WHERE m.share_token = ?1`,
    )
    .bind(token)
    .first<{ id: string; owner: string; sharer: string | null }>();
