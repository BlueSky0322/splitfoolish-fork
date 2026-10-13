import { WritableDraft } from 'immer';
import { ImmerReducer } from 'use-immer';
import {
  AppReducerAction,
  AppReducerState,
  IItem,
  IOwing,
  IPerson,
} from '../../interfaces/app-reducer.ts';
import Big from 'big.js';

/** An item as the API returns it, referring to people by id */
export interface ApiItem {
  id: string;
  name: string;
  cost: number;
  payerId: string;
  participantIds: string[];
}

export const toClientItem = (item: ApiItem, people: IPerson[]): IItem => {
  const byId = new Map(people.map((p) => [p.id, p]));
  return {
    id: item.id,
    name: item.name,
    cost: item.cost,
    payer: byId.get(item.payerId)!,
    participants: item.participantIds.map((id) => byId.get(id)!).filter(Boolean),
  };
};

export const toApiItem = (item: IItem): ApiItem => ({
  id: item.id,
  name: item.name,
  cost: item.cost,
  payerId: item.payer.id,
  participantIds: item.participants.map((p) => p.id),
});

// Every action applies a change the server has already accepted
export const appReducer: ImmerReducer<AppReducerState, AppReducerAction> = (draft, action) => {
  switch (action.type) {
    case 'ADD_PERSON':
      draft.people.push(action.payload as IPerson);
      break;

    case 'REMOVE_PERSON':
      draft.people = draft.people.filter((p) => p.id !== action.payload);
      draft.owings = calculateOwings(draft);
      break;

    case 'CLEAR_PEOPLE':
      draft.people = [];
      draft.owings = calculateOwings(draft);
      break;

    case 'ADD_ITEM':
      draft.items.push(toClientItem(action.payload, draft.people));
      draft.owings = calculateOwings(draft);
      break;

    case 'UPDATE_ITEM': {
      const updated = toClientItem(action.payload, draft.people);
      draft.items = draft.items.map((i) => (i.id === updated.id ? updated : i));
      draft.owings = calculateOwings(draft);
      break;
    }

    case 'REMOVE_ITEM':
      draft.items = draft.items.filter((i) => i.id !== action.payload);
      draft.owings = calculateOwings(draft);
      break;

    case 'CLEAR_ITEMS':
      draft.items = [];
      draft.owings = calculateOwings(draft);
      break;

    case 'LOAD_STATE': {
      const people: IPerson[] = action.payload.people ?? [];
      draft.people = people;
      draft.items = (action.payload.items ?? []).map((i: ApiItem) => toClientItem(i, people));
      draft.owings = calculateOwings(draft);
      break;
    }

    default:
      throw new Error(`Unsupported action type '${action.type}'`);
  }
};

function calculateOwings(draft: WritableDraft<AppReducerState>): WritableDraft<IOwing>[] {
  // clear previous owings
  draft.owings.length = 0;

  for (let i = 0; i < draft.items.length; i++) {
    const item = draft.items[i];

    // Guards against a payer or participant missing from the people list
    if (item.payer == null || item.participants.length === 0) continue;

    const pricePerPerson = Big(item.cost).div(item.participants.length).toNumber();

    item.participants.forEach((p) => {
      const existingOwing = draft.owings.find(
        (o) => p.name === o.payer.name && item.payer.name === o.payee.name,
      );

      if (existingOwing != null) {
        existingOwing.amount += pricePerPerson;
      } else {
        draft.owings.push({
          amount: pricePerPerson,
          payer: p,
          payee: item.payer,
        });
      }
    });
  }

  return draft.owings;
}
