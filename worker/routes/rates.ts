// Exchange rates for the app's live preview when an item is in another currency. The
// rate actually saved with an item is fetched again by the server when it's saved.

import { Hono } from 'hono';
import { convertCents } from '../../shared/rates';
import { AppEnv, json } from '../app';
import { CURRENCY } from '../profiles';
import { RatesUnavailable, getRate } from '../rates';

const MAX_AMOUNT = 1_000_000_000;

const rates = new Hono<AppEnv>();

rates.get('/rates', async (c) => {
  const from = c.req.query('from')?.toUpperCase() ?? '';
  const to = c.req.query('to')?.toUpperCase() ?? '';
  if (!CURRENCY.test(from) || !CURRENCY.test(to)) {
    return json({ error: 'Give from and to as currency codes, like USD' }, 400);
  }
  const rawAmount = c.req.query('amount');
  const amount = rawAmount == null ? null : Number(rawAmount);
  if (amount != null && (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT)) {
    return json({ error: 'Amount must be a number of 0 or more' }, 400);
  }

  try {
    const { rate, source, fetchedAt } = await getRate(c.env, from, to);
    return json({
      from,
      to,
      rate,
      source,
      fetchedAt,
      ...(amount != null && { convertedCents: convertCents(Math.round(amount * 100), rate) }),
    });
  } catch (err) {
    if (err instanceof RatesUnavailable) return json({ error: err.message }, 503);
    throw err;
  }
});

export default rates;
