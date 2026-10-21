// A split itself: making one, changing its name and currency (which sets off converting
// its items in the background), everyone's own order of their splits, and deleting one.
// Its bill is in bill/, and who has access to it in sharing.ts.

import type { Env } from '../app';
import { touchSplitStatement } from '../app';
import { getRatePreference, settingsStatements } from '../accounts/profiles';
import { getRateOn } from '../currency/exchange-rates';
import { RETRY_AFTER_MS, reconvertSplit } from '../currency/reconvert';
import { queueReconvert } from '../currency/reconvert-queue';
import { notifySplit } from './room';
import { deleteAllAccessStatements, newShareToken } from './sharing';
import { deleteContentStatements } from '../bill/changes';

type WaitUntil = { waitUntil: (p: Promise<unknown>) => void };

/** A new split, owned by the account that made it; `id` is the app's */
export function createSplitStatements(
  db: D1Database,
  id: string,
  name: string,
  currency: string,
  email: string,
) {
  const now = Date.now();
  return [
    db
      .prepare(
        `INSERT INTO splits (id, name, currency, invite_token, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
      )
      .bind(id, name, currency, newShareToken(), now),
    // New splits default to the currency used last
    ...settingsStatements(db, email, { lastCurrency: currency }),
    db
      .prepare(
        `INSERT INTO split_members (split_id, email, role, joined_at) VALUES (?, ?, 'owner', ?)`,
      )
      .bind(id, email, now),
  ];
}

/**
 * Someone's own order for their splits, first to last. Splits they're not in are
 * skipped: only their own rows change.
 */
export const splitOrderStatements = (db: D1Database, email: string, ids: string[]) =>
  [...new Set(ids)].map((id, position) =>
    db
      .prepare('UPDATE split_members SET sort_position = ? WHERE split_id = ? AND email = ?')
      .bind(position, id, email),
  );

/**
 * Changes a split's name and currency, both checked already. A new currency starts
 * converting its items (converting: true), which startReconvert does once these have
 * run; until it's done, plain items are still in the currency the split had before.
 * No statements when nothing changes.
 */
export async function planSplitSettings(
  db: D1Database,
  splitId: string,
  changes: { name?: string; currency?: string },
): Promise<{ statements: D1PreparedStatement[]; converting: boolean; since: number }> {
  const statements: D1PreparedStatement[] = [];
  // When the conversion started, which tells its retries apart from a later change's
  const since = Date.now();
  if (changes.name != null) {
    statements.push(
      db.prepare('UPDATE splits SET name = ? WHERE id = ?').bind(changes.name, splitId),
    );
  }
  let converting = false;
  if (changes.currency != null) {
    const changed = await db
      .prepare('SELECT 1 FROM splits WHERE id = ? AND currency != ?')
      .bind(splitId, changes.currency)
      .first();
    if (changed) {
      converting = true;
      // Changed again mid-conversion, plain items are still in the first old currency
      statements.push(
        db
          .prepare(
            `UPDATE splits SET converting_from = coalesce(converting_from, currency),
             converting_since = ?, currency = ? WHERE id = ?`,
          )
          .bind(since, changes.currency, splitId),
      );
    }
  }
  if (statements.length > 0) statements.push(touchSplitStatement(db, splitId));
  return { statements, converting, since };
}

/** Everything of a split, children first, for deleting it */
export const deleteSplitStatements = (db: D1Database, splitId: string) => [
  // Retry receipts for agents' expense writes (mcp/receipts.ts) last as long as the split
  db.prepare('DELETE FROM mcp_receipts WHERE split_id = ?').bind(splitId),
  db.prepare('DELETE FROM change_receipts WHERE split_id = ?').bind(splitId),
  ...deleteContentStatements(db, splitId),
  ...deleteAllAccessStatements(db, splitId),
  db.prepare('DELETE FROM splits WHERE id = ?').bind(splitId),
];

/**
 * Converts the split's items after the response is sent, at rates from the source the
 * person who set it off prefers, and tells the apps that have it open once it's done.
 * If that fails (say, the rates are down), the reconvert queue tries again later.
 * `since` is when the conversion started (converting_since).
 */
export const startReconvert = (
  env: Env,
  ctx: WaitUntil,
  splitId: string,
  email: string,
  since: number,
) =>
  ctx.waitUntil(
    (async () => {
      try {
        const prefer = await getRatePreference(env.DB, email);
        const fetchRate = (from: string, to: string, at: number) =>
          getRateOn(env, from, to, at, { prefer });
        if (await reconvertSplit(env.DB, splitId, fetchRate, since)) {
          notifySplit(env, ctx, splitId, null);
        }
      } catch (err) {
        console.error(err);
        await queueReconvert(env, { splitId, since, email });
      }
    })(),
  );

/** How long a conversion may take before opening the split retries it */
const retryAfterMs = (env: Env) => {
  const configured = Number.parseInt(env.RECONVERT_RETRY_MS ?? '', 10);
  return Number.isNaN(configured) ? RETRY_AFTER_MS : configured;
};

/**
 * Starts the conversion again if one that began at `convertingSince` should have
 * finished by now (say, the rates were down). Nothing when the split isn't converting.
 */
export function retryStalledReconvert(
  env: Env,
  ctx: WaitUntil,
  splitId: string,
  email: string,
  convertingSince: number | null,
) {
  if (convertingSince != null && Date.now() - convertingSince >= retryAfterMs(env)) {
    startReconvert(env, ctx, splitId, email, convertingSince);
  }
}
