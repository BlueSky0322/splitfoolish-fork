import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import type { MyInvite } from '@shared/api';
import { api } from '../../api';
import { navigate } from '../../hooks/useRoute';
import { removeListedInvite, sendMySplitsChange } from '../../my-splits/my-splits';
import { nameFor } from '../../profile/ProfileContext';

// Invites as the lists show them, and answering one: shared by the desktop Invites page,
// My splits on tablets and the Invites tab on phones

/** The invite you just picked up from a share link, picked out in the list */
export const linkedInviteId = () => new URLSearchParams(window.location.search).get('invite');

/** How long ago, as "2h ago", "yesterday" or "12 Oct" */
export function ago(at: number, now = Date.now()) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  if (at >= dayStart) return `${Math.floor(minutes / 60)}h ago`;
  if (at >= dayStart - 86_400_000) return 'yesterday';
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** What a row says, by kind: an invite to you, your request, or someone asking to join yours */
export function describeInvite(invite: MyInvite, { short = false } = {}) {
  const from = invite.invitedByName ?? invite.invitedBy;
  const expires = new Date(invite.expiresAt).toLocaleDateString();
  switch (invite.kind) {
    case 'request':
      return {
        title: `${nameFor(invite.email, invite.name)} wants to join`,
        meta: `${invite.splitName} · shared by ${from}`,
      };
    case 'sent':
      return {
        title: invite.splitName,
        meta: `Waiting for ${nameFor(invite.owner, invite.ownerName)} to approve · expires ${expires}`,
      };
    default:
      return {
        title: invite.splitName,
        meta: short
          ? `From ${from}, ${ago(invite.createdAt)}`
          : `From ${from} · expires ${expires}`,
      };
  }
}

/**
 * Answers invites. The invite leaves the list straight away and the server catches up,
 * except accepting one to a split, which opens it once joined.
 */
export function useAnswerInvite() {
  const [busy, setBusy] = useState<string | null>(null);

  const respond = async (invite: MyInvite, accept: boolean) => {
    removeListedInvite(invite.id);
    if (!accept) {
      void sendMySplitsChange(() => api.declineInvite(invite.id), 'Could not answer the invite');
      return;
    }
    // Joining has to finish before the split can be opened
    if (invite.kind === 'invite') setBusy(invite.id);
    const joined = await sendMySplitsChange(
      () => api.acceptInvite(invite.id),
      'Could not answer the invite',
    );
    setBusy(null);
    if (joined == null) return;
    if (invite.kind === 'invite') {
      navigate(`?s=${joined.id}`);
    } else if (invite.kind === 'request') {
      notifications.show({
        message: `${nameFor(invite.email, invite.name)} joined ${invite.splitName}`,
      });
    }
  };

  return { busy, respond };
}
