// The other currencies a split's items were paid in

import { type RateSource, savedRateSource } from '@shared/rates';
import type { ItemOriginal } from '@shared/types';
import type { SplitItem } from './state';

export interface UsedCurrency {
  code: string;
  count: number;
  rate: number;
  source: RateSource;
  at: number;
  /** Every item in it is on a typed rate */
  manual: boolean;
}

/** The other currencies items were paid in, with the rate each is converted at now */
export function usedCurrencies(items: SplitItem[]): UsedCurrency[] {
  const byCode = new Map<string, ItemOriginal[]>();
  for (const { original } of items) {
    if (original)
      byCode.set(original.currency, [...(byCode.get(original.currency) ?? []), original]);
  }
  return [...byCode]
    .map(([code, list]) => {
      // A rate saved without a source (by an older build) counts as typed, as it does
      // everywhere else
      const typed = (o: ItemOriginal) => savedRateSource(o.rateSource) === 'manual';
      const manual = list.every(typed);
      // The newest live rate, or the newest typed one when there's no live one
      const [shown] = list
        .filter((o) => manual || !typed(o))
        .sort((a, b) => (b.rateAt ?? 0) - (a.rateAt ?? 0));
      return {
        code,
        count: list.length,
        rate: shown.rate ?? 1,
        source: savedRateSource(shown.rateSource),
        at: shown.rateAt ?? 0,
        manual,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}
