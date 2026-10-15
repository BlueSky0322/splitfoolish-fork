// The open split's bill on this device: its people and items, changed straight away
// and saved after (see useSplit). Items hold the person objects they refer to; the API
// refers to people by id.

import { ImmerReducer } from 'use-immer';
import type { SplitMode } from '../../../shared/settle';
import type { Item as ApiItem, ItemOriginal, Person } from '../../../shared/types';

export type { Person };

/** An item with its payer and participants as person objects */
export interface SplitItem {
  id: string;
  name: string;
  /** In currency units */
  cost: number;
  payer: Person;
  participants: Person[];
  splitMode: SplitMode;
  /** Shares per person id, when split by shares */
  shares?: Record<string, number>;
  /** Amount per person id in currency units, when split by exact amounts */
  exact?: Record<string, number>;
  category: string | null;
  notes?: string | null;
  createdAt: number;
  /** Entered in another currency: what was typed and the rate it was converted at */
  original?: ItemOriginal | null;
}

export interface SplitState {
  people: Person[];
  items: SplitItem[];
}

// Every action is a change made on this device. Items arrive as the API shapes them.
export type SplitAction =
  | { type: 'ADD_PERSON'; payload: Person }
  | { type: 'UPDATE_PERSON'; payload: Partial<Person> & { id: string } }
  | { type: 'REMOVE_PERSON'; payload: string }
  | { type: 'CLEAR_PEOPLE'; payload: null }
  | { type: 'ADD_ITEM'; payload: ApiItem }
  | { type: 'UPDATE_ITEM'; payload: ApiItem }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'CLEAR_ITEMS'; payload: null }
  | { type: 'LOAD_STATE'; payload: { people?: Person[]; items?: ApiItem[] } };

export const toClientItem = (item: ApiItem, people: Person[]): SplitItem => {
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
    notes: item.notes ?? null,
    createdAt: item.createdAt ?? 0,
    original: item.original ?? null,
  };
};

export const toApiItem = (item: SplitItem): ApiItem => ({
  id: item.id,
  name: item.name,
  cost: item.cost,
  payerId: item.payer.id,
  participantIds: item.participants.map((p) => p.id),
  splitMode: item.splitMode,
  shares: item.shares,
  exact: item.exact,
  category: item.category,
  notes: item.notes ?? null,
  createdAt: item.createdAt,
  original: item.original,
});

export const splitReducer: ImmerReducer<SplitState, SplitAction> = (draft, action) => {
  switch (action.type) {
    case 'ADD_PERSON':
      draft.people.push(action.payload);
      break;

    case 'UPDATE_PERSON': {
      const { id, ...changes } = action.payload;
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
      const id = action.payload;
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
      const people = action.payload.people ?? [];
      draft.people = people;
      draft.items = (action.payload.items ?? []).map((i) => toClientItem(i, people));
      break;
    }

    default:
      // Unreachable for typed actions; kept for anything dispatched from plain JavaScript
      throw new Error(`Unsupported action type '${(action as { type: string }).type}'`);
  }
};
