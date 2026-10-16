// Photos on a split: receipts on its items, and photos of the whole split. They are
// deleted together with their item or split.

import { type Attachment, isRowId, MAX_PHOTO_BYTES, PHOTO_ID_PARAM } from '../../shared/api';
import type { Actor } from '../../shared/rules';
import { canRemovePhoto } from '../../shared/rules';
import { json, newId, fail, notFound, ok, isConstraintError } from '../http';
import { type Image, imageResponse, readImage } from './images';

const MAX_PHOTOS_PER_SPLIT = 300;

export const listAttachmentsStatement = (db: D1Database, splitId: string) =>
  db
    .prepare(
      `SELECT id, item_id AS itemId, size, content_type AS contentType, uploaded_by AS uploadedBy,
       created_at AS createdAt
       FROM attachments WHERE split_id = ? ORDER BY created_at`,
    )
    .bind(splitId);

export const assembleAttachments = (result: D1Result) => result.results as Attachment[];

const attachmentByIdStatement = (db: D1Database, id: string) =>
  db
    .prepare(
      `SELECT id, split_id AS splitId, item_id AS itemId, size, content_type AS contentType,
       uploaded_by AS uploadedBy, created_at AS createdAt
       FROM attachments WHERE id = ?`,
    )
    .bind(id);

/**
 * A photo sent again with the id it was first sent with (its answer was lost, say): the
 * photo saved then, if it's the same one; null when that id is new
 */
function alreadyUploaded(
  found: (Attachment & { splitId: string }) | undefined,
  splitId: string,
  itemId: string | null,
  email: string,
) {
  if (found == null) return null;
  const { splitId: savedIn, ...attachment } = found;
  if (savedIn !== splitId || attachment.itemId !== itemId || attachment.uploadedBy !== email) {
    return fail('That photo id is already used', 409);
  }
  return json<Attachment>(attachment);
}

export function uploadAttachment(db: D1Database, splitId: string, email: string, req: Request) {
  const params = new URL(req.url).searchParams;
  // Chosen by the app, so sending a photo again never adds it twice
  const id = params.get(PHOTO_ID_PARAM);
  if (id != null && !isRowId(id)) return fail('That photo id is not valid', 400);
  return addAttachment(db, splitId, email, params.get('itemId'), id, () =>
    readImage(req, MAX_PHOTO_BYTES),
  );
}

/**
 * Adds a photo to the split, or to one of its items: the app's uploads and the agents'
 * (mcp/tools.ts). `read` gives the checked image, and is only called once the split has
 * room and the item is there. `alongside` is saved in the same batch, so it exists
 * exactly when the photo does. A photo sent again under its first id answers with the
 * one saved then.
 */
export async function addAttachment(
  db: D1Database,
  splitId: string,
  email: string,
  itemId: string | null,
  id: string | null,
  read: () => Promise<Image | Response>,
  alongside: D1PreparedStatement[] = [],
) {
  const [count, item, existing] = await db.batch<{ n?: number; id?: string }>([
    db.prepare('SELECT count(*) AS n FROM attachments WHERE split_id = ?').bind(splitId),
    db.prepare('SELECT id FROM items WHERE id = ? AND split_id = ?').bind(itemId ?? '', splitId),
    attachmentByIdStatement(db, id ?? ''),
  ]);
  const again = alreadyUploaded(
    existing.results[0] as (Attachment & { splitId: string }) | undefined,
    splitId,
    itemId,
    email,
  );
  if (again) return again;
  if ((count.results[0]?.n ?? 0) >= MAX_PHOTOS_PER_SPLIT) {
    return fail(`A split can have up to ${MAX_PHOTOS_PER_SPLIT} photos`, 409);
  }
  if (itemId != null && item.results.length === 0) {
    return fail('That item no longer exists', 404);
  }

  const image = await read();
  if (image instanceof Response) return image;

  const attachment: Attachment = {
    id: id ?? newId(),
    itemId,
    size: image.bytes.length,
    contentType: image.contentType,
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
          attachment.contentType,
          attachment.size,
          email,
          attachment.createdAt,
        ),
      db
        .prepare('INSERT INTO attachment_data (id, data) VALUES (?, ?)')
        .bind(attachment.id, image.bytes),
      ...alongside,
    ]);
  } catch (err) {
    if (isConstraintError(err)) {
      // The same photo, sent twice at once: the other request saved it
      if (id != null) {
        const saved = await attachmentByIdStatement(db, id).first<
          Attachment & { splitId: string }
        >();
        const again = alreadyUploaded(saved ?? undefined, splitId, itemId, email);
        if (again) return again;
      }
      // The item was removed between the check above and now
      return fail('That item no longer exists', 404);
    }
    throw err;
  }
  return json<Attachment>(attachment, 201);
}

/** A photo of this split and its bytes; null when there's no such photo in it */
export const readAttachment = (db: D1Database, splitId: string, id: string) =>
  db
    .prepare(
      `SELECT a.content_type AS contentType, d.data FROM attachments a
       JOIN attachment_data d ON d.id = a.id WHERE a.id = ? AND a.split_id = ?`,
    )
    .bind(id, splitId)
    .first<{ contentType: string; data: ArrayBuffer | number[] }>();

export async function serveAttachment(db: D1Database, splitId: string, id: string) {
  const row = await readAttachment(db, splitId, id);
  if (row == null) return notFound();
  return imageResponse(row.data, row.contentType);
}

/**
 * Removes photos from the split: all of them, or none when any isn't this person's to
 * remove. Ones already gone are skipped.
 */
export async function deleteAttachments(
  db: D1Database,
  splitId: string,
  ids: string[],
  actor: Actor,
) {
  const marks = (n: number) => Array.from({ length: n }, () => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT id, uploaded_by AS uploadedBy FROM attachments
       WHERE split_id = ? AND id IN (${marks(ids.length)})`,
    )
    .bind(splitId, ...ids)
    .all<{ id: string; uploadedBy: string }>();
  if (results.some((row) => !canRemovePhoto(row.uploadedBy, actor))) {
    return fail('Only the person who added a photo, or the owner, can remove it', 403);
  }
  if (results.length === 0) return ok();
  const found = results.map((row) => row.id);
  await db.batch([
    db.prepare(`DELETE FROM attachment_data WHERE id IN (${marks(found.length)})`).bind(...found),
    db.prepare(`DELETE FROM attachments WHERE id IN (${marks(found.length)})`).bind(...found),
  ]);
  return ok();
}
