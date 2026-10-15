import { describe, expect, it } from 'vitest';
import { RatesUnavailable, getRate } from './exchange-rates';

// A cache that behaves like Cloudflare's for these tests
const memoryCache = () => {
  const store = new Map<string, string>();
  return {
    match: (key: string) =>
      Promise.resolve(store.has(key) ? new Response(store.get(key)) : undefined),
    put: async (key: string, res: Response) => {
      store.set(key, await res.text());
    },
  } as unknown as Cache;
};

/** Answers Wise and Frankfurter requests from the given handlers, counting calls */
function services(wise: () => Response, frankfurter: () => Response) {
  const calls = { wise: 0, frankfurter: 0 };
  const fetchImpl = (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('/v1/rates')) {
      calls.wise++;
      return Promise.resolve(wise());
    }
    calls.frankfurter++;
    return Promise.resolve(frankfurter());
  };
  return { calls, fetch: fetchImpl };
}

const ok = (body: unknown) => new Response(JSON.stringify(body));
const wiseRate = (rate: number) => () => ok([{ rate, source: 'USD', target: 'MYR' }]);
const ecbRate = (rate: number) => () => ok({ base: 'USD', rates: { MYR: rate } });
const down = () => new Response('down', { status: 500 });

describe('getRate', () => {
  it('uses Wise when there is a token', async () => {
    const s = services(wiseRate(4.2), ecbRate(4.1));
    const rate = await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', {
      deps: { fetch: s.fetch, cache: null, now: () => 1 },
    });
    expect(rate).toEqual({ rate: 4.2, source: 'wise', fetchedAt: 1 });
    expect(s.calls.frankfurter).toBe(0);
  });

  it('falls back to Frankfurter without a token, or when Wise fails', async () => {
    const deps = (s: ReturnType<typeof services>) => ({
      fetch: s.fetch,
      cache: null,
      now: () => 1,
    });
    const noToken = services(wiseRate(4.2), ecbRate(4.1));
    expect((await getRate({}, 'USD', 'MYR', { deps: deps(noToken) })).source).toBe('frankfurter');
    expect(noToken.calls.wise).toBe(0);

    const wiseDown = services(down, ecbRate(4.1));
    expect(
      await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', { deps: deps(wiseDown) }),
    ).toMatchObject({
      rate: 4.1,
      source: 'frankfurter',
    });
  });

  it('uses an old rate when both services are down, and fails with none', async () => {
    let now = 0;
    const cache = memoryCache();
    await getRate({}, 'USD', 'MYR', {
      deps: { ...services(down, ecbRate(4.1)), cache, now: () => now },
    });
    now = 5 * 60 * 60 * 1000;
    const outage = services(down, down);
    expect(
      (await getRate({}, 'USD', 'MYR', { deps: { fetch: outage.fetch, cache, now: () => now } }))
        .rate,
    ).toBe(4.1);
    await expect(
      getRate({}, 'USD', 'SGD', { deps: { fetch: outage.fetch, cache, now: () => now } }),
    ).rejects.toBeInstanceOf(RatesUnavailable);
  });

  it('is 1 between the same currency, without asking anyone', async () => {
    const s = services(down, down);
    expect(
      (await getRate({}, 'MYR', 'MYR', { deps: { fetch: s.fetch, cache: null, now: () => 1 } }))
        .rate,
    ).toBe(1);
    expect(s.calls.wise + s.calls.frankfurter).toBe(0);
  });

  it('reuses a cached rate for 4 hours, unless a recent one is asked for', async () => {
    const cache = memoryCache();
    let now = 0;
    const s = services(wiseRate(4.2), ecbRate(4.1));
    const deps = { fetch: s.fetch, cache, now: () => now };
    await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', { deps });
    now = 3 * 60 * 60 * 1000;
    expect((await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', { deps })).fetchedAt).toBe(0);
    expect(s.calls.wise).toBe(1);
    // Refresh: anything older than 10 minutes is fetched again
    expect(
      (await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', { deps, maxAgeMs: 10 * 60 * 1000 }))
        .fetchedAt,
    ).toBe(now);
    expect(s.calls.wise).toBe(2);
    now += 4 * 60 * 60 * 1000;
    await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', { deps });
    expect(s.calls.wise).toBe(3);
  });

  it('asks the ECB first for people who prefer it, and falls back to Wise', async () => {
    const s = services(wiseRate(4.2), ecbRate(4.1));
    const deps = { fetch: s.fetch, cache: memoryCache(), now: () => 1 };
    const ecb = await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', { deps, prefer: 'ecb' });
    expect(ecb).toMatchObject({ rate: 4.1, source: 'frankfurter' });
    expect(s.calls.wise).toBe(0);
    // Its own cache entry: someone preferring Wise still gets Wise's rate
    const wise = await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', { deps });
    expect(wise).toMatchObject({ rate: 4.2, source: 'wise' });

    const noEcb = services(wiseRate(4.2), () => new Response('', { status: 404 }));
    const fallback = await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', {
      deps: { fetch: noEcb.fetch, cache: null, now: () => 1 },
      prefer: 'ecb',
    });
    expect(fallback.source).toBe('wise');
  });

  it('still returns a fetched rate when keeping a copy of it fails', async () => {
    const s = services(wiseRate(4.2), ecbRate(4.1));
    const cache = {
      match: () => Promise.resolve(undefined),
      put: () => Promise.reject(new Error('cache full')),
    } as unknown as Cache;
    const rate = await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', {
      deps: { fetch: s.fetch, cache, now: () => 1 },
    });
    expect(rate).toMatchObject({ rate: 4.2, source: 'wise' });
    expect(s.calls.frankfurter).toBe(0);
  });
});
