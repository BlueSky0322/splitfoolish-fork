// A split's bill: its people and items. Clients send batches of small changes
// (add this person, remove that item); each batch is checked against the split's
// current contents and applied all-or-nothing, touching only the rows involved, so
// people editing the same split don't overwrite each other.

import { type ChangesBody, MAX_CHANGES, isRowId } from '../../shared/api';
import { convertCents, convertParts } from '../../shared/rates';
import type { Actor } from '../../shared/rules';
import { canChangePeople, canLinkPerson, removalBlocker } from '../../shared/rules';
import type { Change } from '../../shared/types';
import { MAX_NAME_LENGTH } from '../../shared/types';
import { touchSplitStatement } from '../app';
import { type Rate, RatesUnavailable } from '../currency/exchange-rates';
import { type Unchecked, fail, ok, readName, isConstraintError } from '../http';
import { revokeMemberStatements } from '../splits/sharing';
import type { FetchedRates, Participant } from './input';
import {
  chooseRate,
  isItemDate,
  nameTaken,
  paidAt,
  rateKey,
  ratesToFetch,
  readId,
  readItem,
  readMemberEmail,
  readRateChange,
  toModelItem,
} from './input';
import type { Batch, Model, ModelItem, UncheckedChange } from './model';
import { Forbidden, Refused, loadModel } from './model';

const OWNER_ONLY_PEOPLE = 'Only the owner can change who is in this split';

const PEOPLE_OPS = new Set<Change['op']>([
  'addPerson',
  'renamePerson',
  'removePerson',
  'clearPeople',
]);

/** Converts an item paid in another currency again, at a new rate */
function convertAgainStatements(
  db: D1Database,
  id: string,
  item: ModelItem,
  rate: ReturnType<typeof chooseRate>,
): D1PreparedStatement[] {
  const c = item.converted!;
  const next = { ...c, ...rate };
  item.converted = next;
  const costCents = convertCents(c.cents, next.rate);
  const statements = [
    db
      .prepare(
        'UPDATE items SET cost_cents = ?, rate = ?, rate_source = ?, rate_at = ? WHERE id = ?',
      )
      .bind(costCents, next.rate, next.source, next.at, id),
  ];
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
  return statements;
}

/**
 * Every item paid in a currency at a typed rate, or with none, back at the rate on the
 * day each was paid
 */
function rateStatements(
  db: D1Database,
  model: Model,
  change: Extract<UncheckedChange, { op: 'setRate' }>,
  rates: FetchedRates,
): D1PreparedStatement[] {
  const { currency, manualRate } = readRateChange(model, change);
  return [...model.items].flatMap(([id, item]) =>
    item.converted?.currency === currency
      ? convertAgainStatements(
          db,
          id,
          item,
          chooseRate(manualRate, rates.get(rateKey(currency, item.createdAt))),
        )
      : [],
  );
}

