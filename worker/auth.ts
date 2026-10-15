// Identifies the signed-in user from the Cloudflare Access token on each request.
// In production every request must carry a valid Access JWT; locally (no Access in
// front of `wrangler dev`) DEV_USER_EMAIL stands in, overridable per request with
// an X-Dev-User header so tests can act as several people.

export interface AuthEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_USER_EMAIL?: string;
}

interface AccessJwk extends JsonWebKey {
  kid: string;
}

const KEYS_TTL_MS = 60 * 60 * 1000;
let keyCache: { url: string; keys: Map<string, CryptoKey>; fetchedAt: number } | null = null;

const decodeBase64Url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

// Token fields as read from the wire; each one is checked before it's trusted
interface JwtHeader {
  kid?: unknown;
}
interface JwtPayload {
  aud?: unknown;
  iss?: unknown;
  exp?: unknown;
  nbf?: unknown;
  email?: unknown;
}

const decodeJson = <T>(s: string) => JSON.parse(new TextDecoder().decode(decodeBase64Url(s))) as T;

async function getSigningKey(certsUrl: string, kid: string): Promise<CryptoKey | undefined> {
  const fresh =
    keyCache != null && keyCache.url === certsUrl && Date.now() - keyCache.fetchedAt < KEYS_TTL_MS;
  // Refetch on an unknown kid too, so a key rotation doesn't lock everyone out for an hour
  if (fresh && keyCache!.keys.has(kid)) return keyCache!.keys.get(kid);

  const res = await fetch(certsUrl);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const { keys } = await res.json<{ keys: AccessJwk[] }>();

  const imported = new Map<string, CryptoKey>();
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA') continue;
    imported.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }
  keyCache = { url: certsUrl, keys: imported, fetchedAt: Date.now() };
  return imported.get(kid);
}

/** Returns the token's email if it is a valid Access token for this app, otherwise null. */
async function verifyAccessJwt(
  token: string,
  teamDomain: string,
  aud: string,
): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [rawHeader, rawPayload, rawSignature] = parts;

  // A token that can't be read is simply not valid; failing to fetch the team's keys is
  // an outage, which reaches the error handler instead of looking like being signed out
  const header = readable(() => decodeJson<JwtHeader>(rawHeader));
  // Always verified as RS256 with the team's key, whatever alg the token claims
  if (typeof header?.kid !== 'string') return null;

  const team = teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const key = await getSigningKey(`https://${team}/cdn-cgi/access/certs`, header.kid);
  if (key == null) return null;

  const signature = readable(() => decodeBase64Url(rawSignature));
  if (signature == null) return null;
  const valid = await crypto.subtle
    .verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
    )
    .catch(() => false);
  if (!valid) return null;

  const payload = readable(() => decodeJson<JwtPayload>(rawPayload));
  if (payload == null) return null;
  const audiences: unknown[] = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const nowSeconds = Date.now() / 1000;
  if (payload.iss !== `https://${team}`) return null;
  if (!audiences.includes(aud)) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= nowSeconds) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) return null;
  if (typeof payload.email !== 'string' || payload.email === '') return null;

  return payload.email.toLowerCase();
}

/** What `decode` returns, or null when the token part isn't valid base64url or JSON */
function readable<T>(decode: () => T): T | null {
  try {
    return decode();
  } catch {
    return null;
  }
}

const readCookie = (req: Request, name: string) =>
  req.headers
    .get('Cookie')
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];

/** The signed-in user's email, or null. Fails closed when Access isn't configured. */
export async function getUserEmail(req: Request, env: AuthEnv): Promise<string | null> {
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const token = req.headers.get('Cf-Access-Jwt-Assertion') ?? readCookie(req, 'CF_Authorization');
    if (!token) return null;
    return verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  }

  if (env.DEV_USER_EMAIL) {
    return (req.headers.get('X-Dev-User') ?? env.DEV_USER_EMAIL).toLowerCase();
  }

  return null;
}
