// The bill's rules, and who may do what in a split, that both sides check: the app
// before sending a change, so it can explain a refusal straight away (or not offer it),
// and the Worker when the change arrives.

import type { SplitMode } from './settle';
import type { Role } from './types';

/** Someone acting in a split: their account, and their role in it */
export interface Actor {
  email: string;
  role: Role;
}

/** Who's in the bill (adding, renaming and removing people) is the owner's call */
export const canChangePeople = (role: Role) => role === 'owner';

/** The split's name, currency and picture are the owner's to change */
export const canEditSplitSettings = (role: Role) => role === 'owner';

/**
 * Whether someone may link a person to `account`, or unlink them from it: the owner
 * links anyone, others only say which person they are, or that they aren't
 */
export const canLinkPerson = (account: string | null, actor: Actor) =>
  canChangePeople(actor.role) || account === actor.email;

/** Deleting the split, for everyone, is the owner's; anyone else can leave it */
export const canDeleteSplit = (role: Role) => role === 'owner';

/**
 * The owner's share link and who's waiting to join (invites, and requests through
 * members' links) are the owner's to manage
 */
export const canManageInvites = (role: Role) => role === 'owner';

/** A photo is removed by whoever added it, or by the owner */
export const canRemovePhoto = (uploadedBy: string, actor: Actor) =>
  uploadedBy === actor.email || actor.role === 'owner';

/** The owner removes members; anyone else can only remove themselves (leave) */
export const canRemoveMember = (email: string, actor: Actor) =>
  actor.role === 'owner' || email === actor.email;

/** As much of an item as the removal rules look at */
export interface RemovalItem {
  payerId: string;
  participantIds: string[];
  splitMode: SplitMode;
}

/** As much of a payment as the removal rules look at */
export interface RemovalPayment {
  fromId: string;
  toId: string;
}

/**
 * Why a person can't be removed. onItems: only because they're on items, which
 * removing them with fromItems would take them off.
 */
export interface RemovalBlocker {
  message: string;
  onItems: boolean;
}

const items = (n: number) => (n === 1 ? '1 item' : `${n} items`);
const payments = (n: number) => (n === 1 ? '1 payment' : `${n} payments`);

/**
 * Why a person can't be removed, or null if they can. Someone who paid for anything, or
 * made or received a payment, stays; with fromItems they come off items they share,
 * unless that would leave an item with nobody or break an exact split.
 */
export function removalBlocker(
  person: { id: string; name: string },
  bill: RemovalItem[],
  fromItems: boolean,
  paidBack: RemovalPayment[] = [],
): RemovalBlocker | null {
  const blocked = (message: string, onItems = false) => ({ message, onItems });
  const paid = bill.filter((i) => i.payerId === person.id).length;
  if (paid > 0) {
    return blocked(`${person.name} paid for ${items(paid)}. Edit or remove those items first.`);
  }
  const settled = paidBack.filter((p) => p.fromId === person.id || p.toId === person.id).length;
  if (settled > 0) {
    return blocked(`${person.name} made or received ${payments(settled)}. Remove those first.`);
  }
  const shared = bill.filter((i) => i.participantIds.includes(person.id));
  if (shared.length === 0) return null;
  if (!fromItems) return blocked(`${person.name} is on ${items(shared.length)}.`, true);
  const emptied = shared.filter((i) => i.participantIds.length === 1).length;
  if (emptied > 0) {
    return blocked(
      emptied === 1
        ? `${person.name} is the only person on an item. Edit or remove it first.`
        : `${person.name} is the only person on some items. Edit or remove them first.`,
    );
  }
  // Exact amounts would no longer add up to the cost without them
  if (shared.some((i) => i.splitMode === 'exact')) {
    return blocked(`${person.name} is on an item split by exact amounts. Edit that item first.`);
  }
  return null;
}
