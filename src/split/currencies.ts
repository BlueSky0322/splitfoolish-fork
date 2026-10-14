// The other currencies a split's items were paid in

import type { RateSource } from '../../shared/rates';
import { IItem } from '../interfaces/app-reducer';

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
export function usedCurrencies(items: IItem[]): UsedCurrency[] {
  const byCode = new Map<string, IItem[]>();
  for (const item of items) {
    const code = item.original?.currency;
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), item]);
  }
  return [...byCode]
    .map(([code, list]) => {
      const manual = list.every((i) => i.original?.rateSource === 'manual');
      // The newest live rate, or the newest typed one when there's no live one
      const shown = list
        .filter((i) => manual || i.original?.rateSource !== 'manual')
        .sort((a, b) => (b.original?.rateAt ?? 0) - (a.original?.rateAt ?? 0))[0].original!;
      return {
        code,
        count: list.length,
        rate: shown.rate ?? 1,
        source: shown.rateSource ?? 'manual',
        at: shown.rateAt ?? 0,
        manual,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}
