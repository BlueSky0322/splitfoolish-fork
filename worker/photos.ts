// Photos: receipts on items, photos of a whole split, and profile pictures. They are
// stored in D1 next to the rest of the data, so they are private by default (served
// only through the Worker, with the same membership checks) and are deleted together
// with their item or split. Photos are shrunk in the browser before upload.

// D1 allows up to 2 MB per value; browser-shrunk photos are usually a few hundred KB
const MAX_PHOTO_BYTES = 1_500_000;
const MAX_AVATAR_BYTES = 256_000;
const MAX_PHOTOS_PER_SPLIT = 300;

import { ensureProfile } from './profiles';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

/** The image type from the file's first bytes, so a mislabelled upload can't pass as an image */
function detectImageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function readImage(req: Request, maxBytes: number) {
  const declared = Number(req.headers.get('Content-Length') ?? 0);
  if (declared > maxBytes) return json({ error: 'That photo is too large' }, 413);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > maxBytes) return json({ error: 'That photo is too large' }, 413);
  if (bytes.length === 0) return json({ error: 'No photo was sent' }, 400);
  const contentType = detectImageType(bytes);
  if (contentType == null) {
    return json({ error: 'Only JPEG, PNG and WebP photos are supported' }, 415);
  }
  return { bytes, contentType };
}

// D1 hands BLOBs back as an ArrayBuffer or an array of byte values depending on version
const toBytes = (data: ArrayBuffer | number[]) => new Uint8Array(data);

