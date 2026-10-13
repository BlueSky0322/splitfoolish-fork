import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { getUserEmail } from './auth';

const TEAM = 'splitfoolish.cloudflareaccess.com';
const AUD = 'app-audience-tag';
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

const encode = (value: unknown) =>
  btoa(typeof value === 'string' ? value : JSON.stringify(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const bytesToBase64Url = (bytes: ArrayBuffer) =>
  encode(String.fromCharCode(...new Uint8Array(bytes)));

const generateKey = () =>
  crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  ) as Promise<CryptoKeyPair>;

let teamKey: CryptoKeyPair;
let otherKey: CryptoKeyPair;

async function sign(payload: Record<string, unknown>, key = teamKey, kid = 'team-key') {
  const unsigned = `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode(payload)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key.privateKey,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${bytesToBase64Url(signature)}`;
}

const validClaims = () => ({
  iss: `https://${TEAM}`,
  aud: [AUD],
  email: 'Ryan@Example.com',
  exp: Math.floor(Date.now() / 1000) + 600,
  iat: Math.floor(Date.now() / 1000),
});

const requestWith = (token?: string, headers: Record<string, string> = {}) =>
  new Request('https://splitfoolish.example/api/me', {
    headers: token ? { 'Cf-Access-Jwt-Assertion': token, ...headers } : headers,
  });

beforeAll(async () => {
  teamKey = await generateKey();
  otherKey = await generateKey();
  const jwk = await crypto.subtle.exportKey('jwk', teamKey.publicKey);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === `https://${TEAM}/cdn-cgi/access/certs`
        ? Response.json({ keys: [{ ...jwk, kid: 'team-key' }] })
        : new Response('not found', { status: 404 }),
    ),
  );
});

afterEach(() => {
  vi.mocked(fetch).mockClear();
});

describe('getUserEmail with Cloudflare Access configured', () => {
  test('accepts a valid Access token and returns its email, lowercased', async () => {
    expect(await getUserEmail(requestWith(await sign(validClaims())), env)).toBe(
      'ryan@example.com',
    );
  });

  test('also reads the token from the CF_Authorization cookie', async () => {
    const token = await sign(validClaims());
    const req = new Request('https://splitfoolish.example/api/me', {
      headers: { Cookie: `other=1; CF_Authorization=${token}` },
    });
    expect(await getUserEmail(req, env)).toBe('ryan@example.com');
  });

  // Each case changes one thing about an otherwise valid token
  test.each([
    ['another Access app (wrong audience)', async () => sign({ ...validClaims(), aud: ['other'] })],
    [
      'another team (wrong issuer)',
      async () => sign({ ...validClaims(), iss: 'https://evil.cloudflareaccess.com' }),
    ],
    [
      'an expired token',
      async () => sign({ ...validClaims(), exp: Math.floor(Date.now() / 1000) - 1 }),
    ],
    [
      'a token not valid yet',
      async () => sign({ ...validClaims(), nbf: Math.floor(Date.now() / 1000) + 600 }),
    ],
    ['a token with an empty email', async () => sign({ ...validClaims(), email: '' })],
    ['a token signed by another key under the team kid', async () => sign(validClaims(), otherKey)],
    ['a token signed by an unknown key', async () => sign(validClaims(), otherKey, 'unknown-kid')],
    [
      'a token whose claims were edited after signing',
      async () => {
        const [header, , signature] = (await sign(validClaims())).split('.');
        return `${header}.${encode({ ...validClaims(), email: 'attacker@example.com' })}.${signature}`;
      },
    ],
    ['a malformed token', async () => 'not-a-jwt'],
  ])('rejects %s', async (_name, makeToken) => {
    expect(await getUserEmail(requestWith(await makeToken()), env)).toBeNull();
  });

  test('rejects a request with no token', async () => {
    expect(await getUserEmail(requestWith(), env)).toBeNull();
  });

  test('ignores the local-dev X-Dev-User override', async () => {
    const devEnv = { ...env, DEV_USER_EMAIL: 'dev@example.com' };
    expect(
      await getUserEmail(requestWith(undefined, { 'X-Dev-User': 'a@b.c' }), devEnv),
    ).toBeNull();
  });
});

describe('getUserEmail without Cloudflare Access configured', () => {
  test('refuses everyone unless a local dev user is set', async () => {
    expect(await getUserEmail(requestWith(undefined, { 'X-Dev-User': 'a@b.c' }), {})).toBeNull();
  });

  test('uses the local dev user, overridable per request', async () => {
    const devEnv = { DEV_USER_EMAIL: 'Dev@Example.com' };
    expect(await getUserEmail(requestWith(), devEnv)).toBe('dev@example.com');
    expect(
      await getUserEmail(requestWith(undefined, { 'X-Dev-User': 'Sam@Example.com' }), devEnv),
    ).toBe('sam@example.com');
  });
});
