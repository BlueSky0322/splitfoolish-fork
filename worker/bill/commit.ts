// What a write checks in the same batch that saves it, so nothing it read beforehand can
// have changed under it: the read and the save are separate round trips, and a write
// may wait on an exchange rate in between. Also the app's change receipts, which make
// a change sent again (its answer lost) count once.

import type { Actor } from '../../shared/rules';
import type { Model } from './model';

/**
 * Refuses the whole batch unless the writer is still in the split with the role they
 * had when it was read, and (when it saves amounts) the split is still in the currency
 * they were worked out in. A check that fails inserts NULL into write_guards (migration
 * 0020), which NOT NULL turns into an error that undoes every statement in the batch.
 */
export function guardStatements(
  db: D1Database,
  splitId: string,
  actor: Actor,
  model: Model | null,
): D1PreparedStatement[] {
  const statements = [
    db
      .prepare(
        `INSERT INTO write_guards (member) SELECT NULL WHERE NOT EXISTS
           (SELECT 1 FROM split_members WHERE split_id = ? AND email = ? AND role = ?)`,
      )
      .bind(splitId, actor.email, actor.role),
  ];
  if (model != null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO write_guards (currency) SELECT NULL WHERE NOT EXISTS
             (SELECT 1 FROM splits
              WHERE id = ? AND currency = ? AND (converting_from IS NOT NULL) = ?)`,
        )
        .bind(splitId, model.currency, model.converting ? 1 : 0),
    );
  }
  return statements;
}

/** Refuses the batch unless `email` is still in the split, in any role */
export const memberGuardStatement = (db: D1Database, splitId: string, email: string) =>
  db
    .prepare(
      `INSERT INTO write_guards (member) SELECT NULL WHERE NOT EXISTS
         (SELECT 1 FROM split_members WHERE split_id = ? AND email = ?)`,
    )
    .bind(splitId, email);

/** Which check refused a batch, from the error it ended with; null for any other error */
export function guardThatFailed(err: unknown): 'member' | 'currency' | null {
  const message = err instanceof Error ? err.message : '';
  if (message.includes('write_guards.member')) return 'member';
  if (message.includes('write_guards.currency')) return 'currency';
  return null;
}

/** A receipt is kept this long: well past how long a change waits on a device */
export const RECEIPT_DAYS = 90;

/** A change as sent, in the currency its plain amounts were typed in, as SHA-256 hex */
export async function changeFingerprint(change: unknown, currency: string | null) {
  const bytes = new TextEncoder().encode(JSON.stringify([change, currency]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The fingerprints saved for these change ids, by id */
export async function savedReceipts(
  db: D1Database,
  splitId: string,
  email: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .prepare(
      `SELECT change_id AS id, fingerprint FROM change_receipts
       WHERE split_id = ? AND email = ? AND change_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(splitId, email, JSON.stringify(ids))
    .all<{ id: string; fingerprint: string }>();
  return new Map(rows.results.map((r) => [r.id, r.fingerprint]));
}

/** Receipts for changes saved now, and the old ones of this split let go */
export function receiptStatements(
  db: D1Database,
  splitId: string,
  email: string,
  receipts: { id: string; fingerprint: string }[],
): D1PreparedStatement[] {
  if (receipts.length === 0) return [];
  const now = Date.now();
  return [
    ...receipts.map((r) =>
      db
        .prepare(
          `INSERT INTO change_receipts (split_id, email, change_id, fingerprint, saved_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(splitId, email, r.id, r.fingerprint, now),
    ),
    db
      .prepare('DELETE FROM change_receipts WHERE split_id = ? AND saved_at < ?')
      .bind(splitId, now - RECEIPT_DAYS * 24 * 60 * 60 * 1000),
  ];
}
