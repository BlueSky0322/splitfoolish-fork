// The bill's rules that both sides check: the app before sending a change, so it can
// explain a refusal straight away, and the Worker when the change arrives.

import type { SplitMode } from './settle';

/** As much of an item as the removal rules look at */
export interface RemovalItem {
  payerId: string;
  participantIds: string[];
  splitMode: SplitMode;
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

/**
 * Why a person can't be removed, or null if they can. Someone who paid for anything
 * stays; with fromItems they come off items they share, unless that would leave an
 * item with nobody or break an exact split.
 */
export function removalBlocker(
  person: { id: string; name: string },
  bill: RemovalItem[],
  fromItems: boolean,
): RemovalBlocker | null {
  const blocked = (message: string, onItems = false) => ({ message, onItems });
  const paid = bill.filter((i) => i.payerId === person.id).length;
  if (paid > 0) {
    return blocked(`${person.name} paid for ${items(paid)}. Edit or remove those items first.`);
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
