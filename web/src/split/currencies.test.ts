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
});
