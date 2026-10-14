import { ImmerReducer } from 'use-immer';
import type { Item } from '../../../shared/types';
import { AppReducerAction, AppReducerState, IItem, IPerson } from '../../interfaces/app-reducer.ts';

/** An item as the API returns it, referring to people by id */
export type ApiItem = Item;

export const toClientItem = (item: ApiItem, people: IPerson[]): IItem => {
  const byId = new Map(people.map((p) => [p.id, p]));
  return {
    id: item.id,
    name: item.name,
    cost: item.cost,
    payer: byId.get(item.payerId)!,
    participants: item.participantIds.map((id) => byId.get(id)!).filter(Boolean),
    // Copies cached before split modes existed have none
    splitMode: item.splitMode ?? 'equal',
    shares: item.shares,
    exact: item.exact,
    category: item.category ?? null,
    createdAt: item.createdAt ?? 0,
  };
};

export const toApiItem = (item: IItem): ApiItem => ({
  id: item.id,
  name: item.name,
  cost: item.cost,
  payerId: item.payer.id,
  participantIds: item.participants.map((p) => p.id),
  splitMode: item.splitMode,
  shares: item.shares,
  exact: item.exact,
  category: item.category,
  createdAt: item.createdAt,
});

// Every action is a change made on this device, applied straight away and saved after
export const appReducer: ImmerReducer<AppReducerState, AppReducerAction> = (draft, action) => {
  switch (action.type) {
    case 'ADD_PERSON':
      draft.people.push(action.payload as IPerson);
      break;

    case 'UPDATE_PERSON': {
      const { id, ...changes } = action.payload as Partial<IPerson> & { id: string };
      const person = draft.people.find((p) => p.id === id);
      if (person == null) break;
      Object.assign(person, changes);
      // Items hold copies of the person, so they show the change too
      for (const item of draft.items) {
        if (item.payer.id === id) Object.assign(item.payer, changes);
        for (const p of item.participants) if (p.id === id) Object.assign(p, changes);
      }
      break;
    }

    case 'REMOVE_PERSON': {
      const id = action.payload as string;
      draft.people = draft.people.filter((p) => p.id !== id);
      for (const item of draft.items) {
        item.participants = item.participants.filter((p) => p.id !== id);
        if (item.shares) delete item.shares[id];
      }
      break;
    }

    case 'CLEAR_PEOPLE':
      draft.people = [];
      break;

    case 'ADD_ITEM':
      draft.items.push(toClientItem(action.payload, draft.people));
      break;

    case 'UPDATE_ITEM': {
      const updated = toClientItem(action.payload, draft.people);
      draft.items = draft.items.map((i) => (i.id === updated.id ? updated : i));
      break;
    }

    case 'REMOVE_ITEM':
      draft.items = draft.items.filter((i) => i.id !== action.payload);
      break;

    case 'CLEAR_ITEMS':
      draft.items = [];
      break;

    case 'LOAD_STATE': {
      const people: IPerson[] = action.payload.people ?? [];
      draft.people = people;
      draft.items = (action.payload.items ?? []).map((i: ApiItem) => toClientItem(i, people));
      break;
    }

    default:
      throw new Error(`Unsupported action type '${action.type}'`);
  }
};
