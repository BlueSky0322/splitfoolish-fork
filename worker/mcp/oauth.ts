// Signing an agent in to Splitfoolish over OAuth, so it can use the MCP tools as one
// account. The provider library (@cloudflare/workers-oauth-provider) runs the protocol:
// discovery, client registration, the token endpoint, refresh and revocation, and the
// bearer check in front of /mcp. This file owns the one page the library leaves to the
// app, /oauth/authorize, where the person signed in through Cloudflare Access sees
// which app is asking and what it may do, and allows or denies it.
//
// The account a grant acts as is always the one Access verified on that page: never an
// email from the agent, the address or the form.

import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import OAuthProvider, { AuthorizationError } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../app';
import { getUserEmail } from '../accounts/auth';
import { bodyRefused, isCrossSiteWrite, readBody } from '../http';
import { mcpHandler } from './server';
import { READ_SCOPE, SCOPES, WRITE_SCOPE } from './scopes';

/** What a grant carries to each MCP request: the account it acts as */
export interface GrantProps {
  email: string;
}

const AUTHORIZE_PATH = '/oauth/authorize';

/** The consent form is a handle, a decision and a few scopes: far less than this */
const MAX_CONSENT_BYTES = 16 * 1024;

// Everything each scope lets an agent do, removing things included: the tools in
// tools.ts that check it (docs/mcp.md lists them)
const SCOPE_LABELS: Record<string, string> = {
  [READ_SCOPE]: 'See your splits: their people, expenses, balances and photos',
  [WRITE_SCOPE]:
    'Change your splits as you can yourself: make splits, add, change and remove ' +
    'expenses and photos, add or rename people, and choose who payments go through',
};

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The app's look (web/src/theme/tokens.css and theme.ts, Blurple accent), copied here
// because the Worker can't import the app. It follows the device's light or dark
// setting, since the page can't see the account's.
const STYLE = `
:root{--bg:#161826;--surface:#232532;--text:#e9e9ed;--accent:#9184d9;--shadow:0 0 0 1px #3f424d;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#eceef6;--surface:#f8f9fd;--text:#1e202b;--accent:#6a5db3;--shadow:0 0 0 1px #cfd3e5;color-scheme:light}}
:root{--border:color-mix(in srgb,var(--text) 22%,transparent);--muted:color-mix(in srgb,var(--text) 58%,transparent);--tint:color-mix(in srgb,var(--text) 5%,transparent)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--text);font:15px/1.5 Inter,system-ui,sans-serif;font-optical-sizing:auto;letter-spacing:-0.006em;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:440px;background:var(--surface);border-radius:14px;box-shadow:var(--shadow);padding:28px 24px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:20px;font-weight:500}
.brand svg{width:28px;height:28px}
h1{font-size:20px;font-weight:500;letter-spacing:-0.02em;line-height:1.3;margin:0 0 12px}
p{margin:0 0 12px}
.muted{color:var(--muted);font-size:13px}
.warn{border:1px solid var(--accent);border-radius:8px;padding:10px 12px}
.label{font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin:20px 0 8px}
.scope{display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;border-radius:8px;background:var(--tint);cursor:pointer}
.scope input{width:18px;height:18px;margin:0;accent-color:var(--accent)}
.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
button{font:inherit;font-weight:500;padding:8px 18px;border-radius:8px;background:transparent;cursor:pointer;border:1px solid var(--border);color:var(--text)}
button:hover{background:color-mix(in srgb,var(--accent) 10%,transparent)}
button.primary{border-color:var(--accent);color:var(--accent)}
button.primary:hover{background:color-mix(in srgb,var(--accent) 12%,transparent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`;

// The app icon (web/public/icon.svg)
const LOGO = `<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#161826"/><g transform="translate(112 112) scale(1.125)"><path fill="#9184d9" d="M232.49,192.49l-32,32a12,12,0,0,1-17,0l-32-32a12,12,0,0,1,17-17L180,187V141L128,89,76,141V187l11.51-11.52a12,12,0,0,1,17,17l-32,32a12,12,0,0,1-17,0l-32-32a12,12,0,1,1,17-17L52,187V136a12,12,0,0,1,3.51-8.49L116,67V24a12,12,0,0,1,24,0V67l60.49,60.48A12,12,0,0,1,204,136v51l11.51-11.52a12,12,0,0,1,17,17Z"/></g></svg>`;

const page = (status: number, body: string, headers = new Headers()) => {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Splitfoolish</title><link rel="icon" type="image/svg+xml" href="/icon.svg">` +
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..600&display=swap">` +
      `<style>${STYLE}</style><body><main><div class="brand">${LOGO}Splitfoolish</div>${body}</main>`,
    { status, headers },
  );
};

