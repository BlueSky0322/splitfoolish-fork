// Small helpers every part of the API uses to answer and to read what it was sent

import type { ApiErrorBody, Ok } from '../shared/api';
import { MAX_NAME_LENGTH } from '../shared/types';

/**
 * Responds with JSON. Every call names the response's type from shared/api.ts
 * (json<SplitDetail>(…)), which the app reads with the same type: without one, the
 * body is `never` and nothing compiles.
 */
export const json = <T = never>(body: NoInfer<T>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
  });

export const ok = () => json<Ok>({ ok: true });

/** Refuses a request, saying why */
export const fail = (error: string, status: number, extra?: Omit<ApiErrorBody, 'error'>) =>
  json<ApiErrorBody>({ error, ...extra }, status);

export const notFound = () => fail('Not found', 404);

/** Whether a D1 error is a constraint failing (a missing parent row, a duplicate key) */
export const isConstraintError = (err: unknown) => String(err).includes('CONSTRAINT');

/** A new id for a row: 16 hex characters */
export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

/** A currency code, like MYR */
export const CURRENCY = /^[A-Z]{3}$/;

/** A name as sent, trimmed; null when it's missing, empty or too long */
export const readName = (value: unknown) => {
  const name = typeof value === 'string' ? value.trim() : '';
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null;
};
