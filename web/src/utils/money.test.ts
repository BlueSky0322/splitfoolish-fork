import { afterEach, describe, expect, test, vi } from 'vitest';

// The app formats money in the browser's own language. These tests set that language,
// so the expected text is the same on every machine, and load the money module afresh
// for each, since it keeps its formatters once made.

const RealIntl = Intl;

async function moneyIn(locale: string) {
  class NumberFormat extends RealIntl.NumberFormat {
    constructor(locales?: string | string[], options?: Intl.NumberFormatOptions) {
      super(locales ?? locale, options);
    }
  }
  class DisplayNames extends RealIntl.DisplayNames {
    constructor(locales: string | string[] | undefined, options: Intl.DisplayNamesOptions) {
      super(locales ?? locale, options);
    }
  }
  vi.stubGlobal('Intl', Object.assign(Object.create(RealIntl), { NumberFormat, DisplayNames }));
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    ...[locales, options]: Parameters<number['toLocaleString']>
  ) {
    return new RealIntl.NumberFormat(locales ?? locale, options).format(this);
  });
  vi.resetModules();
  return import('./money');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('money formatting in US English', () => {
  test('ringgit shows as RM with two decimals', async () => {
    const { currencySymbol, formatMoney } = await moneyIn('en-US');
    expect(currencySymbol('MYR')).toBe('RM');
    expect(formatMoney(24800, 'MYR')).toBe('RM 248.00');
    expect(formatMoney(123456789, 'MYR')).toBe('RM 1,234,567.89');
  });

  test('amounts are shown unsigned, so the colour and wording carry the direction', async () => {
    const { formatAmount, formatMoney } = await moneyIn('en-US');
    expect(formatMoney(-10250, 'MYR')).toBe('RM 102.50');
    expect(formatAmount(-10250, 'MYR')).toBe('102.50');
  });

  test('currencies without cents keep their own decimals', async () => {
    const { formatMoney } = await moneyIn('en-US');
    expect(formatMoney(150000, 'JPY')).toBe('¥ 1,500');
  });

  test('signed balances use a true minus sign', async () => {
    const { formatSigned } = await moneyIn('en-US');
    expect(formatSigned(5350)).toBe('+53.50');
    expect(formatSigned(-10250)).toBe('−102.50');
    expect(formatSigned(0)).toBe('0.00');
    expect(formatSigned(123456)).toBe('+1,234.56');
  });

  test('the currency list labels codes with their name and symbol', async () => {
    const { listCurrencies } = await moneyIn('en-US');
    expect(listCurrencies().find((c) => c.value === 'MYR')).toEqual({
      value: 'MYR',
      label: 'MYR · Malaysian Ringgit (RM)',
      name: 'Malaysian Ringgit',
      detail: 'Malaysian Ringgit (RM)',
    });
  });
});

describe('money formatting in German', () => {
  // German swaps the separators and writes the symbol after the amount; the app still
  // puts the symbol first, followed by the amount as German writes it
  test('uses the language’s separators, keeping the symbol first', async () => {
    const { formatMoney, formatSigned, listCurrencies } = await moneyIn('de-DE');
    expect(formatMoney(123456789, 'MYR')).toBe('RM 1.234.567,89');
    expect(formatMoney(150000, 'JPY')).toBe('¥ 1.500');
    expect(formatSigned(-10250)).toBe('−102,50');
    expect(listCurrencies().find((c) => c.value === 'MYR')?.label).toBe(
      'MYR · Malaysischer Ringgit (RM)',
    );
  });
});
