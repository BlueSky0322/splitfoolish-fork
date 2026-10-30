// Photos on a split: receipts on its items, and photos of the whole split. They are
// deleted together with their item or split.

import { type Place, isPosition, toPlace } from '../../shared/places';
import { type Attachment, isRowId, MAX_PHOTO_BYTES, PHOTO_ID_PARAM } from '../../shared/api';
import type { Actor } from '../../shared/rules';
import { canRemovePhoto } from '../../shared/rules';
import { json, newId, fail, notFound, ok, isConstraintError } from '../http';
import { memberGuardStatement, guardThatFailed } from '../bill/commit';
import { touchSplitStatement } from '../app';
import { type Image, type Viewing, imageResponse, readImage } from './images';

const MAX_PHOTOS_PER_SPLIT = 300;

/** How many photos a split may hold: fewer when a test's Worker says so */
export const photosPerSplit = (env: { PHOTOS_PER_SPLIT?: string }) =>
  Math.min(Number(env.PHOTOS_PER_SPLIT) || MAX_PHOTOS_PER_SPLIT, MAX_PHOTOS_PER_SPLIT);

const full = (limit: number) => fail(`A split can have up to ${limit} photos`, 409);

/** A photo's details as the API shows them, with its place as two columns */
const COLUMNS = `id, item_id AS itemId, size, content_type AS contentType,
  uploaded_by AS uploadedBy, created_at AS createdAt, place_lat AS placeLat, place_lng AS placeLng`;

type AttachmentRow = Omit<Attachment, 'place'> & {
  placeLat: number | null;
  placeLng: number | null;
};

const toAttachment = ({ placeLat, placeLng, ...rest }: AttachmentRow): Attachment => ({
  ...rest,
  place: placeLat == null || placeLng == null ? null : { lat: placeLat, lng: placeLng, name: null },
});

export const listAttachmentsStatement = (db: D1Database, splitId: string) =>
  db
    .prepare(`SELECT ${COLUMNS} FROM attachments WHERE split_id = ? ORDER BY created_at`)
    .bind(splitId);

export const assembleAttachments = (result: D1Result) =>
  (result.results as AttachmentRow[]).map(toAttachment);

const attachmentByIdStatement = (db: D1Database, id: string) =>
  db.prepare(`SELECT ${COLUMNS}, split_id AS splitId FROM attachments WHERE id = ?`).bind(id);

/** One photo by id, with the split it's in; null when there's none */
const attachmentById = async (db: D1Database, id: string) => {
  const row = await attachmentByIdStatement(db, id).first<AttachmentRow & { splitId: string }>();
  return row == null ? null : { ...toAttachment(row), splitId: row.splitId };
};

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

export function uploadAttachment(
  db: D1Database,
  splitId: string,
  email: string,
  req: Request,
  limit = MAX_PHOTOS_PER_SPLIT,
) {
  const params = new URL(req.url).searchParams;
  // Chosen by the app, so sending a photo again never adds it twice
  const id = params.get(PHOTO_ID_PARAM);
  if (id != null && !isRowId(id)) return fail('That photo id is not valid', 400);
  // Where it was taken, read on the device before it was shrunk: both or neither
  const [lat, lng] = [params.get('lat'), params.get('lng')];
  let place: Place | null = null;
  if (lat != null || lng != null) {
    if (lat == null || lng == null || !isPosition(Number(lat), Number(lng))) {
      return fail('Where a photo was taken is a latitude and longitude', 400);
    }
    place = toPlace(Number(lat), Number(lng));
  }
  return addAttachment(
    db,
    splitId,
    email,
    params.get('itemId'),
    id,
    () => readImage(req, MAX_PHOTO_BYTES),
    [],
    limit,
    place,
  );
}

/**
 * Adds a photo to the split, or to one of its items: the app's uploads and the agents'
 * (mcp/tools.ts). `read` gives the checked image, and is only called once the split has
 * room and the item is there. `alongside` is saved in the same batch, so it exists
 * exactly when the photo does. A photo sent again under its first id answers with the
 * one saved then. A split holds at most `limit`, counted as the photo is saved, so
 * photos sent at the same moment can't take it past.
 */
