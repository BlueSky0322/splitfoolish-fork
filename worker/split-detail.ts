// A split as opened: everything the app shows of it, read in one round trip (the
// database can be far from the user, so every query costs), membership check included.

import type { SplitDetail, SplitInvite } from '../shared/api';
import type { Role } from '../shared/types';
import { assembleAttachments, listAttachmentsStatement } from './photos';
import { assembleMembers, memberProfileStatements } from './profiles';
import { assembleContent, contentStatements } from './split-content';

/** What to read, in groups; run with batchGroups, then pass to assembleSplitDetail */
export const splitDetailStatements = (db: D1Database, splitId: string, email: string) => [
  [
    db
      .prepare(
        'SELECT role, share_token AS shareToken FROM split_members WHERE split_id = ? AND email = ?',
      )
      .bind(splitId, email),
    db
      .prepare(
        `SELECT s.name, s.currency, s.invite_token AS ownerToken,
           s.distributor_person_id AS distributorId, p.version AS pictureVersion,
           s.converting_since AS convertingSince
         FROM splits s LEFT JOIN split_pictures p ON p.split_id = s.id WHERE s.id = ?`,
      )
      .bind(splitId),
    db
      .prepare(
        `SELECT i.id, i.email, i.invited_by AS invitedBy, p.display_name AS invitedByName,
           i.needs_approval AS needsApproval, i.created_at AS createdAt,
           i.expires_at AS expiresAt
         FROM split_invites i LEFT JOIN profiles p ON p.email = i.invited_by
         WHERE i.split_id = ? AND i.expires_at > ? ORDER BY i.created_at`,
      )
      .bind(splitId, Date.now()),
  ],
  [listAttachmentsStatement(db, splitId)],
  memberProfileStatements(db, splitId),
  contentStatements(db, splitId),
];

/**
 * The split, and since when its items have been converting into a new currency (null
 * when they aren't). Null for a missing split and for non-members alike, so ids can't
 * be probed.
 */
export function assembleSplitDetail(
  splitId: string,
  [[roleRows, splitRows, inviteRows], [attachments], members, content]: D1Result[][],
): { detail: SplitDetail; convertingSince: number | null } | null {
  const { role, shareToken } =
    (roleRows.results[0] as { role: Role; shareToken: string | null } | undefined) ?? {};
  const split = splitRows.results[0] as
    | {
        name: string;
        currency: string;
        ownerToken: string;
        distributorId: string | null;
        pictureVersion: number | null;
        convertingSince: number | null;
      }
    | undefined;
  if (role == null || split == null) return null;

  const invites = inviteRows.results as (Omit<SplitInvite, 'needsApproval'> & {
    needsApproval: number;
  })[];
  return {
    detail: {
      id: splitId,
      name: split.name,
      currency: split.currency,
      distributorId: split.distributorId,
      pictureVersion: split.pictureVersion,
      converting: split.convertingSince != null,
      role,
      members: assembleMembers(members),
      invites:
        role === 'owner'
          ? invites.map((i) => ({ ...i, needsApproval: i.needsApproval === 1 }))
          : undefined,
      // Everyone shares with their own link; a member's asks the owner to approve
      shareToken: role === 'owner' ? split.ownerToken : shareToken ?? undefined,
      attachments: assembleAttachments(attachments),
      ...assembleContent(content),
    },
    convertingSince: split.convertingSince,
  };
}
