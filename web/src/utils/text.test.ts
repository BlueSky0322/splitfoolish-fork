import { describe, expect, it } from 'vitest';
import { findLinks, shortLink } from './text';

describe('findLinks', () => {
  it('finds http, https and www addresses, leaving the words around them', () => {
    expect(findLinks('Menu at https://example.com/menu and www.other.org/x, see')).toEqual([
      { text: 'Menu at ' },
      { text: 'https://example.com/menu', href: 'https://example.com/menu' },
      { text: ' and ' },
      { text: 'www.other.org/x', href: 'https://www.other.org/x' },
      { text: ', see' },
    ]);
  });

  it("leaves the sentence's punctuation out of the address, but keeps a closed bracket", () => {
    expect(findLinks('(see http://a.io/p?q=1).').map((p) => p.text)).toEqual([
      '(see ',
      'http://a.io/p?q=1',
      ').',
    ]);
    expect(findLinks('https://en.wikipedia.org/wiki/Nasi_(dish)!')[0]).toEqual({
      text: 'https://en.wikipedia.org/wiki/Nasi_(dish)',
      href: 'https://en.wikipedia.org/wiki/Nasi_(dish)',
    });
  });

  it('is one plain run when there is no address', () => {
    expect(findLinks('Paid at the counter')).toEqual([{ text: 'Paid at the counter' }]);
    expect(findLinks('')).toEqual([]);
  });
});

describe('shortLink', () => {
  it('reads as where it goes: no https:// or www., and cut when long', () => {
    expect(shortLink('https://www.example.com/menu/')).toBe('example.com/menu');
    expect(shortLink('http://a.io')).toBe('a.io');
    const long = shortLink('https://example.com/a/very/long/path/to/somewhere?with=query');
    expect(long).toBe('example.com/a/very/long/path/to…');
    expect(long).toHaveLength(32);
  });
});
