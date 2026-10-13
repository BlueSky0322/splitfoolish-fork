import { AuthEnv, getUserEmail } from './auth';

interface Env extends AuthEnv {
  DB: D1Database;
  ASSETS: Fetcher;
}

type Role = 'owner' | 'editor';

const ID = '([A-Za-z0-9_-]{8,64})';
const SPLITS_PATH = /^\/api\/splits$/;
const SPLIT_PATH = new RegExp(`^/api/splits/${ID}$`);
const INVITE_PATH = new RegExp(`^/api/splits/${ID}/invite$`);
const MEMBER_PATH = new RegExp(`^/api/splits/${ID}/members/([^/]+)$`);
const JOIN_PATH = new RegExp(`^/api/join/${ID}$`);

const MAX_BODY_BYTES = 256 * 1024;
const MAX_NAME_LENGTH = 80;

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
            `INSERT INTO splits (id, name, data, invite_token, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
          )
          .bind(id, name, JSON.stringify({ people: [], items: [] }), newInviteToken(), now),
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
    // Non-members get the same 404 as a missing split, so ids can't be probed
    const role = await getRole(db, id, email);
    if (role == null) return notFound();

    if (req.method === 'GET') {
      const split = await db
        .prepare('SELECT name, data, invite_token AS inviteToken FROM splits WHERE id = ?')
        .bind(id)
        .first<{ name: string; data: string; inviteToken: string }>();
      if (split == null) return notFound();
      const { results: members } = await db
        .prepare(
          'SELECT email, role FROM split_members WHERE split_id = ? ORDER BY joined_at, email',
        )
        .bind(id)
        .all<{ email: string; role: Role }>();

      return json({
        id,
        name: split.name,
        role,
        members,
        inviteToken: role === 'owner' ? split.inviteToken : undefined,
        ...JSON.parse(split.data),
      });
    }

    if (req.method === 'PUT') {
      const data = await readJson(req);
      if (data instanceof Response) return data;
      if (!Array.isArray(data.people) || !Array.isArray(data.items)) {
        return json({ error: 'Expected { people: [], items: [] }' }, 400);
      }

      await db
        .prepare('UPDATE splits SET data = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify({ people: data.people, items: data.items }), Date.now(), id)
        .run();
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (role !== 'owner') return json({ error: 'Only the owner can delete this split' }, 403);
      await db.batch([
        db.prepare('DELETE FROM split_members WHERE split_id = ?').bind(id),
        db.prepare('DELETE FROM splits WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  }

  if ((match = pathname.match(INVITE_PATH))) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const id = match[1];
    const role = await getRole(db, id, email);
    if (role == null) return notFound();
    if (role !== 'owner') return json({ error: 'Only the owner can reset the invite link' }, 403);

    const inviteToken = newInviteToken();
    await db.prepare('UPDATE splits SET invite_token = ? WHERE id = ?').bind(inviteToken, id).run();
    return json({ inviteToken });
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

    await db
      .prepare(
        `INSERT OR IGNORE INTO split_members (split_id, email, role, joined_at)
         VALUES (?, ?, 'editor', ?)`,
      )
      .bind(split.id, email, Date.now())
      .run();
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
