import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchPlaces, toSuggestion } from './search';

/** Truz Tackles as Photon answers it */
const TRUZ = {
  geometry: { coordinates: [101.2505021, 3.3401712] },
  properties: {
    name: 'Truz Tackles',
    street: 'Jalan Kuala Selangor-Teluk Intan',
    city: 'Kuala Selangor',
    state: 'Selangor',
    country: 'Malaysia',
  },
};

const ctx = { waitUntil: () => {} };

/** Stands in for Photon, noting what it was asked; and for the Worker's cache */
let asked: URL[];
let answer: () => Response;
beforeEach(() => {
  asked = [];
  answer = () => Response.json({ features: [TRUZ] });
  const kept = new Map<string, Response>();
  vi.stubGlobal('caches', {
    default: {
      match: (r: Request) => Promise.resolve(kept.get(r.url)?.clone()),
      put: (r: Request, res: Response) => Promise.resolve(void kept.set(r.url, res)),
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input);
      asked.push(url);
      // Which country a position is in
      if (url.pathname === '/reverse') {
        return Promise.resolve(
          Response.json({ features: [{ properties: { countrycode: 'MY' } }] }),
        );
      }
      return Promise.resolve(answer());
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('a place found by name', () => {
  it('is kept as its name and town, with the rest of where it is to tell it apart', () => {
    expect(toSuggestion(TRUZ)).toEqual({
      lat: 3.34017,
      lng: 101.2505,
      name: 'Truz Tackles, Kuala Selangor',
      address: 'Jalan Kuala Selangor-Teluk Intan, Selangor, Malaysia',
    });
    // A street with no name of its own, and an answer with no position
    expect(
      toSuggestion({
        geometry: { coordinates: [101.67, 3.13] },
        properties: { street: 'Jalan Riong', housenumber: '29', district: 'Bangsar' },
      }),
    ).toMatchObject({ name: 'Jalan Riong 29', address: 'Bangsar' });
    expect(toSuggestion({ properties: { name: 'Nowhere' } })).toBeNull();
  });

  it("asks Photon near where the person is, within that place's country, once per search in that area", async () => {
    const near = { lat: 3.34, lng: 101.25 };
    expect(await searchPlaces('  Truz   tackles ', near, ctx, { country: 'US' })).toEqual([
      toSuggestion(TRUZ),
    ]);
    expect(asked.map((u) => `${u.origin}${u.pathname}`)).toEqual([
      'https://photon.komoot.io/reverse',
      'https://photon.komoot.io/api/',
    ]);
    expect(Object.fromEntries(asked[0].searchParams)).toEqual({
      lat: '3.3',
      lon: '101.3',
      limit: '1',
    });
    // The place's country, not the one the person is asking from
    expect(Object.fromEntries(asked[1].searchParams)).toEqual({
      q: 'Truz tackles',
      limit: '5',
      lang: 'en',
      countrycode: 'MY',
      lat: '3.3',
      lon: '101.3',
      location_bias_scale: '0.1',
      zoom: '12',
    });
    // The same words nearby come from the cache, the area's country too
    await searchPlaces('truz tackles', { lat: 3.31, lng: 101.26 }, ctx, { country: 'US' });
    expect(asked).toHaveLength(2);
    await searchPlaces('kepong tackle', { lat: 3.31, lng: 101.26 }, ctx);
    expect(asked.map((u) => u.pathname)).toEqual(['/reverse', '/api/', '/api/']);
  });

  it('without a place to go by, searches the country the person asks from, or everywhere', async () => {
    await searchPlaces('Truz', null, ctx, { country: 'sg' });
    expect(asked[0].searchParams.get('countrycode')).toBe('SG');
    expect(asked[0].searchParams.has('lat')).toBe(false);
    await searchPlaces('Truz', null, ctx);
    expect(asked[1].searchParams.has('countrycode')).toBe(false);
  });

  it("says nothing for a letter, and null when Photon can't answer", async () => {
    expect(await searchPlaces('T', null, ctx)).toEqual([]);
    expect(asked).toHaveLength(0);
    answer = () => new Response('busy', { status: 503 });
    expect(await searchPlaces('Truz', null, ctx)).toBeNull();
    answer = () => new Response('not json');
    expect(await searchPlaces('Truz Tackles', null, ctx)).toBeNull();
  });
});
