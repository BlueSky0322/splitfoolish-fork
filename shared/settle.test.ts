import { describe, expect, test } from 'vitest';
import type { Balance, SettleItem, Transfer } from './settle';
import { balances, itemShares, transfers } from './settle';

const equal = (costCents: number, payerId: string, ids: string[]): SettleItem => ({
  costCents,
  payerId,
  splitMode: 'equal',
  participants: ids.map((personId) => ({ personId, shares: 1, exactCents: null })),
});

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

const byShares = (costCents: number, shares: Record<string, number>): SettleItem => ({
  costCents,
  payerId: Object.keys(shares)[0],
  splitMode: 'shares',
  participants: Object.entries(shares).map(([personId, n]) => ({
    personId,
    shares: n,
    exactCents: null,
  })),
});

/** Balances with these amounts, as paid minus share */
const owed = (amounts: Record<string, number>): Map<string, Balance> =>
  new Map(
    Object.entries(amounts).map(([id, cents]) => [
      id,
      { paidCents: Math.max(cents, 0), shareCents: Math.max(-cents, 0), balanceCents: cents },
    ]),
  );

/**
 * Pays every transfer and returns what each person is still owed (or owes) afterwards,
 * checking each payment is a real one: a positive amount between two different people
 */
const afterPaying = (all: Map<string, Balance>, paid: Transfer[]) => {
  const left = new Map([...all].map(([id, b]) => [id, b.balanceCents]));
  for (const t of paid) {
    expect(Number.isInteger(t.amountCents)).toBe(true);
    expect(t.amountCents).toBeGreaterThan(0);
    expect(t.fromId).not.toBe(t.toId);
    expect(left.has(t.fromId) && left.has(t.toId)).toBe(true);
    left.set(t.fromId, left.get(t.fromId)! + t.amountCents);
    left.set(t.toId, left.get(t.toId)! - t.amountCents);
  }
  return Object.fromEntries(left);
};

const allZero = (all: Map<string, Balance>) =>
  Object.fromEntries([...all.keys()].map((id) => [id, 0]));

