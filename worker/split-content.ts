// A split's bill: its people and items. Every change is its own request that touches
// only the rows involved, so people editing the same split don't overwrite each other.

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

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

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

async function findPerson(db: D1Database, splitId: string, personId: string) {
  return db
    .prepare('SELECT id, name FROM people WHERE id = ? AND split_id = ?')
    .bind(personId, splitId)
    .first<{ id: string; name: string }>();
}

async function nameTaken(db: D1Database, splitId: string, name: string, exceptId?: string) {
  const row = await db
    .prepare('SELECT id FROM people WHERE split_id = ? AND name = ? AND id != ?')
    .bind(splitId, name, exceptId ?? '')
    .first();
  return row != null;
}

/** Checks an item body against the split's people. Returns the values or an error response. */
async function readItem(db: D1Database, splitId: string, body: Record<string, unknown>) {
  const name = readName(body.name);
  if (name == null)
    return json({ error: `Item name must be 1-${MAX_NAME_LENGTH} characters` }, 400);

  const cost = body.cost;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > MAX_COST) {
    return json({ error: 'Cost must be a number of 0 or more' }, 400);
  }

  const payerId = body.payerId;
  const participantIds = body.participantIds;
  if (typeof payerId !== 'string') return json({ error: 'Choose who paid' }, 400);
  if (
    !Array.isArray(participantIds) ||
    participantIds.length === 0 ||
    participantIds.some((p) => typeof p !== 'string')
  ) {
    return json({ error: 'Choose at least one person to split with' }, 400);
  }

  const wanted = [...new Set([payerId, ...(participantIds as string[])])];
  const { results } = await db
    .prepare(
      `SELECT id FROM people WHERE split_id = ? AND id IN (${wanted.map(() => '?').join(',')})`,
    )
    .bind(splitId, ...wanted)
    .all<{ id: string }>();
  if (results.length !== wanted.length) {
    return json({ error: 'Payer and participants must be people in this split' }, 400);
  }

  return {
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

export async function addPerson(db: D1Database, splitId: string, body: Record<string, unknown>) {
  const name = readName(body.name);
  if (name == null) return json({ error: `Name must be 1-${MAX_NAME_LENGTH} characters` }, 400);
  if (await nameTaken(db, splitId, name)) {
    return json({ error: `${name} is already in this split` }, 409);
  }

  const memberEmail =
    typeof body.memberEmail === 'string' && body.memberEmail !== ''
      ? body.memberEmail.toLowerCase()
      : null;
  const person: Person = { id: newId(), name, memberEmail };
  await db.batch([
    db
      .prepare(
        `INSERT INTO people (id, split_id, name, member_email, position)
         VALUES (?1, ?2, ?3, ?4,
           (SELECT coalesce(max(position), -1) + 1 FROM people WHERE split_id = ?2))`,
      )
      .bind(person.id, splitId, name, memberEmail),
    touchSplit(db, splitId),
  ]);
  return json(person, 201);
}

export async function removePerson(db: D1Database, splitId: string, personId: string) {
  const person = await findPerson(db, splitId, personId);
  if (person == null) return json({ error: 'Not found' }, 404);

  const used = await db
    .prepare(
      `SELECT count(*) AS n FROM items
       WHERE split_id = ?1 AND (payer_id = ?2
         OR id IN (SELECT item_id FROM item_participants WHERE person_id = ?2))`,
    )
    .bind(splitId, personId)
    .first<{ n: number }>();
  if (used != null && used.n > 0) {
    const items = used.n === 1 ? '1 item' : `${used.n} items`;
    return json({ error: `${person.name} is on ${items}. Edit or remove those items first.` }, 409);
  }

  await db.batch([
    db.prepare('DELETE FROM people WHERE id = ?').bind(personId),
    touchSplit(db, splitId),
  ]);
  return json({ ok: true });
}

export async function clearPeople(db: D1Database, splitId: string) {
  const items = await db
    .prepare('SELECT count(*) AS n FROM items WHERE split_id = ?')
    .bind(splitId)
    .first<{ n: number }>();
  if (items != null && items.n > 0) {
    return json({ error: 'Remove the items first, then clear the people.' }, 409);
  }

  await db.batch([
    db.prepare('DELETE FROM people WHERE split_id = ?').bind(splitId),
    touchSplit(db, splitId),
  ]);
  return json({ ok: true });
}

export async function addItem(db: D1Database, splitId: string, body: Record<string, unknown>) {
  const item = await readItem(db, splitId, body);
  if (item instanceof Response) return item;

  const id = newId();
  await db.batch([
    db
      .prepare(
        `INSERT INTO items (id, split_id, name, cost_cents, payer_id, position)
         VALUES (?1, ?2, ?3, ?4, ?5,
           (SELECT coalesce(max(position), -1) + 1 FROM items WHERE split_id = ?2))`,
      )
      .bind(id, splitId, item.name, item.costCents, item.payerId),
    ...insertParticipants(db, id, item.participantIds),
    touchSplit(db, splitId),
  ]);
  return json(
    {
      id,
      name: item.name,
      cost: item.costCents / 100,
      payerId: item.payerId,
      participantIds: item.participantIds,
    } satisfies Item,
    201,
  );
}

export async function updateItem(
  db: D1Database,
  splitId: string,
  itemId: string,
  body: Record<string, unknown>,
) {
  const exists = await db
    .prepare('SELECT id FROM items WHERE id = ? AND split_id = ?')
    .bind(itemId, splitId)
    .first();
  if (exists == null) return json({ error: 'This item was removed by someone else' }, 404);
  const item = await readItem(db, splitId, body);
  if (item instanceof Response) return item;

  await db.batch([
    db
      .prepare('UPDATE items SET name = ?, cost_cents = ?, payer_id = ? WHERE id = ?')
      .bind(item.name, item.costCents, item.payerId, itemId),
    db.prepare('DELETE FROM item_participants WHERE item_id = ?').bind(itemId),
    ...insertParticipants(db, itemId, item.participantIds),
    touchSplit(db, splitId),
  ]);
  return json({
    id: itemId,
    name: item.name,
    cost: item.costCents / 100,
    payerId: item.payerId,
    participantIds: item.participantIds,
  } satisfies Item);
}

export async function removeItem(db: D1Database, splitId: string, itemId: string) {
  const [, removed] = await db.batch([
    db
      .prepare(
        `DELETE FROM item_participants
         WHERE item_id = (SELECT id FROM items WHERE id = ? AND split_id = ?)`,
      )
      .bind(itemId, splitId),
    db.prepare('DELETE FROM items WHERE id = ? AND split_id = ?').bind(itemId, splitId),
  ]);
  // Already gone (someone else removed it) is fine: the result is the same
  if (removed.meta.changes > 0) await touchSplit(db, splitId).run();
  return json({ ok: true });
}

export async function clearItems(db: D1Database, splitId: string) {
  await db.batch([
    db
      .prepare(
        'DELETE FROM item_participants WHERE item_id IN (SELECT id FROM items WHERE split_id = ?)',
      )
      .bind(splitId),
    db.prepare('DELETE FROM items WHERE split_id = ?').bind(splitId),
    touchSplit(db, splitId),
  ]);
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
