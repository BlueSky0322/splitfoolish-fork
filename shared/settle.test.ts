import { describe, expect, test } from 'vitest';
import type { SettleItem } from './settle';
import { balances, itemShares, transfers } from './settle';

const equal = (costCents: number, payerId: string, ids: string[]): SettleItem => ({
  costCents,
  payerId,
  splitMode: 'equal',
  participants: ids.map((personId) => ({ personId, shares: 1, exactCents: null })),
});

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

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
    const shares = itemShares({
      costCents: 1000,
      payerId: 'a',
      splitMode: 'shares',
      participants: [
        { personId: 'a', shares: 2, exactCents: null },
        { personId: 'b', shares: 1, exactCents: null },
      ],
    });
    expect(shares.get('a')).toBe(667);
    expect(shares.get('b')).toBe(333);
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
    const after = new Map([...all].map(([id, b]) => [id, b.balanceCents]));
    for (const t of result) {
      expect(t.amountCents).toBeGreaterThan(0);
      after.set(t.fromId, after.get(t.fromId)! + t.amountCents);
      after.set(t.toId, after.get(t.toId)! - t.amountCents);
    }
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });

  test('with a distributor, everyone settles with that person only', () => {
    const all = balances(people, items);
    const result = transfers(all, 'ben');
    expect(result.every((t) => t.fromId === 'ben' || t.toId === 'ben')).toBe(true);
    expect(result.some((t) => t.fromId === t.toId)).toBe(false);
    expect(result).toHaveLength(people.length - 1);
    const after = new Map([...all].map(([id, b]) => [id, b.balanceCents]));
    for (const t of result) {
      after.set(t.fromId, after.get(t.fromId)! + t.amountCents);
      after.set(t.toId, after.get(t.toId)! - t.amountCents);
    }
    expect([...after.values()].every((v) => v === 0)).toBe(true);
  });

  test('a settled split needs no transfers', () => {
    expect(transfers(balances(['a', 'b'], [equal(1000, 'a', ['a'])]))).toEqual([]);
  });
});
