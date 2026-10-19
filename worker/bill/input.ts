// Reading what a change sends: names, amounts, currencies and rates, who is on an
// item and their part of it. Anything that can't be applied is refused with a reason.

import { isRowId } from '../../shared/api';
import {
  convertCents,
  convertParts,
  isCurrency,
  isValidRate,
  keepsSavedConversion,
  rateDay,
  toCents,
} from '../../shared/rates';
import type { SplitMode } from '../../shared/settle';
import { MAX_SHARES, isSplitMode } from '../../shared/settle';
import type { ItemOriginal } from '../../shared/types';
import { MAX_COST, MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from '../../shared/types';
import type { Rate } from '../currency/exchange-rates';
import { readName } from '../http';
import type { Batch, Model, ModelItem, UncheckedChange } from './model';
import { Refused } from './model';

const MAX_CATEGORY_LENGTH = 32;

export const nameTaken = (model: Model, name: string, exceptId?: string) =>
  [...model.people].some(([id, p]) => p.name === name && id !== exceptId);

/** A member email a person may be linked to, or null; refuses non-members and double links */
export function readMemberEmail(model: Model, value: unknown, personId: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Refused('Invalid account');
  const email = value.toLowerCase();
  if (!model.members.has(email)) throw new Refused('That account is not in this split');
  const other = [...model.people].find(([id, p]) => p.memberEmail === email && id !== personId);
  if (other) throw new Refused(`That account is already ${other[1].name}`);
  return email;
}

/** Rates fetched before a batch is checked, by rateKey */
export type FetchedRates = Map<string, Rate>;

/** Which rate an item paid in `currency` at `at` takes: the one for that currency and day */
export const rateKey = (currency: string, at: number) => `${currency} ${rateDay(at)}`;

/** A rate a batch needs: a currency, and when the item was paid */
export interface RateWanted {
  currency: string;
  at: number;
}

interface OriginalInput {
  currency: string;
  cents: number;
  exact: Record<string, unknown>;
  /** A rate typed in, used instead of a fetched one */
  manualRate: number | null;
}

/** An amount as sent, checked */
function readCost(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_COST) {
    throw new Refused(`Cost must be between 0 and ${MAX_COST.toLocaleString('en-US')}`);
  }
  return value;
}

/** What was typed for an item in another currency; null when it's in the split's own */
function readOriginal(model: Model, raw: unknown): OriginalInput | null {
  if (raw == null) return null;
  const original = raw as Partial<Record<keyof ItemOriginal, unknown>>;
  const currency = original.currency;
  if (!isCurrency(currency)) throw new Refused('Invalid currency');
  if (currency === model.currency) return null;
  const amount = readCost(original.amount);
  let manualRate: number | null = null;
  if (original.rateSource === 'manual') {
    if (!isValidRate(original.rate)) throw new Refused('Enter an exchange rate above 0');
    manualRate = original.rate;
  }
  return {
    currency,
    cents: toCents(amount),
    exact: (original.exact ?? {}) as Record<string, unknown>,
    manualRate,
  };
}

/** The saved conversion an edit keeps, by the rule the app's preview follows too */
const reusableConversion = (model: Model, itemId: unknown, original: OriginalInput) => {
  const saved = typeof itemId === 'string' ? model.items.get(itemId)?.converted : null;
  return saved != null && keepsSavedConversion(saved, original) ? saved : null;
};

/** What a setRate change does, checked: the currency, and the rate typed (or null) */
export function readRateChange(
  model: Model,
  change: Extract<UncheckedChange, { op: 'setRate' }>,
): { currency: string; manualRate: number | null } {
  if (!isCurrency(change.currency) || change.currency === model.currency) {
    throw new Refused('Invalid currency');
  }
  if (change.rate != null && !isValidRate(change.rate)) {
    throw new Refused('Enter an exchange rate above 0');
  }
  return { currency: change.currency, manualRate: change.rate ?? null };
}

/**
 * The rates a batch needs fetched, read before the batch is checked, by rateKey: each
 * converted item's currency and the day it was paid. Earlier changes in the batch count,
 * as they will when it's checked: an item added offline, moved to another day and then
 * given a new currency arrives as all three, and takes the rate of the day it was moved to.
 */
