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