const insertParticipantsStatements = (
  db: D1Database,
  itemId: string,
  participants: Participant[],
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

/**
 * Deletes the items `where` picks, and what hangs off them, children first: their
 * photos' bytes, the photos, who's on them, then the items
 */
const deleteItemsStatements = (db: D1Database, where: 'id = ?' | 'split_id = ?', value: string) => {
  const items = `SELECT id FROM items WHERE ${where}`;
  return [
    db
      .prepare(
        `DELETE FROM attachment_data WHERE id IN
           (SELECT id FROM attachments WHERE item_id IN (${items}))`,
      )
      .bind(value),
    db.prepare(`DELETE FROM attachments WHERE item_id IN (${items})`).bind(value),
    db.prepare(`DELETE FROM item_participants WHERE item_id IN (${items})`).bind(value),
    db.prepare(`DELETE FROM items WHERE ${where}`).bind(value),
  ];
};

/** The original-currency columns for an item, in the order the queries list them */
const conversionValues = (c: ModelItem['converted']) => [
  c?.currency ?? null,
  c?.cents ?? null,
  c?.rate ?? null,
  c?.source ?? null,
  c?.at ?? null,
];

/**
 * Takes a person out of the bill, and with fromItems off the items they share, if the
 * rules in shared/rules.ts allow it. Someone with an account loses their access too.
 */
function removePersonStatements(
  db: D1Database,
  splitId: string,
  model: Model,
  id: string,
  fromItems: boolean,
): D1PreparedStatement[] {
  const person = model.people.get(id);
  // Already removed (by someone else) is fine: the result is the same
  if (person == null) return [];
  const blocker = removalBlocker({ id, name: person.name }, [...model.items.values()], fromItems);
  if (blocker != null) {
    throw new Refused(
      blocker.onItems ? `${blocker.message} Edit or remove those items first.` : blocker.message,
    );
  }
  for (const item of model.items.values()) {
    item.participantIds = item.participantIds.filter((p) => p !== id);
  }
  model.people.delete(id);
  const statements = [
    db.prepare('DELETE FROM item_participants WHERE person_id = ?').bind(id),
    db.prepare('DELETE FROM people WHERE id = ?').bind(id),
  ];
  // Taking someone with an account out of the split takes away their access too
  const email = person.memberEmail;
  if (email != null && email !== model.owner && model.members.has(email)) {
    model.members.delete(email);
    statements.push(...revokeMemberStatements(db, splitId, email));
  }
  return statements;
}

/** Checks one change against the model, updates the model, and returns its statements */
function changeStatements(
  db: D1Database,
  splitId: string,
  model: Model,
  change: UncheckedChange | null,
  actor: Actor,
  rates: FetchedRates,
): D1PreparedStatement[] {
  // Who's in the split is the owner's call; anyone can add and edit items
  if (change != null && PEOPLE_OPS.has(change.op) && !canChangePeople(actor.role)) {
    throw new Forbidden(OWNER_ONLY_PEOPLE);
  }
  switch (change?.op) {
    case 'addPerson': {
      if (!isRowId(change.id) || model.people.has(change.id)) {
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
      const id = readId(change.id);
      const person = model.people.get(id);
      if (person == null) throw new Refused('That person was removed by someone else');
      // Their name comes from their account; only they can change it, in Settings
      if (person.memberEmail != null) {
        throw new Refused('Their name comes from their account, so only they can change it');
      }
      const name = readName(change.name);
      if (name == null) throw new Refused(`Name must be 1-${MAX_NAME_LENGTH} characters`);
      if (nameTaken(model, name, id)) throw new Refused(`${name} is already in this split`);
      person.name = name;
      return [db.prepare('UPDATE people SET name = ? WHERE id = ?').bind(name, id)];
    }

    case 'linkPerson': {
      const id = readId(change.id);
      const person = model.people.get(id);
      if (person == null) throw new Refused('That person was removed by someone else');
      const memberEmail = readMemberEmail(model, change.memberEmail, id);
      // Others can only say which person they are, or that they aren't
      if (!canLinkPerson(memberEmail ?? person.memberEmail, actor)) {
        throw new Forbidden(OWNER_ONLY_PEOPLE);
      }
      // Someone else's link has to be removed first, so no one takes over another person
      if (memberEmail != null && person.memberEmail != null && person.memberEmail !== memberEmail) {
        throw new Refused(`${person.name} is already linked to another account`);
      }
      person.memberEmail = memberEmail;
      return [db.prepare('UPDATE people SET member_email = ? WHERE id = ?').bind(memberEmail, id)];
    }

    case 'removePerson':
      return removePersonStatements(db, splitId, model, readId(change.id), !!change.fromItems);

    case 'setDistributor': {
      const personId = change.personId == null ? null : readId(change.personId);
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
        ...emails.flatMap((email) => revokeMemberStatements(db, splitId, email)),
      ];
    }

    case 'addItem': {
      const createdAt = paidAt(model, 'addItem', change.item);
      const item = readItem(model, change.item, rates, createdAt);
      if (model.items.has(item.id)) throw new Refused('Invalid item');
      model.items.set(item.id, toModelItem(item, createdAt));
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
            createdAt,
            ...conversionValues(item.converted),
          ),
        ...insertParticipantsStatements(db, item.id, item.participants),
      ];
    }

    case 'updateItem': {
      const createdAt = paidAt(model, 'updateItem', change.item);
      const item = readItem(model, change.item, rates, createdAt);
      if (!model.items.has(item.id)) throw new Refused('This item was removed by someone else');
      model.items.set(item.id, toModelItem(item, createdAt));
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
        ...insertParticipantsStatements(db, item.id, item.participants),
      ];
    }

    case 'removeItem': {
      const id = readId(change.id);
      // Already removed (by someone else) is fine: the result is the same
      if (!model.items.delete(id)) return [];
      return deleteItemsStatements(db, 'id = ?', id);
    }

    case 'setItemDate': {
      const id = readId(change.id);
      const item = model.items.get(id);
      // Already removed (by someone else): nothing to move
      if (item == null) return [];
      const at = change.createdAt;
      if (!isItemDate(at)) throw new Refused('Pick a date that has already come');
      item.createdAt = at;
      const moved = [db.prepare('UPDATE items SET created_at = ? WHERE id = ?').bind(at, id)];
      // Paid in another currency on a fetched rate: now at the new day's
      const c = item.converted;
      if (c == null || c.source === 'manual') return moved;
      return [
        ...moved,
        ...convertAgainStatements(
          db,
          id,
          item,
          chooseRate(null, rates.get(rateKey(c.currency, at))),
        ),
      ];
    }

    case 'clearItems':
      model.items.clear();
      return deleteItemsStatements(db, 'split_id = ?', splitId);

    case 'refreshRates':
      // Sent by older versions of the app, perhaps from a device's outbox. Items keep the
      // rate of the day they were paid now, so there's nothing to refresh.
      return [];

    case 'setRate':
      return rateStatements(db, model, change, rates);

    default:
      throw new Refused('Unknown change');
  }
}

