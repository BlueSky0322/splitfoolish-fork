import { describe, expect, it } from 'vitest';
import { findLinks, withoutMapsLinks } from '@shared/links';
import { shortLink } from './text';

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

describe('withoutMapsLinks', () => {
  const place = 'https://maps.app.goo.gl/AbCd123';
  const other = 'https://share.google/kopi168';
  it('takes out the Maps links that end a line, with what they leave at its end', () => {
    expect(withoutMapsLinks(`Frogs 8.60, Lures 9.00. ${place}`)).toBe('Frogs 8.60, Lures 9.00.');
    expect(withoutMapsLinks(`Bought here: ${place}.`)).toBe('Bought here');
    expect(withoutMapsLinks(`Coffee - ${place}, ${other}`)).toBe('Coffee');
  });

  it('keeps one in the middle of a sentence, and other links, so they still read', () => {
    const text = `Lunch at ${place} with Ann, menu at https://example.com/menu`;
    expect(withoutMapsLinks(text)).toBe(text);
  });

  it('drops a line that held only Maps links, and leaves the others as typed', () => {
    expect(withoutMapsLinks(place)).toBe('');
    expect(withoutMapsLinks(`Two plates -\n${place}\n  Menu at https://example.com/menu`)).toBe(
      'Two plates -\n  Menu at https://example.com/menu',
    );
  });
});
