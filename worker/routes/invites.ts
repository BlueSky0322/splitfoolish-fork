// Joining a split. Opening the owner's share link gives you an invite, which you accept
// (and join) or decline from Invites. Opening a member's link asks to join instead: the
// request waits in the owner's Invites to be approved or declined, and you can withdraw it.

import { Hono } from 'hono';
import type { AcceptResult, JoinResult, MyInvite } from '../../shared/api';
import { AppEnv, ID, INVITE_TTL_MS, clientId, getRole, notifySplit } from '../app';
import { json, newId, fail, ok } from '../http';
import { newInviteToken } from '../split-content';

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
    statements.push(
      db.prepare('UPDATE splits SET updated_at = ? WHERE id = ?').bind(Date.now(), splitId),
    );
  }
  await db.batch(statements);
}

invites.get('/invites', async (c) => {
  const db = c.env.DB;
  const [mine, requests] = await db.batch<Record<string, unknown>>([
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
      .bind(c.var.email, Date.now()),
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
      .bind(c.var.email, Date.now()),
  ]);
  type Base = Omit<MyInvite, 'kind'>;
  type Mine = Base & { needsApproval: number; owner: string; ownerName: string | null };
  type Request = Base & { email: string; name: string | null };
  return json<{ invites: MyInvite[] }>({
    invites: [
      ...(requests.results as unknown as Request[]).map((r) => ({
        ...r,
        kind: 'request' as const,
      })),
      ...(mine.results as unknown as Mine[]).map(
        ({ needsApproval, owner, ownerName, ...r }): MyInvite =>
          needsApproval ? { ...r, kind: 'sent', owner, ownerName } : { ...r, kind: 'invite' },
      ),
    ],
  });
});

const GONE = 'This invite has expired or was withdrawn. Ask for the link again.';

// Accept or decline an invite to you; withdraw a request you sent (decline); or, as the
// owner, approve (accept) or decline a request to join your split
invites.post(`/invites/:inviteId${ID}/:action{accept|decline}`, async (c) => {
  const db = c.env.DB;
  const email = c.var.email;
  const inviteId = c.req.param('inviteId');
  const accept = c.req.param('action') === 'accept';
  // Anyone else gets the same answer as for an invite that doesn't exist
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

  if (!accept) {
    await db.prepare('DELETE FROM split_invites WHERE id = ?').bind(inviteId).run();
    // The owner's list of who's waiting changes
    notifySplit(c.env, c.executionCtx, invite.splitId, clientId(c.req.raw));
    return ok();
  }
  if (isApprover) {
    // Approving joins them; they asked, so there's nothing more for them to accept
    await addEditor(db, invite.splitId, invite.email);
    notifySplit(c.env, c.executionCtx, invite.splitId, clientId(c.req.raw));
    return json<AcceptResult>({ id: invite.splitId });
  }
  if (invite.needsApproval === 1) {
    return fail('The owner needs to approve this first', 403);
  }
  // Joining also clears the invite, so accepting twice lands in the split either way
  await addEditor(db, invite.splitId, email);
  notifySplit(c.env, c.executionCtx, invite.splitId, clientId(c.req.raw));
  return json<AcceptResult>({ id: invite.splitId });
});

// Opening a share link: the owner's gives you an invite to accept, a member's asks the
// owner to let you in. Neither joins you by itself.
invites.post(`/join/:token${ID}`, async (c) => {
  const db = c.env.DB;
  const email = c.var.email;
  const token = c.req.param('token');
  const split = await db
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
  if (split == null) return fail('This invite link is no longer valid', 404);

  // Already in it (the owner included): nothing to accept
  if ((await getRole(db, split.id, email)) != null) {
    return json<JoinResult>({ status: 'member', id: split.id });
  }

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
      split.id,
      email,
      split.sharer ?? split.owner,
      now,
      split.sharer == null ? 0 : 1,
      now + INVITE_TTL_MS,
    )
    .run();
  const invite = await db
    .prepare(
      'SELECT id, needs_approval AS needsApproval FROM split_invites WHERE split_id = ? AND email = ?',
    )
    .bind(split.id, email)
    .first<{ id: string; needsApproval: number }>();
  // Shows up in the owner's list of who's waiting
  notifySplit(c.env, c.executionCtx, split.id, clientId(c.req.raw));
  return json<JoinResult>({
    status: invite!.needsApproval ? 'requested' : 'invited',
    id: split.id,
    inviteId: invite!.id,
  });
});

export default invites;