/** Changes that convert amounts, held back while the split changes currency */
const CONVERTING_OPS = new Set<Change['op']>(['addItem', 'updateItem', 'setItemDate', 'setRate']);

interface ApplyOptions {
  /**
   * Fetches the rate into the split's currency for an item paid at `at` (getRateOn);
   * throws RatesUnavailable if none can be had
   */
  fetchRate: (from: string, to: string, at: number) => Promise<Rate>;
  /** Called once saved with the accounts the changes took out of the split */
  onAccessRemoved?: (emails: string[]) => void;
}

/**
 * What saving a batch came to: saved, with the accounts it took out of the split; or
 * refused, with the status and reason the API answers with. `constraint` marks a write
 * the database refused, which a caller saving something alongside may need to look into.
 */
export type SaveResult =
  | { saved: true; accessRemoved: string[] }
  | { saved: false; status: 400 | 403 | 409 | 503; error: string; constraint?: true };

const refused = (status: 400 | 403 | 409 | 503, error: string) => ({
  saved: false as const,
  status,
  error,
});

/**
 * Checks a batch of changes against the split as it is now and saves it all-or-nothing.
 * `alongside` is written in the same transaction, so it is saved exactly when the
 * changes are (the MCP tools keep their retry receipts this way).
 */
export async function saveChanges(
  db: D1Database,
  splitId: string,
  actor: Actor,
  changes: unknown,
  fetchRate: ApplyOptions['fetchRate'],
  alongside: D1PreparedStatement[] = [],
): Promise<SaveResult> {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_CHANGES) {
    return refused(400, `Send 1-${MAX_CHANGES} changes`);
  }

  const model = await loadModel(db, splitId);
  const membersBefore = new Set(model.members);

  // Items can't be added or edited while they're being converted into a new currency;
  // the app keeps the change and sends it again shortly
  const batch = changes as Batch;
  if (model.converting && batch.some((c) => c != null && CONVERTING_OPS.has(c.op))) {
    return refused(503, 'Converting amounts to the new currency. Saving in a moment.');
  }

  // Rates for items in other currencies, fetched before anything is checked or saved
  const rates: FetchedRates = new Map();
  try {
    await Promise.all(
      [...ratesToFetch(model, batch)].map(async ([key, { currency, at }]) => {
        rates.set(key, await fetchRate(currency, model.currency, at));
      }),
    );
  } catch (err) {
    // Not the change's fault: the app keeps it and tries again
    if (err instanceof RatesUnavailable) {
      return refused(503, "Couldn't get an exchange rate. We'll keep trying.");
    }
    throw err;
  }

  const statements: D1PreparedStatement[] = [];
  for (const change of batch) {
    try {
      statements.push(...changeStatements(db, splitId, model, change, actor, rates));
    } catch (err) {
      if (err instanceof Refused) return refused(err instanceof Forbidden ? 403 : 409, err.message);
      throw err;
    }
  }
  if (statements.length === 0 && alongside.length === 0) {
    return { saved: true, accessRemoved: [] };
  }

  try {
    await db.batch([...statements, ...alongside, touchSplitStatement(db, splitId)]);
  } catch (err) {
    // Someone else's change landed between our read and write (e.g. a person we
    // referenced was just removed); the database's constraints caught it
    if (isConstraintError(err)) {
      return {
        ...refused(409, 'Someone else changed this split at the same time.'),
        constraint: true,
      };
    }
    throw err;
  }
  return {
    saved: true,
    accessRemoved: [...membersBefore].filter((email) => !model.members.has(email)),
  };
}

/** Applies a batch of changes all-or-nothing, answering as the API does. On refusal, says why. */
export async function applyChanges(
  db: D1Database,
  splitId: string,
  actor: Actor,
  body: Unchecked<ChangesBody>,
  { fetchRate, onAccessRemoved }: ApplyOptions,
) {
  const result = await saveChanges(db, splitId, actor, body.changes, fetchRate);
  if (!result.saved) return fail(result.error, result.status);
  onAccessRemoved?.(result.accessRemoved);
  return ok();
}

/** Rows to delete, children first, when a whole split is deleted: its photos and bill */
export const deleteContentStatements = (db: D1Database, splitId: string) => [
  ...deleteItemsStatements(db, 'split_id = ?', splitId),
  // Photos of the whole split, on no item
  db
    .prepare(
      'DELETE FROM attachment_data WHERE id IN (SELECT id FROM attachments WHERE split_id = ?)',
    )
    .bind(splitId),
  db.prepare('DELETE FROM attachments WHERE split_id = ?').bind(splitId),
  db.prepare('DELETE FROM people WHERE split_id = ?').bind(splitId),
];
