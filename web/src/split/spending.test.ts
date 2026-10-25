import { describe, expect, test } from 'vitest';
import type { Person } from '@shared/types';
import { computeTotals } from './derive';
import { byCategory, byPayer, byShare, crossCut, foldTail, percentOf } from './spending';
import type { SplitItem } from './state';

const ryan: Person = { id: 'r', name: 'Ryan', memberEmail: 'ryan@example.com' };
const ann: Person = { id: 'a', name: 'Ann', memberEmail: null };
const item = (over: Partial<SplitItem>): SplitItem => ({
  id: 'x',
  name: 'Thing',
  cost: 10,
  payer: ryan,
  participants: [ryan, ann],
  splitMode: 'equal',
  category: null,
  notes: null,
  original: null,
  createdAt: 0,
  ...over,
});

describe('spending', () => {
  const items = [
    item({ id: 'd', cost: 90, category: 'food' }),
    item({ id: 't', cost: 30, category: 'transport', payer: ann }),
    item({ id: 's', cost: 12.5, category: 'food', participants: [ann] }),
    item({ id: 'u', cost: 7.5 }),
  ];

  test('adds items up by category, largest first, each with its items largest first', () => {
    expect(byCategory(items)).toEqual([
      {
        key: 'food',
        label: 'Food',
        cents: 10250,
        parts: [
          { itemId: 'd', cents: 9000 },
          { itemId: 's', cents: 1250 },
        ],
      },
      { key: 'transport', label: 'Transport', cents: 3000, parts: [{ itemId: 't', cents: 3000 }] },
      { key: 'other', label: 'Other', cents: 750, parts: [{ itemId: 'u', cents: 750 }] },
    ]);
  });

  test("by who paid, and by whose share it was, each item's part in cents", () => {
    expect(byPayer(items, [ryan, ann]).map((s) => [s.label, s.cents, s.parts.length])).toEqual([
      ['Ryan', 11000, 3],
      ['Ann', 3000, 1],
    ]);
    const totals = computeTotals([ryan, ann], items);
    // Ryan: 45 + 15 + 3.75; Ann: 45 + 15 + 12.50 + 3.75
    const shares = byShare(items, [ryan, ann], totals);
    expect(shares.map((s) => [s.label, s.cents])).toEqual([
      ['Ann', 7625],
      ['Ryan', 6375],
    ]);
    expect(shares[0].parts).toEqual([
      { itemId: 'd', cents: 4500 },
      { itemId: 't', cents: 1500 },
      { itemId: 's', cents: 1250 },
      { itemId: 'u', cents: 375 },
    ]);
  });

  test('cuts a slice the other way: a category by payer, a person by category', () => {
    const [food] = byCategory(items);
    expect(crossCut(food, 'payer', items)).toEqual([{ key: 'r', label: 'Ryan', cents: 10250 }]);
    const [annShare] = byShare(items, [ryan, ann], computeTotals([ryan, ann], items));
    expect(crossCut(annShare, 'category', items)).toEqual([
      { key: 'food', label: 'Food', cents: 5750 },
      { key: 'transport', label: 'Transport', cents: 1500 },
      { key: 'other', label: 'Other', cents: 375 },
    ]);
  });

  test('folds the tail into one slice with all its items, but never a tail of one', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((key, i) => ({
      key,
      label: key.toUpperCase(),
      cents: 1000 - i * 100,
      parts: [{ itemId: key, cents: 1000 - i * 100 }],
    }));
    const folded = foldTail(many);
    expect(folded.map((s) => s.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'rest']);
    expect(folded[5]).toEqual({
      key: 'rest',
      label: 'Everything else',
      cents: 900,
      parts: [
        { itemId: 'f', cents: 500 },
        { itemId: 'g', cents: 400 },
      ],
    });
    expect(foldTail(many.slice(0, 6)).map((s) => s.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(percentOf(900, 4900)).toBe(18);
    expect(percentOf(0, 0)).toBe(0);
  });
});