function imageResponse(data: ArrayBuffer | number[], contentType: string) {
  return new Response(toBytes(data), {
    headers: {
      'Content-Type': contentType,
      // Ids and versions never point at different content, so browsers can keep them
      'Cache-Control': 'private, max-age=31536000, immutable',
      // Never treat the bytes as anything but the image type above
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

export const listAttachmentsStatement = (db: D1Database, splitId: string) =>
  db
    .prepare(
      `SELECT id, item_id AS itemId, size, uploaded_by AS uploadedBy, created_at AS createdAt
       FROM attachments WHERE split_id = ? ORDER BY created_at`,
    )
    .bind(splitId);

export async function uploadAttachment(
  req: Request,
  db: D1Database,
  splitId: string,
  email: string,
) {
  const itemId = new URL(req.url).searchParams.get('itemId');
  const [count, item] = await db.batch<{ n?: number; id?: string }>([
    db.prepare('SELECT count(*) AS n FROM attachments WHERE split_id = ?').bind(splitId),
    db.prepare('SELECT id FROM items WHERE id = ? AND split_id = ?').bind(itemId ?? '', splitId),
  ]);
  if ((count.results[0]?.n ?? 0) >= MAX_PHOTOS_PER_SPLIT) {
    return json({ error: `A split can have up to ${MAX_PHOTOS_PER_SPLIT} photos` }, 409);
  }
  if (itemId != null && item.results.length === 0) {
    return json({ error: 'That item no longer exists' }, 404);
  }

  const image = await readImage(req, MAX_PHOTO_BYTES);
  if (image instanceof Response) return image;

  const attachment = {
    id: newId(),
    itemId,
    size: image.bytes.length,
    uploadedBy: email,
    createdAt: Date.now(),
  };
  try {
    // Details and bytes are saved together or not at all
    await db.batch([
      db
        .prepare(
          `INSERT INTO attachments (id, split_id, item_id, content_type, size, uploaded_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          attachment.id,
          splitId,
          itemId,
          image.contentType,
          attachment.size,
          email,
          attachment.createdAt,
        ),
      db
        .prepare('INSERT INTO attachment_data (id, data) VALUES (?, ?)')
        .bind(attachment.id, image.bytes),
    ]);
  } catch (err) {
    // The item was removed between the check above and now
    if (String(err).includes('CONSTRAINT')) {
      return json({ error: 'That item no longer exists' }, 404);
    }
    throw err;
  }
  return json(attachment, 201);
}

export async function getAttachment(db: D1Database, splitId: string, id: string) {
  const row = await db
    .prepare(
      `SELECT a.content_type AS contentType, d.data FROM attachments a
       JOIN attachment_data d ON d.id = a.id WHERE a.id = ? AND a.split_id = ?`,
    )
    .bind(id, splitId)
    .first<{ contentType: string; data: ArrayBuffer | number[] }>();
  if (row == null) return json({ error: 'Not found' }, 404);
  return imageResponse(row.data, row.contentType);
}

export async function deleteAttachment(
  db: D1Database,
  splitId: string,
  id: string,
  email: string,
  isOwner: boolean,
) {
  const row = await db
    .prepare('SELECT uploaded_by AS uploadedBy FROM attachments WHERE id = ? AND split_id = ?')
    .bind(id, splitId)
    .first<{ uploadedBy: string }>();
  if (row == null) return json({ ok: true });
  if (row.uploadedBy !== email && !isOwner) {
    return json({ error: 'Only the person who added a photo, or the owner, can remove it' }, 403);
  }
  await db.batch([
    db.prepare('DELETE FROM attachment_data WHERE id = ?').bind(id),
    db.prepare('DELETE FROM attachments WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

export async function putAvatar(req: Request, db: D1Database, email: string) {
  const image = await readImage(req, MAX_AVATAR_BYTES);
  if (image instanceof Response) return image;

  const version = Date.now();
  await db.batch([
    ensureProfile(db, email),
    db
      .prepare(
        `INSERT INTO avatars (email, content_type, version, data) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (email) DO UPDATE SET content_type = ?2, version = ?3, data = ?4`,
      )
      .bind(email, image.contentType, version, image.bytes),
  ]);
  return json({ avatarVersion: version });
}

export async function deleteAvatar(db: D1Database, email: string) {
  await db.prepare('DELETE FROM avatars WHERE email = ?').bind(email).run();
  return json({ ok: true });
}

/** Profile pictures are visible to their owner and to people they share a split with */
export async function getAvatar(db: D1Database, viewer: string, email: string) {
  if (viewer !== email) {
    const shared = await db
      .prepare(
        `SELECT 1 FROM split_members a JOIN split_members b ON a.split_id = b.split_id
         WHERE a.email = ? AND b.email = ? LIMIT 1`,
      )
      .bind(viewer, email)
      .first();
    if (shared == null) return json({ error: 'Not found' }, 404);
  }
  const row = await db
    .prepare('SELECT content_type AS contentType, data FROM avatars WHERE email = ?')
    .bind(email)
    .first<{ contentType: string; data: ArrayBuffer | number[] }>();
  if (row == null) return json({ error: 'Not found' }, 404);
  return imageResponse(row.data, row.contentType);
}

/** A split's picture; set and removed by its owner, seen by its members */
export async function putSplitPicture(req: Request, db: D1Database, splitId: string) {
  const image = await readImage(req, MAX_AVATAR_BYTES);
  if (image instanceof Response) return image;
  const version = Date.now();
  await db
    .prepare(
      `INSERT INTO split_pictures (split_id, content_type, version, data) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (split_id) DO UPDATE SET content_type = ?2, version = ?3, data = ?4`,
    )
    .bind(splitId, image.contentType, version, image.bytes)
    .run();
  return json({ pictureVersion: version });
}

export async function deleteSplitPicture(db: D1Database, splitId: string) {
  await db.prepare('DELETE FROM split_pictures WHERE split_id = ?').bind(splitId).run();
  return json({ ok: true });
}

export async function getSplitPicture(db: D1Database, splitId: string) {
  const row = await db
    .prepare('SELECT content_type AS contentType, data FROM split_pictures WHERE split_id = ?')
    .bind(splitId)
    .first<{ contentType: string; data: ArrayBuffer | number[] }>();
  if (row == null) return json({ error: 'Not found' }, 404);
  return imageResponse(row.data, row.contentType);
}
