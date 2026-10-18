// A split's bill as it stands while a batch of changes is checked: each change is
// checked against it and then applied to it, so the next change sees the result.

import type { RateSource } from '../../shared/rates';
import { savedRateSource } from '../../shared/rates';
import type { SplitMode } from '../../shared/settle';
import type { Change, Role } from '../../shared/types';

/** A change that can't be applied to the split as it is now */
export class Refused extends Error {}
/** A change the person's role doesn't allow */
export class Forbidden extends Refused {}

export interface ModelItem {
  payerId: string;
  participantIds: string[];
  splitMode: SplitMode;
  /** When it was paid, in ms; an item in another currency is converted at that day's rate */
  createdAt: number;
  /** Exact split amounts as typed in the item's own currency, by person id */
  originalExact: Map<string, number>;
  /** The rate it was converted at, kept when an edit doesn't change the amount */
  converted: {
    currency: string;
    cents: number;
    rate: number;
    source: RateSource;
    at: number;
  } | null;
}

/** The split's people and items as they will be after each change, for checking the next one */
export interface Model {
  people: Map<string, { name: string; memberEmail: string | null }>;
  items: Map<string, ModelItem>;
  /** The split's currency; items in others are converted into it */
  currency: string;
  /** Its items are being converted into a new currency */
  converting: boolean;
  members: Set<string>;
  owner: string | null;
  nextPersonPosition: number;
  nextItemPosition: number;
}

export async function loadModel(db: D1Database, splitId: string): Promise<Model> {
  const [people, items, participants, positions, members, split] = await db.batch([
    db
      .prepare('SELECT id, name, member_email AS memberEmail FROM people WHERE split_id = ?')
      .bind(splitId),
    db
      .prepare(
        `SELECT id, payer_id AS payerId, split_mode AS splitMode, created_at AS createdAt,
             original_currency AS currency, original_cents AS cents, rate,
             rate_source AS source, rate_at AS at
           FROM items WHERE split_id = ?`,
      )
      .bind(splitId),
    db
      .prepare(
        `SELECT ip.item_id AS itemId, ip.person_id AS personId,
           ip.original_exact_cents AS originalExactCents
         FROM item_participants ip JOIN items i ON i.id = ip.item_id WHERE i.split_id = ?`,
      )
      .bind(splitId),
    db
      .prepare(
        `SELECT (SELECT coalesce(max(position), -1) + 1 FROM people WHERE split_id = ?1) AS person,
                (SELECT coalesce(max(position), -1) + 1 FROM items WHERE split_id = ?1) AS item`,
      )
      .bind(splitId),
    db.prepare('SELECT email, role FROM split_members WHERE split_id = ?').bind(splitId),
    db
      .prepare('SELECT currency, converting_since AS convertingSince FROM splits WHERE id = ?')
      .bind(splitId),
  ]);
  const memberRows = members.results as { email: string; role: Role }[];
  // The route already found the split, so its row is there
  const splitRow = split.results[0] as { currency: string; convertingSince: number | null };

  const model: Model = {
    people: new Map(
      (people.results as { id: string; name: string; memberEmail: string | null }[]).map((p) => [
        p.id,
        { name: p.name, memberEmail: p.memberEmail },
      ]),
    ),
    items: new Map(
      (
        items.results as {
          id: string;
          payerId: string;
          splitMode: SplitMode;
          createdAt: number;
          currency: string | null;
          cents: number | null;
          rate: number | null;
          source: RateSource | null;
          at: number | null;
        }[]
      ).map((i) => [
        i.id,
        {
          payerId: i.payerId,
          participantIds: [] as string[],
          originalExact: new Map<string, number>(),
          splitMode: i.splitMode,
          createdAt: i.createdAt,
          converted:
            i.currency == null || i.cents == null || i.rate == null
              ? null
              : {
                  currency: i.currency,
                  cents: i.cents,
                  rate: i.rate,
                  source: savedRateSource(i.source),
                  at: i.at ?? 0,
                },
        },
      ]),
    ),
    currency: splitRow.currency,
    converting: splitRow.convertingSince != null,
    members: new Set(memberRows.map((m) => m.email)),
    owner: memberRows.find((m) => m.role === 'owner')?.email ?? null,
    nextPersonPosition: (positions.results[0] as { person: number }).person,
    nextItemPosition: (positions.results[0] as { item: number }).item,
  };
  for (const row of participants.results as {
    itemId: string;
    personId: string;
    originalExactCents: number | null;
  }[]) {
    const item = model.items.get(row.itemId);
    item?.participantIds.push(row.personId);
    if (row.originalExactCents != null)
      item?.originalExact.set(row.personId, row.originalExactCents);
  }
  return model;
}

/**
 * A change as sent: its op says which change it claims to be, but every other field is
 * unchecked until changeStatements reads it
 */
export type UncheckedChange = Change extends infer C
  ? C extends { op: infer Op }
    ? { op: Op } & { [K in Exclude<keyof C, 'op'>]?: unknown }
    : never
  : never;

/** A batch as sent: a non-object in it has no op, and is refused like an unknown one */
export type Batch = (UncheckedChange | null)[];