export async function addAttachment(
  db: D1Database,
  splitId: string,
  email: string,
  itemId: string | null,
  id: string | null,
  read: () => Promise<Image | Response>,
  alongside: D1PreparedStatement[] = [],
  limit = MAX_PHOTOS_PER_SPLIT,
  place: Place | null = null,
) {
  const [count, item, existing] = await db.batch<{ n?: number; id?: string }>([
    db.prepare('SELECT count(*) AS n FROM attachments WHERE split_id = ?').bind(splitId),
    db.prepare('SELECT id FROM items WHERE id = ? AND split_id = ?').bind(itemId ?? '', splitId),
    attachmentByIdStatement(db, id ?? ''),
  ]);
  const found = existing.results[0] as (AttachmentRow & { splitId: string }) | undefined;
  const again = alreadyUploaded(
    found && { ...toAttachment(found), splitId: found.splitId },
    splitId,
    itemId,
    email,
  );
  if (again) return again;
  if ((count.results[0]?.n ?? 0) >= limit) return full(limit);
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
    place,
  };
  try {
    // Details and bytes are saved together or not at all, and only while the sender is
    // still in the split: the bytes may have taken a while to arrive
    await db.batch([
      memberGuardStatement(db, splitId, email),
      db
        .prepare(
          // Only while the split has room: when it's full nothing is added here, and the
          // bytes below then have no photo to belong to, so the whole batch is refused
          `INSERT INTO attachments
             (id, split_id, item_id, content_type, size, uploaded_by, created_at, place_lat, place_lng)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE (SELECT count(*) FROM attachments WHERE split_id = ?) < ?`,
        )
        .bind(
          attachment.id,
          splitId,
          itemId,
          attachment.contentType,
          attachment.size,
          email,
          attachment.createdAt,
          place?.lat ?? null,
          place?.lng ?? null,
          splitId,
          limit,
        ),
      db
        .prepare('INSERT INTO attachment_data (id, data) VALUES (?, ?)')
        .bind(attachment.id, image.bytes),
      // A new photo is a change to the split, as a new expense is
      touchSplitStatement(db, splitId),
      ...alongside,
    ]);
  } catch (err) {
    // Taken out of the split meanwhile: as for anyone not in it
    if (guardThatFailed(err) === 'member') return notFound();
    if (isConstraintError(err)) {
      // The same photo, sent twice at once: the other request saved it
      if (id != null) {
        const saved = await attachmentById(db, id);
        const again = alreadyUploaded(saved ?? undefined, splitId, itemId, email);
        if (again) return again;
      }
      // Others' photos filled the split between the check above and now
      const now = await db
        .prepare('SELECT count(*) AS n FROM attachments WHERE split_id = ?')
        .bind(splitId)
        .first<{ n: number }>();
      if ((now?.n ?? 0) >= limit) return full(limit);
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

export async function serveAttachment(
  db: D1Database,
  splitId: string,
  id: string,
  viewing: Viewing,
) {
  const row = await readAttachment(db, splitId, id);
  if (row == null) return notFound();
  // A photo never changes once added, so its id names its content
  return imageResponse(viewing, id, row.data, row.contentType);
}

/** One of this split's photos, as listed; null when there's no such photo in it */
export const findAttachment = async (db: D1Database, splitId: string, id: string) => {
  const found = await attachmentById(db, id);
  if (found == null || found.splitId !== splitId) return null;
  const { splitId: _, ...attachment } = found;
  return attachment;
};

/**
 * Puts a photo on another of the split's items, or on the split itself (`itemId` null):
 * the agent's (mcp/tools.ts), by whoever may remove it. `alongside` is saved in the same
 * batch. A photo already where it's asked to go is left as it is.
 */
export async function moveAttachment(
  db: D1Database,
  splitId: string,
  id: string,
  itemId: string | null,
  actor: Actor,
  alongside: D1PreparedStatement[] = [],
) {
  const [photo, item] = await db.batch<{ uploadedBy?: string; id?: string }>([
    db
      .prepare('SELECT uploaded_by AS uploadedBy FROM attachments WHERE id = ? AND split_id = ?')
      .bind(id, splitId),
    db.prepare('SELECT id FROM items WHERE id = ? AND split_id = ?').bind(itemId ?? '', splitId),
  ]);
  const row = photo.results[0];
  if (row == null) return notFound();
  if (!canRemovePhoto(row.uploadedBy!, actor)) {
    return fail('Only the person who added a photo, or the owner, can move it', 403);
  }
  if (itemId != null && item.results.length === 0) {
    return fail('That item no longer exists', 404);
  }
  await db.batch([
    db
      .prepare('UPDATE attachments SET item_id = ? WHERE id = ? AND split_id = ?')
      .bind(itemId, id, splitId),
    touchSplitStatement(db, splitId),
    ...alongside,
  ]);
  return ok();
}

/**
 * Removes photos from the split: all of them, or none when any isn't this person's to
 * remove. Ones already gone are skipped. `alongside` is saved in the same batch.
 */
export async function deleteAttachments(
  db: D1Database,
  splitId: string,
  ids: string[],
  actor: Actor,
  alongside: D1PreparedStatement[] = [],
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
    touchSplitStatement(db, splitId),
    ...alongside,
  ]);
  return ok();
}
