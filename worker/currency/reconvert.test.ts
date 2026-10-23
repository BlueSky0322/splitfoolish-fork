import { describe, expect, test, vi } from 'vitest';
import { reconvertSplit } from './reconvert';

// The guards that stop a retry once it has nothing to do: the real converter,
// over a database stand-in that answers the first read and records anything written.

const MYR_TEA = {
  id: 'tea',
  costCents: 1000,
  splitMode: 'equal',
  createdAt: Date.UTC(2026, 9, 10),
  originalCurrency: null,
  originalCents: null,
  rate: null,
  rateSource: null,
  rateAt: null,
};

/** A database whose split reads as `split`, with one item paid in MYR */
function database(split: { currency: string; fromCurrency: string | null; since: number | null }) {
  const batches: unknown[][] = [];
  // Statements run on their own, outside a batch
  const ran: { sql: string; args: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        sql,
        args,
        run: () => {
          ran.push({ sql, args });
          return Promise.resolve({ meta: { changes: 1 } });
        },
      }),
    }),
    batch: (statements: unknown[]) => {
      batches.push(statements);
      return Promise.resolve(
        batches.length === 1
          ? [{ results: [split] }, { results: [MYR_TEA] }, { results: [] }, { results: [] }]
          : statements.map(() => ({ results: [], meta: { changes: 1 } })),
      );
    },
  };
  return { db: db as unknown as D1Database, batches, ran };
}

const rate = (value = 0.25) =>
  vi.fn(() => Promise.resolve({ rate: value, source: 'wise' as const, fetchedAt: 1 }));

describe('retrying a conversion', () => {
  test('does nothing once the conversion has finished', async () => {
    const { db, batches } = database({ currency: 'GBP', fromCurrency: null, since: null });
    const fetchRate = rate();
    // Without a change to match, as opening the split retries: only this guard stops it
    expect(await reconvertSplit(db, 's', fetchRate)).toBe(false);
    expect(fetchRate).not.toHaveBeenCalled();
    // Only the first read: nothing written
    expect(batches).toHaveLength(1);
  });

  test('does nothing while a newer change is still converting', async () => {
    const { db, batches } = database({ currency: 'GBP', fromCurrency: 'MYR', since: 200 });
    const fetchRate = rate();
    expect(await reconvertSplit(db, 's', fetchRate, 100)).toBe(false);
    expect(fetchRate).not.toHaveBeenCalled();
    expect(batches).toHaveLength(1);

    // The newer change's own retry does convert, so the stand-in can tell the two apart
    const newer = database({ currency: 'GBP', fromCurrency: 'MYR', since: 200 });
    expect(await reconvertSplit(newer.db, 's', fetchRate, 200)).toBe(true);
    expect(fetchRate).toHaveBeenCalledWith('MYR', 'GBP', MYR_TEA.createdAt);
    expect(newer.batches).toHaveLength(2);
  });
});

describe('converting an item too large for the new currency', () => {
  test('puts the split back in the old currency, its items untouched', async () => {
    const { db, batches, ran } = database({ currency: 'IDR', fromCurrency: 'MYR', since: 200 });
    // RM 10 at this rate is past the most an item may come to (MAX_ITEM_CENTS)
    expect(await reconvertSplit(db, 's', rate(1e12), 200)).toBe(true);
    // Only the first read: no item written
    expect(batches).toHaveLength(1);
    expect(ran).toHaveLength(1);
    expect(ran[0].sql).toMatch(/SET currency = converting_from, converting_from = NULL/);
    // Only while that conversion is still the one under way
    expect(ran[0].args.slice(1)).toEqual(['s', 'IDR', 200]);
  });
});