describe('itemShares', () => {
  test.each([
    [1000, 3],
    [1, 3],
    [10001, 7],
    [99999, 4],
  ])('equal split of %i cents among %i people adds up to the cost', (cost, n) => {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const shares = itemShares(equal(cost, 'p0', ids));
    expect(sum(shares)).toBe(cost);
    const values = [...shares.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
  });

  test('RM 10 three ways is 3.34 + 3.33 + 3.33', () => {
    expect([...itemShares(equal(1000, 'a', ['a', 'b', 'c'])).values()]).toEqual([334, 333, 333]);
  });

  test('the leftover cent does not depend on the order participants are listed', () => {
    const shares = itemShares(equal(1000, 'a', ['c', 'b', 'a']));
    expect(shares.get('a')).toBe(334);
    expect(shares.get('c')).toBe(333);
  });

  test('by shares is proportional and adds up to the cost', () => {
    const shares = itemShares(byShares(1000, { a: 2, b: 1 }));
    expect(shares.get('a')).toBe(667);
    expect(shares.get('b')).toBe(333);
  });

  // 100 cents at 1:2 is 33.33 and 66.67; the leftover cent goes to the larger remainder
  test('by shares gives the leftover cent to the largest remainder, whatever the order', () => {
    expect(Object.fromEntries(itemShares(byShares(100, { a: 1, b: 2 })))).toEqual({
      a: 33,
      b: 67,
    });
    expect(Object.fromEntries(itemShares(byShares(100, { b: 2, a: 1 })))).toEqual({
      a: 33,
      b: 67,
    });
  });

  // 100 cents at 1:1:1:1 is 25 each; at 1:1:1 it is 33.33 each, an exact tie, so the
  // one leftover cent goes to the lowest person id however the list is ordered
  test('equal remainders give the leftover cents to the lowest person ids', () => {
    for (const order of [
      { a: 1, b: 1, c: 1 },
      { c: 1, b: 1, a: 1 },
      { b: 1, c: 1, a: 1 },
    ]) {
      const shares = itemShares(byShares(100, order));
      expect(Object.fromEntries(shares)).toEqual({ a: 34, b: 33, c: 33 });
    }
    // 200 cents three ways is 66.67 each: two leftover cents, to a and b
    expect(Object.fromEntries(itemShares(byShares(200, { c: 1, b: 1, a: 1 })))).toEqual({
      a: 67,
      b: 67,
      c: 66,
    });
  });

  test('someone with no shares owes nothing, and the rest still add up', () => {
    expect(Object.fromEntries(itemShares(byShares(1001, { a: 0, b: 3, c: 4 })))).toEqual({
      a: 0,
      b: 429,
      c: 572,
    });
  });

  test('exact amounts are used as given', () => {
    const shares = itemShares({
      costCents: 1000,
      payerId: 'a',
      splitMode: 'exact',
      participants: [
        { personId: 'a', shares: 1, exactCents: 250 },
        { personId: 'b', shares: 1, exactCents: 750 },
      ],
    });
    expect(Object.fromEntries(shares)).toEqual({ a: 250, b: 750 });
  });
});

describe('balances and transfers', () => {
  const people = ['ann', 'ben', 'cat', 'dee'];
  const items = [
    equal(24800, 'ann', people),
    equal(9000, 'ben', ['ann', 'ben', 'cat']),
    equal(3333, 'cat', ['cat', 'dee']),
    equal(1, 'dee', people),
  ];

  test('balances are paid minus share and net to zero', () => {
    const all = balances(people, items);
    // Ann's share includes the leftover cent of the 1-cent item, the lowest person id
    expect(all.get('ann')).toEqual({
      paidCents: 24800,
      shareCents: 6200 + 3000 + 1,
      balanceCents: 15599,
    });
    expect([...all.values()].reduce((a, b) => a + b.balanceCents, 0)).toBe(0);
  });

  test('transfers clear every balance in at most one fewer payment than people', () => {
    const all = balances(people, items);
    const result = transfers(all);
    expect(result.length).toBeLessThanOrEqual(people.length - 1);
    expect(afterPaying(all, result)).toEqual(allZero(all));
  });

  test('with a distributor, everyone settles with that person only', () => {
    const all = balances(people, items);
    const result = transfers(all, 'ben');
    expect(result.every((t) => t.fromId === 'ben' || t.toId === 'ben')).toBe(true);
    expect(result).toHaveLength(people.length - 1);
    expect(afterPaying(all, result)).toEqual(allZero(all));
  });

  // Ann and Ben are owed, Cat, Dee and Eve owe. The largest debt goes to the largest
  // credit each time: Eve pays Ann 70 (Ann is still owed 10), Cat pays Ben 50, and Dee
  // pays Ann the last 10. Paying them all leaves nobody owed or owing anything.
  test('several creditors and debtors are all cleared exactly', () => {
    const all = owed({ ann: 80, ben: 50, cat: -50, dee: -10, eve: -70 });
    const result = transfers(all);
    expect(result).toEqual([
      { fromId: 'eve', toId: 'ann', amountCents: 70 },
      { fromId: 'cat', toId: 'ben', amountCents: 50 },
      { fromId: 'dee', toId: 'ann', amountCents: 10 },
    ]);
    expect(afterPaying(all, result)).toEqual(allZero(all));
  });

  test.each([
    { ann: 100, ben: 100, cat: -50, dee: -50, eve: -50, fay: -50 },
    { ann: 333, ben: 1, cat: 666, dee: -400, eve: -400, fay: -200 },
    { ann: 7, ben: 13, cat: 29, dee: -17, eve: -19, fay: -13 },
  ])('every balance ends at exactly zero for %o', (amounts) => {
    const all = owed(amounts);
    const result = transfers(all);
    expect(afterPaying(all, result)).toEqual(allZero(all));
    expect(result.length).toBeLessThanOrEqual(all.size - 1);
    // Nobody both pays and is paid
    const payers = new Set(result.map((t) => t.fromId));
    expect(result.some((t) => payers.has(t.toId))).toBe(false);
  });

  test('a bill with several payers and several debtors settles exactly', () => {
    const people = ['ann', 'ben', 'cat', 'dee', 'eve'];
    const all = balances(people, [
      equal(10000, 'ann', people),
      equal(4500, 'ben', ['ben', 'cat', 'dee']),
      byShares(999, { eve: 1, cat: 2 }),
    ]);
    // Ann 10000 - 2000, Ben 4500 - 2000 - 1500, Cat 0 - 2000 - 1500 - 666,
    // Dee 0 - 2000 - 1500, Eve 999 - 2000 - 333
    expect(Object.fromEntries([...all].map(([id, b]) => [id, b.balanceCents]))).toEqual({
      ann: 8000,
      ben: 1000,
      cat: -4166,
      dee: -3500,
      eve: -1334,
    });
    expect(afterPaying(all, transfers(all))).toEqual(allZero(all));
  });

  test('a settled split needs no transfers', () => {
    expect(transfers(balances(['a', 'b'], [equal(1000, 'a', ['a'])]))).toEqual([]);
  });
});
