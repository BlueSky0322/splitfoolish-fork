// A split's bill: its people and items. Clients send batches of small changes
// (add this person, remove that item); each batch is checked against the split's
// current contents and applied all-or-nothing, touching only the rows involved, so
// people editing the same split don't overwrite each other.

import { SplitMode } from '../shared/settle';
import type { Change, Item, Person } from '../shared/types';

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
         category, created_at AS createdAt
       FROM items WHERE split_id = ? ORDER BY position, rowid`,
    )
    .bind(splitId),
  db
    .prepare(
      `SELECT ip.item_id AS itemId, ip.person_id AS personId, ip.shares,
         ip.exact_cents AS exactCents
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
  createdAt: number;
}

interface ParticipantRow {
  itemId: string;
  personId: string;
  shares: number;
  exactCents: number | null;
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
        createdAt: i.createdAt,
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

/** The split's people and items as they will be after each change, for checking the next one */
interface Model {
  people: Map<string, { name: string; memberEmail: string | null }>;
  items: Map<string, { payerId: string; participantIds: string[]; splitMode: SplitMode }>;
  members: Set<string>;
  owner: string | null;
  nextPersonPosition: number;
  nextItemPosition: number;
}

async function loadModel(db: D1Database, splitId: string): Promise<Model> {
  const [people, items, participants, positions, members] = await db.batch<Record<string, unknown>>(
    [
      db
        .prepare('SELECT id, name, member_email AS memberEmail FROM people WHERE split_id = ?')
        .bind(splitId),
      db
        .prepare(
          'SELECT id, payer_id AS payerId, split_mode AS splitMode FROM items WHERE split_id = ?',
        )
        .bind(splitId),
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
      db.prepare('SELECT email, role FROM split_members WHERE split_id = ?').bind(splitId),
    ],
  );
  const memberRows = members.results as { email: string; role: string }[];

  const model: Model = {
    people: new Map(
      (people.results as { id: string; name: string; memberEmail: string | null }[]).map((p) => [
        p.id,
        { name: p.name, memberEmail: p.memberEmail },
      ]),
    ),
    items: new Map(
      (items.results as { id: string; payerId: string; splitMode: SplitMode }[]).map((i) => [
        i.id,
        { payerId: i.payerId, participantIds: [] as string[], splitMode: i.splitMode },
      ]),
    ),
    members: new Set(memberRows.map((m) => m.email)),
    owner: memberRows.find((m) => m.role === 'owner')?.email ?? null,
    nextPersonPosition: (positions.results[0] as { person: number }).person,
    nextItemPosition: (positions.results[0] as { item: number }).item,
  };
  for (const row of participants.results as { itemId: string; personId: string }[]) {
    model.items.get(row.itemId)?.participantIds.push(row.personId);
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

function readItem(model: Model, raw: unknown) {
  const item = (raw ?? {}) as Record<string, unknown>;
  if (typeof item.id !== 'string' || !CLIENT_ID.test(item.id)) throw new Refused('Invalid item');
  const name = readName(item.name);
  if (name == null) throw new Refused(`Item name must be 1-${MAX_NAME_LENGTH} characters`);

  const cost = item.cost;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > MAX_COST) {
    throw new Refused('Cost must be a number of 0 or more');
  }
  const costCents = toCents(cost);

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
    const exact = (item.exact ?? {}) as Record<string, unknown>;
    for (const p of participants) {
      const amount = exact[p.personId];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        throw new Refused('Exact amounts must be numbers of 0 or more');
      }
      p.exactCents = toCents(amount);
    }
    const assigned = participants.reduce((a, p) => a + (p.exactCents ?? 0), 0);
    if (assigned !== costCents) {
      throw new Refused('The exact amounts must add up to the cost');
    }
  }

  let category: string | null = null;
  if (item.category != null && item.category !== '') {
    if (typeof item.category !== 'string' || item.category.trim().length > MAX_CATEGORY_LENGTH) {
      throw new Refused('Invalid category');
    }
    category = item.category.trim();
  }

  return { id: item.id, name, costCents, payerId, splitMode, participants, category };
}

const insertParticipants = (
  db: D1Database,
  itemId: string,
  participants: { personId: string; shares: number; exactCents: number | null }[],
) =>
  participants.map((p) =>
    db
      .prepare(
        'INSERT INTO item_participants (item_id, person_id, shares, exact_cents) VALUES (?, ?, ?, ?)',
      )
      .bind(itemId, p.personId, p.shares, p.exactCents),
  );

/** Checks one change against the model, updates the model, and returns its statements */
function plan(
  db: D1Database,
  splitId: string,
  model: Model,
  change: Change,
  actor: Actor,
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
      const item = readItem(model, change.item);
      if (model.items.has(item.id)) throw new Refused('Invalid item');
      model.items.set(item.id, {
        payerId: item.payerId,
        participantIds: item.participants.map((p) => p.personId),
        splitMode: item.splitMode,
      });
      return [
        db
          .prepare(
            `INSERT INTO items
               (id, split_id, name, cost_cents, payer_id, position, split_mode, category, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            Date.now(),
          ),
        ...insertParticipants(db, item.id, item.participants),
      ];
    }

    case 'updateItem': {
      const item = readItem(model, change.item);
      if (!model.items.has(item.id)) throw new Refused('This item was removed by someone else');
      model.items.set(item.id, {
        payerId: item.payerId,
        participantIds: item.participants.map((p) => p.personId),
        splitMode: item.splitMode,
      });
      return [
        db
          .prepare(
            `UPDATE items SET name = ?, cost_cents = ?, payer_id = ?, split_mode = ?, category = ?
             WHERE id = ?`,
          )
          .bind(item.name, item.costCents, item.payerId, item.splitMode, item.category, item.id),
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

    default:
      throw new Refused('Unknown change');
  }
}

/** Applies a batch of changes all-or-nothing. On refusal, says which change and why. */
export async function applyChanges(
  db: D1Database,
  splitId: string,
  body: Record<string, unknown>,
  actor: Actor,
) {
  const changes = body.changes;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_CHANGES) {
    return json({ error: `Send 1-${MAX_CHANGES} changes` }, 400);
  }

  const model = await loadModel(db, splitId);
  const statements: D1PreparedStatement[] = [];
  for (const [index, change] of (changes as Change[]).entries()) {
    try {
      statements.push(...plan(db, splitId, model, change, actor));
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
