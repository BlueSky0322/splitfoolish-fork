import type { Balance, SettleItem, Transfer } from '@shared/settle';
import { balances, itemShares, transfers } from '@shared/settle';
import type { SplitItem, SplitPayment } from './state';
import type { Person } from '@shared/types';
import { toCents } from '@shared/rates';

// Everything the split view shows that is worked out from its people, items and
// payments. The maths is the same code the server uses for My splits, so both always
// agree.

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
  payments: SplitPayment[] = [],
): SplitTotals {
  const settleItems = items.map(toSettleItem);
  const all = balances(
    people.map((p) => p.id),
    settleItems,
    payments.map((p) => ({ fromId: p.from.id, toId: p.to.id, amountCents: toCents(p.amount) })),
  );
  return {
    totalCents: settleItems.reduce((sum, i) => sum + i.costCents, 0),
    hasItems: settleItems.length > 0,
    balances: all,
    transfers: transfers(all, distributorId),
    sharesByItem: new Map(items.map((item, ix) => [item.id, itemShares(settleItems[ix])])),
  };
}

/**
 * Someone's part of an item paid back to whoever paid for it: what they've already paid
 * back for it, and what they still could. That's their part less what they've paid back,
 * and never more than they owe overall: balances are net, so someone who is settled or
 * owed money has nothing to pay back, however much their part was.
 */
export function payBack(
  item: SplitItem,
  personId: string,
  totals: SplitTotals,
  payments: SplitPayment[],
) {
  const partCents = totals.sharesByItem.get(item.id)?.get(personId) ?? 0;
  const paidCents = payments
    .filter((p) => p.itemId === item.id && p.from.id === personId && p.to.id === item.payer.id)
    .reduce((sum, p) => sum + toCents(p.amount), 0);
  const owesCents = Math.max(0, -(totals.balances.get(personId)?.balanceCents ?? 0));
  const dueCents =
    personId === item.payer.id ? 0 : Math.max(0, Math.min(partCents - paidCents, owesCents));
  return { paidCents, dueCents };
}

/** The person in the bill who is this account, if one is linked */
export const findMe = (people: Person[], email: string | null | undefined) =>
  email == null ? null : people.find((p) => p.memberEmail === email) ?? null;

/** The currencies besides the split's own that its items were paid in, A to Z */
export const otherCurrencies = (items: { original?: { currency: string } | null }[]) =>
  [...new Set(items.map((i) => i.original?.currency).filter((c): c is string => c != null))].sort();

/** How many currencies besides the split's own its items were paid in */
export const otherCurrencyCount = (items: { original?: { currency: string } | null }[]) =>
  otherCurrencies(items).length;

/** "10 Oct 2026 – 14 Oct 2026": from the first item to the last, or null with none dated */
export function dateRange(items: { createdAt: number }[]) {
  const times = items.map((i) => i.createdAt).filter((t) => t > 0);
  if (times.length === 0) return null;
  const fmt = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const first = fmt(Math.min(...times));
  const last = fmt(Math.max(...times));
  return first === last ? first : `${first} – ${last}`;
}
