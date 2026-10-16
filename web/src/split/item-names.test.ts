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

  it('ranks by how well a name matches, not by the order names arrive in', () => {
    // Most recent first, the opposite of how well each matches "tea"
    const arriving = ['Steak', 'Green tea', 'Teapot', 'Tea'].map((name) => ({
      name,
      category: null,
    }));
    expect(suggestNames(arriving, 'tea').map((n) => n.name)).toEqual([
      'Teapot',
      'Green tea',
      'Steak',
    ]);
    // Letters in order rank below containing them, even when more recent
    expect(
      suggestNames(
        [
          { name: 'Toffee bar', category: null },
          { name: 'Iced tea', category: null },
        ],
        'tea',
      ).map((n) => n.name),
    ).toEqual(['Iced tea', 'Toffee bar']);
  });

  it('keeps each name’s category', () => {
    expect(
      suggestNames(
        [
          { name: 'Taxi', category: 'transport' },
          { name: 'Tacos', category: 'food' },
          { name: 'Tip', category: null },
        ],
        'ta',
      ),
    ).toEqual([
      { name: 'Taxi', category: 'transport' },
      { name: 'Tacos', category: 'food' },
    ]);
  });

  it('suggests at most eight names, the best matches', () => {
    // Ten names start with "c", in arrival order; two more only contain it, more recently
    const many = [
      { name: 'Taxi cab', category: null },
      { name: 'Mocha', category: null },
      ...Array.from({ length: 10 }, (_, i) => ({ name: `Coffee ${i}`, category: null })),
    ];
    expect(suggestNames(many, 'c').map((n) => n.name)).toEqual(
      Array.from({ length: 8 }, (_, i) => `Coffee ${i}`),
    );
    expect(suggestNames(many, '')).toEqual(many.slice(0, 8));
  });

  it('suggests recent names before anything is typed, and nothing for a full match', () => {
    expect(names('')).toEqual(past.map((p) => p.name));
    expect(names('ABC')).toEqual([]);
  });
});
