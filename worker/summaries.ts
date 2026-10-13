// My Splits: each split the person belongs to, with its total and their own balance.
// Everything is read in one round trip and balanced with the same maths as the app.

import { SettleItem, SplitMode, balances } from '../shared/settle';

export async function listSplitSummaries(db: D1Database, email: string) {
  const [splits, items, participants, mine, people] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT s.id, s.name, s.currency, s.updated_at AS updatedAt, m.role,
           (SELECT count(*) FROM split_members WHERE split_id = s.id) AS memberCount
         FROM splits s JOIN split_members m ON m.split_id = s.id
         WHERE m.email = ? ORDER BY s.updated_at DESC`,
      )
      .bind(email),
    db
      .prepare(
        `SELECT i.id, i.split_id AS splitId, i.cost_cents AS costCents, i.payer_id AS payerId,
           i.split_mode AS splitMode
         FROM items i JOIN split_members m ON m.split_id = i.split_id WHERE m.email = ?`,
      )
      .bind(email),
    db
      .prepare(
        `SELECT ip.item_id AS itemId, ip.person_id AS personId, ip.shares, ip.exact_cents AS exactCents
         FROM item_participants ip JOIN items i ON i.id = ip.item_id
         JOIN split_members m ON m.split_id = i.split_id WHERE m.email = ?`,
      )
      .bind(email),
    // The person in each split's bill who is this account, if any
    db
      .prepare(
        `SELECT p.split_id AS splitId, p.id FROM people p
         JOIN split_members m ON m.split_id = p.split_id AND m.email = ?1
         WHERE p.member_email = ?1`,
      )
      .bind(email),
    db
      .prepare(
        `SELECT p.split_id AS splitId, count(*) AS n FROM people p
         JOIN split_members m ON m.split_id = p.split_id WHERE m.email = ? GROUP BY p.split_id`,
      )
      .bind(email),
  ]);

  const bySplit = new Map<string, SettleItem[]>();
  const byItem = new Map<string, SettleItem>();
  for (const i of items.results as {
    id: string;
    splitId: string;
    costCents: number;
    payerId: string;
    splitMode: SplitMode;
  }[]) {
    const item: SettleItem = {
      costCents: i.costCents,
      payerId: i.payerId,
      splitMode: i.splitMode,
      participants: [],
    };
    byItem.set(i.id, item);
    bySplit.set(i.splitId, [...(bySplit.get(i.splitId) ?? []), item]);
  }
  for (const p of participants.results as {
    itemId: string;
    personId: string;
    shares: number;
    exactCents: number | null;
  }[]) {
    byItem.get(p.itemId)?.participants.push(p);
  }
  const myPerson = new Map(
    (mine.results as { splitId: string; id: string }[]).map((r) => [r.splitId, r.id]),
  );
  const peopleCount = new Map(
    (people.results as { splitId: string; n: number }[]).map((r) => [r.splitId, r.n]),
  );

  return (
    splits.results as {
      id: string;
      name: string;
      currency: string;
      updatedAt: number;
      role: string;
      memberCount: number;
    }[]
  ).map((s) => {
    const splitItems = bySplit.get(s.id) ?? [];
    const me = myPerson.get(s.id);
    return {
      ...s,
      peopleCount: peopleCount.get(s.id) ?? 0,
      totalCents: splitItems.reduce((a, i) => a + i.costCents, 0),
      /** Null when no one in the bill is linked to this account */
      myBalanceCents: me == null ? null : balances([me], splitItems).get(me)?.balanceCents ?? 0,
    };
  });
}
