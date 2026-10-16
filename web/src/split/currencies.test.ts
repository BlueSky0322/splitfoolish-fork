import { describe, expect, it } from 'vitest';
import type { SplitItem } from './state';
import { usedCurrencies } from './currencies';

const person = { id: 'a', name: 'A', memberEmail: null };
const item = (original: SplitItem['original']): SplitItem => ({
  id: Math.random().toString(16),
  name: 'x',
  cost: 1,
  payer: person,
  participants: [person],
  splitMode: 'equal',
  category: null,
  notes: null,
  createdAt: 0,
  original,
});

describe('usedCurrencies', () => {
  it('shows the newest live rate, and a typed one only when every item is typed', () => {
    const used = usedCurrencies([
      item(null),
      item({ currency: 'JPY', amount: 1, rate: 0.03, rateSource: 'wise', rateAt: 1 }),
      item({ currency: 'JPY', amount: 1, rate: 0.031, rateSource: 'wise', rateAt: 2 }),
      item({ currency: 'JPY', amount: 1, rate: 0.5, rateSource: 'manual', rateAt: 3 }),
      item({ currency: 'THB', amount: 1, rate: 0.13, rateSource: 'manual', rateAt: 1 }),
    ]);
    expect(used).toEqual([
      { code: 'JPY', count: 3, rate: 0.031, source: 'wise', at: 2, manual: false },
      { code: 'THB', count: 1, rate: 0.13, source: 'manual', at: 1, manual: true },
    ]);
  });

  it('reads a rate saved without a source (older builds) as typed, like everywhere else', () => {
    const used = usedCurrencies([item({ currency: 'JPY', amount: 1, rate: 0.5, rateAt: 3 })]);
    expect(used).toEqual([
      { code: 'JPY', count: 1, rate: 0.5, source: 'manual', at: 3, manual: true },
    ]);
  });

  it('never lets an older build’s typed rate stand in for a live one', () => {
    const used = usedCurrencies([
      item({ currency: 'JPY', amount: 1, rate: 0.031, rateSource: 'wise', rateAt: 2 }),
      // Newer, but typed (saved before sources were kept)
      item({ currency: 'JPY', amount: 1, rate: 0.5, rateAt: 3 }),
    ]);
    expect(used).toEqual([
      { code: 'JPY', count: 2, rate: 0.031, source: 'wise', at: 2, manual: false },
    ]);
  });

  it('lists currencies A to Z, whatever order their items came in', () => {
    const used = usedCurrencies([
      item({ currency: 'USD', amount: 1, rate: 4.4, rateSource: 'frankfurter', rateAt: 1 }),
      item({ currency: 'JPY', amount: 1, rate: 0.03, rateSource: 'wise', rateAt: 1 }),
      item({ currency: 'EUR', amount: 1, rate: 5.1, rateSource: 'wise', rateAt: 1 }),
    ]);
    expect(used.map((u) => u.code)).toEqual(['EUR', 'JPY', 'USD']);
  });
});
