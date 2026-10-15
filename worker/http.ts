// Small helpers every part of the API uses to answer and to read what it was sent

import { type ApiErrorBody, CLIENT_ID_HEADER, type Ok } from '../shared/api';
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

export const fail = (error: string, status: number) => json<ApiErrorBody>({ error }, status);

export const notFound = () => fail('Not found', 404);

/** Whether a D1 error is a constraint failing (a missing parent row, a duplicate key) */
export const isConstraintError = (err: unknown) => String(err).includes('CONSTRAINT');

/** A new id for a row: 16 hex characters */
export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

/** An id the app made, shaped like newId's, for a row it can refer to before it's saved */
export const isClientId = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);

/** A name as sent, trimmed; null when it's missing, empty or too long */
export const readName = (value: unknown) => {
  const name = typeof value === 'string' ? value.trim() : '';
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null;
};

/**
 * Whether a request came from a page on another site. Browsers say where a request
 * came from in Sec-Fetch-Site; older ones only in Origin.
 */
export function isCrossSite(req: Request, url: URL): boolean {
  const site = req.headers.get('Sec-Fetch-Site');
  if (site != null) return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.get('Origin');
  return origin != null && origin !== url.origin;
}

/**
 * True for a change (not a read) started by another site. The sign-in cookie rides
 * along with such requests, so without this a page elsewhere could, say, open a share
 * link or post changes on someone's behalf.
 */
export const isCrossSiteWrite = (req: Request, url: URL) =>
  req.method !== 'GET' && req.method !== 'HEAD' && isCrossSite(req, url);

/** The tab that sent a request, as the app identifies itself */
export const clientId = (req: Request) => req.headers.get(CLIENT_ID_HEADER)?.slice(0, 64) ?? null;

const MAX_BODY_BYTES = 256 * 1024;

/** A request body as sent: the field names the contract gives, each value still to check */
export type Unchecked<T> = { [K in keyof T]?: unknown };

/** The JSON body of a request, as the fields of T (in shared/api.ts) still to be checked */
export async function readJson<T>(req: Request): Promise<Unchecked<T> | Response> {
  // Turned away before reading when it says it's too big; checked again after, as the
  // header can be missing or wrong
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY_BYTES) {
    return fail('Too large', 413);
  }
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return fail('Too large', 413);
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (body == null || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    return fail('Invalid JSON', 400);
  }
}