export function ratesToFetch(model: Model, changes: Batch): Map<string, RateWanted> {
  const needed = new Map<string, RateWanted>();
  const want = (currency: string, at: number) =>
    needed.set(rateKey(currency, at), { currency, at });
  // What earlier changes in the batch made of an item: its date, and its currency with
  // whether its rate was typed (null when it's in the split's own currency)
  const dates = new Map<string, number>();
  const currencies = new Map<string, { currency: string; typed: boolean } | null>();
  const dateOf = (id: string) => dates.get(id) ?? model.items.get(id)?.createdAt;
  const currencyOf = (id: string) => {
    if (currencies.has(id)) return currencies.get(id) ?? null;
    const c = model.items.get(id)?.converted;
    return c == null ? null : { currency: c.currency, typed: c.source === 'manual' };
  };

  for (const change of changes) {
    try {
      if (change?.op === 'setRate') {
        const { currency, manualRate } = readRateChange(model, change);
        for (const id of new Set([...model.items.keys(), ...currencies.keys()])) {
          if (currencyOf(id)?.currency !== currency) continue;
          currencies.set(id, { currency, typed: manualRate != null });
          // Back on fetched rates: each item at its own day's
          const at = dateOf(id);
          if (manualRate == null && at != null) want(currency, at);
        }
      } else if (change?.op === 'setItemDate') {
        // Moving keeps the item's rate, but a later change in the batch is for the new day
        const id = readId(change.id);
        if (isItemDate(change.createdAt)) dates.set(id, change.createdAt);
      } else if (change?.op === 'addItem' || change?.op === 'updateItem') {
        const item = (change.item ?? {}) as Record<string, unknown>;
        const id = readId(item.id);
        const at = change.op === 'addItem' ? readCreatedAt(change.item) : dateOf(id) ?? Date.now();
        dates.set(id, at);
        const original = readOriginal(model, item.original);
        currencies.set(
          id,
          original && { currency: original.currency, typed: original.manualRate != null },
        );
        if (original == null || original.manualRate != null) continue;
        if (reusableConversion(model, id, original) != null) continue;
        want(original.currency, at);
      }
    } catch (err) {
      // Refused properly when the batch is checked
      if (!(err instanceof Refused)) throw err;
    }
  }
  return needed;
}

/**
 * When an item being saved was paid: for a new one, the time it brings (readCreatedAt);
 * for an edit, the date it has now, which only setItemDate changes
 */
export function paidAt(model: Model, op: 'addItem' | 'updateItem', raw: unknown) {
  if (op === 'addItem') return readCreatedAt(raw);
  const id = (raw as { id?: unknown } | null)?.id;
  return (typeof id === 'string' ? model.items.get(id)?.createdAt : null) ?? Date.now();
}

const exactOriginals = (participants: { personId: string; originalExactCents: number | null }[]) =>
  new Map(
    participants
      .filter((p) => p.originalExactCents != null)
      .map((p) => [p.personId, p.originalExactCents!]),
  );

/** What the model keeps of an item that was just checked, as it will be saved */
export const toModelItem = (item: ReturnType<typeof readItem>, createdAt: number): ModelItem => ({
  payerId: item.payerId,
  createdAt,
  participantIds: item.participants.map((p) => p.personId),
  originalExact: exactOriginals(item.participants),
  splitMode: item.splitMode,
  converted: item.converted,
});

/**
 * The rate to convert at: the one typed, or else the one fetched before the batch was
 * checked. Missing only when the batch changed things in a way that first read didn't
 * foresee.
 */
export function chooseRate(manualRate: number | null, fetched: Rate | undefined) {
  if (manualRate != null) return { rate: manualRate, source: 'manual' as const, at: Date.now() };
  if (fetched == null) throw new Refused('The exchange rate changed. Try again.');
  return { rate: fetched.rate, source: fetched.source, at: fetched.fetchedAt };
}

