// Exchange rates for converting items into a split's currency. Wise's live mid-market
// rate when a token is set, else the ECB's daily rate from Frankfurter (free, no key).
// Each pair is kept in Cloudflare's cache and reused for 4 hours, so a day costs the
// services a few requests per pair, and a day-old rate still serves if both are down.
// Refresh in the Currencies sheet asks for one no older than 10 minutes.

import {
  DEFAULT_SETTINGS,
  type FetchedRateSource,
  RATE_PREFERENCES,
  RATE_PROVIDERS,
  type RatePreference,
} from '../shared/api';
import { isValidRate } from '../shared/rates';

export interface RatesEnv {
  /** Wise personal API token (a Worker secret); without it Wise is skipped */
  WISE_TOKEN?: string;
  /** Overridable so tests can stand in for the services */
  WISE_BASE?: string;
  FRANKFURTER_BASE?: string;
}

export interface Rate {
  rate: number;
  source: FetchedRateSource;
  /** When the rate was fetched from the service, in ms */
  fetchedAt: number;
}

export class RatesUnavailable extends Error {}

/** Fresh for this long; older copies are refetched but still used if that fails */
const FRESH_MS = 4 * 60 * 60 * 1000;
/** How old a rate may be when someone presses Refresh */
export const REFRESH_MAX_AGE_MS = 10 * 60 * 1000;
/** How long Cloudflare keeps a copy at all */
const KEEP_SECONDS = 24 * 60 * 60;
const TIMEOUT_MS = 4000;

export interface Deps {
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

export interface RateOptions {
  /** Use a cached rate younger than this rather than fetching */
  maxAgeMs?: number;
  /** Wise first (the default), or the ECB first for people who picked it in Settings */
  prefer?: RatePreference;
  /** The network, cache and clock; tests stand in for them */
  deps?: Deps;
}

const cacheKey = (from: string, to: string, prefer: RatePreference) =>
  `https://rates.internal/v1/${prefer}/${from}/${to}`;

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

const FETCHERS: Record<FetchedRateSource, typeof fromWise> = {
  wise: fromWise,
  frankfurter: fromFrankfurter,
};

/** The rate to convert `from` into `to`: 1 unit of `from` is `rate` units of `to` */
export async function getRate(
  env: RatesEnv,
  from: string,
  to: string,
  {
    maxAgeMs = FRESH_MS,
    prefer = DEFAULT_SETTINGS.ratePreference,
    deps = defaultDeps(),
  }: RateOptions = {},
): Promise<Rate> {
  if (from === to) return { rate: 1, source: RATE_PROVIDERS.ecb, fetchedAt: deps.now() };

  const key = cacheKey(from, to, prefer);
  const cached = deps.cache ? await deps.cache.match(key) : undefined;
  const saved = cached ? await cached.json<Rate>() : null;
  if (saved && deps.now() - saved.fetchedAt < maxAgeMs) return saved;

  // The ECB doesn't publish every currency, so the other service is always the fallback
  const order = [prefer, ...RATE_PREFERENCES.filter((p) => p !== prefer)];
  for (const preference of order) {
    const source = RATE_PROVIDERS[preference];
    let rate: number | null;
    try {
      rate = await FETCHERS[source](env, from, to, deps);
    } catch (err) {
      console.error(err);
      continue;
    }
    if (rate == null) continue;
    const fresh: Rate = { rate, source, fetchedAt: deps.now() };
    // Keeping a copy is a bonus: a rate that can't be cached is still the rate
    await deps.cache
      ?.put(
        key,
        new Response(JSON.stringify(fresh), {
          headers: { 'Cache-Control': `max-age=${KEEP_SECONDS}` },
        }),
      )
      .catch((err: unknown) => console.error(err));
    return fresh;
  }

  // Both down: an older rate beats none
  if (saved) return saved;
  throw new RatesUnavailable(`No rate for ${from} to ${to} right now`);
}
