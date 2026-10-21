// Converting between currencies. Amounts are whole cents (hundredths of the currency's
// main unit) everywhere, so a conversion is one multiplication and one rounding, done
// the same way by the app's preview and the server that saves it.

/** Where a rate came from: a live mid-market rate, the daily ECB rate, or typed in */
export type RateSource = 'wise' | 'frankfurter' | 'manual';

/** A currency code, like MYR */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export const isCurrency = (v: unknown): v is string =>
  typeof v === 'string' && CURRENCY_PATTERN.test(v);

/** Offered first in currency pickers: the currencies people here travel and spend in */
export const COMMON_CURRENCIES = [
  'MYR',
  'SGD',
  'USD',
  'THB',
  'JPY',
  'IDR',
  'PHP',
  'KRW',
  'CNY',
  'HKD',
  'TWD',
  'VND',
  'AUD',
  'NZD',
  'GBP',
  'EUR',
] as const;

/**
 * The day an item's rate is for: the UTC day it was paid on, as 2026-10-12. Items are
 * converted at the rate on that day, so the app's preview and the server use this one.
 */
export const rateDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/** An amount in the currency's main unit (12.34), in whole cents (1234) */
export const toCents = (amount: number) => Math.round(amount * 100);

/** `cents` in one currency, at `rate` units of the other per unit, in the other's cents */
export const convertCents = (cents: number, rate: number) => Math.round(cents * rate);

/**
 * The most an item can come to in the split's currency, in cents, once converted. A
 * typed amount (MAX_COST) at a high rate could go past it, and past what a number holds
 * exactly. With at most MAX_ITEMS items and MAX_SHARES shares each, every total and
 * every share worked out from items this size stays a whole number held exactly.
 */
export const MAX_ITEM_CENTS = 5_000_000_000_000;

/** Whether cents are a whole amount an item may come to in the split's currency */
export const fitsItemCents = (cents: number) =>
  Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_ITEM_CENTS;

/** Rates people type in, or that services return, outside this range are refused */
export const MIN_RATE = 1e-6;
export const MAX_RATE = 1e6;

export const isValidRate = (rate: unknown): rate is number =>
  typeof rate === 'number' && Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE;

/**
 * Where a saved rate came from. One saved without a source (from before sources were
 * kept) counts as typed, so it's never swapped for a fetched one unasked.
 */
export const savedRateSource = (source: RateSource | null | undefined): RateSource =>
  source ?? 'manual';

/**
 * Whether an edit keeps an item's saved rate instead of converting again: an item is
 * kept at the rate it was recorded with, so a new amount in the same currency is
 * converted at that rate too. A fetched rate is kept while no rate is typed; a typed one
 * only when the same rate is typed again. A new currency needs a new rate.
 */
export function keepsSavedConversion(
  saved: { currency: string; rate: number; source?: RateSource | null },
  entered: { currency: string; manualRate: number | null },
): boolean {
  if (saved.currency !== entered.currency) return false;
  return entered.manualRate == null ? saved.source !== 'manual' : entered.manualRate === saved.rate;
}

/**
 * Converts amounts that add up to a total, keeping them adding up to `targetCents`:
 * each is rounded down, and the leftover cents go to the largest remainders (ties by
 * id), the same way leftover cents are shared out in settle.ts.
 */
export function convertParts(
  parts: [id: string, cents: number][],
  rate: number,
  targetCents: number,
): Map<string, number> {
  const raw = parts.map(([id, cents]) => ({ id, value: cents * rate }));
  const result = new Map(raw.map((p) => [p.id, Math.floor(p.value)]));
  let left = targetCents - [...result.values()].reduce((a, b) => a + b, 0);
  const order = [...raw].sort(
    (a, b) =>
      b.value - Math.floor(b.value) - (a.value - Math.floor(a.value)) || a.id.localeCompare(b.id),
  );
  for (let i = 0; left > 0 && order.length > 0; i = (i + 1) % order.length, left--) {
    result.set(order[i].id, result.get(order[i].id)! + 1);
  }
  return result;
}
