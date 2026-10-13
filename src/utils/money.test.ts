import { describe, expect, test } from 'vitest';
import { currencySymbol, formatMoney, formatSigned, listCurrencies } from './money';

describe('money formatting', () => {
  test('ringgit shows as RM with two decimals', () => {
    expect(currencySymbol('MYR')).toBe('RM');
    expect(formatMoney(24800, 'MYR')).toBe('RM 248.00');
  });

  test('amounts are shown unsigned, so the colour and wording carry the direction', () => {
    expect(formatMoney(-10250, 'MYR')).toBe('RM 102.50');
  });

  test('currencies without cents keep their own decimals', () => {
    expect(formatMoney(150000, 'JPY')).toBe('¥ 1,500');
  });

  test('signed balances use a true minus sign', () => {
    expect(formatSigned(5350)).toBe('+53.50');
    expect(formatSigned(-10250)).toBe('−102.50');
    expect(formatSigned(0)).toBe('0.00');
  });

  test('the currency list labels codes with their name and symbol', () => {
    expect(listCurrencies().find((c) => c.value === 'MYR')?.label).toBe(
      'MYR · Malaysian Ringgit (RM)',
    );
  });
});
