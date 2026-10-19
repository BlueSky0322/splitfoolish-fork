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

export const MAX_NOTES_LENGTH = 2000;

/** The largest amount an item can cost, in currency units, whatever it was paid in */
export const MAX_COST = 1_000_000_000;

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
  /** The rate it was recorded with: the one on the day it was paid, or one typed */
  rate?: number;
  rateSource?: RateSource;
  /** When the rate was fetched or typed, in ms; for an earlier day's, noon UTC that day */
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
  /**
   * Moves an item to another day: when it's dated, in ms, not after today. One paid in
   * another currency keeps the rate it was recorded with.
   */
  | { op: 'setItemDate'; id: string; createdAt: number }
  | { op: 'clearItems' }
  /**
   * Sent by older versions of the app, which converted items again at today's rate. Does
   * nothing now: items keep the rate of the day they were paid.
   */
  | { op: 'refreshRates'; currencies: string[] }
  /** Every item in this currency at a typed rate, or when null at the rate on its day */
  | { op: 'setRate'; currency: string; rate: number | null };
