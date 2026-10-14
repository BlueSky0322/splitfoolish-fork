// A split's bill: its people and items. Clients send batches of small changes
// (add this person, remove that item); each batch is checked against the split's
// current contents and applied all-or-nothing, touching only the rows involved, so
// people editing the same split don't overwrite each other.

import { RateSource, convertCents, convertParts, isValidRate } from '../shared/rates';
import { SplitMode } from '../shared/settle';
import type { Change, Item, ItemOriginal, Person } from '../shared/types';
import { MAX_NOTES_LENGTH } from '../shared/types';

export type { Change, Item, Person };

const MAX_NAME_LENGTH = 80;
const MAX_CATEGORY_LENGTH = 32;
const MAX_COST = 1_000_000_000;
const MAX_SHARES = 999;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const touchSplit = (db: D1Database, splitId: string) =>
  db.prepare('UPDATE splits SET updated_at = ? WHERE id = ?').bind(Date.now(), splitId);

const readName = (value: unknown) => {
  const name = typeof value === 'string' ? value.trim() : '';
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null;
};

const toCents = (amount: number) => Math.round(amount * 100);

/** Reads a split's people and items; run as part of a larger batch, then pass to assembleContent */
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

export function assembleContent([people, items, participants]: D1Result<
  Record<string, unknown>
>[]) {
  const byItem = new Map<string, ParticipantRow[]>();
  for (const row of participants.results as unknown as ParticipantRow[]) {
    byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row]);
  }

  return {
    people: people.results as unknown as Person[],
    items: (items.results as unknown as ItemRow[]).map((i): Item => {
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
  };
}

const MAX_CHANGES = 200;
// Ids are made by the client so its changes can refer to people and items it just added
const CLIENT_ID = /^[0-9a-f]{16}$/;

class Refused extends Error {}

export interface Actor {
  email: string;
  role: 'owner' | 'editor';
}

const PEOPLE_OPS = new Set<unknown>(['addPerson', 'renamePerson', 'removePerson', 'clearPeople']);

export const newInviteToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/**
 * Takes an account out of a split: their membership goes, the person they were in the
 * bill stays as a guest, and the share link changes (withdrawing invites picked up from
 * it) so the old one can't bring them back
 */
export const removeAccessStatements = (db: D1Database, splitId: string, email: string) => [
  db.prepare('DELETE FROM split_members WHERE split_id = ? AND email = ?').bind(splitId, email),
  // The link changes below, so invites picked up from the old one go too
  db.prepare('DELETE FROM split_invites WHERE split_id = ?').bind(splitId),
  db
    .prepare('UPDATE people SET member_email = NULL WHERE split_id = ? AND member_email = ?')
    .bind(splitId, email),
  db.prepare('UPDATE splits SET invite_token = ? WHERE id = ?').bind(newInviteToken(), splitId),
];

interface ModelItem {
  payerId: string;
  participantIds: string[];
  splitMode: SplitMode;
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
interface Model {
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

async function loadModel(db: D1Database, splitId: string): Promise<Model> {
  const [people, items, participants, positions, members, split] = await db.batch<
    Record<string, unknown>
  >([
    db
      .prepare('SELECT id, name, member_email AS memberEmail FROM people WHERE split_id = ?')
      .bind(splitId),
    db
      .prepare(
        `SELECT id, payer_id AS payerId, split_mode AS splitMode,
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
  const memberRows = members.results as { email: string; role: string }[];

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
          converted:
            i.currency == null || i.cents == null || i.rate == null
              ? null
              : {
                  currency: i.currency,
                  cents: i.cents,
                  rate: i.rate,
                  source: i.source ?? 'manual',
                  at: i.at ?? 0,
                },
        },
      ]),
    ),
    currency: (split.results[0] as { currency: string } | undefined)?.currency ?? 'MYR',
    converting:
      (split.results[0] as { convertingSince: number | null } | undefined)?.convertingSince != null,
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

const nameTaken = (model: Model, name: string, exceptId?: string) =>
  [...model.people].some(([id, p]) => p.name === name && id !== exceptId);

/** A member email a person may be linked to, or null; refuses non-members and double links */
function readMemberEmail(model: Model, value: unknown, personId: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Refused('Invalid account');
  const email = value.toLowerCase();
  if (!model.members.has(email)) throw new Refused('That account is not in this split');
  const other = [...model.people].find(([id, p]) => p.memberEmail === email && id !== personId);
  if (other) throw new Refused(`That account is already ${other[1].name}`);
  return email;
}

/** Rates fetched for this batch, by the currency converted from */
export type FetchedRates = Map<string, { rate: number; source: RateSource; fetchedAt: number }>;

interface OriginalInput {
  currency: string;
  cents: number;
  exact: Record<string, unknown>;
  /** A rate typed in, used instead of a fetched one */
  manualRate: number | null;
}

/** What was typed for an item in another currency; null when it's in the split's own */
function readOriginal(model: Model, raw: unknown): OriginalInput | null {
  if (raw == null) return null;
  const original = raw as Partial<Record<keyof ItemOriginal, unknown>>;
  const currency = original.currency;
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    throw new Refused('Invalid currency');
  }
  if (currency === model.currency) return null;
  const amount = original.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_COST) {
    throw new Refused('Cost must be a number of 0 or more');
  }
  let manualRate: number | null = null;
  if (original.rateSource === 'manual') {
    if (!isValidRate(original.rate)) throw new Refused('Enter an exchange rate above 0');
    manualRate = original.rate;
  }
  return {
    currency,
    cents: toCents(amount),
    exact: (original.exact ?? {}) as Record<string, unknown>,
    manualRate,
  };
}

/** The saved conversion an edit can keep: same currency and amount, rate not retyped */
const reusableConversion = (model: Model, itemId: unknown, original: OriginalInput) => {
  const saved = typeof itemId === 'string' ? model.items.get(itemId)?.converted : null;
  if (saved == null || saved.currency !== original.currency || saved.cents !== original.cents) {
    return null;
  }
  if (original.manualRate != null && original.manualRate !== saved.rate) return null;
  if (original.manualRate == null && saved.source === 'manual') return null;
  return saved;
};

/** The currencies a batch needs a fetched rate for, read before the batch is checked */
export function currenciesToFetch(model: Model, changes: Change[]): Set<string> {
  const needed = new Set<string>();
  for (const change of changes) {
    if (change?.op === 'refreshRates' || change?.op === 'setRate') {
      try {
        // Only for currencies some item would take the fetched rate in
        const { currencies, keepManual } = readRateChange(model, change);
        for (const item of model.items.values()) {
          const c = item.converted;
          if (c == null || !currencies.includes(c.currency)) continue;
          if (!(keepManual && c.source === 'manual')) needed.add(c.currency);
        }
      } catch {
        // Refused properly when the batch is checked
      }
      continue;
    }
    if (change?.op !== 'addItem' && change?.op !== 'updateItem') continue;
    try {
      const item = (change.item ?? {}) as unknown as Record<string, unknown>;
      const original = readOriginal(model, item.original);
      if (original == null || original.manualRate != null) continue;
      if (reusableConversion(model, item.id, original) == null) needed.add(original.currency);
    } catch {
      // Refused properly when the batch is checked
    }
  }
  return needed;
}

const MAX_RATE_CURRENCIES = 50;

/** The currencies a rate change is about, and the typed rate if there is one */
function readRateChange(
  model: Model,
  change: Extract<Change, { op: 'refreshRates' | 'setRate' }>,
): { currencies: string[]; manualRate: number | null; keepManual: boolean } {
  const isCode = (c: unknown): c is string => typeof c === 'string' && /^[A-Z]{3}$/.test(c);
  if (change.op === 'refreshRates') {
    const list = change.currencies;
    if (!Array.isArray(list) || list.length > MAX_RATE_CURRENCIES || !list.every(isCode)) {
      throw new Refused('Invalid currency');
    }
    return {
      currencies: [...new Set(list)].filter((c) => c !== model.currency),
      manualRate: null,
      keepManual: true,
    };
  }
  if (!isCode(change.currency) || change.currency === model.currency) {
    throw new Refused('Invalid currency');
  }
  if (change.rate != null && !isValidRate(change.rate)) {
    throw new Refused('Enter an exchange rate above 0');
  }
  return {
    currencies: change.rate == null ? [change.currency] : [],
    manualRate: change.rate ?? null,
    keepManual: false,
  };
}

const exactOriginals = (participants: { personId: string; originalExactCents: number | null }[]) =>
  new Map(
    participants
      .filter((p) => p.originalExactCents != null)
      .map((p) => [p.personId, p.originalExactCents!]),
  );

/** Converts the items paid in some currencies again, at a new rate each */
function rateStatements(
  db: D1Database,
  model: Model,
  change: Extract<Change, { op: 'refreshRates' | 'setRate' }>,
  rates: FetchedRates,
): D1PreparedStatement[] {
  const { manualRate, keepManual } = readRateChange(model, change);
  const currencies = change.op === 'setRate' ? [change.currency] : change.currencies;
  const statements: D1PreparedStatement[] = [];
  for (const [id, item] of model.items) {
    const c = item.converted;
    if (c == null || !currencies.includes(c.currency)) continue;
    if (keepManual && c.source === 'manual') continue;
    const fetched = manualRate == null ? rates.get(c.currency) : null;
    // Only when the batch changed things in a way the first read didn't foresee
    if (manualRate == null && fetched == null) {
      throw new Refused('The exchange rate changed. Try again.');
    }
    const next = {
      ...c,
      rate: manualRate ?? fetched!.rate,
      source: manualRate == null ? fetched!.source : ('manual' as const),
      at: manualRate == null ? fetched!.fetchedAt : Date.now(),
    };
    item.converted = next;
    const costCents = convertCents(c.cents, next.rate);
    statements.push(
      db
        .prepare(
          'UPDATE items SET cost_cents = ?, rate = ?, rate_source = ?, rate_at = ? WHERE id = ?',
        )
        .bind(costCents, next.rate, next.source, next.at, id),
    );
    if (item.splitMode === 'exact') {
      const parts = convertParts([...item.originalExact], next.rate, costCents);
      for (const [personId, cents] of parts) {
        statements.push(
          db
            .prepare(
              'UPDATE item_participants SET exact_cents = ? WHERE item_id = ? AND person_id = ?',
            )
            .bind(cents, id, personId),
        );
      }
    }
  }
  return statements;
}

/** Earliest date an item may say it was added on: before this app existed */
const EARLIEST_ITEM = Date.UTC(2000, 0, 1);

/**
 * When a new item was added: the time it brings with it (a duplicate keeping its
 * original date, or one put back with Undo) if that's a sensible past time, else now
 */
function readCreatedAt(raw: unknown) {
  const now = Date.now();
  const at = (raw as { createdAt?: unknown } | null)?.createdAt;
  return typeof at === 'number' && Number.isInteger(at) && at >= EARLIEST_ITEM && at <= now
    ? at
    : now;
}

function readItem(model: Model, raw: unknown, rates: FetchedRates) {
  const item = (raw ?? {}) as Record<string, unknown>;
  if (typeof item.id !== 'string' || !CLIENT_ID.test(item.id)) throw new Refused('Invalid item');
  const name = readName(item.name);
  if (name == null) throw new Refused(`Item name must be 1-${MAX_NAME_LENGTH} characters`);

  // In another currency: converted here, whatever the app worked out for its preview
  const original = readOriginal(model, item.original);
  let converted: ModelItem['converted'] = null;
  let costCents: number;
  if (original != null) {
    const reused = reusableConversion(model, item.id, original);
    const fetched = rates.get(original.currency);
    const rate =
      reused?.rate ??
      original.manualRate ??
      fetched?.rate ??
      // Only when the batch changed the item in a way the first read didn't foresee
      null;
    if (rate == null) throw new Refused('The exchange rate changed. Try again.');
    converted = {
      currency: original.currency,
      cents: original.cents,
      rate,
      source: reused?.source ?? (original.manualRate != null ? 'manual' : fetched!.source),
      at: reused?.at ?? (original.manualRate != null ? Date.now() : fetched!.fetchedAt),
    };
    costCents = convertCents(original.cents, rate);
  } else {
    const cost = item.cost;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > MAX_COST) {
      throw new Refused('Cost must be a number of 0 or more');
    }
    costCents = toCents(cost);
  }

  const payerId = item.payerId;
  if (typeof payerId !== 'string' || !model.people.has(payerId)) {
    throw new Refused('Who paid must be someone in this split');
  }
  const raws = item.participantIds;
  if (!Array.isArray(raws) || raws.length === 0) {
    throw new Refused('Choose at least one person to split with');
  }
  if (raws.some((p) => typeof p !== 'string' || !model.people.has(p))) {
    throw new Refused('Everyone splitting an item must be someone in this split');
  }
  const participantIds = [...new Set(raws as string[])];

  const splitMode = (item.splitMode ?? 'equal') as SplitMode;
  if (!['equal', 'shares', 'exact'].includes(splitMode)) throw new Refused('Invalid split');

  const participants = participantIds.map((personId) => ({
    personId,
    shares: 1,
    exactCents: null as number | null,
    originalExactCents: null as number | null,
  }));
  if (splitMode === 'shares') {
    const shares = (item.shares ?? {}) as Record<string, unknown>;
    for (const p of participants) {
      const n = shares[p.personId];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_SHARES) {
        throw new Refused(`Shares must be whole numbers from 1 to ${MAX_SHARES}`);
      }
      p.shares = n;
    }
  }
  if (splitMode === 'exact') {
    // In another currency, amounts are typed in it and converted so they still add up
    const exact = original?.exact ?? ((item.exact ?? {}) as Record<string, unknown>);
    for (const p of participants) {
      const amount = exact[p.personId];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        throw new Refused('Exact amounts must be numbers of 0 or more');
      }
      p.exactCents = toCents(amount);
    }
    const assigned = participants.reduce((a, p) => a + (p.exactCents ?? 0), 0);
    if (assigned !== (original?.cents ?? costCents)) {
      throw new Refused('The exact amounts must add up to the cost');
    }
    if (original != null && converted != null) {
      const parts = convertParts(
        participants.map((p) => [p.personId, p.exactCents ?? 0]),
        converted.rate,
        costCents,
      );
      for (const p of participants) {
        p.originalExactCents = p.exactCents;
        p.exactCents = parts.get(p.personId) ?? 0;
      }
    }
  }

  let category: string | null = null;
  if (item.category != null && item.category !== '') {
    if (typeof item.category !== 'string' || item.category.trim().length > MAX_CATEGORY_LENGTH) {
      throw new Refused('Invalid category');
    }
    category = item.category.trim();
  }

  let notes: string | null = null;
  if (item.notes != null) {
    if (typeof item.notes !== 'string') throw new Refused('Invalid notes');
    // Kept as typed, line breaks and all; only blank space around them goes
    const trimmed = item.notes.trim();
    if (trimmed.length > MAX_NOTES_LENGTH) {
      throw new Refused(`Notes can be up to ${MAX_NOTES_LENGTH} characters`);
    }
    notes = trimmed === '' ? null : trimmed;
  }

  return {
    id: item.id,
    name,
    costCents,
    payerId,
    splitMode,
    participants,
    category,
    notes,
    converted,
  };
}

const insertParticipants = (
  db: D1Database,
  itemId: string,
  participants: {
    personId: string;
    shares: number;
    exactCents: number | null;
    originalExactCents: number | null;
  }[],
) =>
  participants.map((p) =>
    db
      .prepare(
        `INSERT INTO item_participants
           (item_id, person_id, shares, exact_cents, original_exact_cents)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(itemId, p.personId, p.shares, p.exactCents, p.originalExactCents),
  );

/** The original-currency columns for an item, in the order the queries list them */
const conversionValues = (c: ModelItem['converted']) => [
  c?.currency ?? null,
  c?.cents ?? null,
  c?.rate ?? null,
  c?.source ?? null,
  c?.at ?? null,
];

/** Checks one change against the model, updates the model, and returns its statements */
function plan(
  db: D1Database,
  splitId: string,
  model: Model,
  change: Change,
  actor: Actor,
  rates: FetchedRates,
): D1PreparedStatement[] {
  // Who's in the split is the owner's call; anyone can add and edit items
  if (PEOPLE_OPS.has(change?.op) && actor.role !== 'owner') {
    throw new Refused('Only the owner can change who is in this split');
  }
  switch (change?.op) {
    case 'addPerson': {
      if (
        typeof change.id !== 'string' ||
        !CLIENT_ID.test(change.id) ||
        model.people.has(change.id)
      ) {
        throw new Refused('Invalid person');
      }
      const name = readName(change.name);
      if (name == null) throw new Refused(`Name must be 1-${MAX_NAME_LENGTH} characters`);
      if (nameTaken(model, name)) throw new Refused(`${name} is already in this split`);
      const memberEmail = readMemberEmail(model, change.memberEmail, change.id);
      model.people.set(change.id, { name, memberEmail });
      return [
        db
          .prepare(
            'INSERT INTO people (id, split_id, name, member_email, position) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(change.id, splitId, name, memberEmail, model.nextPersonPosition++),
      ];
    }

    case 'renamePerson': {
      const person = model.people.get(change.id);
      if (person == null) throw new Refused('That person was removed by someone else');
      // Their name comes from their account; only they can change it, in Settings
      if (person.memberEmail != null) {
        throw new Refused('Their name comes from their account, so only they can change it');
      }
      const name = readName(change.name);
      if (name == null) throw new Refused(`Name must be 1-${MAX_NAME_LENGTH} characters`);
      if (nameTaken(model, name, change.id)) throw new Refused(`${name} is already in this split`);
      person.name = name;
      return [db.prepare('UPDATE people SET name = ? WHERE id = ?').bind(name, change.id)];
    }

    case 'linkPerson': {
      const person = model.people.get(change.id);
      if (person == null) throw new Refused('That person was removed by someone else');
      const memberEmail = readMemberEmail(model, change.memberEmail, change.id);
      // Others can only say which person they are, or that they aren't
      if (actor.role !== 'owner' && (memberEmail ?? person.memberEmail) !== actor.email) {
        throw new Refused('Only the owner can change who is in this split');
      }
      // Someone else's link has to be removed first, so no one takes over another person
      if (memberEmail != null && person.memberEmail != null && person.memberEmail !== memberEmail) {
        throw new Refused(`${person.name} is already linked to another account`);
      }
      person.memberEmail = memberEmail;
      return [
        db.prepare('UPDATE people SET member_email = ? WHERE id = ?').bind(memberEmail, change.id),
      ];
    }

    case 'removePerson': {
      const person = model.people.get(change.id);
      // Already removed (by someone else) is fine: the result is the same
      if (person == null) return [];
      const paid = [...model.items.values()].filter((i) => i.payerId === change.id).length;
      const shared = [...model.items].filter(
        ([, i]) => i.payerId !== change.id && i.participantIds.includes(change.id),
      );
      if (paid > 0) {
        const items = paid === 1 ? '1 item' : `${paid} items`;
        throw new Refused(`${person.name} paid for ${items}. Edit or remove those items first.`);
      }
      if (shared.length > 0 && !change.fromItems) {
        const items = shared.length === 1 ? '1 item' : `${shared.length} items`;
        throw new Refused(`${person.name} is on ${items}. Edit or remove those items first.`);
      }
      const emptied = shared.filter(([, i]) => i.participantIds.length === 1);
      if (emptied.length > 0) {
        throw new Refused(
          `${person.name} is the only person on ${emptied.length === 1 ? 'an item' : 'some items'}. Edit or remove ${emptied.length === 1 ? 'it' : 'them'} first.`,
        );
      }
      // Exact amounts would no longer add up to the cost without them
      if (shared.some(([, i]) => i.splitMode === 'exact')) {
        throw new Refused(
          `${person.name} is on an item split by exact amounts. Edit that item first.`,
        );
      }
      for (const [, i] of shared) {
        i.participantIds = i.participantIds.filter((p) => p !== change.id);
      }
      model.people.delete(change.id);
      const statements = [
        db.prepare('DELETE FROM item_participants WHERE person_id = ?').bind(change.id),
        db.prepare('DELETE FROM people WHERE id = ?').bind(change.id),
      ];
      // Taking someone with an account out of the split takes away their access too
      const email = person.memberEmail;
      if (email != null && email !== model.owner && model.members.has(email)) {
        model.members.delete(email);
        statements.push(...removeAccessStatements(db, splitId, email));
      }
      return statements;
    }

    case 'setDistributor': {
      const personId = change.personId ?? null;
      if (personId != null && !model.people.has(personId)) {
        throw new Refused('That person was removed by someone else');
      }
      // Removing the person clears this too (ON DELETE SET NULL)
      return [
        db
          .prepare('UPDATE splits SET distributor_person_id = ? WHERE id = ?')
          .bind(personId, splitId),
      ];
    }

    case 'clearPeople': {
      if (model.items.size > 0) throw new Refused('Remove the items first, then clear the people.');
      const emails = [...model.people.values()]
        .map((p) => p.memberEmail)
        .filter((e): e is string => e != null && e !== model.owner && model.members.has(e));
      model.people.clear();
      for (const email of emails) model.members.delete(email);
      return [
        db.prepare('DELETE FROM people WHERE split_id = ?').bind(splitId),
        ...emails.flatMap((email) => removeAccessStatements(db, splitId, email)),
      ];
    }

    case 'addItem': {
      const item = readItem(model, change.item, rates);
      if (model.items.has(item.id)) throw new Refused('Invalid item');
      model.items.set(item.id, {
        payerId: item.payerId,
        participantIds: item.participants.map((p) => p.personId),
        originalExact: exactOriginals(item.participants),
        splitMode: item.splitMode,
        converted: item.converted,
      });
      return [
        db
          .prepare(
            `INSERT INTO items
               (id, split_id, name, cost_cents, payer_id, position, split_mode, category, notes,
                created_at, original_currency, original_cents, rate, rate_source, rate_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            item.id,
            splitId,
            item.name,
            item.costCents,
            item.payerId,
            model.nextItemPosition++,
            item.splitMode,
            item.category,
            item.notes,
            readCreatedAt(change.item),
            ...conversionValues(item.converted),
          ),
        ...insertParticipants(db, item.id, item.participants),
      ];
    }

    case 'updateItem': {
      const item = readItem(model, change.item, rates);
      if (!model.items.has(item.id)) throw new Refused('This item was removed by someone else');
      model.items.set(item.id, {
        payerId: item.payerId,
        participantIds: item.participants.map((p) => p.personId),
        originalExact: exactOriginals(item.participants),
        splitMode: item.splitMode,
        converted: item.converted,
      });
      return [
        db
          .prepare(
            `UPDATE items SET name = ?, cost_cents = ?, payer_id = ?, split_mode = ?, category = ?,
               notes = ?, original_currency = ?, original_cents = ?, rate = ?, rate_source = ?, rate_at = ?
             WHERE id = ?`,
          )
          .bind(
            item.name,
            item.costCents,
            item.payerId,
            item.splitMode,
            item.category,
            item.notes,
            ...conversionValues(item.converted),
            item.id,
          ),
        db.prepare('DELETE FROM item_participants WHERE item_id = ?').bind(item.id),
        ...insertParticipants(db, item.id, item.participants),
      ];
    }

    case 'removeItem':
      // Already removed (by someone else) is fine: the result is the same
      if (!model.items.delete(change.id)) return [];
      return [
        db
          .prepare(
            'DELETE FROM attachment_data WHERE id IN (SELECT id FROM attachments WHERE item_id = ?)',
          )
          .bind(change.id),
        db.prepare('DELETE FROM attachments WHERE item_id = ?').bind(change.id),
        db.prepare('DELETE FROM item_participants WHERE item_id = ?').bind(change.id),
        db.prepare('DELETE FROM items WHERE id = ?').bind(change.id),
      ];

    case 'clearItems':
      model.items.clear();
      return [
        db
          .prepare(
            `DELETE FROM attachment_data WHERE id IN
               (SELECT id FROM attachments WHERE item_id IN (SELECT id FROM items WHERE split_id = ?))`,
          )
          .bind(splitId),
        db
          .prepare(
            'DELETE FROM attachments WHERE item_id IN (SELECT id FROM items WHERE split_id = ?)',
          )
          .bind(splitId),
        db
          .prepare(
            'DELETE FROM item_participants WHERE item_id IN (SELECT id FROM items WHERE split_id = ?)',
          )
          .bind(splitId),
        db.prepare('DELETE FROM items WHERE split_id = ?').bind(splitId),
      ];

    case 'refreshRates':
    case 'setRate':
      return rateStatements(db, model, change, rates);

    default:
      throw new Refused('Unknown change');
  }
}

/** Changes that convert amounts, held back while the split changes currency */
const CONVERTING_OPS = new Set<unknown>(['addItem', 'updateItem', 'refreshRates', 'setRate']);

/** Applies a batch of changes all-or-nothing. On refusal, says which change and why. */
export async function applyChanges(
  db: D1Database,
  splitId: string,
  body: Record<string, unknown>,
  actor: Actor,
  /** Fetches a rate into the split's currency; throws if none can be had */
  fetchRate: (
    from: string,
    to: string,
    /** Refreshing rates on purpose: a recent rate, not one from hours ago */
    recent: boolean,
  ) => Promise<{
    rate: number;
    source: RateSource;
    fetchedAt: number;
  }>,
) {
  const changes = body.changes;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_CHANGES) {
    return json({ error: `Send 1-${MAX_CHANGES} changes` }, 400);
  }

  const model = await loadModel(db, splitId);

  // Items can't be added or edited while they're being converted into a new currency;
  // the app keeps the change and sends it again shortly
  if (model.converting && (changes as Change[]).some((c) => CONVERTING_OPS.has(c?.op))) {
    return json({ error: 'Converting amounts to the new currency. Saving in a moment.' }, 503);
  }

  // Rates for items in other currencies, fetched before anything is checked or saved
  const rates: FetchedRates = new Map();
  const recent = (changes as Change[]).some(
    (c) => c?.op === 'refreshRates' || (c?.op === 'setRate' && c.rate == null),
  );
  try {
    await Promise.all(
      [...currenciesToFetch(model, changes as Change[])].map(async (from) => {
        rates.set(from, await fetchRate(from, model.currency, recent));
      }),
    );
  } catch (err) {
    // Not the change's fault: the app keeps it and tries again
    console.error(err);
    return json({ error: "Couldn't get an exchange rate. We'll keep trying." }, 503);
  }

  const statements: D1PreparedStatement[] = [];
  for (const [index, change] of (changes as Change[]).entries()) {
    try {
      statements.push(...plan(db, splitId, model, change, actor, rates));
    } catch (err) {
      if (err instanceof Refused) return json({ error: err.message, index }, 409);
      throw err;
    }
  }
  if (statements.length === 0) return json({ ok: true });

  try {
    await db.batch([...statements, touchSplit(db, splitId)]);
  } catch (err) {
    // Someone else's change landed between our read and write (e.g. a person we
    // referenced was just removed); the database's constraints caught it
    if (String(err).includes('CONSTRAINT')) {
      return json({ error: 'Someone else changed this split at the same time.' }, 409);
    }
    throw err;
  }
  return json({ ok: true });
}

/** Rows to delete, children first, when a whole split is deleted */
export const deleteContentStatements = (db: D1Database, splitId: string) => [
  db
    .prepare(
      'DELETE FROM item_participants WHERE item_id IN (SELECT id FROM items WHERE split_id = ?)',
    )
    .bind(splitId),
  db.prepare('DELETE FROM items WHERE split_id = ?').bind(splitId),
  db.prepare('DELETE FROM people WHERE split_id = ?').bind(splitId),
];
