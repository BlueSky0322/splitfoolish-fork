import { produce } from 'immer';
import { describe, expect, test, vi } from 'vitest';
import type { Change, Item, Person } from '@shared/types';
import { makeSplitActions } from './actions';
import type { SplitAction, SplitMeta, SplitState } from './state';
import { splitReducer } from './state';

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
    expect(queued.map((c) => c.op)).toEqual(['setItemDate', 'setItemDate']);
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
