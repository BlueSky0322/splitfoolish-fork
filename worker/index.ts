import { AuthEnv, getUserEmail } from './auth';
import {
  addItem,
  addPerson,
  clearItems,
  clearPeople,
  deleteContentStatements,
  assembleContent,
  contentStatements,
  removeItem,
  removePerson,
  updateItem,
} from './split-content';

interface Env extends AuthEnv {
  DB: D1Database;
  ASSETS: Fetcher;
}

type Role = 'owner' | 'editor';

const ID = '([A-Za-z0-9_-]{8,64})';
const SPLITS_PATH = /^\/api\/splits$/;
const SPLIT_PATH = new RegExp(`^/api/splits/${ID}$`);
const INVITE_LINK_PATH = new RegExp(`^/api/splits/${ID}/invite$`);
const SPLIT_INVITES_PATH = new RegExp(`^/api/splits/${ID}/invites$`);
const SPLIT_INVITE_PATH = new RegExp(`^/api/splits/${ID}/invites/${ID}$`);
const MY_INVITES_PATH = /^\/api\/invites$/;
const MY_INVITE_ACTION_PATH = new RegExp(`^/api/invites/${ID}/(accept|decline)$`);
const MEMBER_PATH = new RegExp(`^/api/splits/${ID}/members/([^/]+)$`);
const PEOPLE_PATH = new RegExp(`^/api/splits/${ID}/people$`);
const PERSON_PATH = new RegExp(`^/api/splits/${ID}/people/${ID}$`);
const ITEMS_PATH = new RegExp(`^/api/splits/${ID}/items$`);
const ITEM_PATH = new RegExp(`^/api/splits/${ID}/items/${ID}$`);
const JOIN_PATH = new RegExp(`^/api/join/${ID}$`);

const MAX_BODY_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 80;
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const notFound = () => json({ error: 'Not found' }, 404);

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

const newInviteToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'Too large' }, 413);
  try {
    const body = JSON.parse(text);
    if (body == null || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
}

const readName = (body: Record<string, unknown>) => {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null;
};

// Adds an editor (no-op if already a member) and clears any pending invite for them
const addEditor = (db: D1Database, splitId: string, email: string) =>
  db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO split_members (split_id, email, role, joined_at)
         VALUES (?, ?, 'editor', ?)`,
      )
      .bind(splitId, email, Date.now()),
    db.prepare('DELETE FROM split_invites WHERE split_id = ? AND email = ?').bind(splitId, email),
  ]);

async function getRole(db: D1Database, splitId: string, email: string): Promise<Role | null> {
  const row = await db
    .prepare('SELECT role FROM split_members WHERE split_id = ? AND email = ?')
    .bind(splitId, email)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

async function handleApi(req: Request, env: Env, url: URL, email: string): Promise<Response> {
  const { pathname } = url;
  const db = env.DB;
  let match: RegExpMatchArray | null;

  if (pathname === '/api/me') {
    return req.method === 'GET' ? json({ email }) : json({ error: 'Method not allowed' }, 405);
  }

  if (SPLITS_PATH.test(pathname)) {
    if (req.method === 'GET') {
      const { results } = await db
        .prepare(
          `SELECT s.id, s.name, s.updated_at AS updatedAt, m.role,
             (SELECT count(*) FROM split_members WHERE split_id = s.id) AS memberCount
           FROM splits s JOIN split_members m ON m.split_id = s.id
           WHERE m.email = ?
           ORDER BY s.updated_at DESC`,
        )
        .bind(email)
        .all();
      return json({ splits: results });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (body instanceof Response) return body;
      const name = readName(body);
      if (name == null) return json({ error: `Name must be 1-${MAX_NAME_LENGTH} characters` }, 400);

      const id = newId();
      const now = Date.now();
      await db.batch([
        db
          .prepare(
            `INSERT INTO splits (id, name, invite_token, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?4)`,
          )
          .bind(id, name, newInviteToken(), now),
        db
          .prepare(
            `INSERT INTO split_members (split_id, email, role, joined_at) VALUES (?, ?, 'owner', ?)`,
          )
          .bind(id, email, now),
      ]);
      return json({ id }, 201);
    }

    return json({ error: 'Method not allowed' }, 405);
  }

  if ((match = pathname.match(SPLIT_PATH))) {
    const id = match[1];

    if (req.method === 'GET') {
      // One round trip: the database can be far from the user, so every query costs
      const [roleRows, splitRows, memberRows, inviteRows, ...content] = await db.batch<
        Record<string, unknown>
      >([
        db
          .prepare('SELECT role FROM split_members WHERE split_id = ? AND email = ?')
          .bind(id, email),
        db.prepare('SELECT name, invite_token AS inviteToken FROM splits WHERE id = ?').bind(id),
        db
          .prepare(
            'SELECT email, role FROM split_members WHERE split_id = ? ORDER BY joined_at, email',
          )
          .bind(id),
        db
          .prepare(
            `SELECT id, email, created_at AS createdAt, expires_at AS expiresAt
             FROM split_invites WHERE split_id = ? AND expires_at > ? ORDER BY created_at`,
          )
          .bind(id, Date.now()),
        ...contentStatements(db, id),
      ]);
      const role = (roleRows.results[0] as { role: Role } | undefined)?.role;
      const split = splitRows.results[0] as { name: string; inviteToken: string } | undefined;
      // Non-members get the same 404 as a missing split, so ids can't be probed
      if (role == null || split == null) return notFound();

      return json({
        id,
        name: split.name,
        role,
        members: memberRows.results,
        invites: role === 'owner' ? inviteRows.results : undefined,
        inviteToken: role === 'owner' ? split.inviteToken : undefined,
        ...assembleContent(content),
      });
    }

    const role = await getRole(db, id, email);
    if (role == null) return notFound();

    if (req.method === 'DELETE') {
      if (role !== 'owner') return json({ error: 'Only the owner can delete this split' }, 403);
      await db.batch([
        ...deleteContentStatements(db, id),
        db.prepare('DELETE FROM split_invites WHERE split_id = ?').bind(id),
        db.prepare('DELETE FROM split_members WHERE split_id = ?').bind(id),
        db.prepare('DELETE FROM splits WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  }

  // The bill (people and items) can be changed by any member
  const contentMatch =
    pathname.match(PEOPLE_PATH) ??
    pathname.match(PERSON_PATH) ??
    pathname.match(ITEMS_PATH) ??
    pathname.match(ITEM_PATH);
  if (contentMatch) {
    const [, id, childId] = contentMatch;
    if ((await getRole(db, id, email)) == null) return notFound();
    const isPeople = pathname.includes('/people');
    const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};
    if (body instanceof Response) return body;

    if (isPeople && childId == null) {
      if (req.method === 'POST') return addPerson(db, id, body);
      if (req.method === 'DELETE') return clearPeople(db, id);
    } else if (isPeople) {
      if (req.method === 'DELETE') return removePerson(db, id, childId);
    } else if (childId == null) {
      if (req.method === 'POST') return addItem(db, id, body);
      if (req.method === 'DELETE') return clearItems(db, id);
    } else {
      if (req.method === 'PUT') return updateItem(db, id, childId, body);
      if (req.method === 'DELETE') return removeItem(db, id, childId);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  if ((match = pathname.match(INVITE_LINK_PATH))) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const id = match[1];
    const role = await getRole(db, id, email);
    if (role == null) return notFound();
    if (role !== 'owner') return json({ error: 'Only the owner can reset the invite link' }, 403);

    const inviteToken = newInviteToken();
    await db.prepare('UPDATE splits SET invite_token = ? WHERE id = ?').bind(inviteToken, id).run();
    return json({ inviteToken });
  }

  if ((match = pathname.match(SPLIT_INVITES_PATH))) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const id = match[1];
    const role = await getRole(db, id, email);
    if (role == null) return notFound();
    if (role !== 'owner') return json({ error: 'Only the owner can invite people' }, 403);

    const body = await readJson(req);
    if (body instanceof Response) return body;
    const invitee = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!EMAIL_PATTERN.test(invitee)) return json({ error: 'Enter a valid email address' }, 400);
    if ((await getRole(db, id, invitee)) != null) {
      return json({ error: `${invitee} already has access` }, 409);
    }

    // Inviting the same email again replaces the old invite and restarts its expiry
    const now = Date.now();
    const invite = { id: newId(), email: invitee, createdAt: now, expiresAt: now + INVITE_TTL_MS };
    await db
      .prepare(
        `INSERT INTO split_invites (id, split_id, email, invited_by, created_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (split_id, email) DO UPDATE SET
           id = excluded.id, invited_by = excluded.invited_by,
           created_at = excluded.created_at, expires_at = excluded.expires_at`,
      )
      .bind(invite.id, id, invitee, email, invite.createdAt, invite.expiresAt)
      .run();
    return json(invite, 201);
  }

  if ((match = pathname.match(SPLIT_INVITE_PATH))) {
    if (req.method !== 'DELETE') return json({ error: 'Method not allowed' }, 405);
    const [, id, inviteId] = match;
    const role = await getRole(db, id, email);
    if (role == null) return notFound();
    if (role !== 'owner') return json({ error: 'Only the owner can revoke invites' }, 403);

    const { meta } = await db
      .prepare('DELETE FROM split_invites WHERE id = ? AND split_id = ?')
      .bind(inviteId, id)
      .run();
    return meta.changes > 0 ? json({ ok: true }) : notFound();
  }

  if (MY_INVITES_PATH.test(pathname)) {
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const { results } = await db
      .prepare(
        `SELECT i.id, i.split_id AS splitId, s.name AS splitName, i.invited_by AS invitedBy,
           i.created_at AS createdAt, i.expires_at AS expiresAt
         FROM split_invites i JOIN splits s ON s.id = i.split_id
         WHERE i.email = ? AND i.expires_at > ?
         ORDER BY i.created_at DESC`,
      )
      .bind(email, Date.now())
      .all();
    return json({ invites: results });
  }

  if ((match = pathname.match(MY_INVITE_ACTION_PATH))) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const [, inviteId, action] = match;
    // Only the invited email can act on an invite; to anyone else it doesn't exist
    const invite = await db
      .prepare(
        'SELECT split_id AS splitId FROM split_invites WHERE id = ? AND email = ? AND expires_at > ?',
      )
      .bind(inviteId, email, Date.now())
      .first<{ splitId: string }>();
    if (invite == null) return json({ error: 'This invite has expired or was withdrawn' }, 404);

    if (action === 'accept') {
      await addEditor(db, invite.splitId, email);
      return json({ id: invite.splitId });
    }
    await db.prepare('DELETE FROM split_invites WHERE id = ?').bind(inviteId).run();
    return json({ ok: true });
  }

  if ((match = pathname.match(MEMBER_PATH))) {
    if (req.method !== 'DELETE') return json({ error: 'Method not allowed' }, 405);
    const id = match[1];
    const target = decodeURIComponent(match[2]).toLowerCase();
    const role = await getRole(db, id, email);
    if (role == null) return notFound();

    const targetRole = await getRole(db, id, target);
    if (targetRole == null) return notFound();
    if (targetRole === 'owner') return json({ error: 'The owner cannot be removed' }, 400);
    // Owners remove anyone; editors can only remove themselves (leave)
    if (role !== 'owner' && target !== email) {
      return json({ error: 'Only the owner can remove members' }, 403);
    }

    await db
      .prepare('DELETE FROM split_members WHERE split_id = ? AND email = ?')
      .bind(id, target)
      .run();
    return json({ ok: true });
  }

  if ((match = pathname.match(JOIN_PATH))) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const split = await db
      .prepare('SELECT id FROM splits WHERE invite_token = ?')
      .bind(match[1])
      .first<{ id: string }>();
    if (split == null) return json({ error: 'This invite link is no longer valid' }, 404);

    await addEditor(db, split.id, email);
    return json({ id: split.id });
  }

  return notFound();
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(req);
    }

    const email = await getUserEmail(req, env);
    if (email == null) return json({ error: 'Not signed in' }, 401);

    return handleApi(req, env, url, email);
  },
} satisfies ExportedHandler<Env>;
