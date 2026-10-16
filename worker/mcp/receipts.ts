// Retry receipts for the expense tools (migrations/0019_mcp_receipts.sql). A receipt is
// written in the same batch as the change it records, so a retry finds one exactly when
// the change was saved, and gets that answer back instead of applying it again.

import type { SaveResult } from '../bill/changes';

export interface Receipt {
  email: string;
  requestId: string;
  fingerprint: string;
  tool: string;
  splitId: string;
  expenseId: string;
  savedAt: number;
}

/**
 * A stable digest of what a request asked for: the same fields in any key order give the
 * same value, and anything else gives another
 */
export async function fingerprint(value: unknown) {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v != null && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
              .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
          )
        : v;
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const findReceipt = (db: D1Database, email: string, requestId: string) =>
  db
    .prepare(
      `SELECT email, request_id AS requestId, fingerprint, tool, split_id AS splitId,
         expense_id AS expenseId, saved_at AS savedAt
       FROM mcp_receipts WHERE email = ? AND request_id = ?`,
    )
    .bind(email, requestId)
    .first<Receipt>();

/** Saves a receipt; fails the whole batch if this account already used the request id */
export const receiptStatement = (db: D1Database, r: Receipt) =>
  db
    .prepare(
      `INSERT INTO mcp_receipts
         (email, request_id, fingerprint, tool, split_id, expense_id, saved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(r.email, r.requestId, r.fingerprint, r.tool, r.splitId, r.expenseId, r.savedAt);

/** A change saved (now, or by an earlier request), under another request, or refused */
export type Answered = { receipt: Receipt; replayed: boolean } | { conflict: Receipt };
export type SaveOnce = Answered | { refused: Extract<SaveResult, { saved: false }> };

/** What a request already saved under this id means for this one: its answer, or a conflict */
export const sameRequest = (earlier: Receipt, print: string): Answered =>
  earlier.fingerprint === print ? { receipt: earlier, replayed: true } : { conflict: earlier };

/**
 * Saves a change (`save` writes what it's given in the same batch) with its receipt.
 * When the same request was sent twice at once, both find no receipt first, and the
 * database refuses the second's: that one answers with the receipt the first saved.
 */
export async function saveOnce(
  db: D1Database,
  receipt: Receipt,
  save: (alongside: D1PreparedStatement[]) => Promise<SaveResult>,
): Promise<SaveOnce> {
  const outcome = await save([receiptStatement(db, receipt)]);
  if (outcome.saved) return { receipt, replayed: false };
  if (outcome.constraint) {
    const other = await findReceipt(db, receipt.email, receipt.requestId);
    if (other != null) return sameRequest(other, receipt.fingerprint);
  }
  return { refused: outcome };
}