const problem = (status: number, message: string) =>
  page(status, `<h1>Can't connect this app</h1><p class="muted">${escape(message)}</p>`);

/** The consent page: who is asking, where access goes, and what it may do */
async function showConsent(oauth: OAuthHelpers, request: AuthRequest, email: string) {
  const details = await oauth.describeConsent(request);
  // Everything this server grants, ticked, whatever the client asked for, so an app
  // that asked for less can still be allowed to add expenses; the person unticks what
  // it shouldn't do. Other scopes the client asked for are left out.
  const offered = SCOPES;
  const consent = await oauth.beginConsent(request);
  const name = escape(details.clientName);
  return page(
    200,
    `<h1>Allow ${name} to use Splitfoolish as you?</h1>
<p>Signed in as <strong>${escape(email)}</strong>.</p>
<p class="muted">${
      details.clientDomain
        ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
        : 'This app named itself; its name is not verified.'
    } Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${
  details.redirectIsLoopback
    ? '<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting it.</p>'
    : ''
}
<form method="post">
<input type="hidden" name="handle" value="${escape(consent.handle)}">
<div class="label">It may</div>
${offered
  .map(
    (s) =>
      `<label class="scope"><input type="checkbox" name="scope" value="${escape(s)}" checked> ${escape(SCOPE_LABELS[s] ?? s)}</label>`,
  )
  .join('\n')}
<p class="muted">It acts as you: anything it adds or changes is saved under your account, whoever asked it to.</p>
<div class="actions"><button name="decision" value="deny">Deny</button><button class="primary" name="decision" value="approve">Allow</button></div>
</form>`,
    consent.headers,
  );
}

/** Saves the person's answer and sends the browser back to the app that asked */
async function answerConsent(oauth: OAuthHelpers, req: Request, email: string) {
  // The page's own small form: a handle, a decision and the scopes ticked
  const body = await readBody(req, MAX_CONSENT_BYTES);
  if (typeof body === 'string') return bodyRefused(body);
  const form = new URLSearchParams(new TextDecoder().decode(body));
  const posted = form.get('handle');
  const handle = typeof posted === 'string' ? posted : '';
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(req, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const scope = form
    .getAll('scope')
    .map(String)
    .filter((s) => SCOPES.includes(s));
  if (scope.length === 0) return problem(400, 'Choose at least one thing it may do.');
  const approved = await oauth.approveConsent(req, handle, { scope });
  const props: GrantProps = { email };
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    // Grant ids can't hold ':'
    userId: encodeURIComponent(email),
    metadata: {},
    scope,
    props,
  });
  approved.headers.set('Location', redirectTo);
  approved.headers.set('Cache-Control', 'no-store');
  return new Response(null, { status: 302, headers: approved.headers });
}

/** Everything on the OAuth routes that the provider leaves to the app */
const oauthPages: ExportedHandler<Env & { OAUTH_PROVIDER: OAuthHelpers }> = {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname !== AUTHORIZE_PATH) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    if (req.method === 'POST' && isCrossSiteWrite(req, url)) {
      return problem(403, 'Not allowed from another site.');
    }
    // The page sits behind Cloudflare Access, which signs the person in; verified here
    // again on every request, as the API does
    const email = await getUserEmail(req, env);
    if (email == null) return problem(401, 'Sign in to Splitfoolish first, then try again.');
    const oauth = env.OAUTH_PROVIDER;
    try {
      if (req.method === 'POST') return await answerConsent(oauth, req, email);
      if (req.method !== 'GET') return problem(405, 'Not supported.');
      return await showConsent(oauth, await oauth.parseAuthRequest(req), email);
    } catch (err) {
      if (err instanceof AuthorizationError) {
        // Back to the app only once the library has checked where "back" is
        if (err.redirectTo) return Response.redirect(err.redirectTo, 302);
        return problem(
          400,
          err.description ?? 'This request is not valid. Start again from the app.',
        );
      }
      throw err;
    }
  },
};

const REGISTER_PATH = '/oauth/register';
/** What an agent app may send when it registers: real ones send well under 2 KiB */
const MAX_REGISTRATION_BYTES = 16 * 1024;
const MAX_CLIENT_NAME = 100;
const MAX_URI_LENGTH = 512;
const MAX_REDIRECT_URIS = 5;
/** How long a registered app is kept; signing in again within it keeps using it */
const REGISTRATION_TTL_S = 90 * 24 * 60 * 60;

const URI_FIELDS = ['client_uri', 'logo_uri', 'policy_uri', 'tos_uri', 'jwks_uri'];

