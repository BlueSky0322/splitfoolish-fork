// A split's bill: its people and items. Clients send batches of small changes
// (add this person, remove that item); each batch is checked against the split's
// current contents and applied all-or-nothing, touching only the rows involved, so
// people editing the same split don't overwrite each other.

export interface Person {
  id: string;
  name: string;
  memberEmail: string | null;
}

export interface Item {
  id: string;
  name: string;
  /** In currency units; stored as integer cents */
  cost: number;
  payerId: string;
  participantIds: string[];
}

const MAX_NAME_LENGTH = 80;
const MAX_COST = 1_000_000_000;

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

/** Reads a split's people and items; run as part of a larger batch, then pass to assembleContent */
export const contentStatements = (db: D1Database, splitId: string) => [
  db
    .prepare(
      `SELECT id, name, member_email AS memberEmail FROM people
       WHERE split_id = ? ORDER BY position, rowid`,
    )
    .bind(splitId),
  db
    .prepare(
      `SELECT id, name, cost_cents AS costCents, payer_id AS payerId FROM items
       WHERE split_id = ? ORDER BY position, rowid`,
    )
    .bind(splitId),
  db
    .prepare(
      `SELECT ip.item_id AS itemId, ip.person_id AS personId
       FROM item_participants ip
       JOIN items i ON i.id = ip.item_id
       JOIN people p ON p.id = ip.person_id
       WHERE i.split_id = ? ORDER BY p.position, p.rowid`,
    )
    .bind(splitId),
];

export function assembleContent([people, items, participants]: D1Result<
  Record<string, unknown>
>[]) {
  const participantIds = new Map<string, string[]>();
  for (const row of participants.results as { itemId: string; personId: string }[]) {
    participantIds.set(row.itemId, [...(participantIds.get(row.itemId) ?? []), row.personId]);
  }

  return {
    people: people.results as unknown as Person[],
    items: (
      items.results as { id: string; name: string; costCents: number; payerId: string }[]
    ).map(
      (i): Item => ({
        id: i.id,
        name: i.name,
        cost: i.costCents / 100,
        payerId: i.payerId,
        participantIds: participantIds.get(i.id) ?? [],
      }),
    ),
  };
}

export type Change =
  | { op: 'addPerson'; id: string; name: string; memberEmail?: string | null }
  | { op: 'removePerson'; id: string }
  | { op: 'clearPeople' }
  | { op: 'addItem'; item: Item }
  | { op: 'updateItem'; item: Item }
  | { op: 'removeItem'; id: string }
  | { op: 'clearItems' };

const MAX_CHANGES = 200;
// Ids are made by the client so its changes can refer to people and items it just added
const CLIENT_ID = /^[0-9a-f]{16}$/;

class Refused extends Error {}

/** The split's people and items as they will be after each change, for checking the next one */
interface Model {
  people: Map<string, { name: string }>;
  items: Map<string, { payerId: string; participantIds: string[] }>;
  nextPersonPosition: number;
  nextItemPosition: number;
}

async function loadModel(db: D1Database, splitId: string): Promise<Model> {
  const [people, items, participants, positions] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id, name FROM people WHERE split_id = ?').bind(splitId),
    db.prepare('SELECT id, payer_id AS payerId FROM items WHERE split_id = ?').bind(splitId),
    db
      .prepare(
        `SELECT ip.item_id AS itemId, ip.person_id AS personId FROM item_participants ip
         JOIN items i ON i.id = ip.item_id WHERE i.split_id = ?`,
      )
      .bind(splitId),
    db
      .prepare(
        `SELECT (SELECT coalesce(max(position), -1) + 1 FROM people WHERE split_id = ?1) AS person,
                (SELECT coalesce(max(position), -1) + 1 FROM items WHERE split_id = ?1) AS item`,
      )
      .bind(splitId),
  ]);

  const model: Model = {
    people: new Map(
      (people.results as { id: string; name: string }[]).map((p) => [p.id, { name: p.name }]),
    ),
    items: new Map(
      (items.results as { id: string; payerId: string }[]).map((i) => [
        i.id,
        { payerId: i.payerId, participantIds: [] as string[] },
      ]),
    ),
    nextPersonPosition: (positions.results[0] as { person: number }).person,
    nextItemPosition: (positions.results[0] as { item: number }).item,
  };
  for (const row of participants.results as { itemId: string; personId: string }[]) {
    model.items.get(row.itemId)?.participantIds.push(row.personId);
  }
  return model;
}

const nameTaken = (model: Model, name: string) =>
  [...model.people.values()].some((p) => p.name === name);

