// Exchange rates for converting items into a split's currency. Wise's live mid-market
// rate when a token is set, else the ECB's daily rate from Frankfurter (free, no key).
// Each pair is kept in Cloudflare's cache for a few minutes, so a busy day costs the
// services a handful of requests, and an hour's-old rate still serves if both are down.

import { RateSource, isValidRate } from '../shared/rates';

export interface RatesEnv {
  /** Wise personal API token (a Worker secret); without it Wise is skipped */
  WISE_TOKEN?: string;
  /** Overridable so tests can stand in for the services */
  WISE_BASE?: string;
  FRANKFURTER_BASE?: string;
}

export interface Rate {
  rate: number;
  source: Exclude<RateSource, 'manual'>;
  /** When the rate was fetched from the service, in ms */
  fetchedAt: number;
}

export class RatesUnavailable extends Error {}

/** Fresh for this long; older copies are refetched but still used if that fails */
const FRESH_MS = 10 * 60 * 1000;
/** How long Cloudflare keeps a copy at all */
const KEEP_SECONDS = 24 * 60 * 60;
const TIMEOUT_MS = 4000;

interface Deps {
  fetch: typeof fetch;
  /** Null where there's no cache, as in unit tests */
  cache: Cache | null;
  now: () => number;
}

const defaultDeps = (): Deps => ({
  fetch: (input, init) => fetch(input, init),
  cache: typeof caches === 'undefined' ? null : caches.default,
  now: Date.now,
});

const cacheKey = (from: string, to: string) => `https://rates.internal/v1/${from}/${to}`;

async function fromWise(env: RatesEnv, from: string, to: string, deps: Deps) {
  if (!env.WISE_TOKEN) return null;
  const base = env.WISE_BASE ?? 'https://api.wise.com';
  const res = await deps.fetch(`${base}/v1/rates?source=${from}&target=${to}`, {
    headers: { Authorization: `Bearer ${env.WISE_TOKEN}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Wise rates: ${res.status}`);
  const body = await res.json<{ rate?: unknown }[]>();
  return isValidRate(body[0]?.rate) ? body[0].rate : null;
}

async function fromFrankfurter(env: RatesEnv, from: string, to: string, deps: Deps) {
  const base = env.FRANKFURTER_BASE ?? 'https://api.frankfurter.dev';
  const res = await deps.fetch(`${base}/v1/latest?base=${from}&symbols=${to}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Frankfurter answers 404 for currencies it doesn't cover
  if (res.status === 404 || res.status === 422) return null;
  if (!res.ok) throw new Error(`Frankfurter: ${res.status}`);
  const body = await res.json<{ rates?: Record<string, unknown> }>();
  const rate = body.rates?.[to];
  return isValidRate(rate) ? rate : null;
}

/** The rate to convert `from` into `to`: 1 unit of `from` is `rate` units of `to` */
export async function getRate(
  env: RatesEnv,
  from: string,
  to: string,
  deps: Deps = defaultDeps(),
): Promise<Rate> {
  if (from === to) return { rate: 1, source: 'frankfurter', fetchedAt: deps.now() };

  const key = cacheKey(from, to);
  const cached = deps.cache ? await deps.cache.match(key) : undefined;
  const saved = cached ? await cached.json<Rate>() : null;
  if (saved && deps.now() - saved.fetchedAt < FRESH_MS) return saved;

  const sources: [Rate['source'], typeof fromWise][] = [
    ['wise', fromWise],
    ['frankfurter', fromFrankfurter],
  ];
  for (const [source, fetchRate] of sources) {
    try {
      const rate = await fetchRate(env, from, to, deps);
      if (rate == null) continue;
      const fresh: Rate = { rate, source, fetchedAt: deps.now() };
      await deps.cache?.put(
        key,
        new Response(JSON.stringify(fresh), {
          headers: { 'Cache-Control': `max-age=${KEEP_SECONDS}` },
        }),
      );
      return fresh;
    } catch (err) {
      console.error(err);
    }
  }

  // Both down: an older rate beats none
  if (saved) return saved;
  throw new RatesUnavailable(`No rate for ${from} to ${to} right now`);
}
