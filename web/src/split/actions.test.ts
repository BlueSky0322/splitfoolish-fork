import { produce } from 'immer';
import { describe, expect, test, vi } from 'vitest';
import type { Change, Item, Person } from '@shared/types';
import { makeSplitActions } from './actions';
import type { SplitAction, SplitMeta, SplitState } from './state';
import { splitReducer, toApiItem } from './state';

vi.mock('../utils/notify', () => ({ showRefusal: vi.fn() }));
const { showRefusal } = await import('../utils/notify');

// The actions run against a plain bill: what they show (dispatched to the reducer) and
// what they queue to be saved are both checked

const ryan: Person = { id: 'r', name: 'Ryan', memberEmail: 'ryan@example.com' };
const ann: Person = { id: 'a', name: 'Ann', memberEmail: 'ann@example.com' };
const ben: Person = { id: 'b', name: 'Ben', memberEmail: null };

const item = (over: Partial<Item> = {}): Item => ({
  id: 'i1',
  name: 'Dinner',
  cost: 30,
  payerId: 'r',
  participantIds: ['r', 'b'],
  splitMode: 'equal',
  category: null,
  notes: null,
  original: null,
  createdAt: new Date(2026, 9, 10, 19, 30).getTime(),
  ...over,
});

const meta = {
  members: [
    { email: 'ryan@example.com', role: 'owner', displayName: 'Ryan' },
    { email: 'ann@example.com', role: 'editor', displayName: 'Ann' },
  ],
} as unknown as SplitMeta;

function setup(items: Item[] = [item()]) {
  let state = produce<SplitState>(
    { people: [], items: [] },
    (draft) =>
      void splitReducer(draft, {
        type: 'LOAD_STATE',
        payload: { people: [ryan, ann, ben], items },
      }),
  );
  const queued: Change[] = [];
  const deps = {
    current: () => state,
    meta: () => meta,
    dispatch: (action: SplitAction) => {
      state = produce(state, (draft) => void splitReducer(draft, action));
    },
    queue: (change: Change) => void queued.push(change),
    metaChanges: { removeMember: vi.fn(), setDistributor: vi.fn() },
    reloadAfterSave: vi.fn(),
  };
  return { actions: makeSplitActions(deps), deps, queued, state: () => state };
}

