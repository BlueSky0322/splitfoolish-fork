import { describe, expect, test } from 'vitest';
import type { SplitItem } from './state';
import type { Person } from '@shared/types';
import { findMe, computeTotals } from './derive';

const ann: Person = { id: 'a', name: 'Ann', memberEmail: 'ann@example.com' };
const ben: Person = { id: 'b', name: 'Ben', memberEmail: null };
const cat: Person = { id: 'c', name: 'Cat', memberEmail: null };

const base = { category: null, notes: null, original: null, createdAt: 1 };

describe('summarising a split', () => {
  test('mixes equal, shares and exact items in cents', () => {
    const items: SplitItem[] = [
      {
        ...base,
        id: '1',
        name: 'Hotel',
        cost: 10,
        payer: ann,
        participants: [ann, ben, cat],
        splitMode: 'equal',
      },
      {
        ...base,
        id: '2',
        name: 'Boat',
        cost: 30,
        payer: ben,
        participants: [ann, cat],
        splitMode: 'shares',
        shares: { a: 1, c: 2 },
      },
      {
        ...base,
        id: '3',
        name: 'Snacks',
        cost: 5.5,
        payer: cat,
        participants: [ben, cat],
        splitMode: 'exact',
        exact: { b: 2.25, c: 3.25 },
      },
    ];
    const s = computeTotals([ann, ben, cat], items);
    expect(s.totalCents).toBe(4550);
    // Ann paid 10.00, owes 3.34 + 10.00
    expect(s.hasItems).toBe(true);
    expect(Object.fromEntries(s.sharesByItem.get('1')!)).toEqual({ a: 334, b: 333, c: 333 });
    expect(Object.fromEntries(s.sharesByItem.get('2')!)).toEqual({ a: 1000, c: 2000 });
    expect(Object.fromEntries(s.sharesByItem.get('3')!)).toEqual({ b: 225, c: 325 });
    // Ann paid 10.00 and owes 3.34 + 10.00; Ben paid 30.00 and owes 3.33 + 2.25;
    // Cat paid 5.50 and owes 3.33 + 20.00 + 3.25
    expect(Object.fromEntries(s.balances)).toEqual({
      a: { paidCents: 1000, shareCents: 1334, sentCents: 0, receivedCents: 0, balanceCents: -334 },
      b: { paidCents: 3000, shareCents: 558, sentCents: 0, receivedCents: 0, balanceCents: 2442 },
      c: { paidCents: 550, shareCents: 2658, sentCents: 0, receivedCents: 0, balanceCents: -2108 },
    });
    // Ben is the only one owed: Cat, who owes most, pays first
    expect(s.transfers).toEqual([
      { fromId: 'c', toId: 'b', amountCents: 2108 },
      { fromId: 'a', toId: 'b', amountCents: 334 },
    ]);
  });

  test('a split with people but no items has nothing to settle yet', () => {
    const s = computeTotals([ann, ben, cat], []);
    expect(s.hasItems).toBe(false);
    expect(s.totalCents).toBe(0);
    expect(s.transfers).toEqual([]);
    expect(s.sharesByItem.size).toBe(0);
    expect(Object.fromEntries(s.balances)).toEqual({
      a: { paidCents: 0, shareCents: 0, sentCents: 0, receivedCents: 0, balanceCents: 0 },
      b: { paidCents: 0, shareCents: 0, sentCents: 0, receivedCents: 0, balanceCents: 0 },
      c: { paidCents: 0, shareCents: 0, sentCents: 0, receivedCents: 0, balanceCents: 0 },
    });
  });

  test('a split whose items cancel out has items but nothing to settle', () => {
    const items: SplitItem[] = [
      {
        ...base,
        id: '1',
        name: 'Taxi',
        cost: 12,
        payer: ann,
        participants: [ann, ben],
        splitMode: 'equal',
      },
      {
        ...base,
        id: '2',
        name: 'Bus',
        cost: 12,
        payer: ben,
        participants: [ann, ben],
        splitMode: 'equal',
      },
    ];
    const s = computeTotals([ann, ben], items);
    expect(s.hasItems).toBe(true);
    expect(s.totalCents).toBe(2400);
    expect(s.transfers).toEqual([]);
  });

  test('routes everything through the chosen person', () => {
    const items: SplitItem[] = [
      {
        ...base,
        id: '1',
        name: 'Hotel',
        cost: 9,
        payer: ann,
        participants: [ann, ben, cat],
        splitMode: 'equal',
      },
    ];
    const s = computeTotals([ann, ben, cat], items, 'b');
    expect(s.transfers).toEqual([
      { fromId: 'b', toId: 'a', amountCents: 600 },
      { fromId: 'c', toId: 'b', amountCents: 300 },
    ]);
  });

  test('finds the person linked to this account', () => {
    expect(findMe([ann, ben], 'ann@example.com')).toBe(ann);
    expect(findMe([ann, ben], 'nobody@example.com')).toBeNull();
    expect(findMe([ann, ben], null)).toBeNull();
  });
});
