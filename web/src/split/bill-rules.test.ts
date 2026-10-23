import { describe, expect, test } from 'vitest';
import { atRate, removalMessage } from './bill-rules';
import type { SplitItem, SplitState } from './state';
import type { Person } from '@shared/types';

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

const bill = (...items: SplitItem[]): SplitState => ({
  people: [ann, ben, cat],
  items,
  payments: [],
});

describe('removalMessage', () => {
  test('someone who paid for anything stays', () => {
    expect(removalMessage(bill(item({})), 'a', true)).toBe(
      'Ann paid for 1 item. Edit or remove those items first.',
    );
  });

  test('someone who made or received a payment stays', () => {
    const state = {
      ...bill(),
      payments: [{ from: ben, to: cat } as SplitState['payments'][number]],
    };
    expect(removalMessage(state, 'b', true)).toBe(
      'Ben made or received 1 payment. Remove those first.',
    );
    expect(removalMessage(state, 'c', true)).toBe(
      'Cat made or received 1 payment. Remove those first.',
    );
    expect(removalMessage(state, 'a', true)).toBeNull();
  });

  test('someone on items can go from them, but only when asked to', () => {
    expect(removalMessage(bill(item({})), 'b', false)).toBe('Ben is on 1 item.');
    expect(removalMessage(bill(item({})), 'b', true)).toBeNull();
  });

  test("can't leave an item with nobody on it", () => {
    const state = bill(item({ participants: [ben] }));
    expect(removalMessage(state, 'b', true)).toBe(
      'Ben is the only person on an item. Edit or remove it first.',
    );
  });

  test("says which, when it'd leave several items with nobody", () => {
    const state = bill(item({ participants: [ben] }), item({ id: 'j', participants: [ben] }));
    expect(removalMessage(state, 'b', true)).toBe(
      'Ben is the only person on some items. Edit or remove them first.',
    );
  });

  test("can't break an exact split", () => {
    const state = bill(item({ splitMode: 'exact', exact: { a: 10, b: 20 } }));
    expect(removalMessage(state, 'b', true)).toBe(
      'Ben is on an item split by exact amounts. Edit that item first.',
    );
  });

  test('someone on nothing can go', () => {
    expect(removalMessage(bill(item({})), 'c', false)).toBeNull();
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
    // 3.33 and 6.67 PHP at 0.1 are 0.333 and 0.667 MYR: rounded down to 0.33 and 0.66,
    // and the leftover cent goes to the larger remainder, Ben's
    expect(dinner.exact).toEqual({ a: 0.33, b: 0.67 });
    expect(dinner.original?.exact).toEqual({ a: 3.33, b: 6.67 });
  });

  test('converts each exact amount, the leftover cents going by remainder then by id', () => {
    const dinner = atRate(
      item({
        cost: 3,
        participants: [ann, ben, cat],
        splitMode: 'exact',
        exact: { c: 1, b: 1, a: 1 },
        original: {
          currency: 'PHP',
          amount: 10,
          exact: { c: 3.34, b: 3.33, a: 3.33 },
          rate: 0.3,
        },
      }),
      0.25,
    );
    // 10.00 PHP at 0.25 is 2.50. 3.34, 3.33 and 3.33 are 0.835, 0.8325 and 0.8325:
    // 0.83 each is 2.49, and the one leftover cent goes to Cat, whose remainder is largest
    expect(dinner.cost).toBe(2.5);
    expect(dinner.exact).toEqual({ a: 0.83, b: 0.83, c: 0.84 });
  });

  test('breaks an exact tie in the leftover cent by person id', () => {
    const taxi = atRate(
      item({
        cost: 1,
        splitMode: 'exact',
        exact: { b: 0.5, a: 0.5 },
        original: { currency: 'PHP', amount: 0.1, exact: { b: 0.05, a: 0.05 }, rate: 10 },
      }),
      0.5,
    );
    // 0.10 PHP at 0.5 is 0.05: 0.025 each, so 0.02 each and Ann (id a) gets the last cent
    expect(taxi.cost).toBe(0.05);
    expect(taxi.exact).toEqual({ a: 0.03, b: 0.02 });
  });

  test('leaves an item in the split’s own currency as it is', () => {
    const lunch = item({ splitMode: 'exact', exact: { a: 10, b: 20 } });
    expect(atRate(lunch, 2)).toBe(lunch);
  });
});
