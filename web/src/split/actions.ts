import type { Dispatch } from 'react';
import type { ItemInput, PaymentInput } from '../api';
import type { Item as ApiItem, Change, Payment } from '@shared/types';
import { toCents } from '@shared/rates';
import { showRefusal } from '../utils/notify';
import { newId } from '../utils/id';
import { atRate, removalMessage } from './bill-rules';
import { type SplitMeta } from './state';
import type { MetaChanges, SplitAction, SplitState } from './state';
import { keepTimeOf } from '../utils/date-input';

// What can be done to an open split: each checks the change, shows it straight away
// and queues it to be saved (see useSplit, which does the saving)

/**
 * Each returns true when the change was made and queued, false when it wasn't: a change
 * that isn't allowed is explained with a notification, while one that would do nothing
 * (an empty name, an unknown person) is just ignored
 */
export interface SplitActions {
  addPerson: (name: string, memberEmail?: string) => boolean;
  renamePerson: (personId: string, name: string) => boolean;
  /** "This is me": links a person to an account, or unlinks with null */
  linkPerson: (personId: string, memberEmail: string | null) => boolean;
  /** fromItems also takes them off items they share; see removalMessage for what's allowed */
  removePerson: (personId: string, fromItems?: boolean) => boolean;
  clearPeople: () => boolean;
  /**
   * id lets the caller refer to the new item straight away, say to attach photos.
   * createdAt dates it in the past (a duplicate keeping its date); now when absent.
   */
  addItem: (item: ItemInput, options?: { id?: string; createdAt?: number }) => boolean;
  /**
   * day moves it to another day as well, keeping its time of day; the date goes first, so
   * the server converts a new currency at that day's rate
   */
  updateItem: (itemId: string, item: ItemInput, options?: { day?: Date }) => boolean;
  removeItem: (itemId: string) => boolean;
  /**
   * Moves items to another day, each keeping its time of day (never later than now) and
   * the rate it was recorded with
   */
  moveItemsToDay: (itemIds: string[], day: Date) => boolean;
  /** Puts items back on the dates they had (Undo after moving them) */
  restoreItemDates: (dates: { id: string; createdAt: number }[]) => boolean;
  /** Who everyone settles up through, or null for the fewest transfers */
  setDistributor: (personId: string | null) => boolean;
  /** Puts back an item that was just removed (Undo) */
  restoreItem: (item: ApiItem) => boolean;
  clearItems: () => boolean;
  /** Every item in a currency at a typed rate, or when null at the rate on the day it was paid */
  setRate: (currency: string, rate: number | null) => boolean;
  /** Records that one person paid another; id lets the caller refer to it straight away */
  addPayment: (payment: PaymentInput, options?: { id?: string }) => boolean;
  updatePayment: (paymentId: string, payment: PaymentInput) => boolean;
  removePayment: (paymentId: string) => boolean;
  /** Puts back a payment that was just removed (Undo) */
  restorePayment: (payment: Payment) => boolean;
}

export interface ActionDeps {
  /** The bill as it is now */
  current: () => SplitState;
  meta: () => SplitMeta | null;
  dispatch: Dispatch<SplitAction>;
  /** Queues a change to be saved */
  queue: (change: Change) => void;
  metaChanges: Pick<MetaChanges, 'removeMember' | 'setDistributor'>;
  /** The server works out something the app can't (say, a conversion): load once saved */
  reloadAfterSave: () => void;
}

const refuse = (message: string) => {
  showRefusal(message);
  return false;
};

/** Why a payment can't be saved, in the server's words, or null when it can */
function paymentProblem(state: SplitState, p: PaymentInput): string | null {
  const here = (id: string) => state.people.some((person) => person.id === id);
  if (!here(p.fromId) || !here(p.toId)) return 'A payment is between two people in this split';
  if (p.fromId === p.toId) return 'A payment is between two different people';
  const amount = p.original?.amount ?? p.amount;
  if (!(toCents(amount) > 0)) return 'A payment is of more than nothing';
  if (p.itemId != null && !state.items.some((i) => i.id === p.itemId)) {
    return 'That item was removed by someone else';
  }
  return null;
}

