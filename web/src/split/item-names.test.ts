import { describe, expect, it } from 'vitest';
import { suggestNames } from './item-names';

const past = ['Grab to airport', 'Airport taxi', 'abc', 'Coffee', 'Breakfast'].map((name) => ({
  name,
  category: null,
}));
const names = (typed: string) => suggestNames(past, typed).map((n) => n.name);

describe('suggestNames', () => {
  it('puts names starting with what was typed first, then words, then the rest', () => {
    expect(names('a')).toEqual(['Airport taxi', 'abc', 'Grab to airport', 'Breakfast']);
    expect(names('air')).toEqual(['Airport taxi', 'Grab to airport']);
  });

  it('finds names with the typed letters in order', () => {
    expect(names('cfe')).toEqual(['Coffee']);
  });

  it('suggests recent names before anything is typed, and nothing for a full match', () => {
    expect(names('')).toEqual(past.map((p) => p.name));
    expect(names('ABC')).toEqual([]);
  });
});
