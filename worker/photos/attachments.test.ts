import { describe, expect, test } from 'vitest';
import type { Attachment } from '../../shared/api';
import { uploadAttachment } from './attachments';

// The same photo sent twice at the same moment (a retry while the first is still on its
// way): both find no photo with its id, and the second to save it is refused by the
// database. A local Worker answers one request at a time, so worker/test can't make
// this happen; here the database is stood in for to make it.

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PHOTO_ID = '0123456789abcdef';

const saved: Attachment & { splitId: string } = {
  id: PHOTO_ID,
  splitId: 'trip',
  itemId: null,
  size: JPEG.length,
  contentType: 'image/jpeg',
  uploadedBy: 'ryan@example.com',
  createdAt: 1,
};

/**
 * A database where the photo isn't there when first looked for, saving it fails as
 * another request just saved `meanwhile`, and looking again finds that
 */
function racedDatabase(meanwhile: (Attachment & { splitId: string }) | null) {
  let batches = 0;
  const statement = { bind: () => statement, first: () => Promise.resolve(meanwhile) };
  return {
    prepare: () => statement,
    batch: () => {
      batches++;
      if (batches === 1) {
        // The photo count, the item, and the photo by its id: none yet
        return Promise.resolve([{ results: [{ n: 0 }] }, { results: [] }, { results: [] }]);
      }
      return Promise.reject(
        new Error('D1_ERROR: UNIQUE constraint failed: attachments.id: SQLITE_CONSTRAINT'),
      );
    },
  } as unknown as D1Database;
}

const send = (db: D1Database, email = 'ryan@example.com') =>
  uploadAttachment(
    db,
    'trip',
    email,
    new Request(`https://app.test/api/splits/trip/attachments?id=${PHOTO_ID}`, {
      method: 'POST',
      body: JPEG,
    }),
  );

describe('a photo sent twice at the same moment', () => {
  test('answers with the photo the other request saved', async () => {
    const res = await send(racedDatabase(saved));
    expect(res.status).toBe(200);
    const { splitId: _, ...attachment } = saved;
    expect(await res.json()).toEqual(attachment);
  });

  test("refuses when that id was someone else's photo", async () => {
    const res = await send(racedDatabase(saved), 'ann@example.com');
    expect(res.status).toBe(409);
  });

  test('says the item is gone when that is why it failed', async () => {
    const res = await send(racedDatabase(null));
    expect(res.status).toBe(404);
  });
});
