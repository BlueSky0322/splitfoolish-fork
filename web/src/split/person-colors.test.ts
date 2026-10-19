import { describe, expect, test } from 'vitest';
import { PERSON_COLORS, personColors } from './person-colors';

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));

describe('personColors', () => {
  test('gives the first six people six different colours, the four most distinct first', () => {
    const colors = [...personColors('trip', people(6)).values()];
    expect(new Set(colors).size).toBe(PERSON_COLORS);
    expect(new Set(colors.slice(0, 4))).toEqual(new Set([0, 1, 2, 3]));
    expect(colors.slice(4)).toEqual([4, 5]);
  });

  test('is the same for a split every time, and differs between splits', () => {
    expect(personColors('trip', people(4))).toEqual(personColors('trip', people(4)));
    const orders = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) =>
        [...personColors(id, people(4)).values()].join(),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  test('repeats after six people', () => {
    const colors = personColors('trip', people(8));
    expect(colors.get('p6')).toBe(colors.get('p0'));
    expect(colors.get('p7')).toBe(colors.get('p1'));
  });
});