export const makeSplitActions = (d: ActionDeps): SplitActions => {
  // Someone with an account loses access along with their person, as the server does it,
  // and the share link changes, so it's fetched again once saved
  const revokeAccessOf = (people: { memberEmail: string | null }[]) => {
    const members = d.meta()?.members ?? [];
    const losing = people
      .map((p) => p.memberEmail)
      .filter((email) => members.some((m) => m.email === email && m.role !== 'owner'));
    for (const email of losing) d.metaChanges.removeMember(email!);
    if (losing.length > 0) d.reloadAfterSave();
  };

  return {
    addPerson: (name, memberEmail) => {
      const trimmed = name.trim();
      if (trimmed === '') return false;
      if (d.current().people.some((p) => p.name === trimmed)) {
        return refuse(`${trimmed} is already in this split`);
      }
      const person = { id: newId(), name: trimmed, memberEmail: memberEmail ?? null };
      d.dispatch({ type: 'ADD_PERSON', payload: person });
      d.queue({ op: 'addPerson', ...person });
      return true;
    },
    renamePerson: (personId, name) => {
      const trimmed = name.trim();
      const person = d.current().people.find((p) => p.id === personId);
      if (person == null || trimmed === '' || trimmed === person.name) return false;
      if (person.memberEmail != null) {
        return refuse(`${person.name}'s name comes from their account`);
      }
      if (d.current().people.some((p) => p.name === trimmed && p.id !== personId)) {
        return refuse(`${trimmed} is already in this split`);
      }
      d.dispatch({ type: 'UPDATE_PERSON', payload: { id: personId, name: trimmed } });
      d.queue({ op: 'renamePerson', id: personId, name: trimmed });
      return true;
    },
    linkPerson: (personId, memberEmail) => {
      const people = d.current().people;
      const person = people.find((p) => p.id === personId);
      if (person == null) return false;
      if (memberEmail != null) {
        const other = people.find((p) => p.memberEmail === memberEmail && p.id !== personId);
        if (other) return refuse(`That account is already ${other.name}`);
        if (person.memberEmail != null && person.memberEmail !== memberEmail) {
          return refuse(`${person.name} is already linked to another account`);
        }
      }
      // Linked people go by their account's display name, as the server shows them
      const displayName = d.meta()?.members.find((m) => m.email === memberEmail)?.displayName;
      d.dispatch({
        type: 'UPDATE_PERSON',
        payload: { id: personId, memberEmail, ...(displayName ? { name: displayName } : {}) },
      });
      d.queue({ op: 'linkPerson', id: personId, memberEmail });
      return true;
    },
    removePerson: (personId, fromItems = false) => {
      const person = d.current().people.find((p) => p.id === personId);
      if (person == null) return false;
      const blocker = removalMessage(d.current(), personId, fromItems);
      if (blocker) return refuse(blocker);
      d.dispatch({ type: 'REMOVE_PERSON', payload: personId });
      revokeAccessOf([person]);
      d.queue({ op: 'removePerson', id: personId, fromItems });
      return true;
    },
    clearPeople: () => {
      if (d.current().items.length > 0) {
        return refuse('Remove the items first, then clear the people.');
      }
      if (d.current().payments.length > 0) {
        return refuse('Remove the payments first, then clear the people.');
      }
      revokeAccessOf(d.current().people);
      d.dispatch({ type: 'CLEAR_PEOPLE', payload: null });
      d.queue({ op: 'clearPeople' });
      return true;
    },
    addItem: (input, { id = newId(), createdAt = Date.now() } = {}) => {
      const item = { id, createdAt, ...input };
      d.dispatch({ type: 'ADD_ITEM', payload: item });
      // In another currency the server works out the amounts; show its numbers after
      if (input.original) d.reloadAfterSave();
      d.queue({ op: 'addItem', item });
      return true;
    },
    updateItem: (itemId, input, { day } = {}) => {
      const existing = d.current().items.find((i) => i.id === itemId);
      // Removed meanwhile, say by someone else
      if (existing == null) return refuse('That item has been removed');
      const createdAt = day
        ? keepTimeOf(day, existing.createdAt || Date.now())
        : existing.createdAt;
      if (createdAt !== existing.createdAt) d.queue({ op: 'setItemDate', id: itemId, createdAt });
      const item = { id: itemId, createdAt, ...input };
      d.dispatch({ type: 'UPDATE_ITEM', payload: item });
      if (input.original || existing.original) d.reloadAfterSave();
      d.queue({ op: 'updateItem', item });
      return true;
    },
    removeItem: (itemId) => {
      if (!d.current().items.some((i) => i.id === itemId)) return false;
      d.dispatch({ type: 'REMOVE_ITEM', payload: itemId });
      d.queue({ op: 'removeItem', id: itemId });
      return true;
    },
    moveItemsToDay: (itemIds, day) => {
      const ids = new Set(itemIds);
      const now = Date.now();
      let moved = false;
      for (const item of d.current().items) {
        if (!ids.has(item.id)) continue;
        const createdAt = keepTimeOf(day, item.createdAt || now);
        if (createdAt === item.createdAt) continue;
        d.dispatch({ type: 'PATCH_ITEM', payload: { id: item.id, createdAt } });
        d.queue({ op: 'setItemDate', id: item.id, createdAt });
        moved = true;
      }
      return moved;
    },
    restoreItemDates: (dates) => {
      let restored = false;
      for (const { id, createdAt } of dates) {
        const item = d.current().items.find((i) => i.id === id);
        // Removed meanwhile, or already there
        if (item == null || item.createdAt === createdAt) continue;
        d.dispatch({ type: 'PATCH_ITEM', payload: { id, createdAt } });
        d.queue({ op: 'setItemDate', id, createdAt });
        restored = true;
      }
      return restored;
    },
    setDistributor: (personId) => {
      d.metaChanges.setDistributor(personId);
      d.queue({ op: 'setDistributor', personId });
      return true;
    },
    restoreItem: (item) => {
      if (d.current().items.some((i) => i.id === item.id)) return false;
      d.dispatch({ type: 'ADD_ITEM', payload: item });
      d.queue({ op: 'addItem', item });
      return true;
    },
    clearItems: () => {
      d.dispatch({ type: 'CLEAR_ITEMS', payload: null });
      d.queue({ op: 'clearItems' });
      return true;
    },
    setRate: (currency, rate) => {
      if (rate == null) {
        d.reloadAfterSave();
      } else {
        for (const item of d.current().items) {
          if (item.original?.currency !== currency) continue;
          d.dispatch({ type: 'PATCH_ITEM', payload: atRate(item, rate) });
        }
      }
      d.queue({ op: 'setRate', currency, rate });
      return true;
    },
    addPayment: (input, { id = newId() } = {}) => {
      const problem = paymentProblem(d.current(), input);
      if (problem) return refuse(problem);
      const payment = { id, ...input };
      d.dispatch({ type: 'ADD_PAYMENT', payload: payment });
      // In another currency the server works out the amount; show its number after
      if (input.original) d.reloadAfterSave();
      d.queue({ op: 'addPayment', payment });
      return true;
    },
    updatePayment: (paymentId, input) => {
      const existing = d.current().payments.find((p) => p.id === paymentId);
      // Removed meanwhile, say by someone else
      if (existing == null) return refuse('That payment has been removed');
      const problem = paymentProblem(d.current(), input);
      if (problem) return refuse(problem);
      const payment = { id: paymentId, ...input };
      d.dispatch({ type: 'UPDATE_PAYMENT', payload: payment });
      if (input.original || existing.original) d.reloadAfterSave();
      d.queue({ op: 'updatePayment', payment });
      return true;
    },
    removePayment: (paymentId) => {
      if (!d.current().payments.some((p) => p.id === paymentId)) return false;
      d.dispatch({ type: 'REMOVE_PAYMENT', payload: paymentId });
      d.queue({ op: 'removePayment', id: paymentId });
      return true;
    },
    restorePayment: (payment) => {
      if (d.current().payments.some((p) => p.id === payment.id)) return false;
      d.dispatch({ type: 'ADD_PAYMENT', payload: payment });
      d.queue({ op: 'addPayment', payment });
      return true;
    },
  };
};