describe('split actions', () => {
  // What shows straight away and what is saved must be the same change; a change queued
  // without being shown (or shown differently) fails these
  test('renaming shows the new name and queues that same name', () => {
    const { actions, queued, state } = setup();
    expect(actions.renamePerson('b', '  Benny ')).toBe(true);
    expect(state().people.find((p) => p.id === 'b')?.name).toBe('Benny');
    expect(state().items[0].participants.map((p) => p.name)).toEqual(['Ryan', 'Benny']);
    expect(queued).toEqual([{ op: 'renamePerson', id: 'b', name: 'Benny' }]);
  });

  test('adding someone shows the person that is queued, with the same id', () => {
    const { actions, queued, state } = setup();
    expect(actions.addPerson(' Cat ')).toBe(true);
    const added = state().people[3];
    expect(added).toMatchObject({ name: 'Cat', memberEmail: null });
    expect(queued).toEqual([{ op: 'addPerson', ...added }]);
  });

  test('linking an account shows the account’s name and queues the link', () => {
    const { actions, queued, state } = setup();
    expect(actions.linkPerson('a', null)).toBe(true);
    expect(actions.linkPerson('b', 'ann@example.com')).toBe(true);
    expect(state().people.map((p) => [p.id, p.name, p.memberEmail])).toEqual([
      ['r', 'Ryan', 'ryan@example.com'],
      ['a', 'Ann', null],
      ['b', 'Ann', 'ann@example.com'],
    ]);
    expect(state().items[0].participants[1]).toEqual(state().people[2]);
    expect(queued).toEqual([
      { op: 'linkPerson', id: 'a', memberEmail: null },
      { op: 'linkPerson', id: 'b', memberEmail: 'ann@example.com' },
    ]);
  });

  test('an added item shows exactly what is queued to be saved', () => {
    const { actions, queued, state } = setup([]);
    const input = {
      name: 'Boat',
      cost: 90,
      payerId: 'b',
      participantIds: ['r', 'a', 'b'],
      splitMode: 'shares' as const,
      shares: { r: 1, a: 1, b: 2 },
      category: 'transport',
      notes: 'Island hop',
      original: null,
    };
    expect(actions.addItem(input, { id: 'new', createdAt: 5 })).toBe(true);
    expect(queued).toEqual([{ op: 'addItem', item: { id: 'new', createdAt: 5, ...input } }]);
    expect(state().items.map(toApiItem)).toEqual([{ id: 'new', createdAt: 5, ...input }]);
  });

  test('an edited item shows exactly what is queued, keeping its date', () => {
    const { actions, queued, state } = setup();
    const {
      id: _,
      createdAt: __,
      ...input
    } = item({
      name: 'Late dinner',
      cost: 45.5,
      splitMode: 'exact',
      exact: { r: 20, b: 25.5 },
    });
    expect(actions.updateItem('i1', input)).toBe(true);
    const change = queued[0];
    expect(change).toMatchObject({
      op: 'updateItem',
      item: { id: 'i1', createdAt: item().createdAt },
    });
    expect(change.op === 'updateItem' && change.item).toEqual(toApiItem(state().items[0]));
    expect(state().items[0]).toMatchObject({
      name: 'Late dinner',
      cost: 45.5,
      exact: { r: 20, b: 25.5 },
    });
  });

  test('an edit to another day moves it first, keeping its time, then saves the edit', () => {
    const { actions, queued, state } = setup();
    const { id: _, createdAt: __, ...input } = item({ name: 'Late dinner' });
    expect(actions.updateItem('i1', input, { day: new Date(2026, 9, 12) })).toBe(true);
    const moved = new Date(2026, 9, 12, 19, 30).getTime();
    // The date goes first, so the server converts the edit on its new day
    expect(queued.map((c) => c.op)).toEqual(['setItemDate', 'updateItem']);
    expect(queued[0]).toEqual({ op: 'setItemDate', id: 'i1', createdAt: moved });
    expect(queued[1]).toMatchObject({ item: { id: 'i1', createdAt: moved } });
    expect(state().items[0]).toMatchObject({ name: 'Late dinner', createdAt: moved });

    // Its own day again: no date change is queued
    queued.length = 0;
    actions.updateItem('i1', input, { day: new Date(2026, 9, 12) });
    expect(queued.map((c) => c.op)).toEqual(['updateItem']);
  });

  test('a removed item is gone from the bill and its removal is queued', () => {
    const { actions, queued, state } = setup([item(), item({ id: 'i2' })]);
    expect(actions.removeItem('i1')).toBe(true);
    expect(state().items.map((i) => i.id)).toEqual(['i2']);
    expect(queued).toEqual([{ op: 'removeItem', id: 'i1' }]);
  });

  test('a name already in the split is refused, and nothing is queued', () => {
    const { actions, queued } = setup();
    expect(actions.addPerson(' Ben ')).toBe(false);
    expect(showRefusal).toHaveBeenCalledWith('Ben is already in this split');
    expect(actions.renamePerson('b', 'Ann')).toBe(false);
    expect(queued).toEqual([]);
  });

  test("someone with an account keeps their account's name", () => {
    const { actions, queued } = setup();
    expect(actions.renamePerson('a', 'Annie')).toBe(false);
    expect(showRefusal).toHaveBeenCalledWith("Ann's name comes from their account");
    expect(actions.renamePerson('b', 'Benny')).toBe(true);
    expect(queued).toEqual([{ op: 'renamePerson', id: 'b', name: 'Benny' }]);
  });

  test('an item removed meanwhile is neither edited nor removed again', () => {
    const { actions, queued } = setup();
    expect(actions.removeItem('gone')).toBe(false);
    expect(actions.updateItem('gone', { ...item(), name: 'Lunch' })).toBe(false);
    expect(showRefusal).toHaveBeenCalledWith('That item has been removed');
    expect(queued).toEqual([]);
  });

  test('removing someone with an account also takes away their access', () => {
    const { actions, deps, queued, state } = setup([]);
    expect(actions.removePerson('a')).toBe(true);
    expect(state().people.map((p) => p.id)).toEqual(['r', 'b']);
    expect(deps.metaChanges.removeMember).toHaveBeenCalledWith('ann@example.com');
    // The share link changes too, which only the server knows
    expect(deps.reloadAfterSave).toHaveBeenCalled();
    expect(queued).toEqual([{ op: 'removePerson', id: 'a', fromItems: false }]);
  });

  test('clearing everyone takes away the access of those with accounts, as one by one', () => {
    const { actions, deps, queued } = setup([]);
    expect(actions.clearPeople()).toBe(true);
    expect(deps.metaChanges.removeMember).toHaveBeenCalledTimes(1);
    expect(deps.metaChanges.removeMember).toHaveBeenCalledWith('ann@example.com');
    expect(deps.reloadAfterSave).toHaveBeenCalledOnce();
    expect(queued).toEqual([{ op: 'clearPeople' }]);
  });

  test('moving items to another day keeps their time, but never later than now', () => {
    const { actions, queued, state } = setup([item(), item({ id: 'i2', createdAt: 1 })]);
    const future = new Date(Date.now() + 7 * 86_400_000);
    expect(actions.moveItemsToDay(['i1'], new Date(2026, 9, 12))).toBe(true);
    expect(new Date(state().items[0].createdAt)).toEqual(new Date(2026, 9, 12, 19, 30));

    actions.moveItemsToDay(['i2'], future);
    expect(state().items[1].createdAt).toBeLessThanOrEqual(Date.now());
    // The dates queued are the ones shown
    expect(queued).toEqual([
      { op: 'setItemDate', id: 'i1', createdAt: state().items[0].createdAt },
      { op: 'setItemDate', id: 'i2', createdAt: state().items[1].createdAt },
    ]);
  });

  test('moving an item paid in another currency keeps its amount and rate, with nothing to reload', () => {
    const { actions, deps, state } = setup([
      item({
        cost: 80,
        original: { currency: 'PHP', amount: 1000, rate: 0.08, rateSource: 'wise' },
      }),
    ]);
    actions.moveItemsToDay(['i1'], new Date(2026, 9, 12));
    expect(state().items[0]).toMatchObject({ cost: 80, original: { rate: 0.08 } });
    expect(deps.reloadAfterSave).not.toHaveBeenCalled();
  });

  test('putting items back on their dates changes only those that moved', () => {
    const { actions, queued, state } = setup([item(), item({ id: 'i2', createdAt: 5 })]);
    const was = state().items[0].createdAt;
    expect(actions.moveItemsToDay(['i1'], new Date(2026, 9, 12))).toBe(true);
    queued.length = 0;
    expect(
      actions.restoreItemDates([
        { id: 'i1', createdAt: was },
        { id: 'i2', createdAt: 5 },
        { id: 'gone', createdAt: 1 },
      ]),
    ).toBe(true);
    expect(state().items.map((i) => i.createdAt)).toEqual([was, 5]);
    expect(queued).toEqual([{ op: 'setItemDate', id: 'i1', createdAt: was }]);
  });

  test('a typed rate converts every item in that currency straight away', () => {
    const { actions, queued, state } = setup([
      item({ cost: 80, original: { currency: 'PHP', amount: 1000, rate: 0.08 } }),
      item({ id: 'i2', cost: 10 }),
    ]);
    expect(actions.setRate('PHP', 0.1)).toBe(true);
    expect(state().items.map((i) => i.cost)).toEqual([100, 10]);
    expect(queued).toEqual([{ op: 'setRate', currency: 'PHP', rate: 0.1 }]);
  });
});
