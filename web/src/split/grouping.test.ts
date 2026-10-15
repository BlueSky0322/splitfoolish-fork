import { describe, expect, test } from 'vitest';
import { SplitItem } from './state';
import type { Person } from '../../../shared/types';
import { groupItems, sortItems } from './grouping';

const ann: Person = { id: 'a', name: 'Ann', memberEmail: null };
const ben: Person = { id: 'b', name: 'ben', memberEmail: null };

const day = (d: number, hour = 12) => new Date(2026, 9, d, hour).getTime();

const item = (
  id: string,
  name: string,
  cost: number,
  payer: Person,
  createdAt: number,
  category: string | null = null,
): SplitItem => ({
  id,
  name,
  cost,
  payer,
  participants: [ann, ben],
  splitMode: 'equal',
  category,
  createdAt,
});

const items = [
  item('1', 'Hotel', 248, ann, day(10, 9), 'accommodation'),
  item('2', 'boat', 90, ben, day(10, 15), 'transport'),
  item('3', 'Dinner', 120.5, ann, day(11, 20), 'food'),
  item('4', 'Taxi', 15.25, ben, day(11, 8), 'transport'),
];

describe('sorting items', () => {
  test('by name ignores case', () => {
    expect(sortItems(items, 'name', 'asc').map((i) => i.name)).toEqual([
      'boat',
      'Dinner',
      'Hotel',
      'Taxi',
    ]);
  });

  test('largest first', () => {
    expect(sortItems(items, 'amount', 'desc').map((i) => i.id)).toEqual(['1', '3', '2', '4']);
  });

  test('newest first', () => {
    expect(sortItems(items, 'date', 'desc').map((i) => i.id)).toEqual(['3', '4', '2', '1']);
  });
});

describe('grouping items', () => {
  test('by day puts each day together with its subtotal in cents', () => {
    const groups = groupItems(items, 'day', 'date', 'asc');
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([
      ['1', '2'],
      ['4', '3'],
    ]);
    expect(groups.map((g) => g.subtotalCents)).toEqual([33800, 13575]);
  });

  test('by payer names the group after the payer', () => {
    const groups = groupItems(items, 'payer', 'date', 'asc');
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ['Ann', 2],
      ['ben', 2],
    ]);
  });

  test('by category labels uncategorised items', () => {
    const groups = groupItems(
      [...items, item('5', 'Misc', 1, ann, day(12))],
      'category',
      'date',
      'asc',
    );
    expect(groups.map((g) => g.label)).toEqual([
      'Accommodation',
      'Transport',
      'Food',
      'Uncategorised',
    ]);
  });

  test('no grouping is one group of everything', () => {
    const [all] = groupItems(items, 'none', 'amount', 'desc');
    expect(all.items.map((i) => i.id)).toEqual(['1', '3', '2', '4']);
    expect(all.subtotalCents).toBe(47375);
  });
});
