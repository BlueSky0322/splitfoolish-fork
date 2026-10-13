// Who owes what. Shared by the Worker (balances on My Splits) and the app (the split
// view and Settle up). Everything is in whole cents so totals always add up exactly.

export type SplitMode = 'equal' | 'shares' | 'exact';

export interface SettleParticipant {
  personId: string;
  /** Used when the item is split by shares */
  shares: number;
  /** Used when the item is split by exact amounts */
  exactCents: number | null;
}

export interface SettleItem {
  costCents: number;
  payerId: string;
  splitMode: SplitMode;
  participants: SettleParticipant[];
}

export interface Balance {
  paidCents: number;
  shareCents: number;
  /** paid − share: positive means others owe this person */
  balanceCents: number;
}

export interface Transfer {
  fromId: string;
  toId: string;
  amountCents: number;
}

/**
 * What each participant owes for one item. Equal and by-shares splits share out the
 * leftover cents one at a time, largest remainder first, so the parts always add up
 * to the cost (RM 10 three ways is 3.34 + 3.33 + 3.33).
 */
export function itemShares(item: SettleItem): Map<string, number> {
  const result = new Map<string, number>();
  if (item.participants.length === 0) return result;

  if (item.splitMode === 'exact') {
    for (const p of item.participants) {
      result.set(p.personId, (result.get(p.personId) ?? 0) + (p.exactCents ?? 0));
    }
    return result;
  }

  const weights = item.participants.map((p) =>
    item.splitMode === 'shares' ? Math.max(0, p.shares) : 1,
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0) return result;

  const exact = weights.map((w) => (item.costCents * w) / totalWeight);
  const floors = exact.map(Math.floor);
  let leftover = item.costCents - floors.reduce((a, b) => a + b, 0);
  // Ties go by person id, not list order, so every reader of the data agrees
  const order = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort(
      (a, b) =>
        b.remainder - a.remainder ||
        (item.participants[a.index].personId < item.participants[b.index].personId ? -1 : 1),
    );
  for (const { index } of order) {
    if (leftover <= 0) break;
    floors[index] += 1;
    leftover -= 1;
  }

  item.participants.forEach((p, i) => {
    result.set(p.personId, (result.get(p.personId) ?? 0) + floors[i]);
  });
  return result;
}

export function balances(personIds: string[], items: SettleItem[]): Map<string, Balance> {
  const result = new Map<string, Balance>(
    personIds.map((id) => [id, { paidCents: 0, shareCents: 0, balanceCents: 0 }]),
  );
  const entry = (id: string) => {
    let b = result.get(id);
    if (b == null) {
      b = { paidCents: 0, shareCents: 0, balanceCents: 0 };
      result.set(id, b);
    }
    return b;
  };

  for (const item of items) {
    entry(item.payerId).paidCents += item.costCents;
    for (const [personId, cents] of itemShares(item)) entry(personId).shareCents += cents;
  }
  for (const b of result.values()) b.balanceCents = b.paidCents - b.shareCents;
  return result;
}

/**
 * Payments that settle every balance. With no distributor, the person who owes most
 * pays the person owed most, repeatedly, which needs at most one fewer payment than
 * there are people. With a distributor, everyone settles with that one person.
 */
export function transfers(all: Map<string, Balance>, distributorId?: string | null): Transfer[] {
  const result: Transfer[] = [];

  if (distributorId != null && all.has(distributorId)) {
    for (const [id, b] of all) {
      if (id === distributorId || b.balanceCents === 0) continue;
      result.push(
        b.balanceCents < 0
          ? { fromId: id, toId: distributorId, amountCents: -b.balanceCents }
          : { fromId: distributorId, toId: id, amountCents: b.balanceCents },
      );
    }
    return result;
  }

  const debtors = [...all]
    .filter(([, b]) => b.balanceCents < 0)
    .map(([id, b]) => ({ id, cents: -b.balanceCents }));
  const creditors = [...all]
    .filter(([, b]) => b.balanceCents > 0)
    .map(([id, b]) => ({ id, cents: b.balanceCents }));

  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort((a, b) => b.cents - a.cents);
    creditors.sort((a, b) => b.cents - a.cents);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = Math.min(debtor.cents, creditor.cents);
    result.push({ fromId: debtor.id, toId: creditor.id, amountCents: amount });
    debtor.cents -= amount;
    creditor.cents -= amount;
    if (debtor.cents === 0) debtors.shift();
    if (creditor.cents === 0) creditors.shift();
  }
  return result;
}
