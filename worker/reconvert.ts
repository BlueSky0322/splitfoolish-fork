// Converting a split's items after its currency changes, in the background. Each item
// keeps what was originally paid: items already in another currency are converted
// again from that, plain items become "paid in the old currency", and items paid in
// the new currency become plain again, so switching back restores the exact amounts.

import type { RateSource } from '../shared/rates';
import { convertCents, convertParts } from '../shared/rates';
import type { SplitMode } from '../shared/settle';
import type { Rate } from './rates';

/** Started (and its time recorded) when the change is made; retried when this old */
export const RETRY_AFTER_MS = 30_000;

interface ItemRow {
  id: string;
  costCents: number;
  splitMode: SplitMode;
  originalCurrency: string | null;
  originalCents: number | null;
  rate: number | null;
  rateSource: RateSource | null;
  rateAt: number | null;
}

interface PartRow {
  itemId: string;
  personId: string;
  exactCents: number | null;
  originalExactCents: number | null;
}

/**
 * Converts every item into the split's current currency, then marks the split done.
 * Does nothing if it isn't converting. If the currency changes again meanwhile, its
 * writes are skipped and the next run starts over.
 */
export async function reconvertSplit(
  db: D1Database,
  splitId: string,
  fetchRate: (from: string, to: string) => Promise<Rate>,
): Promise<void> {
  const [splitRows, itemRows, partRows] = await db.batch([
    db
      .prepare(
        `SELECT currency, converting_from AS fromCurrency, converting_since AS since
         FROM splits WHERE id = ?`,
      )
      .bind(splitId),
    db
      .prepare(
        `SELECT id, cost_cents AS costCents, split_mode AS splitMode,
           original_currency AS originalCurrency, original_cents AS originalCents,
           rate, rate_source AS rateSource, rate_at AS rateAt
         FROM items WHERE split_id = ?`,
      )
      .bind(splitId),
    db
      .prepare(
        `SELECT ip.item_id AS itemId, ip.person_id AS personId, ip.exact_cents AS exactCents,
           ip.original_exact_cents AS originalExactCents
         FROM item_participants ip JOIN items i ON i.id = ip.item_id WHERE i.split_id = ?`,
      )
      .bind(splitId),
  ]);
  const split = splitRows.results[0] as
    | { currency: string; fromCurrency: string | null; since: number | null }
    | undefined;
  if (split?.fromCurrency == null || split.since == null) return;
  const { currency: to, fromCurrency, since } = split;

  const items = itemRows.results as ItemRow[];
  const partsOf = new Map<string, PartRow[]>();
  for (const part of partRows.results as PartRow[]) {
    partsOf.set(part.itemId, [...(partsOf.get(part.itemId) ?? []), part]);
  }
  // What each item was paid in: its own currency, or the split's old one
  const paidIn = (item: ItemRow) => item.originalCurrency ?? fromCurrency;

  // Throws if a rate can't be had; the split stays converting and is retried
  const rates = new Map<string, Rate>();
  for (const from of new Set(items.map(paidIn).filter((c) => c !== to))) {
    rates.set(from, await fetchRate(from, to));
  }

  // Each write only applies while the split is still in the currency read above
  const stillTo = `(SELECT currency FROM splits WHERE id = ?) = ?`;
  const statements: D1PreparedStatement[] = [];
  for (const item of items) {
    const from = paidIn(item);
    const paidCents = item.originalCents ?? item.costCents;
    const paidParts = (partsOf.get(item.id) ?? []).map((p): [string, number] => [
      p.personId,
      p.originalExactCents ?? p.exactCents ?? 0,
    ]);

    if (from === to) {
      // Paid in the new currency: plain again, exactly as typed
      statements.push(
        db
          .prepare(
            `UPDATE items SET cost_cents = ?, original_currency = NULL, original_cents = NULL,
               rate = NULL, rate_source = NULL, rate_at = NULL
             WHERE id = ? AND ${stillTo}`,
          )
          .bind(paidCents, item.id, splitId, to),
      );
      if (item.splitMode === 'exact') {
        for (const [personId, cents] of paidParts) {
          statements.push(
            db
              .prepare(
                `UPDATE item_participants SET exact_cents = ?, original_exact_cents = NULL
                 WHERE item_id = ? AND person_id = ? AND ${stillTo}`,
              )
              .bind(cents, item.id, personId, splitId, to),
          );
        }
      }
      continue;
    }

    const rate = rates.get(from)!;
    const costCents = convertCents(paidCents, rate.rate);
    statements.push(
      db
        .prepare(
          `UPDATE items SET cost_cents = ?, original_currency = ?, original_cents = ?,
             rate = ?, rate_source = ?, rate_at = ?
           WHERE id = ? AND ${stillTo}`,
        )
        .bind(
          costCents,
          from,
          paidCents,
          rate.rate,
          rate.source,
          rate.fetchedAt,
          item.id,
          splitId,
          to,
        ),
    );
    if (item.splitMode === 'exact') {
      const converted = convertParts(paidParts, rate.rate, costCents);
      for (const [personId, cents] of paidParts) {
        statements.push(
          db
            .prepare(
              `UPDATE item_participants SET exact_cents = ?, original_exact_cents = ?
               WHERE item_id = ? AND person_id = ? AND ${stillTo}`,
            )
            .bind(converted.get(personId) ?? 0, cents, item.id, personId, splitId, to),
        );
      }
    }
  }

  // Done, unless the currency was changed again while this ran
  statements.push(
    db
      .prepare(
        `UPDATE splits SET converting_from = NULL, converting_since = NULL, updated_at = ?
         WHERE id = ? AND currency = ? AND converting_since = ?`,
      )
      .bind(Date.now(), splitId, to, since),
  );
  await db.batch(statements);
}
