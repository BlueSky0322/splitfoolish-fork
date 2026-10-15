// Exchange rates for the app's live preview when an item is in another currency. The
// rate actually saved with an item is fetched again by the server when it's saved.

import { Hono } from 'hono';
import type { RateQuote, UsedCurrencyRate, UsedCurrencyRates } from '../../shared/api';
import { convertCents, isCurrency, toCents } from '../../shared/rates';
import { MAX_COST } from '../../shared/types';
import type { AppEnv } from '../app';
import { json, fail } from '../http';
import { getRatePreference } from '../profiles';
import { REFRESH_MAX_AGE_MS, RatesUnavailable, getRate, rateOrNull } from '../exchange-rates';
import { listUsedCurrencies } from '../summaries';

const rates = new Hono<AppEnv>();

rates.get('/rates', async (c) => {
  const from = c.req.query('from')?.toUpperCase() ?? '';
  const to = c.req.query('to')?.toUpperCase() ?? '';
  if (!isCurrency(from) || !isCurrency(to)) {
    return fail('Give from and to as currency codes, like USD', 400);
  }
  const rawAmount = c.req.query('amount');
  const amount = rawAmount == null ? null : Number(rawAmount);
  if (amount != null && (!Number.isFinite(amount) || amount < 0 || amount > MAX_COST)) {
    return fail(`Amount must be between 0 and ${MAX_COST.toLocaleString('en-US')}`, 400);
  }

  try {
    const prefer = await getRatePreference(c.env.DB, c.var.email);
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

// The other currencies in your splits, how many splits each is in, and today's rate into
// `to`, all in one go for Settings
rates.get('/me/rates', async (c) => {
  const to = c.req.query('to')?.toUpperCase() ?? '';
  if (!isCurrency(to)) return fail('Give to as a currency code, like MYR', 400);
  const [used, prefer] = await Promise.all([
    listUsedCurrencies(c.env.DB, c.var.email, to),
    getRatePreference(c.env.DB, c.var.email),
  ]);
  const currencies = await Promise.all(
    used.map(async ({ currency, splits }): Promise<UsedCurrencyRate> => {
      // One rate missing doesn't hide the rest
      const found = await rateOrNull(c.env, currency, to, { prefer });
      return { currency, splits, rate: null, source: null, fetchedAt: null, ...found };
    }),
  );
  return json<UsedCurrencyRates>({ to, currencies });
});

export default rates;
