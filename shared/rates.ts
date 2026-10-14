// Converting between currencies. Amounts are whole cents (hundredths of the currency's
// main unit) everywhere, so a conversion is one multiplication and one rounding, done
// the same way by the app's preview and the server that saves it.

/** Where a rate came from: a live mid-market rate, the daily ECB rate, or typed in */
export type RateSource = 'wise' | 'frankfurter' | 'manual';

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

/** `cents` in one currency, at `rate` units of the other per unit, in the other's cents */
export const convertCents = (cents: number, rate: number) => Math.round(cents * rate);

/** Rates people type in, or that services return, outside this range are refused */
export const MIN_RATE = 1e-6;
export const MAX_RATE = 1e6;

export const isValidRate = (rate: unknown): rate is number =>
  typeof rate === 'number' && Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE;
