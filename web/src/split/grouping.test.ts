import { describe, expect, test } from 'vitest';
import type { SplitItem } from './state';
import type { Person } from '@shared/types';
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
  notes: null,
  original: null,
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

  // Names differing only in case sort as equal, so the one added first comes first,
  // in either direction
  test('names differing only in case keep the order they were added in', () => {
    const same = [
      item('x', 'TAXI', 10, ann, day(12)),
      item('y', 'taxi', 10, ann, day(10)),
      item('z', 'Taxi', 10, ann, day(11)),
    ];
    expect(sortItems(same, 'name', 'asc').map((i) => i.id)).toEqual(['y', 'z', 'x']);
    expect(sortItems(same, 'name', 'desc').map((i) => i.id)).toEqual(['y', 'z', 'x']);
    expect(
      sortItems([...same, item('w', 'Bus', 1, ann, day(13))], 'name', 'desc').map((i) => i.id),
    ).toEqual(['y', 'z', 'x', 'w']);
  });

  test('by payer ignores case, then keeps the order added', () => {
    const bea: Person = { id: 'c', name: 'BEN', memberEmail: null };
    const mixed = [
      item('1', 'One', 1, bea, day(12)),
      item('2', 'Two', 1, ben, day(11)),
      item('3', 'Three', 1, ann, day(13)),
    ];
    expect(sortItems(mixed, 'payer', 'asc').map((i) => i.id)).toEqual(['3', '2', '1']);
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
    // Each day knows where it starts, so an item can be added to it
    expect(groups.map((g) => g.day)).toEqual([day(10, 0), day(11, 0)]);
    expect(groupItems(items, 'payer', 'date', 'asc').every((g) => g.day == null)).toBe(true);
  });

  test('by payer names the group after the payer', () => {
    const groups = groupItems(items, 'payer', 'date', 'asc');
    expect(groups.map((g) => [g.key, g.label, g.items.map((i) => i.id), g.subtotalCents])).toEqual([
      ['a', 'Ann', ['1', '3'], 36850],
      ['b', 'ben', ['2', '4'], 10525],
    ]);
  });

  test('by payer keeps two people with the same name apart', () => {
    const otherAnn: Person = { id: 'a2', name: 'Ann', memberEmail: null };
    const groups = groupItems(
      [...items, item('5', 'Snacks', 7.5, otherAnn, day(12))],
      'payer',
      'date',
      'asc',
    );
    expect(groups.map((g) => [g.key, g.label, g.items.map((i) => i.id)])).toEqual([
      ['a', 'Ann', ['1', '3']],
      ['b', 'ben', ['2', '4']],
      ['a2', 'Ann', ['5']],
    ]);
  });

  test('by category keeps categories apart whatever their spelling', () => {
    const groups = groupItems(
      [
        item('1', 'Bus', 2, ann, day(10), 'transport'),
        item('2', 'Ferry', 3, ann, day(11), 'Transport'),
      ],
      'category',
      'date',
      'asc',
    );
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['transport', 'Transport'],
      ['Transport', 'Transport'],
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
    const groups = groupItems(items, 'none', 'amount', 'desc');
    expect(groups).toHaveLength(1);
    const [all] = groups;
    expect(all).toMatchObject({ key: 'all', label: 'All items' });
    expect(all.items.map((i) => i.id)).toEqual(['1', '3', '2', '4']);
    expect(all.subtotalCents).toBe(47375);
  });
});
