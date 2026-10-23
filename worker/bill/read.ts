// A split's bill as the apps show it: its people, their items and the payments between
// them, read in one batch with the rest of the split.

import type { RateSource } from '../../shared/rates';
import type { SplitMode } from '../../shared/settle';
import type { Item, Payment, Person } from '../../shared/types';

/** How many statements contentStatements makes, for callers that batch them with others */
export const CONTENT_STATEMENTS = 4;

/**
 * Reads a split's people, items and payments; run as part of a larger batch, then pass
 * to assembleContent
 */
export const contentStatements = (db: D1Database, splitId: string) => [
  db
    .prepare(
      // Someone linked to an account goes by that account's display name, if they set one
      `SELECT p.id, coalesce(pr.display_name, p.name) AS name, p.member_email AS memberEmail
       FROM people p LEFT JOIN profiles pr ON pr.email = p.member_email
       WHERE p.split_id = ? ORDER BY p.position, p.rowid`,
    )
    .bind(splitId),
  db
    .prepare(
      `SELECT id, name, cost_cents AS costCents, payer_id AS payerId, split_mode AS splitMode,
         category, notes, created_at AS createdAt, original_currency AS originalCurrency,
         original_cents AS originalCents, rate, rate_source AS rateSource, rate_at AS rateAt
       FROM items WHERE split_id = ? ORDER BY position, rowid`,
    )
    .bind(splitId),
  db
    .prepare(
      `SELECT ip.item_id AS itemId, ip.person_id AS personId, ip.shares,
         ip.exact_cents AS exactCents, ip.original_exact_cents AS originalExactCents
       FROM item_participants ip
       JOIN items i ON i.id = ip.item_id
       JOIN people p ON p.id = ip.person_id
       WHERE i.split_id = ? ORDER BY p.position, p.rowid`,
    )
    .bind(splitId),
  db
    .prepare(
      `SELECT id, from_person_id AS fromId, to_person_id AS toId, amount_cents AS amountCents,
         item_id AS itemId, notes, created_at AS createdAt, original_currency AS originalCurrency,
         original_cents AS originalCents, rate, rate_source AS rateSource, rate_at AS rateAt
       FROM payments WHERE split_id = ? ORDER BY created_at, rowid`,
    )
    .bind(splitId),
];

interface ItemRow {
  id: string;
  name: string;
  costCents: number;
  payerId: string;
  splitMode: SplitMode;
  category: string | null;
  notes: string | null;
  createdAt: number;
  originalCurrency: string | null;
  originalCents: number | null;
  rate: number | null;
  rateSource: RateSource | null;
  rateAt: number | null;
}

interface ParticipantRow {
  itemId: string;
  personId: string;
  shares: number;
  exactCents: number | null;
  originalExactCents: number | null;
}

interface PaymentRow {
  id: string;
  fromId: string;
  toId: string;
  amountCents: number;
  itemId: string | null;
  notes: string | null;
  createdAt: number;
  originalCurrency: string | null;
  originalCents: number | null;
  rate: number | null;
  rateSource: RateSource | null;
  rateAt: number | null;
}

export function assembleContent([people, items, participants, payments]: D1Result[]) {
  const byItem = new Map<string, ParticipantRow[]>();
  for (const row of participants.results as ParticipantRow[]) {
    byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row]);
  }

  return {
    people: people.results as Person[],
    items: (items.results as ItemRow[]).map((i): Item => {
      const rows = byItem.get(i.id) ?? [];
      return {
        id: i.id,
        name: i.name,
        cost: i.costCents / 100,
        payerId: i.payerId,
        participantIds: rows.map((r) => r.personId),
        splitMode: i.splitMode,
        shares:
          i.splitMode === 'shares'
            ? Object.fromEntries(rows.map((r) => [r.personId, r.shares]))
            : undefined,
        exact:
          i.splitMode === 'exact'
            ? Object.fromEntries(rows.map((r) => [r.personId, (r.exactCents ?? 0) / 100]))
            : undefined,
        category: i.category,
        notes: i.notes,
        createdAt: i.createdAt,
        original:
          i.originalCurrency == null
            ? null
            : {
                currency: i.originalCurrency,
                amount: (i.originalCents ?? 0) / 100,
                exact:
                  i.splitMode === 'exact'
                    ? Object.fromEntries(
                        rows.map((r) => [r.personId, (r.originalExactCents ?? 0) / 100]),
                      )
                    : undefined,
                rate: i.rate ?? undefined,
                rateSource: i.rateSource ?? undefined,
                rateAt: i.rateAt ?? undefined,
              },
      };
    }),
    payments: (payments.results as PaymentRow[]).map(
      (p): Payment => ({
        id: p.id,
        fromId: p.fromId,
        toId: p.toId,
        amount: p.amountCents / 100,
        itemId: p.itemId,
        notes: p.notes,
        createdAt: p.createdAt,
        original:
          p.originalCurrency == null
            ? null
            : {
                currency: p.originalCurrency,
                amount: (p.originalCents ?? 0) / 100,
                rate: p.rate ?? undefined,
                rateSource: p.rateSource ?? undefined,
                rateAt: p.rateAt ?? undefined,
              },
      }),
    ),
  };
}
