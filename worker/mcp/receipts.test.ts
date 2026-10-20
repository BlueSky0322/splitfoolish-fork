import { describe, expect, test } from 'vitest';
import type { SaveResult } from '../bill/changes';
import type { Receipt } from './receipts';
import { saveOnce } from './receipts';

// The same expense request sent twice at the same moment: both find no receipt, both
// check the change, and the database refuses the second one's write because the first
// just saved a receipt under that id. A local Worker answers one request at a time, so
// worker/test can't make this happen; here the database is stood in for to make it.

const mine: Receipt = {
  email: 'ryan@example.com',
  requestId: 'dinner-000001',
  fingerprint: 'abc',
  tool: 'add_expense',
  splitId: 'trip',
  expenseId: '0123456789abcdef',
  savedAt: 2,
};

/** A database where looking the receipt up finds `meanwhile`, saved by the other request */
const lookingUpFinds = (meanwhile: Receipt | null) => {
  const statement = { bind: () => statement, first: () => Promise.resolve(meanwhile) };
  return { prepare: () => statement } as unknown as D1Database;
};

const refusedByDatabase: SaveResult = {
  saved: false,
  status: 409,
  error: 'Someone else changed this split at the same time.',
  constraint: true,
};

describe('an expense request sent twice at the same moment', () => {
  test('answers with what the other request saved, as a repeat', async () => {
    const theirs = { ...mine, expenseId: 'fedcba9876543210', savedAt: 1 };
    const answer = await saveOnce(lookingUpFinds(theirs), mine, () =>
      Promise.resolve(refusedByDatabase),
    );
    expect(answer).toEqual({ receipt: theirs, replayed: true });
  });

  test('is a conflict when the other request was a different change', async () => {
    const theirs = { ...mine, fingerprint: 'other' };
    const answer = await saveOnce(lookingUpFinds(theirs), mine, () =>
      Promise.resolve(refusedByDatabase),
    );
    expect(answer).toEqual({ conflict: theirs });
  });

  test('is refused as it was when no receipt explains the failed write', async () => {
    const answer = await saveOnce(lookingUpFinds(null), mine, () =>
      Promise.resolve(refusedByDatabase),
    );
    expect(answer).toEqual({ refused: refusedByDatabase });
  });
});
