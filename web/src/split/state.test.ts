import { produce } from 'immer';
import { describe, expect, test } from 'vitest';
import type { Item, Person } from '@shared/types';
import type { SplitAction, SplitState } from './state';
import { splitReducer, toApiItem } from './state';

const ann: Person = { id: 'a', name: 'Ann', memberEmail: null };
const ben: Person = { id: 'b', name: 'Ben', memberEmail: null };
const cat: Person = { id: 'c', name: 'Cat', memberEmail: 'cat@example.com' };

const apiItem = (over: Partial<Item> = {}): Item => ({
  id: 'i1',
  name: 'Dinner',
  cost: 30,
  payerId: 'a',
  participantIds: ['a', 'b'],
  splitMode: 'equal',
  category: null,
  notes: null,
  original: null,
  createdAt: 1,
  ...over,
});

const run = (state: SplitState, ...actions: SplitAction[]) =>
  actions.reduce((s, action) => produce(s, (draft) => void splitReducer(draft, action)), state);

const loaded = () =>
  run(
    { people: [], items: [] },
    { type: 'LOAD_STATE', payload: { people: [ann, ben], items: [apiItem()] } },
  );

describe('splitReducer', () => {
  test('loads items with their people as objects', () => {
    const state = loaded();
    expect(state.items[0].payer).toEqual(ann);
    expect(state.items[0].participants).toEqual([ann, ben]);
  });

  test('round-trips an item back to the API shape', () => {
    expect(toApiItem(loaded().items[0])).toEqual(apiItem());
  });

  // Every field an item can carry, so one the conversion forgot shows up as a difference
  test.each<[string, Item]>([
    [
      'split by shares',
      apiItem({
        id: 'i7',
        name: 'Boat trip',
        cost: 123.45,
        payerId: 'c',
        participantIds: ['b', 'c', 'a'],
        splitMode: 'shares',
        shares: { a: 1, b: 3, c: 2 },
        category: 'transport',
        notes: 'Paid at the pier',
        createdAt: Date.UTC(2026, 9, 11, 7, 45),
      }),
    ],
    [
      'split by exact amounts in another currency',
      apiItem({
        id: 'i8',
        name: 'Ramen',
        cost: 30,
        payerId: 'b',
        participantIds: ['a', 'b'],
        splitMode: 'exact',
        exact: { a: 18, b: 12 },
        category: 'food',
        notes: 'Two bowls\nand gyoza',
        createdAt: Date.UTC(2026, 9, 12, 12),
        original: {
          currency: 'JPY',
          amount: 1000,
          exact: { a: 600, b: 400 },
          rate: 0.03,
          rateSource: 'wise',
          rateAt: Date.UTC(2026, 9, 12, 11),
        },
      }),
    ],
    [
      // Saved before rates kept where they came from and when
      'in another currency from before rate sources',
      apiItem({
        id: 'i9',
        payerId: 'b',
        splitMode: 'exact',
        exact: { a: 10.5, b: 19.5 },
        original: { currency: 'SGD', amount: 9, exact: { a: 3.15, b: 5.85 }, rate: 3.3333 },
      }),
    ],
  ])('an item %s loads and comes back unchanged', (_, item) => {
    const state = run(
      { people: [], items: [] },
      { type: 'LOAD_STATE', payload: { people: [ann, ben, cat], items: [item] } },
    );
    const [client] = state.items;
    expect(client.payer).toEqual(item.payerId === 'c' ? cat : ben);
    expect(client.participants.map((p) => p.id)).toEqual(item.participantIds);
    expect(toApiItem(client)).toEqual(item);
  });

  test('renaming a person renames them on the items that refer to them', () => {
    const state = run(loaded(), { type: 'UPDATE_PERSON', payload: { id: 'b', name: 'Benny' } });
    expect(state.people[1].name).toBe('Benny');
    expect(state.items[0].participants[1].name).toBe('Benny');
  });

  test('removing a person takes them off items and out of their shares', () => {
    const shared = run(loaded(), {
      type: 'UPDATE_ITEM',
      payload: apiItem({ splitMode: 'shares', shares: { a: 1, b: 2 } }),
    });
    const state = run(shared, { type: 'REMOVE_PERSON', payload: 'b' });
    expect(state.people).toEqual([ann]);
    expect(state.items[0].participants).toEqual([ann]);
    expect(state.items[0].shares).toEqual({ a: 1 });
  });

  test('adds, updates and removes items', () => {
    let state = run(loaded(), { type: 'ADD_ITEM', payload: apiItem({ id: 'i2', name: 'Taxi' }) });
    expect(state.items.map((i) => i.name)).toEqual(['Dinner', 'Taxi']);
    state = run(state, { type: 'UPDATE_ITEM', payload: apiItem({ id: 'i2', name: 'Train' }) });
    expect(state.items.map((i) => i.name)).toEqual(['Dinner', 'Train']);
    state = run(state, { type: 'REMOVE_ITEM', payload: 'i1' });
    expect(state.items.map((i) => i.id)).toEqual(['i2']);
  });

  test('drops participants that are no longer in the bill', () => {
    const state = run(
      { people: [], items: [] },
      { type: 'LOAD_STATE', payload: { people: [ann], items: [apiItem()] } },
    );
    expect(state.items[0].participants).toEqual([ann]);
  });

  test('leaves out an item whose payer is not in the bill, until it reloads', () => {
    const state = run(
      { people: [], items: [] },
      { type: 'LOAD_STATE', payload: { people: [ben], items: [apiItem()] } },
    );
    expect(state.items).toEqual([]);
  });
});