/**
 * Why an app's registration is refused before anything of it is kept, or nothing: a
 * name, addresses and contacts of a sensible size. The provider checks the rest
 * (redirect addresses, grant types) as OAuth says.
 */
export function registrationRefusal(metadata: Record<string, unknown>): string | null {
  const name = metadata.client_name;
  if (name != null && (typeof name !== 'string' || name.length > MAX_CLIENT_NAME)) {
    return `client_name must be at most ${MAX_CLIENT_NAME} characters`;
  }
  const redirects = metadata.redirect_uris;
  if (Array.isArray(redirects)) {
    if (redirects.length > MAX_REDIRECT_URIS) {
      return `At most ${MAX_REDIRECT_URIS} redirect_uris`;
    }
    if (redirects.some((u) => typeof u !== 'string' || u.length > MAX_URI_LENGTH)) {
      return `Each redirect_uri must be at most ${MAX_URI_LENGTH} characters`;
    }
  }
  for (const field of URI_FIELDS) {
    const value = metadata[field];
    if (value != null && (typeof value !== 'string' || value.length > MAX_URI_LENGTH)) {
      return `${field} must be at most ${MAX_URI_LENGTH} characters`;
    }
  }
  const contacts = metadata.contacts;
  if (contacts != null && (!Array.isArray(contacts) || contacts.length > 5)) {
    return 'At most 5 contacts';
  }
  return null;
}

const oauthError = (status: number, error: string, description: string) =>
  Response.json(
    { error, error_description: description },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );

/**
 * Registering is open to anyone, as MCP clients register themselves: so it's budgeted
 * before the provider reads or keeps anything, per address as Cloudflare sees it (its
 * own CF-Connecting-IP, which a client can't set) and from everywhere, and its body is
 * read only so far
 */
async function admitRegistration(req: Request, env: Env): Promise<Request | Response> {
  const address = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const [mine, everyone] = await Promise.all([
    env.REGISTER_LIMITER.limit({ key: address }),
    env.REGISTER_ALL_LIMITER.limit({ key: 'all' }),
  ]);
  if (!mine.success || !everyone.success) {
    return oauthError(429, 'temporarily_unavailable', 'Too many apps registering; try again soon');
  }
  const body = await readBody(req, MAX_REGISTRATION_BYTES);
  if (body === 'too large') {
    return oauthError(413, 'invalid_client_metadata', 'Registration is too large');
  }
  if (body === 'too slow') return bodyRefused(body);
  return new Request(req.url, { method: req.method, headers: req.headers, body });
}

const providers = new Map<string, OAuthProvider<Env>>();

/** The provider for this deployment's address, made once per Worker instance */
function providerFor(origin: string) {
  let provider = providers.get(origin);
  if (provider == null) {
    provider = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: mcpHandler,
      defaultHandler: oauthPages as ExportedHandler<Env>,
      authorizeEndpoint: AUTHORIZE_PATH,
      tokenEndpoint: '/oauth/token',
      // MCP clients such as Hermes, Claude and MCP Inspector register themselves here;
      // a registered app still gets nothing until someone allows it on the page above
      clientRegistrationEndpoint: REGISTER_PATH,
      clientRegistrationTTL: REGISTRATION_TTL_S,
      // Refused before anything is kept
      clientRegistrationCallback: ({ clientMetadata }) => {
        const refusal = registrationRefusal(clientMetadata);
        return refusal == null ? undefined : { description: refusal };
      },
      scopesSupported: [...SCOPES, 'offline_access'],
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        resource_name: 'Splitfoolish',
      },
      // What clients are told to ask for (resource metadata and the 401 challenge); the
      // provider doesn't hold tokens to it, each tool checks its own scope
      requiredScopes: SCOPES,
    });
    providers.set(origin, provider);
  }
  return provider;
}

/**
 * Answers /mcp, /oauth/* and /.well-known/*. Off (404) until the deployment says where
 * it lives (MCP_ORIGIN) and has somewhere to keep grants (OAUTH_KV).
 */
export async function handleOAuthRoute(req: Request, env: Env, ctx: ExecutionContext) {
  if (!env.MCP_ORIGIN || env.OAUTH_KV == null) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const provider = providerFor(new URL(env.MCP_ORIGIN).origin);
  if (req.method === 'POST' && new URL(req.url).pathname === REGISTER_PATH) {
    const admitted = await admitRegistration(req, env);
    if (admitted instanceof Response) return admitted;
    return provider.fetch(admitted, env, ctx);
  }
  return provider.fetch(req, env, ctx);
}
