// Retrying currency conversions that failed (usually because both rate services were
// down), so a split never stays stuck converting just because nobody opens it. The
// first attempt runs straight after the change (startReconvert in splits/lifecycle.ts);
// only a failed one comes here, through the reconvert queue (wrangler.jsonc). Each retry
// waits longer than the last; after max_retries the job goes to reconvert-dlq, and
// opening the split still retries it (retryStalledReconvert).

import type { Env } from '../app';
import { getRate } from './exchange-rates';
import { getRatePreference } from '../accounts/profiles';
import { FIRST_RETRY_S, type ReconvertJob, reconvertSplit, retryDelaySeconds } from './reconvert';
import { notifySplit } from '../splits/room';

/** Seconds before the next try; RECONVERT_RETRY_DELAY_S (for tests) sets every wait */
export function retryDelay(env: Pick<Env, 'RECONVERT_RETRY_DELAY_S'>, attempts: number | null) {
  const configured = Number.parseInt(env.RECONVERT_RETRY_DELAY_S ?? '', 10);
  if (!Number.isNaN(configured)) return configured;
  return attempts == null ? FIRST_RETRY_S : retryDelaySeconds(attempts);
}

/** Queues a retry of a conversion whose first attempt failed */
export async function queueReconvert(env: Env, job: ReconvertJob) {
  try {
    await env.RECONVERT_QUEUE.send(job, { delaySeconds: retryDelay(env, null) });
  } catch (err) {
    // Opening the split still retries it
    console.error('could not queue a conversion retry', job, err);
  }
}

/** Converts the split, at the rates the person who changed its currency prefers */
async function convert(env: Env, { splitId, since, email }: ReconvertJob) {
  const prefer = await getRatePreference(env.DB, email);
  return reconvertSplit(env.DB, splitId, (from, to) => getRate(env, from, to, { prefer }), since);
}

/**
 * Converts each split asked for, telling the apps that have it open once it's done. A
 * job for a split no longer converting, or for an older change, does nothing and is
 * done with. One that fails is tried again later.
 */
export async function handleReconvertBatch(
  batch: MessageBatch<ReconvertJob>,
  env: Env,
  ctx: ExecutionContext,
) {
  for (const msg of batch.messages) {
    try {
      if (await convert(env, msg.body)) notifySplit(env, ctx, msg.body.splitId, null);
      msg.ack();
    } catch (err) {
      console.error('conversion retry failed', msg.body, `attempt ${msg.attempts}`, err);
      msg.retry({ delaySeconds: retryDelay(env, msg.attempts) });
    }
  }
}

/** Given up after max_retries: the split stays converting, and opening it still retries */
export function handleReconvertDeadLetters(batch: MessageBatch<ReconvertJob>) {
  for (const msg of batch.messages) {
    console.error('gave up retrying a conversion', msg.body);
    msg.ack();
  }
}

/** The dead-letter queue's name, as in wrangler.jsonc */
export const DEAD_LETTER_QUEUE = 'reconvert-dlq';

/** The Worker's queue handler: retries, and the ones given up on */
export const handleReconvertQueue = (
  batch: MessageBatch<ReconvertJob>,
  env: Env,
  ctx: ExecutionContext,
) =>
  batch.queue === DEAD_LETTER_QUEUE
    ? handleReconvertDeadLetters(batch)
    : handleReconvertBatch(batch, env, ctx);
