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
  const db = {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args }) }),
    batch: (statements: unknown[]) => {
      batches.push(statements);
      return Promise.resolve(
        batches.length === 1
          ? [{ results: [split] }, { results: [MYR_TEA] }, { results: [] }]
          : statements.map(() => ({ results: [], meta: { changes: 1 } })),
      );
    },
  };
  return { db: db as unknown as D1Database, batches };
}

const rate = () =>
  vi.fn(() => Promise.resolve({ rate: 0.25, source: 'wise' as const, fetchedAt: 1 }));

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
