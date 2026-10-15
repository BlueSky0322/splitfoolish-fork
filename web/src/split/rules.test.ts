import { describe, expect, test } from 'vitest';
import { atRate, removalBlocker } from './rules';
import type { SplitItem, SplitState } from './state';
import type { Person } from '../../../shared/types';

// The same cases as the server's tests of these rules (worker/test/api.test.ts), so the
// app's instant answer is the one the server gives once the change is sent

const ann: Person = { id: 'a', name: 'Ann', memberEmail: null };
const ben: Person = { id: 'b', name: 'Ben', memberEmail: null };
const cat: Person = { id: 'c', name: 'Cat', memberEmail: null };

const item = (over: Partial<SplitItem>): SplitItem => ({
  id: 'i',
  name: 'Item',
  cost: 30,
  payer: ann,
  participants: [ann, ben],
  splitMode: 'equal',
  category: null,
  notes: null,
  original: null,
  createdAt: 1,
  ...over,
});

const bill = (...items: SplitItem[]): SplitState => ({ people: [ann, ben, cat], items });

describe('removalBlocker', () => {
  test('someone who paid for anything stays', () => {
    expect(removalBlocker(bill(item({})), 'a', true)).toBe(
      'Ann paid for 1 item. Edit or remove those items first.',
    );
  });

  test('someone on items can go from them, but only when asked to', () => {
    expect(removalBlocker(bill(item({})), 'b', false)).toBe('Ben is on 1 item.');
    expect(removalBlocker(bill(item({})), 'b', true)).toBeNull();
  });

  test("can't leave an item with nobody on it", () => {
    const state = bill(item({ participants: [ben] }));
    expect(removalBlocker(state, 'b', true)).toBe(
      'Ben is the only person on an item. Edit or remove it first.',
    );
  });

  test("says which, when it'd leave several items with nobody", () => {
    const state = bill(item({ participants: [ben] }), item({ id: 'j', participants: [ben] }));
    expect(removalBlocker(state, 'b', true)).toBe(
      'Ben is the only person on some items. Edit or remove them first.',
    );
  });

  test("can't break an exact split", () => {
    const state = bill(item({ splitMode: 'exact', exact: { a: 10, b: 20 } }));
    expect(removalBlocker(state, 'b', true)).toBe(
      'Ben is on an item split by exact amounts. Edit that item first.',
    );
  });

  test('someone on nothing can go', () => {
    expect(removalBlocker(bill(item({})), 'c', false)).toBeNull();
  });
});

describe('atRate', () => {
  // The server's "puts every item in a currency on a typed rate" case: PHP at 0.1 MYR
  test('converts again from what was typed, and marks the rate as typed', () => {
    const taxi = atRate(
      item({ cost: 80, original: { currency: 'PHP', amount: 1000, rate: 0.08 } }),
      0.1,
    );
    expect(taxi.cost).toBe(100);
    expect(taxi.original).toMatchObject({ rate: 0.1, rateSource: 'manual' });
  });

  test('keeps exact amounts adding up to the converted cost', () => {
    const dinner = atRate(
      item({
        cost: 0.8,
        splitMode: 'exact',
        exact: { a: 0.27, b: 0.53 },
        original: { currency: 'PHP', amount: 10, exact: { a: 3.33, b: 6.67 }, rate: 0.08 },
      }),
      0.1,
    );
    expect(dinner.cost).toBe(1);
    expect(Math.round((dinner.exact!.a + dinner.exact!.b) * 100)).toBe(100);
  });
});
