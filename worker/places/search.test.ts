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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

  it("says nothing for a letter, asks once more when Photon is busy, and null when it can't answer", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await searchPlaces('T', null, ctx)).toEqual([]);
    expect(asked).toHaveLength(0);
    // Busy, then answering: the places
    const answers = [new Response('busy', { status: 503 }), Response.json({ features: [TRUZ] })];
    answer = () => answers.shift()!;
    expect(await searchPlaces('Truz', null, ctx)).toEqual([toSuggestion(TRUZ)]);
    expect(asked).toHaveLength(2);
    // Busy twice: null, and only why is logged, never what was searched for
    answer = () => new Response('busy', { status: 503 });
    expect(await searchPlaces('Kedai Kopi', null, ctx)).toBeNull();
    expect(asked).toHaveLength(4);
    expect(vi.mocked(console.warn).mock.calls.flat().join(' ')).not.toMatch(/Kedai|Truz/);
    // A question refused as it is isn't asked again
    answer = () => new Response('bad', { status: 400 });
    expect(await searchPlaces('Kepong', null, ctx)).toBeNull();
    expect(asked).toHaveLength(5);
    answer = () => new Response('not json');
    expect(await searchPlaces('Truz Tackles', null, ctx)).toBeNull();
  });

  it('finds a typed plus code itself: a full one alone, a short one near its town or the person', async () => {
    expect(await searchPlaces('6pm2vrj3+mg', null, ctx)).toEqual([
      { lat: 3.88169, lng: 100.80381, name: '6PM2VRJ3+MG', address: 'Plus code' },
    ]);
    expect(asked).toHaveLength(0);
    // The town is found by name (Truz Tackles stands in for it), then the nearest box
    expect(await searchPlaces('87R2+36 Kuala Selangor', null, ctx)).toEqual([
      {
        lat: 3.34019,
        lng: 101.25056,
        name: '87R2+36 Kuala Selangor',
        address: 'Plus code',
      },
    ]);
    expect(asked.map((u) => u.searchParams.get('q'))).toEqual(['Kuala Selangor']);
    expect((await searchPlaces('87R2+36', { lat: 3.3, lng: 101.3 }, ctx))?.[0]).toMatchObject({
      lat: 3.34019,
      name: '6PM387R2+36',
    });
    // A short one with nothing to go by is nowhere
    expect(await searchPlaces('87R2+36', null, ctx)).toEqual([]);
  });
});
