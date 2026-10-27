// My Splits: each split the person belongs to, with its total and their own balance.
// Everything is read in one round trip and balanced with the same maths as the app.
// Also the names of items across those splits, for suggesting as you type one, and the
// currencies used in them, for Settings.

import type { FoundItem, ItemNameUse, SplitSummary } from '../../shared/api';
import type { SettleItem, SplitMode, Transfer } from '../../shared/settle';
import { balances } from '../../shared/settle';
import type { Role } from '../../shared/types';

/** A page of someone's splits: `limit` of them from `offset`, in their own order */
export interface SplitPage {
  limit: number;
  offset: number;
}

/**
 * Someone's splits in their own order (s for splits, m for their membership): as they
 * dragged them, then the latest changed first, then by id, so splits that tie on both
 * still come in the same order every time and a page never repeats or skips one
 */
export const SPLIT_ORDER = 'm.sort_position IS NOT NULL, m.sort_position, s.updated_at DESC, s.id';

// The splits a read is about, in the person's order: those they belong to, or a page of
// them. Every bill query joins this, so only the bills on the page are read.
const PAGE_OF_SPLITS = `page AS (
  SELECT s.id FROM splits s JOIN split_members m ON m.split_id = s.id
  WHERE m.email = ?1
  ORDER BY ${SPLIT_ORDER}
  LIMIT ?2 OFFSET ?3)`;

/** Adds `row` to the list kept under `key`, starting one if there is none */
function file<T>(into: Map<string, T[]>, key: string, row: T) {
  const list = into.get(key);
  if (list == null) into.set(key, [row]);
  else list.push(row);
}

/**
 * Someone's splits with their totals and balances, all of them or one page, and how
 * many there are in all
 */
