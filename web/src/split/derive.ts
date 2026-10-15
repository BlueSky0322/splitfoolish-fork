import type { Balance, SettleItem, Transfer } from '../../../shared/settle';
import { balances, itemShares, transfers } from '../../../shared/settle';
import type { SplitItem } from './state';
import type { Person } from '../../../shared/types';
import { toCents } from '../../../shared/rates';

// Everything the split view shows that is worked out from its people and items. The
// maths is the same code the server uses for My splits, so both always agree.

export function toSettleItem(item: SplitItem): SettleItem {
  return {
    costCents: toCents(item.cost),
    payerId: item.payer.id,
    splitMode: item.splitMode,
    participants: item.participants.map((p) => ({
      personId: p.id,
      shares: item.shares?.[p.id] ?? 1,
      exactCents: item.exact?.[p.id] != null ? toCents(item.exact[p.id]) : null,
    })),
  };
}

export interface SplitTotals {
  totalCents: number;
  /** False until something has been added; nothing is "settled" before then */
  hasItems: boolean;
  balances: Map<string, Balance>;
  transfers: Transfer[];
  /** What each item costs each person, by item id then person id */
  sharesByItem: Map<string, Map<string, number>>;
}

export function computeTotals(
  people: Person[],
  items: SplitItem[],
  distributorId?: string | null,
): SplitTotals {
  const settleItems = items.map(toSettleItem);
  const all = balances(
    people.map((p) => p.id),
    settleItems,
  );
  return {
    totalCents: settleItems.reduce((sum, i) => sum + i.costCents, 0),
    hasItems: settleItems.length > 0,
    balances: all,
    transfers: transfers(all, distributorId),
    sharesByItem: new Map(items.map((item, ix) => [item.id, itemShares(settleItems[ix])])),
  };
}

/** The person in the bill who is this account, if one is linked */
export const findMe = (people: Person[], email: string | null | undefined) =>
  email == null ? null : people.find((p) => p.memberEmail === email) ?? null;

/** How many currencies besides the split's own its items were paid in */
export const otherCurrencyCount = (items: { original?: { currency: string } | null }[]) =>
  new Set(items.map((i) => i.original?.currency).filter((c): c is string => c != null)).size;
