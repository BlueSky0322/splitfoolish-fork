// Exchange rates for the app's live preview when an item is in another currency. The
// rate actually saved with an item is fetched again by the server when it's saved.

import { Hono } from 'hono';
import type { RateQuote, UsedCurrencyRate, UsedCurrencyRates } from '../../shared/api';
import { convertCents, toCents } from '../../shared/rates';
import { AppEnv } from '../app';
import { json, fail } from '../http';
import { CURRENCY, getRateSource } from '../profiles';
import { REFRESH_MAX_AGE_MS, RatesUnavailable, getRate } from '../rates';

const MAX_AMOUNT = 1_000_000_000;

const rates = new Hono<AppEnv>();

rates.get('/rates', async (c) => {
  const from = c.req.query('from')?.toUpperCase() ?? '';
  const to = c.req.query('to')?.toUpperCase() ?? '';
  if (!CURRENCY.test(from) || !CURRENCY.test(to)) {
    return fail('Give from and to as currency codes, like USD', 400);
  }
  const rawAmount = c.req.query('amount');
  const amount = rawAmount == null ? null : Number(rawAmount);
  if (amount != null && (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT)) {
    return fail('Amount must be a number of 0 or more', 400);
  }

  try {
    const prefer = await getRateSource(c.env.DB, c.var.email);
    // Refresh asks for a recent rate rather than one from hours ago
    const maxAgeMs = c.req.query('fresh') != null ? REFRESH_MAX_AGE_MS : undefined;
    const { rate, source, fetchedAt } = await getRate(c.env, from, to, {
      prefer,
      maxAgeMs,
    });
    return json<RateQuote>({
      from,
      to,
      rate,
      source,
      fetchedAt,
      ...(amount != null && { convertedCents: convertCents(toCents(amount), rate) }),
    });
  } catch (err) {
    if (err instanceof RatesUnavailable) return fail(err.message, 503);
    throw err;
  }
});

/** At most this many currencies in Settings' "Rates in your splits" */
const MAX_USED = 12;

// The other currencies in your splits (theirs, and items paid in another one), how many
// splits each is in, and today's rate into `to`, all in one go for Settings
rates.get('/me/rates', async (c) => {
  const to = c.req.query('to')?.toUpperCase() ?? '';
  if (!CURRENCY.test(to)) return fail('Give to as a currency code, like MYR', 400);
  const used = await c.env.DB.prepare(
    `SELECT cur AS currency, count(DISTINCT split_id) AS splits FROM (
       SELECT s.currency AS cur, s.id AS split_id
         FROM splits s JOIN split_members m ON m.split_id = s.id WHERE m.email = ?1
       UNION ALL
       SELECT i.original_currency, i.split_id
         FROM items i JOIN split_members m ON m.split_id = i.split_id
         WHERE m.email = ?1 AND i.original_currency IS NOT NULL
     ) WHERE cur != ?2 GROUP BY cur ORDER BY splits DESC, cur LIMIT ${MAX_USED}`,
  )
    .bind(c.var.email, to)
    .all<{ currency: string; splits: number }>();

  const prefer = await getRateSource(c.env.DB, c.var.email);
  const currencies = await Promise.all(
    used.results.map(async ({ currency, splits }) => {
      try {
        const { rate, source, fetchedAt } = await getRate(c.env, currency, to, {
          prefer,
        });
        return { currency, splits, rate, source, fetchedAt } satisfies UsedCurrencyRate;
      } catch (err) {
        // One rate missing doesn't hide the rest
        if (err instanceof RatesUnavailable) {
          return {
            currency,
            splits,
            rate: null,
            source: null,
            fetchedAt: null,
          } satisfies UsedCurrencyRate;
        }
        throw err;
      }
    }),
  );
  return json<UsedCurrencyRates>({ to, currencies });
});

export default rates;
