// Joining a split. Opening the owner's share link gives you an invite, which you accept
// (and join) or decline from Invites. Opening a member's link asks to join instead: the
// request waits in the owner's Invites to be approved or declined, and you can withdraw it.

import { Hono } from 'hono';
import type { InviteList, JoinResult } from '../../shared/api';
import type { AppEnv } from '../app';
import { ID, getRole } from '../app';
import { json, fail } from '../http';
import { answerInvite, findShareLink, listInvites, openInvite } from '../sharing';

const invites = new Hono<AppEnv>();

invites.get('/invites', async (c) =>
  json<InviteList>({ invites: await listInvites(c.env.DB, c.var.email) }),
);

// Accept or decline an invite to you; withdraw a request you sent (decline); or, as the
// owner, approve (accept) or decline a request to join your split
invites.post(`/invites/:inviteId${ID}/:action{accept|decline}`, (c) =>
  answerInvite(
    c.env.DB,
    c.req.param('inviteId'),
    c.var.email,
    c.req.param('action') === 'accept',
    // Each answer changes the owner's list of who's waiting, or who's in
    (splitId) => c.set('changedSplit', splitId),
  ),
);

// Opening a share link: the owner's gives you an invite to accept, a member's asks the
// owner to let you in. Neither joins you by itself.
invites.post(`/join/:token${ID}`, async (c) => {
  const db = c.env.DB;
  const email = c.var.email;
  const link = await findShareLink(db, c.req.param('token'));
  if (link == null) return fail('This invite link is no longer valid', 404);

  // Already in it (the owner included): nothing to accept
  if ((await getRole(db, link.id, email)) != null) {
    return json<JoinResult>({ status: 'member', id: link.id });
  }

  const invite = await openInvite(db, link.id, email, link);
  // Shows up in the owner's list of who's waiting
  c.set('changedSplit', link.id);
  return json<JoinResult>({
    status: invite.needsApproval ? 'requested' : 'invited',
    id: link.id,
    inviteId: invite.id,
  });
});

export default invites;