function readItem(model: Model, raw: unknown) {
  const item = (raw ?? {}) as Record<string, unknown>;
  if (typeof item.id !== 'string' || !CLIENT_ID.test(item.id)) throw new Refused('Invalid item');
  const name = readName(item.name);
  if (name == null) throw new Refused(`Item name must be 1-${MAX_NAME_LENGTH} characters`);

  const cost = item.cost;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > MAX_COST) {
    throw new Refused('Cost must be a number of 0 or more');
  }

  const payerId = item.payerId;
  const participantIds = item.participantIds;
  if (typeof payerId !== 'string' || !model.people.has(payerId)) {
    throw new Refused('Who paid must be someone in this split');
  }
  if (!Array.isArray(participantIds) || participantIds.length === 0) {
    throw new Refused('Choose at least one person to split with');
  }
  if (participantIds.some((p) => typeof p !== 'string' || !model.people.has(p))) {
    throw new Refused('Everyone splitting an item must be someone in this split');
  }

  return {
    id: item.id,
    name,
    costCents: Math.round(cost * 100),
    payerId,
    participantIds: [...new Set(participantIds as string[])],
  };
}

const insertParticipants = (db: D1Database, itemId: string, personIds: string[]) =>
  personIds.map((personId) =>
    db
      .prepare('INSERT INTO item_participants (item_id, person_id) VALUES (?, ?)')
      .bind(itemId, personId),
  );

/** Checks one change against the model, updates the model, and returns its statements */
function plan(
  db: D1Database,
  splitId: string,
  model: Model,
  change: Change,
): D1PreparedStatement[] {
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
      const memberEmail =
        typeof change.memberEmail === 'string' && change.memberEmail !== ''
          ? change.memberEmail.toLowerCase()
          : null;
      model.people.set(change.id, { name });
      return [
        db
          .prepare(
            'INSERT INTO people (id, split_id, name, member_email, position) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(change.id, splitId, name, memberEmail, model.nextPersonPosition++),
      ];
    }

    case 'removePerson': {
      const person = model.people.get(change.id);
      // Already removed (by someone else) is fine: the result is the same
      if (person == null) return [];
      const uses = [...model.items.values()].filter(
        (i) => i.payerId === change.id || i.participantIds.includes(change.id),
      ).length;
      if (uses > 0) {
        const items = uses === 1 ? '1 item' : `${uses} items`;
        throw new Refused(`${person.name} is on ${items}. Edit or remove those items first.`);
      }
      model.people.delete(change.id);
      return [db.prepare('DELETE FROM people WHERE id = ?').bind(change.id)];
    }

    case 'clearPeople':
      if (model.items.size > 0) throw new Refused('Remove the items first, then clear the people.');
      model.people.clear();
      return [db.prepare('DELETE FROM people WHERE split_id = ?').bind(splitId)];

    case 'addItem': {
      const item = readItem(model, change.item);
      if (model.items.has(item.id)) throw new Refused('Invalid item');
      model.items.set(item.id, { payerId: item.payerId, participantIds: item.participantIds });
      return [
        db
          .prepare(
            `INSERT INTO items (id, split_id, name, cost_cents, payer_id, position)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            item.id,
            splitId,
            item.name,
            item.costCents,
            item.payerId,
            model.nextItemPosition++,
          ),
        ...insertParticipants(db, item.id, item.participantIds),
      ];
    }

    case 'updateItem': {
      const item = readItem(model, change.item);
      if (!model.items.has(item.id)) throw new Refused('This item was removed by someone else');
      model.items.set(item.id, { payerId: item.payerId, participantIds: item.participantIds });
      return [
        db
          .prepare('UPDATE items SET name = ?, cost_cents = ?, payer_id = ? WHERE id = ?')
          .bind(item.name, item.costCents, item.payerId, item.id),
        db.prepare('DELETE FROM item_participants WHERE item_id = ?').bind(item.id),
        ...insertParticipants(db, item.id, item.participantIds),
      ];
    }

    case 'removeItem':
      // Already removed (by someone else) is fine: the result is the same
      if (!model.items.delete(change.id)) return [];
      return [
        db.prepare('DELETE FROM item_participants WHERE item_id = ?').bind(change.id),
        db.prepare('DELETE FROM items WHERE id = ?').bind(change.id),
      ];

    case 'clearItems':
      model.items.clear();
      return [
        db
          .prepare(
            'DELETE FROM item_participants WHERE item_id IN (SELECT id FROM items WHERE split_id = ?)',
          )
          .bind(splitId),
        db.prepare('DELETE FROM items WHERE split_id = ?').bind(splitId),
      ];

    default:
      throw new Refused('Unknown change');
  }
}

/** Applies a batch of changes all-or-nothing. On refusal, says which change and why. */
export async function applyChanges(db: D1Database, splitId: string, body: Record<string, unknown>) {
  const changes = body.changes;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_CHANGES) {
    return json({ error: `Send 1-${MAX_CHANGES} changes` }, 400);
  }

  const model = await loadModel(db, splitId);
  const statements: D1PreparedStatement[] = [];
  for (const [index, change] of (changes as Change[]).entries()) {
    try {
      statements.push(...plan(db, splitId, model, change));
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
