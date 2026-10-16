// Pictures: profile pictures and payment QR codes, seen by their owner and the people
// they share a split with (sharesSplit, in splits/sharing.ts), and split pictures,
// seen by the split's members.

import {
  type AvatarResult,
  MAX_AVATAR_BYTES,
  MAX_QR_BYTES,
  type PaymentQrResult,
  type SplitPictureResult,
} from '../../shared/api';
import { ensureProfileStatement, paymentMethodOwner } from '../accounts/profiles';
import { json, notFound, ok } from '../http';
import { sharesSplit } from '../splits/sharing';
import { imageResponse, readImage } from './images';

export async function putAvatar(db: D1Database, email: string, req: Request) {
  const image = await readImage(req, MAX_AVATAR_BYTES);
  if (image instanceof Response) return image;

  const version = Date.now();
  await db.batch([
    ensureProfileStatement(db, email),
    db
      .prepare(
        `INSERT INTO avatars (email, content_type, version, data) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (email) DO UPDATE SET content_type = ?2, version = ?3, data = ?4`,
      )
      .bind(email, image.contentType, version, image.bytes),
  ]);
  return json<AvatarResult>({ avatarVersion: version });
}

/**
 * Stores the QR code for one of your payment methods. Sent before the method itself
 * is saved (so a new method's id may not exist yet); an id that's someone else's gets
 * the same 404 as their code would, so ids can't be probed.
 */
export async function putPaymentQr(db: D1Database, id: string, email: string, req: Request) {
  const owner = await paymentMethodOwner(db, id);
  if (owner != null && owner !== email) return notFound();
  const image = await readImage(req, MAX_QR_BYTES);
  if (image instanceof Response) return image;

  const version = Date.now();
  await db.batch([
    ensureProfileStatement(db, email),
    db
      .prepare(
        `INSERT INTO payment_qr_codes (method_id, email, content_type, version, data)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (method_id) DO UPDATE SET content_type = ?3, version = ?4, data = ?5`,
      )
      .bind(id, email, image.contentType, version, image.bytes),
  ]);
  return json<PaymentQrResult>({ qrVersion: version });
}

/** A payment method's QR code, seen by its owner and the people they share a split with */
export async function servePaymentQr(db: D1Database, id: string, viewer: string) {
  const row = await db
    .prepare(
      'SELECT email, content_type AS contentType, data FROM payment_qr_codes WHERE method_id = ?',
    )
    .bind(id)
    .first<{ email: string; contentType: string; data: ArrayBuffer | number[] }>();
  if (row == null || !(await sharesSplit(db, viewer, row.email))) {
    return notFound();
  }
  return imageResponse(row.data, row.contentType);
}

export async function deleteAvatar(db: D1Database, email: string) {
  await db.prepare('DELETE FROM avatars WHERE email = ?').bind(email).run();
  return ok();
}

/** Profile pictures are visible to their owner and to people they share a split with */
export async function serveAvatar(db: D1Database, email: string, viewer: string) {
  if (!(await sharesSplit(db, viewer, email))) return notFound();
  const row = await db
    .prepare('SELECT content_type AS contentType, data FROM avatars WHERE email = ?')
    .bind(email)
    .first<{ contentType: string; data: ArrayBuffer | number[] }>();
  if (row == null) return notFound();
  return imageResponse(row.data, row.contentType);
}

/** A split's picture; set and removed by its owner, seen by its members */
export async function putSplitPicture(db: D1Database, splitId: string, req: Request) {
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
  return json<SplitPictureResult>({ pictureVersion: version });
}

export async function deleteSplitPicture(db: D1Database, splitId: string) {
  await db.prepare('DELETE FROM split_pictures WHERE split_id = ?').bind(splitId).run();
  return ok();
}

export async function serveSplitPicture(db: D1Database, splitId: string) {
  const row = await db
    .prepare('SELECT content_type AS contentType, data FROM split_pictures WHERE split_id = ?')
    .bind(splitId)
    .first<{ contentType: string; data: ArrayBuffer | number[] }>();
  if (row == null) return notFound();
  return imageResponse(row.data, row.contentType);
}