/** Earliest date an item may say it was added on: before this app existed */
const EARLIEST_ITEM = Date.UTC(2000, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a time is one an item may say it was added at: one that has come, with a
 * day's grace for clocks and time zones ahead of the server's
 */
export const isItemDate = (at: unknown): at is number =>
  typeof at === 'number' &&
  Number.isInteger(at) &&
  at >= EARLIEST_ITEM &&
  at <= Date.now() + DAY_MS;

/** "Now" for an item sent without a sensible time, the same each time it's read */
const sentAt = new WeakMap<object, number>();

/**
 * When a new item was added: the time it brings with it (a duplicate keeping its
 * original date, or one put back with Undo) if that's a sensible one, else now. Read
 * once for its rate and again to save it, so both are for the same day.
 */
export function readCreatedAt(raw: unknown) {
  const at = (raw as { createdAt?: unknown } | null)?.createdAt;
  if (isItemDate(at)) return at;
  if (raw == null || typeof raw !== 'object') return Date.now();
  const now = sentAt.get(raw) ?? Date.now();
  sentAt.set(raw, now);
  return now;
}

/** Someone on an item, and their part of it, as saved */
export interface Participant {
  personId: string;
  shares: number;
  exactCents: number | null;
  originalExactCents: number | null;
}

/**
 * Each person's part of an item, checked: their shares, or their exact amount. Exact
 * amounts typed in another currency are converted at the item's rate, so they still
 * add up to its cost.
 */
function readParticipants(
  item: Record<string, unknown>,
  participantIds: string[],
  splitMode: SplitMode,
  costCents: number,
  original: OriginalInput | null,
  converted: ModelItem['converted'],
): Participant[] {
  const participants = participantIds.map(
    (personId): Participant => ({
      personId,
      shares: 1,
      exactCents: null,
      originalExactCents: null,
    }),
  );
  if (splitMode === 'shares') {
    const shares = (item.shares ?? {}) as Record<string, unknown>;
    for (const p of participants) {
      const n = shares[p.personId];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_SHARES) {
        throw new Refused(`Shares must be whole numbers from 1 to ${MAX_SHARES}`);
      }
      p.shares = n;
    }
  }
  if (splitMode === 'exact') {
    const exact = original?.exact ?? ((item.exact ?? {}) as Record<string, unknown>);
    for (const p of participants) {
      const amount = exact[p.personId];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
        throw new Refused('Exact amounts must be numbers of 0 or more');
      }
      p.exactCents = toCents(amount);
    }
    const assigned = participants.reduce((a, p) => a + (p.exactCents ?? 0), 0);
    if (assigned !== (original?.cents ?? costCents)) {
      throw new Refused('The exact amounts must add up to the cost');
    }
    if (converted != null) {
      const parts = convertParts(
        participants.map((p) => [p.personId, p.exactCents ?? 0]),
        converted.rate,
        costCents,
      );
      for (const p of participants) {
        p.originalExactCents = p.exactCents;
        p.exactCents = parts.get(p.personId) ?? 0;
      }
    }
  }
  return participants;
}

/** An item as sent, checked; one in another currency is converted at the rate for `paid` */
export function readItem(model: Model, raw: unknown, rates: FetchedRates, paid: number) {
  const item = (raw ?? {}) as Record<string, unknown>;
  // Ids are made by the app so its changes can refer to people and items it just added
  if (!isRowId(item.id)) throw new Refused('Invalid item');
  const name = readName(item.name);
  if (name == null) throw new Refused(`Item name must be 1-${MAX_NAME_LENGTH} characters`);

  // In another currency: converted here, whatever the app worked out for its preview
  const original = readOriginal(model, item.original);
  let converted: ModelItem['converted'] = null;
  let costCents: number;
  if (original != null) {
    const { rate, source, at } =
      reusableConversion(model, item.id, original) ??
      chooseRate(original.manualRate, rates.get(rateKey(original.currency, paid)));
    converted = { currency: original.currency, cents: original.cents, rate, source, at };
    costCents = convertCents(original.cents, rate);
  } else {
    costCents = toCents(readCost(item.cost));
  }

  const payerId = item.payerId;
  if (typeof payerId !== 'string' || !model.people.has(payerId)) {
    throw new Refused('Who paid must be someone in this split');
  }
  const raws = item.participantIds;
  if (!Array.isArray(raws) || raws.length === 0) {
    throw new Refused('Choose at least one person to split with');
  }
  if (raws.some((p) => typeof p !== 'string' || !model.people.has(p))) {
    throw new Refused('Everyone splitting an item must be someone in this split');
  }
  const participantIds = [...new Set(raws as string[])];

  const splitMode: unknown = item.splitMode ?? 'equal';
  if (!isSplitMode(splitMode)) throw new Refused('Invalid split');

  const participants = readParticipants(
    item,
    participantIds,
    splitMode,
    costCents,
    original,
    converted,
  );

  let category: string | null = null;
  if (item.category != null && item.category !== '') {
    if (typeof item.category !== 'string' || item.category.trim().length > MAX_CATEGORY_LENGTH) {
      throw new Refused('Invalid category');
    }
    category = item.category.trim();
  }

  let notes: string | null = null;
  if (item.notes != null) {
    if (typeof item.notes !== 'string') throw new Refused('Invalid notes');
    // Kept as typed, line breaks and all; only blank space around them goes
    const trimmed = item.notes.trim();
    if (trimmed.length > MAX_NOTES_LENGTH) {
      throw new Refused(`Notes can be up to ${MAX_NOTES_LENGTH} characters`);
    }
    notes = trimmed === '' ? null : trimmed;
  }

  return {
    id: item.id,
    name,
    costCents,
    payerId,
    splitMode,
    participants,
    category,
    notes,
    converted,
  };
}

/** An id in a change; anything but a string is a malformed change */
export const readId = (value: unknown) => {
  if (typeof value !== 'string') throw new Refused('Invalid change');
  return value;
};
