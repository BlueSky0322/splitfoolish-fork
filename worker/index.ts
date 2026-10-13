import { AuthEnv, getUserEmail } from './auth';
import {
  applyChanges,
  assembleContent,
  contentStatements,
  deleteContentStatements,
} from './split-content';
import {
  CURRENCY,
  assembleMembers,
  getProfile,
  memberProfileStatements,
  patchProfile,
  putPaymentMethods,
  settingsStatements,
} from './profiles';
import { listSplitSummaries } from './summaries';
import {
  deleteAttachment,
  deleteAvatar,
  getAttachment,
  getAvatar,
  listAttachmentsStatement,
  putAvatar,
  putSplitPicture,
  deleteSplitPicture,
  getSplitPicture,
  uploadAttachment,
} from './photos';

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
const CHANGES_PATH = new RegExp(`^/api/splits/${ID}/changes$`);
const ATTACHMENTS_PATH = new RegExp(`^/api/splits/${ID}/attachments$`);
const ATTACHMENT_PATH = new RegExp(`^/api/splits/${ID}/attachments/${ID}$`);
const AVATAR_PATH = /^\/api\/avatars\/([^/]+)$/;
const SPLIT_PICTURE_PATH = new RegExp(`^/api/splits/${ID}/picture$`);
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
    if (req.method === 'GET') return json(await getProfile(db, email));
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      if (body instanceof Response) return body;
      return patchProfile(db, email, body);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  if (pathname === '/api/me/payment-methods') {
    if (req.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
    const body = await readJson(req);
    if (body instanceof Response) return body;
    return putPaymentMethods(db, email, body);
  }

  if (pathname === '/api/me/avatar') {
    if (req.method === 'PUT') return putAvatar(req, db, email);
    if (req.method === 'DELETE') return deleteAvatar(db, email);
    return json({ error: 'Method not allowed' }, 405);
  }

  if ((match = pathname.match(AVATAR_PATH))) {
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    return getAvatar(db, email, decodeURIComponent(match[1]).toLowerCase());
  }

  if (SPLITS_PATH.test(pathname)) {
    if (req.method === 'GET') return json({ splits: await listSplitSummaries(db, email) });

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (body instanceof Response) return body;
      const name = readName(body);
      if (name == null) return json({ error: `Name must be 1-${MAX_NAME_LENGTH} characters` }, 400);
      const currency = body.currency ?? 'MYR';
      if (typeof currency !== 'string' || !CURRENCY.test(currency)) {
        return json({ error: 'Invalid currency' }, 400);
      }

      // The app may pick the id, so it can open the new split before this finishes
      const id = typeof body.id === 'string' && /^[0-9a-f]{16}$/.test(body.id) ? body.id : newId();
      const now = Date.now();
      const created = await db
        .batch([
          db
            .prepare(
              `INSERT INTO splits (id, name, currency, invite_token, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
            )
            .bind(id, name, currency, newInviteToken(), now),
          // New splits default to the currency used last
          ...settingsStatements(db, email, { lastCurrency: currency }),
          db
            .prepare(
              `INSERT INTO split_members (split_id, email, role, joined_at) VALUES (?, ?, 'owner', ?)`,
            )
            .bind(id, email, now),
        ])
        .then(
          () => true,
          (err) => {
            // That id is already taken
            if (String(err).includes('CONSTRAINT')) return false;
            throw err;
          },
        );
      if (!created) return json({ error: 'That split already exists' }, 409);
      return json({ id }, 201);
    }

    return json({ error: 'Method not allowed' }, 405);
  }

  if ((match = pathname.match(SPLIT_PATH))) {
    const id = match[1];

    if (req.method === 'GET') {
      // One round trip: the database can be far from the user, so every query costs
      const [roleRows, splitRows, memberRows, methodRows, inviteRows, attachmentRows, ...content] =
        await db.batch<Record<string, unknown>>([
          db
            .prepare('SELECT role FROM split_members WHERE split_id = ? AND email = ?')
            .bind(id, email),
          db
            .prepare(
              `SELECT s.name, s.currency, s.invite_token AS inviteToken,
                 s.distributor_person_id AS distributorId, p.version AS pictureVersion
               FROM splits s LEFT JOIN split_pictures p ON p.split_id = s.id WHERE s.id = ?`,
            )
            .bind(id),
          ...memberProfileStatements(db, id),
          db
            .prepare(
              `SELECT id, email, created_at AS createdAt, expires_at AS expiresAt
             FROM split_invites WHERE split_id = ? AND expires_at > ? ORDER BY created_at`,
            )
            .bind(id, Date.now()),
          listAttachmentsStatement(db, id),
          ...contentStatements(db, id),
        ]);
      const role = (roleRows.results[0] as { role: Role } | undefined)?.role;
      const split = splitRows.results[0] as
        | {
            name: string;
            currency: string;
            inviteToken: string;
            distributorId: string | null;
            pictureVersion: number | null;
          }
        | undefined;
      // Non-members get the same 404 as a missing split, so ids can't be probed
      if (role == null || split == null) return notFound();

      return json({
        id,
        name: split.name,
        currency: split.currency,
        distributorId: split.distributorId,
        pictureVersion: split.pictureVersion,
        role,
        members: assembleMembers([memberRows, methodRows]),
        invites: role === 'owner' ? inviteRows.results : undefined,
        inviteToken: role === 'owner' ? split.inviteToken : undefined,
        attachments: attachmentRows.results,
        ...assembleContent(content),
      });
    }

    const role = await getRole(db, id, email);
    if (role == null) return notFound();

    // Split settings: rename, change currency
    if (req.method === 'PATCH') {
      if (role !== 'owner') return json({ error: 'Only the owner can change split settings' }, 403);
      const body = await readJson(req);
      if (body instanceof Response) return body;
      const statements: D1PreparedStatement[] = [];
      if ('name' in body) {
        const name = readName(body);
        if (name == null) {
          return json({ error: `Name must be 1-${MAX_NAME_LENGTH} characters` }, 400);
        }
        statements.push(db.prepare('UPDATE splits SET name = ? WHERE id = ?').bind(name, id));
      }
      if ('currency' in body) {
        if (typeof body.currency !== 'string' || !CURRENCY.test(body.currency)) {
          return json({ error: 'Invalid currency' }, 400);
        }
        statements.push(
          db.prepare('UPDATE splits SET currency = ? WHERE id = ?').bind(body.currency, id),
        );
      }
      if (statements.length > 0) {
        await db.batch([
          ...statements,
          db.prepare('UPDATE splits SET updated_at = ? WHERE id = ?').bind(Date.now(), id),
        ]);
      }
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (role !== 'owner') return json({ error: 'Only the owner can delete this split' }, 403);
      await db.batch([
        db
          .prepare(
            'DELETE FROM attachment_data WHERE id IN (SELECT id FROM attachments WHERE split_id = ?)',
          )
          .bind(id),
        db.prepare('DELETE FROM attachments WHERE split_id = ?').bind(id),
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
  if ((match = pathname.match(CHANGES_PATH))) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const id = match[1];
    if ((await getRole(db, id, email)) == null) return notFound();
    const body = await readJson(req);
    if (body instanceof Response) return body;
    return applyChanges(db, id, body);
  }

  // Photos can be added by any member, and removed by whoever added them or the owner
  if ((match = pathname.match(SPLIT_PICTURE_PATH))) {
    const id = match[1];
    const role = await getRole(db, id, email);
    if (role == null) return notFound();
    if (req.method === 'GET') return getSplitPicture(db, id);
    if (role !== 'owner') return json({ error: 'Only the owner can change the picture' }, 403);
    if (req.method === 'PUT') return putSplitPicture(req, db, id);
    if (req.method === 'DELETE') return deleteSplitPicture(db, id);
    return json({ error: 'Method not allowed' }, 405);
  }

  if ((match = pathname.match(ATTACHMENTS_PATH) ?? pathname.match(ATTACHMENT_PATH))) {
    const [, id, attachmentId] = match;
    const role = await getRole(db, id, email);
    if (role == null) return notFound();
    if (attachmentId == null) {
      return req.method === 'POST'
        ? uploadAttachment(req, db, id, email)
        : json({ error: 'Method not allowed' }, 405);
    }
    if (req.method === 'GET') return getAttachment(db, id, attachmentId);
    if (req.method === 'DELETE') {
      return deleteAttachment(db, id, attachmentId, email, role === 'owner');
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
           p.display_name AS invitedByName, i.created_at AS createdAt, i.expires_at AS expiresAt
         FROM split_invites i JOIN splits s ON s.id = i.split_id
         LEFT JOIN profiles p ON p.email = i.invited_by
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
