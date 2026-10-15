// The open split's bill on this device: its people and items, changed straight away
// and saved after (see useSplit). Items hold the person objects they refer to; the API
// refers to people by id.

import type { ImmerReducer } from 'use-immer';
import type { Item as ApiItem, Person } from '../../../shared/types';
import type { Attachment, SplitDetail } from '../../../shared/api';

/** Everything about the open split besides its bill: name, members, photos and so on */
export type SplitMeta = Omit<SplitDetail, 'people' | 'items'>;

/** An item with its payer and participants as person objects */
export interface SplitItem extends Omit<ApiItem, 'payerId' | 'participantIds'> {
  payer: Person;
  participants: Person[];
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
  /** Changes some of an item shown here (its date, its amounts at a new rate) */
  | { type: 'PATCH_ITEM'; payload: Pick<SplitItem, 'id'> & Partial<SplitItem> }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'CLEAR_ITEMS'; payload: null }
  | { type: 'LOAD_STATE'; payload: { people: Person[]; items: ApiItem[] } };

/**
 * The item with its people looked up. Null when its payer isn't in the bill, which only
 * a copy out of step with the server can have; it comes back with the next load.
 */
export const toClientItem = (item: ApiItem, people: Person[]): SplitItem | null => {
  const byId = new Map(people.map((p) => [p.id, p]));
  const payer = byId.get(item.payerId);
  if (payer == null) return null;
  return {
    id: item.id,
    name: item.name,
    cost: item.cost,
    payer,
    participants: item.participantIds
      .map((id) => byId.get(id))
      .filter((p): p is Person => p != null),
    splitMode: item.splitMode,
    shares: item.shares,
    exact: item.exact,
    category: item.category,
    notes: item.notes,
    createdAt: item.createdAt,
    original: item.original,
  };
};

const toClientItems = (items: ApiItem[], people: Person[]) =>
  items.map((i) => toClientItem(i, people)).filter((i): i is SplitItem => i != null);

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
  notes: item.notes,
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
      draft.items.push(...toClientItems([action.payload], draft.people));
      break;

    case 'UPDATE_ITEM': {
      const updated = toClientItem(action.payload, draft.people);
      draft.items = draft.items.flatMap((i) =>
        i.id !== action.payload.id ? [i] : updated ? [updated] : [],
      );
      break;
    }

    case 'PATCH_ITEM': {
      const item = draft.items.find((i) => i.id === action.payload.id);
      if (item) Object.assign(item, action.payload);
      break;
    }

    case 'REMOVE_ITEM':
      draft.items = draft.items.filter((i) => i.id !== action.payload);
      break;

    case 'CLEAR_ITEMS':
      draft.items = [];
      break;

    case 'LOAD_STATE': {
      const { people, items } = action.payload;
      draft.people = people;
      draft.items = toClientItems(items, people);
      break;
    }

    default:
      // Unreachable for typed actions; kept for anything dispatched from plain JavaScript
      throw new Error(`Unsupported action type '${(action as { type: string }).type}'`);
  }
};

/**
 * 'refreshing' means a cached copy is showing while the latest loads; 'offline' that
 * there's no connection, with any changes kept on the device until there is
 */
export type SyncStatus =
  | 'loading'
  | 'refreshing'
  | 'saving'
  | 'saved'
  | 'error'
  | 'offline'
  | 'notfound';

/** The ways the split page changes what it shows about the split besides its bill */
export interface MetaChanges {
  addAttachment: (photo: Attachment) => void;
  /** Photos of an item that was deleted (the server removed them with it) */
  forgetItemAttachments: (itemId: string) => void;
  /** Shows saved split settings straight away, here and in My splits */
  patchSettings: (
    changes: Partial<Pick<SplitMeta, 'name' | 'currency' | 'pictureVersion' | 'converting'>>,
  ) => void;
  /** Someone who lost access when their person was removed */
  removeMember: (email: string) => void;
  /** Who everyone settles up through, or null for the fewest transfers */
  setDistributor: (personId: string | null) => void;
  /**
   * Shows a change to the split's settings, sharing or photos straight away, here and in
   * My splits, and sends it. `request` may answer with what the server changed besides.
   * If it fails, that's explained and both are fetched again, showing what the server has.
   */
  changeMeta: (
    show: (meta: SplitMeta) => SplitMeta,
    request: () => Promise<((meta: SplitMeta) => SplitMeta) | void>,
    failure?: string,
  ) => void;
}
