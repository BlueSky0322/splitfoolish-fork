import { describe, expect, test } from 'vitest';
import type { Person } from '@shared/types';
import { computeTotals } from './derive';
import { byCategory, byPayer, byShare, foldTail, percentOf } from './spending';
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

  test('adds items up by category, largest first, in whole cents', () => {
    expect(byCategory(items)).toEqual([
      { key: 'food', label: 'Food', cents: 10250, count: 2 },
      { key: 'transport', label: 'Transport', cents: 3000, count: 1 },
      { key: 'other', label: 'Other', cents: 750, count: 1 },
    ]);
  });

  test('by who paid, and by whose share it was, leaving out anyone at nothing', () => {
    expect(byPayer(items, [ryan, ann])).toEqual([
      { key: 'r', label: 'Ryan', cents: 11000, count: 3 },
      { key: 'a', label: 'Ann', cents: 3000, count: 1 },
    ]);
    const totals = computeTotals([ryan, ann], items);
    // Ryan: 45 + 15 + 3.75; Ann: 45 + 15 + 12.50 + 3.75
    expect(byShare(items, [ryan, ann], totals)).toEqual([
      { key: 'a', label: 'Ann', cents: 7625, count: 4 },
      { key: 'r', label: 'Ryan', cents: 6375, count: 3 },
    ]);
    expect(byPayer([items[0]], [ryan, ann])).toEqual([
      { key: 'r', label: 'Ryan', cents: 9000, count: 1 },
    ]);
  });

  test('folds the tail into one slice, but never a tail of one', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((key, i) => ({
      key,
      label: key.toUpperCase(),
      cents: 1000 - i * 100,
      count: 1,
    }));
    const folded = foldTail(many);
    expect(folded.map((s) => s.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'rest']);
    expect(folded[5]).toEqual({ key: 'rest', label: 'Everything else', cents: 900, count: 2 });
    expect(foldTail(many.slice(0, 6)).map((s) => s.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(percentOf(900, 4900)).toBe(18);
    expect(percentOf(0, 0)).toBe(0);
  });
});
