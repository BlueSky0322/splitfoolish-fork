// What the client and the Worker send each other about a split's bill. One copy, so
// the two sides can't drift apart.
import type { RateSource } from './rates';
import type { SplitMode } from './settle';

export type { SplitMode };

export type Role = 'owner' | 'editor';

export interface Person {
  id: string;
  name: string;
  /** The account this person is, when linked ("This is me") */
  memberEmail: string | null;
}

/** The longest name a split, person or item can have */
export const MAX_NAME_LENGTH = 80;

/** The longest notes an item can have */
export const MAX_NOTES_LENGTH = 2000;

export interface Item {
  id: string;
  name: string;
  /** In currency units; stored as integer cents */
  cost: number;
  payerId: string;
  participantIds: string[];
  splitMode: SplitMode;
  /** Shares per participant, when split by shares */
  shares?: Record<string, number>;
  /** Amount per participant in currency units, when split by exact amounts */
  exact?: Record<string, number>;
  category: string | null;
  /** Free text, up to MAX_NOTES_LENGTH characters; null when there are none */
  notes: string | null;
  createdAt: number;
  /** Set when the item was entered in a currency other than the split's */
  original: ItemOriginal | null;
}

/**
 * An item as entered in another currency. The app sends currency, amount (and exact,
 * for exact splits); the server converts it and fills in the rate. To use a rate of
 * their own, people send rate with rateSource 'manual'.
 */
export interface ItemOriginal {
  currency: string;
  amount: number;
  /** Exact split amounts in this currency, by person id */
  exact?: Record<string, number>;
  rate?: number;
  rateSource?: RateSource;
  /** When the rate was fetched or typed, in ms */
  rateAt?: number;
}

/** One change to a split's people or items; ids are made by the client */
export type Change =
  | { op: 'addPerson'; id: string; name: string; memberEmail?: string | null }
  | { op: 'renamePerson'; id: string; name: string }
  /** Link a person to a member's account ("This is me"), or unlink with null */
  | { op: 'linkPerson'; id: string; memberEmail: string | null }
  /** fromItems: also take them off items they share (never items they paid for) */
  | { op: 'removePerson'; id: string; fromItems?: boolean }
  | { op: 'clearPeople' }
  /** Settle up through this person ("route payments through"), or null for fewest transfers */
  | { op: 'setDistributor'; personId: string | null }
  | { op: 'addItem'; item: Item }
  | { op: 'updateItem'; item: Item }
  | { op: 'removeItem'; id: string }
  /** Moves an item to another day: when it's dated, in ms, not after today */
  | { op: 'setItemDate'; id: string; createdAt: number }
  | { op: 'clearItems' }
  /** Converts items in these currencies again at today's rate; items on a typed rate stay */
  | { op: 'refreshRates'; currencies: string[] }
  /** Every item in this currency at a typed rate, or at today's rate when null */
  | { op: 'setRate'; currency: string; rate: number | null };
