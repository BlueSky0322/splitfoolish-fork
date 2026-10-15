import { describe, expect, test } from 'vitest';
import { RateInputs, buildItemInput, chooseRate } from './item-input';

const inputs = (over: Partial<RateInputs> = {}): RateInputs => ({
  foreign: true,
  entryCurrency: 'JPY',
  enteredCents: 100000,
  useOwnRate: false,
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
    expect(chooseRate(inputs({ useOwnRate: true, ownRate: 0.031 }))).toEqual({
      rate: 0.031,
      source: 'manual',
    });
    expect(chooseRate(inputs({ useOwnRate: true, ownRate: '' })).rate).toBeNull();
  });

  test('keeps the saved rate while the amount and currency are unchanged', () => {
    expect(chooseRate(inputs({ original: saved }))).toEqual({
      rate: 0.029,
      source: 'frankfurter',
    });
    // A new amount is converted at today's rate, as the server does
    expect(chooseRate(inputs({ original: saved, enteredCents: 200000 })).rate).toBe(0.03);
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
    useOwnRate: false,
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
    const item = buildItemInput({ ...fields, useOwnRate: true, ownRate: 0.031 });
    expect(item.original).toMatchObject({ rate: 0.031, rateSource: 'manual' });
  });
});
