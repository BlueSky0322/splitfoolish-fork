import { describe, expect, test } from 'vitest';
import { IItem, IPerson } from '../interfaces/app-reducer';
import { findMe, summarise } from './derive';

const ann: IPerson = { id: 'a', name: 'Ann', memberEmail: 'ann@example.com' };
const ben: IPerson = { id: 'b', name: 'Ben' };
const cat: IPerson = { id: 'c', name: 'Cat' };

const base = { category: null, createdAt: 1 };

describe('summarising a split', () => {
  test('mixes equal, shares and exact items in cents', () => {
    const items: IItem[] = [
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
    const s = summarise([ann, ben, cat], items);
    expect(s.totalCents).toBe(4550);
    expect(s.sharesByItem.get('1')?.get('a')).toBe(334);
    expect(s.sharesByItem.get('2')?.get('c')).toBe(2000);
    expect(s.sharesByItem.get('3')?.get('b')).toBe(225);
    // Ann paid 10.00, owes 3.34 + 10.00
    expect(s.balances.get('a')?.balanceCents).toBe(1000 - 334 - 1000);
    expect([...s.balances.values()].reduce((sum, b) => sum + b.balanceCents, 0)).toBe(0);
    expect(s.transfers.reduce((sum, t) => sum + t.amountCents, 0)).toBeGreaterThan(0);
  });

  test('routes everything through the chosen person', () => {
    const items: IItem[] = [
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
    const s = summarise([ann, ben, cat], items, 'b');
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
