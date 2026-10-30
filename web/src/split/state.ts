// The open split's bill on this device: its people, items and payments, changed
// straight away and saved after (see useSplit). Items and payments hold the person
// objects they refer to; the API refers to people by id.

import type { ImmerReducer } from 'use-immer';
import type { Item as ApiItem, Payment, Person } from '@shared/types';
import type { Attachment, SplitDetail } from '@shared/api';

/** Everything about the open split besides its bill: name, members, photos and so on */
export type SplitMeta = Omit<SplitDetail, 'people' | 'items' | 'payments'>;

/** An item with its payer and participants as person objects */
export interface SplitItem extends Omit<ApiItem, 'payerId' | 'participantIds'> {
  payer: Person;
  participants: Person[];
}

/** A payment with who paid and who was paid as person objects */
export interface SplitPayment extends Omit<Payment, 'fromId' | 'toId'> {
  from: Person;
  to: Person;
}

export interface SplitState {
  people: Person[];
  items: SplitItem[];
  payments: SplitPayment[];
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
  | { type: 'ADD_PAYMENT'; payload: Payment }
  | { type: 'UPDATE_PAYMENT'; payload: Payment }
  | { type: 'REMOVE_PAYMENT'; payload: string }
  | {
      type: 'LOAD_STATE';
      payload: { people: Person[]; items: ApiItem[]; payments: Payment[] };
    };

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
    place: item.place,
  };
};

const toClientItems = (items: ApiItem[], people: Person[]) =>
  items.map((i) => toClientItem(i, people)).filter((i): i is SplitItem => i != null);

/**
 * The payment with its people looked up. Null when either isn't in the bill, which only
 * a copy out of step with the server can have; it comes back with the next load.
 */
export const toClientPayment = (payment: Payment, people: Person[]): SplitPayment | null => {
  const from = people.find((p) => p.id === payment.fromId);
  const to = people.find((p) => p.id === payment.toId);
  if (from == null || to == null) return null;
  const { fromId: _from, toId: _to, ...rest } = payment;
  return { ...rest, from, to };
};

const toClientPayments = (payments: Payment[], people: Person[]) =>
  payments.map((p) => toClientPayment(p, people)).filter((p): p is SplitPayment => p != null);

export const toApiPayment = ({ from, to, ...rest }: SplitPayment): Payment => ({
  ...rest,
  fromId: from.id,
  toId: to.id,
});

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
  place: item.place,
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
      // Items and payments hold copies of the person, so they show the change too
      for (const item of draft.items) {
        if (item.payer.id === id) Object.assign(item.payer, changes);
        for (const p of item.participants) if (p.id === id) Object.assign(p, changes);
      }
      for (const payment of draft.payments) {
        if (payment.from.id === id) Object.assign(payment.from, changes);
        if (payment.to.id === id) Object.assign(payment.to, changes);
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
      // The rules keep someone with payments; a copy out of step is put right by the next load
      draft.payments = draft.payments.filter((p) => p.from.id !== id && p.to.id !== id);
      break;
    }

    case 'CLEAR_PEOPLE':
      draft.people = [];
      draft.payments = [];
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
      // A payment that settled it stays, no longer tied to it, as on the server
      for (const p of draft.payments) if (p.itemId === action.payload) p.itemId = null;
      break;

    case 'CLEAR_ITEMS':
      draft.items = [];
      for (const p of draft.payments) p.itemId = null;
      break;

    case 'ADD_PAYMENT':
      draft.payments.push(...toClientPayments([action.payload], draft.people));
      break;

    case 'UPDATE_PAYMENT': {
      const updated = toClientPayment(action.payload, draft.people);
      draft.payments = draft.payments.flatMap((p) =>
        p.id !== action.payload.id ? [p] : updated ? [updated] : [],
      );
      break;
    }

    case 'REMOVE_PAYMENT':
      draft.payments = draft.payments.filter((p) => p.id !== action.payload);
      break;

    case 'LOAD_STATE': {
      const { people, items, payments } = action.payload;
      draft.people = people;
      draft.items = toClientItems(items, people);
      draft.payments = toClientPayments(payments, people);
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