export async function listSplitSummaries(
  db: D1Database,
  email: string,
  page?: SplitPage,
): Promise<{ splits: SplitSummary[]; total: number }> {
  // A negative limit is no limit
  const [limit, offset] = page == null ? [-1, 0] : [page.limit, page.offset];
  const paged = (sql: string) =>
    db.prepare(`WITH ${PAGE_OF_SPLITS} ${sql}`).bind(email, limit, offset);
  const [splits, items, participants, mine, people, payments, count] = await db.batch([
    paged(
      `SELECT s.id, s.name, s.currency, s.updated_at AS updatedAt, m.role,
         m.archived_at IS NOT NULL AS archived,
         (SELECT count(*) FROM split_members WHERE split_id = s.id) AS memberCount,
         (SELECT version FROM split_pictures WHERE split_id = s.id) AS pictureVersion
       FROM page JOIN splits s ON s.id = page.id
       JOIN split_members m ON m.split_id = s.id AND m.email = ?1
       ORDER BY ${SPLIT_ORDER}`,
    ),
    paged(
      `SELECT i.id, i.split_id AS splitId, i.cost_cents AS costCents, i.payer_id AS payerId,
         i.split_mode AS splitMode
       FROM items i JOIN page ON page.id = i.split_id`,
    ),
    paged(
      `SELECT ip.item_id AS itemId, ip.person_id AS personId, ip.shares, ip.exact_cents AS exactCents
       FROM item_participants ip JOIN items i ON i.id = ip.item_id
       JOIN page ON page.id = i.split_id`,
    ),
    // The person in each split's bill who is this account, if any
    paged(
      `SELECT p.split_id AS splitId, p.id FROM people p JOIN page ON page.id = p.split_id
       WHERE p.member_email = ?1`,
    ),
    paged(`SELECT p.split_id AS splitId, p.id FROM people p JOIN page ON page.id = p.split_id`),
    paged(
      `SELECT p.split_id AS splitId, p.from_person_id AS fromId, p.to_person_id AS toId,
         p.amount_cents AS amountCents
       FROM payments p JOIN page ON page.id = p.split_id`,
    ),
    db.prepare('SELECT count(*) AS total FROM split_members WHERE email = ?').bind(email),
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
    file(bySplit, i.splitId, item);
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
  const peopleOf = new Map<string, string[]>();
  for (const p of people.results as { splitId: string; id: string }[]) {
    file(peopleOf, p.splitId, p.id);
  }
  const paidBack = new Map<string, Transfer[]>();
  for (const p of payments.results as ({ splitId: string } & Transfer)[]) {
    file(paidBack, p.splitId, p);
  }

  const summaries = (
    splits.results as {
      id: string;
      name: string;
      currency: string;
      updatedAt: number;
      role: Role;
      memberCount: number;
      pictureVersion: number | null;
      archived: number;
    }[]
  ).map((s) => {
    const splitItems = bySplit.get(s.id) ?? [];
    const me = myPerson.get(s.id);
    const ids = peopleOf.get(s.id) ?? [];
    const totalCents = splitItems.reduce((a, i) => a + i.costCents, 0);
    // Everyone's balance once; balances() gives every id it's asked about an entry
    const all = balances(ids, splitItems, paidBack.get(s.id) ?? []);
    return {
      ...s,
      archived: s.archived === 1,
      peopleCount: ids.length,
      itemCount: splitItems.length,
      totalCents,
      // Something was spent and no one owes anyone, payments counted
      settled: totalCents > 0 && [...all.values()].every((b) => b.balanceCents === 0),
      // Null when no one in the bill is linked to this account
      myBalanceCents: me == null ? null : all.get(me)!.balanceCents,
    };
  });
  return { splits: summaries, total: (count.results[0] as { total: number }).total };
}

const MAX_ITEM_NAMES = 500;

/**
 * Names of items in someone's splits, most recent first. Each name once (ignoring case),
 * with the category it was last given.
 */
export async function listItemNames(db: D1Database, email: string): Promise<ItemNameUse[]> {
  const { results } = await db
    .prepare(
      `SELECT name, category, uses FROM (
         SELECT i.name, i.category, count(*) OVER (PARTITION BY lower(i.name)) AS uses,
           row_number() OVER (PARTITION BY lower(i.name) ORDER BY i.created_at DESC) AS n,
           max(i.created_at) OVER (PARTITION BY lower(i.name)) AS last
         FROM items i JOIN split_members m ON m.split_id = i.split_id AND m.email = ?
       ) WHERE n = 1 ORDER BY last DESC LIMIT ?`,
    )
    .bind(email, MAX_ITEM_NAMES)
    .all<ItemNameUse>();
  return results;
}

/** At most this many currencies in Settings' "Rates in your splits" */
const MAX_USED_CURRENCIES = 12;

/**
 * The currencies in a person's splits other than `except` (the splits' own, and those
 * items were paid in), with how many splits each is in, most used first
 */
export async function listUsedCurrencies(
  db: D1Database,
  email: string,
  except: string,
): Promise<{ currency: string; splits: number }[]> {
  const used = await db
    .prepare(
      `SELECT cur AS currency, count(DISTINCT split_id) AS splits FROM (
         SELECT s.currency AS cur, s.id AS split_id
           FROM splits s JOIN split_members m ON m.split_id = s.id WHERE m.email = ?1
         UNION ALL
         SELECT i.original_currency, i.split_id
           FROM items i JOIN split_members m ON m.split_id = i.split_id
           WHERE m.email = ?1 AND i.original_currency IS NOT NULL
       ) WHERE cur != ?2 GROUP BY cur ORDER BY splits DESC, cur LIMIT ?3`,
    )
    .bind(email, except, MAX_USED_CURRENCIES)
    .all<{ currency: string; splits: number }>();
  return used.results;
}

/** At most this many items found by a search */
const MAX_FOUND_ITEMS = 50;

/** Items in someone's splits whose name has `text` in it, newest first */
export async function searchItems(
  db: D1Database,
  email: string,
  text: string,
): Promise<FoundItem[]> {
  // % and _ are wildcards in LIKE: they're looked for as typed
  const pattern = `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const { results } = await db
    .prepare(
      `SELECT i.id, i.name, i.cost_cents AS costCents, i.category, i.created_at AS createdAt,
         s.id AS splitId, s.name AS splitName, s.currency
       FROM items i JOIN splits s ON s.id = i.split_id
       JOIN split_members m ON m.split_id = i.split_id AND m.email = ?
       WHERE i.name LIKE ? ESCAPE '\\' ORDER BY i.created_at DESC LIMIT ?`,
    )
    .bind(email, pattern, MAX_FOUND_ITEMS)
    .all<FoundItem>();
  return results;
}
