import { describe, expect, it } from 'vitest';
import { RatesUnavailable, getRate } from './rates';

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
      fetch: s.fetch,
      cache: null,
      now: () => 1,
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
    expect((await getRate({}, 'USD', 'MYR', deps(noToken))).source).toBe('frankfurter');
    expect(noToken.calls.wise).toBe(0);

    const wiseDown = services(down, ecbRate(4.1));
    expect(await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', deps(wiseDown))).toMatchObject({
      rate: 4.1,
      source: 'frankfurter',
    });
  });

  it('serves a cached rate while fresh, and refetches once it is old', async () => {
    let now = 0;
    const cache = memoryCache();
    const s = services(wiseRate(4.2), ecbRate(4.1));
    const deps = { fetch: s.fetch, cache, now: () => now };
    await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', deps);
    now = 5 * 60 * 1000;
    await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', deps);
    expect(s.calls.wise).toBe(1);
    now = 11 * 60 * 1000;
    await getRate({ WISE_TOKEN: 't' }, 'USD', 'MYR', deps);
    expect(s.calls.wise).toBe(2);
  });

  it('uses an old rate when both services are down, and fails with none', async () => {
    let now = 0;
    const cache = memoryCache();
    await getRate({}, 'USD', 'MYR', { ...services(down, ecbRate(4.1)), cache, now: () => now });
    now = 60 * 60 * 1000;
    const outage = services(down, down);
    expect(
      (await getRate({}, 'USD', 'MYR', { fetch: outage.fetch, cache, now: () => now })).rate,
    ).toBe(4.1);
    await expect(
      getRate({}, 'USD', 'SGD', { fetch: outage.fetch, cache, now: () => now }),
    ).rejects.toBeInstanceOf(RatesUnavailable);
  });

  it('is 1 between the same currency, without asking anyone', async () => {
    const s = services(down, down);
    expect(
      (await getRate({}, 'MYR', 'MYR', { fetch: s.fetch, cache: null, now: () => 1 })).rate,
    ).toBe(1);
    expect(s.calls.wise + s.calls.frankfurter).toBe(0);
  });
});
