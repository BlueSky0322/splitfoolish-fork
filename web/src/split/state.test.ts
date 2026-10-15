import { produce } from 'immer';
import { describe, expect, test } from 'vitest';
import type { Item, Person } from '@shared/types';
import type { SplitAction, SplitState } from './state';
import { splitReducer, toApiItem } from './state';

const ann: Person = { id: 'a', name: 'Ann', memberEmail: null };
const ben: Person = { id: 'b', name: 'Ben', memberEmail: null };

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
    expect(toApiItem(loaded().items[0])).toMatchObject(apiItem());
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
