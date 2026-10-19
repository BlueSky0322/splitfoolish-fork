import { describe, expect, test } from 'vitest';
import type { RateInputs } from './item-input';
import { buildItemInput, chooseRate } from './item-input';

const inputs = (over: Partial<RateInputs> = {}): RateInputs => ({
  foreign: true,
  entryCurrency: 'JPY',
  enteredCents: 100000,
  ownRateChosen: false,
  ownRate: '',
  original: null,
  fetched: { rate: 0.03, source: 'wise' },
  ...over,
});

const saved = { currency: 'JPY', amount: 1000, rate: 0.029, rateSource: 'frankfurter' as const };

describe('chooseRate', () => {
  test('is 1 in the split’s own currency', () => {
    expect(chooseRate(inputs({ foreign: false }))).toEqual({ rate: 1, source: null });
  });

  test('uses a typed rate, and none until it is a valid one', () => {
    expect(chooseRate(inputs({ ownRateChosen: true, ownRate: 0.031 }))).toEqual({
      rate: 0.031,
      source: 'manual',
    });
    expect(chooseRate(inputs({ ownRateChosen: true, ownRate: '' })).rate).toBeNull();
  });

  test('keeps the rate the item was recorded with, a new amount included, as the server does', () => {
    expect(chooseRate(inputs({ original: saved }))).toEqual({
      rate: 0.029,
      source: 'frankfurter',
    });
    expect(chooseRate(inputs({ original: saved, enteredCents: 200000 }))).toEqual({
      rate: 0.029,
      source: 'frankfurter',
    });
  });

  test('converts at today’s rate when the currency changed or the saved rate was typed', () => {
    expect(chooseRate(inputs({ original: saved, entryCurrency: 'THB' })).rate).toBe(0.03);
    expect(
      chooseRate(inputs({ original: { ...saved, rate: 0.031, rateSource: 'manual' } })),
    ).toEqual({ rate: 0.03, source: 'wise' });
  });

  test('has no rate until today’s is fetched', () => {
    expect(chooseRate(inputs({ fetched: undefined }))).toEqual({ rate: null, source: null });
  });
});

describe('buildItemInput', () => {
  const fields = {
    name: '  Ramen ',
    enteredCents: 100000,
    costCents: 3000,
    rate: 0.03,
    foreign: true,
    entryCurrency: 'JPY',
    ownRateChosen: false,
    ownRate: '' as const,
    payerId: 'a',
    participantIds: ['a', 'b'],
    mode: 'exact' as const,
    shares: {},
    exact: { a: 600 as number | '', b: 400 as number | '' },
    category: null,
    notes: '  ',
  };

  test('shows converted amounts and sends what was typed for the server to convert', () => {
    const item = buildItemInput(fields);
    expect(item).toMatchObject({ name: 'Ramen', cost: 30, notes: null, splitMode: 'exact' });
    // 600 and 400 JPY of 1000 at 0.03 are 18.00 and 12.00 of 30.00
    expect(item.exact).toEqual({ a: 18, b: 12 });
    expect(item.original).toEqual({
      currency: 'JPY',
      amount: 1000,
      exact: { a: 600, b: 400 },
    });
  });

  test('converts each exact amount, sharing out the leftover cents', () => {
    const item = buildItemInput({
      ...fields,
      costCents: 3330,
      rate: 0.0333,
      participantIds: ['c', 'b', 'a'],
      exact: { a: 333, b: 333, c: 334 },
    });
    // 333, 333 and 334 JPY at 0.0333 are 11.0889, 11.0889 and 11.1222 of 33.30:
    // 11.08, 11.08 and 11.12 make 33.28, and the two leftover cents go to the larger
    // remainders, Ann's and Ben's
    expect(item.cost).toBe(33.3);
    expect(item.exact).toEqual({ a: 11.09, b: 11.09, c: 11.12 });
    expect(item.original?.exact).toEqual({ a: 333, b: 333, c: 334 });
  });

  test('shows the amounts as typed while there is no rate yet', () => {
    const item = buildItemInput({
      ...fields,
      rate: null,
      costCents: null,
      exact: { a: 600, b: '' },
    });
    expect(item.cost).toBe(1000);
    // A blank amount counts as nothing yet
    expect(item.exact).toEqual({ a: 600, b: 0 });
  });

  test('sends a typed rate with the item', () => {
    const item = buildItemInput({ ...fields, ownRateChosen: true, ownRate: 0.031 });
    expect(item.original).toMatchObject({ rate: 0.031, rateSource: 'manual' });
  });
});
