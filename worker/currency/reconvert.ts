// Converting a split's items and payments after its currency changes, in the
// background. Each keeps what was originally paid: ones already in another currency
// are converted again from that, plain ones become "paid in the old currency", and
// ones paid in the new currency become plain again, so switching back restores the
// exact amounts. Each is converted at the rate on the day it was paid.

import type { RateSource } from '../../shared/rates';
import { convertCents, convertParts, fitsItemCents, rateDay } from '../../shared/rates';
import type { SplitMode } from '../../shared/settle';
import type { Rate } from './exchange-rates';

/**
 * Opening a split retries a conversion this old. Failed conversions are retried by the
 * queue (reconvert-queue.ts); this is the safety net for when that couldn't.
 */
export const RETRY_AFTER_MS = 10 * 60 * 1000;

/** A conversion to retry, sent to the reconvert queue when the first attempt fails */
export interface ReconvertJob {
  splitId: string;
  /** converting_since of the change this job is for; a newer change makes it a no-op */
  since: number;
  /** Whose rate preference to use: the person who changed the currency */
  email: string;
}

/** The first retry waits this long, giving the rate services a moment to come back */
export const FIRST_RETRY_S = 30;
/** Longest wait between retries; queued messages are kept a day, and 8 tries fit in it */
const MAX_RETRY_S = 60 * 60;

/** How long to wait before try number `attempts + 1`: 1 minute, 2, 4 ... up to an hour */
export const retryDelaySeconds = (attempts: number) =>
  Math.min(60 * 2 ** Math.max(0, attempts - 1), MAX_RETRY_S);

/** What an item or payment was paid in and when, which decides its rate */
interface Paid {
  createdAt: number;
  originalCurrency: string | null;
}

interface PaymentRow extends Paid {
  id: string;
  amountCents: number;
  originalCents: number | null;
}

interface ItemRow {
  id: string;
  costCents: number;
  splitMode: SplitMode;
  createdAt: number;
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
 * Does nothing if it isn't converting, or (given `onlySince`) if the conversion under
 * way is for a newer change than the one asked about. If the currency changes again
 * meanwhile, its writes are skipped and the next run starts over. An item too large in
 * the new currency puts the split back in the old one instead. True when this run
 * finished the conversion, either way.
 */
export async function reconvertSplit(
  db: D1Database,
  splitId: string,
  /** The rate for an item paid at `at`, as getRateOn finds it */
  fetchRate: (from: string, to: string, at: number) => Promise<Rate>,
  onlySince?: number,
): Promise<boolean> {
  const [splitRows, itemRows, partRows, paymentRows] = await db.batch([
    db
      .prepare(
        `SELECT currency, converting_from AS fromCurrency, converting_since AS since
         FROM splits WHERE id = ?`,
      )
      .bind(splitId),
    db
      .prepare(
        `SELECT id, cost_cents AS costCents, split_mode AS splitMode, created_at AS createdAt,
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
    db
      .prepare(
        `SELECT id, amount_cents AS amountCents, created_at AS createdAt,
           original_currency AS originalCurrency, original_cents AS originalCents
         FROM payments WHERE split_id = ?`,
      )
      .bind(splitId),
  ]);
  const split = splitRows.results[0] as
    | { currency: string; fromCurrency: string | null; since: number | null }
    | undefined;
  if (split?.fromCurrency == null || split.since == null) return false;
  if (onlySince != null && split.since !== onlySince) return false;
  const { currency: to, fromCurrency, since } = split;

  const items = itemRows.results as ItemRow[];
  const payments = paymentRows.results as PaymentRow[];
  const partsOf = new Map<string, PartRow[]>();
  for (const part of partRows.results as PartRow[]) {
    partsOf.set(part.itemId, [...(partsOf.get(part.itemId) ?? []), part]);
  }
  // What each item or payment was paid in: its own currency, or the split's old one
  const paidIn = (paid: Paid) => paid.originalCurrency ?? fromCurrency;

  // One rate per currency and day. Throws if one can't be had; the split stays
  // converting and is retried.
  const keyOf = (paid: Paid) => `${paidIn(paid)} ${rateDay(paid.createdAt)}`;
  const wanted = new Map(
    [...items, ...payments].filter((p) => paidIn(p) !== to).map((p) => [keyOf(p), p]),
  );
  const rates = new Map(
    await Promise.all(
      [...wanted].map(
        async ([key, p]) => [key, await fetchRate(paidIn(p), to, p.createdAt)] as const,
      ),
    ),
  );

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

    const rate = rates.get(keyOf(item))!;
    const costCents = convertCents(paidCents, rate.rate);
    // Too much in the new currency to hold exactly: no rate will change that, so the
    // split goes back to the currency its amounts are still in, rather than retrying
    if (!fitsItemCents(costCents)) return undoCurrencyChange(db, splitId, to, since);
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

  for (const payment of payments) {
    const from = paidIn(payment);
    const paidCents = payment.originalCents ?? payment.amountCents;
    if (from === to) {
      // Paid in the new currency: plain again, exactly as typed
      statements.push(
        db
          .prepare(
            `UPDATE payments SET amount_cents = ?, original_currency = NULL, original_cents = NULL,
               rate = NULL, rate_source = NULL, rate_at = NULL
             WHERE id = ? AND ${stillTo}`,
          )
          .bind(paidCents, payment.id, splitId, to),
      );
      continue;
    }
    const rate = rates.get(keyOf(payment))!;
    const amountCents = convertCents(paidCents, rate.rate);
    if (!fitsItemCents(amountCents)) return undoCurrencyChange(db, splitId, to, since);
    statements.push(
      db
        .prepare(
          `UPDATE payments SET amount_cents = ?, original_currency = ?, original_cents = ?,
             rate = ?, rate_source = ?, rate_at = ?
           WHERE id = ? AND ${stillTo}`,
        )
        .bind(
          amountCents,
          from,
          paidCents,
          rate.rate,
          rate.source,
          rate.fetchedAt,
          payment.id,
          splitId,
          to,
        ),
    );
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
  const results = await db.batch(statements);
  return (results.at(-1)?.meta.changes ?? 0) > 0;
}

/**
 * Puts a split back in the currency its amounts are still in, its conversion over, when
 * an item would come to more in the new one than an item may (MAX_ITEM_CENTS). Nothing
 * was written to its items, so they stay as they were. Only while that conversion is
 * still the one under way.
 */
async function undoCurrencyChange(db: D1Database, splitId: string, to: string, since: number) {
  console.error('undid a currency change an item is too large for', { splitId, to });
  const { meta } = await db
    .prepare(
      `UPDATE splits SET currency = converting_from, converting_from = NULL,
         converting_since = NULL, updated_at = ?
       WHERE id = ? AND currency = ? AND converting_since = ?`,
    )
    .bind(Date.now(), splitId, to, since)
    .run();
  return meta.changes > 0;
}
