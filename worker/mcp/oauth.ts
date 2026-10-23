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
import type { OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import OAuthProvider, { AuthorizationError, getOAuthApi } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../app';
import { getUserEmail } from '../accounts/auth';
import { bodyRefused, isCrossSiteWrite, readBody } from '../http';
import { mcpHandler } from './server';
import { READ_SCOPE, SCOPES, WRITE_SCOPE } from './scopes';
import { describeDevice } from './agents';
import { getAppearance } from '../accounts/profiles';
import type { Settings } from '../../shared/api';
import { ACCENT_RAMPS, ACCENT_SHADE } from '../../shared/accents';

/** What a grant carries to each MCP request: the account it acts as */
export interface GrantProps {
  email: string;
}

const AUTHORIZE_PATH = '/oauth/authorize';

/** The consent form is a handle, a decision and a few scopes: far less than this */
const MAX_CONSENT_BYTES = 16 * 1024;

// Everything each scope lets an agent do, removing things included: the tools in
// tools.ts that check it (docs/mcp.md lists them)
const SCOPE_LABELS: Record<string, { title: string; detail: string[] }> = {
  [READ_SCOPE]: {
    title: 'See your splits',
    detail: ['Their people, expenses, balances and photos'],
  },
  [WRITE_SCOPE]: {
    title: 'Change your splits, as you can yourself',
    detail: [
      'Make splits; add, change and remove expenses and photos',
      'Record and remove payments',
      'Add, rename or remove people, and route payments through one',
    ],
  },
};

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The account's theme and accent, which the page follows as the app does */
type Appearance = Pick<Settings, 'theme' | 'accent'>;

// The app's look (web/src/theme/tokens.css and theme.ts), copied here because the Worker
// can't import the app; the accent ramps are shared. The theme is the account's, and
// "auto" follows the device, as in the app.
const COLORS = {
  dark: '--bg:#161826;--surface:#232532;--text:#e9e9ed;--shadow:0 0 0 1px #3f424d;color-scheme:dark',
  light:
    '--bg:#eceef6;--surface:#f8f9fd;--text:#1e202b;--shadow:0 0 0 1px #cfd3e5;color-scheme:light',
};

function colorsFor({ theme, accent }: Appearance) {
  const ramp = ACCENT_RAMPS[accent].ramp;
  const dark = `:root{${COLORS.dark};--accent:${ramp[ACCENT_SHADE.dark]}}`;
  const light = `:root{${COLORS.light};--accent:${ramp[ACCENT_SHADE.light]}}`;
  if (theme === 'dark') return dark;
  if (theme === 'light') return light;
  return `${dark}@media (prefers-color-scheme:light){${light}}`;
}

const STYLE = `
:root{--border:color-mix(in srgb,var(--text) 22%,transparent);--muted:color-mix(in srgb,var(--text) 58%,transparent);--secondary:color-mix(in srgb,var(--text) 70%,transparent);--label:color-mix(in srgb,var(--text) 50%,transparent);--tint:color-mix(in srgb,var(--text) 5%,transparent);--tag:color-mix(in srgb,var(--text) 9%,transparent);--accent-tint:color-mix(in srgb,var(--accent) 14%,transparent)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--bg);color:var(--text);font:15px/1.5 Inter,system-ui,sans-serif;font-optical-sizing:auto;letter-spacing:-0.006em;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:420px;background:var(--surface);border-radius:18px;box-shadow:var(--shadow);padding:28px}
.brand{display:flex;align-items:center;gap:8px;margin-bottom:24px;font-size:13px;font-weight:500;color:var(--muted)}
.brand svg{width:22px;height:22px}
h1{font-size:22px;font-weight:500;letter-spacing:-0.02em;line-height:1.25;margin:0 0 18px;overflow-wrap:anywhere}
p{margin:0}
.muted{color:var(--muted);font-size:13px}
.facts{margin:0;display:grid;grid-template-columns:auto 1fr;gap:10px 14px;align-items:center;font-size:14px}
.facts dt{color:var(--muted);white-space:nowrap}
.facts dd{margin:0;display:flex;align-items:center;gap:8px;min-width:0;font-weight:500;overflow-wrap:anywhere}
.avatar{width:24px;height:24px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center;background:var(--accent-tint);color:var(--accent);font-size:12px;font-weight:600;object-fit:cover}
.tag{font-size:11px;font-weight:500;line-height:18px;padding:0 7px;border-radius:999px;background:var(--tag);color:var(--secondary);white-space:nowrap}
.fine{margin-top:16px;font-size:13px;color:var(--muted)}
.warn{margin-top:14px;padding:10px 12px;border:1px solid var(--accent);border-radius:10px;font-size:14px}
.label{font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:0.08em;color:var(--label);margin:24px 0 10px}
.scope{display:grid;grid-template-columns:auto 1fr;gap:1px 12px;padding:12px 14px;margin-bottom:8px;border:1px solid var(--border);border-radius:12px;cursor:pointer;transition:border-color .15s,background .15s}
.scope:hover{background:var(--tint)}
.scope:has(input:checked){border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,transparent)}
.scope input{grid-row:span 2;width:18px;height:18px;margin:2px 0 0;accent-color:var(--accent)}
.scope b{font-weight:500}
.scope span,.scope ul{font-size:13px;color:var(--secondary)}
.scope ul{margin:0;padding-left:18px}
.scope li{margin-top:2px}
.actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:20px}
button{font:inherit;font-weight:500;height:42px;border-radius:10px;background:transparent;cursor:pointer;border:1px solid var(--border);color:var(--text)}
button:hover{background:var(--tint)}
button.primary{border-color:var(--accent);color:var(--accent);background:var(--accent-tint)}
button.primary:hover{background:color-mix(in srgb,var(--accent) 22%,transparent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`;

// The app icon (web/public/icon.svg)
const LOGO = `<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#161826"/><g transform="translate(112 112) scale(1.125)"><path fill="#9184d9" d="M232.49,192.49l-32,32a12,12,0,0,1-17,0l-32-32a12,12,0,0,1,17-17L180,187V141L128,89,76,141V187l11.51-11.52a12,12,0,0,1,17,17l-32,32a12,12,0,0,1-17,0l-32-32a12,12,0,1,1,17-17L52,187V136a12,12,0,0,1,3.51-8.49L116,67V24a12,12,0,0,1,24,0V67l60.49,60.48A12,12,0,0,1,204,136v51l11.51-11.52a12,12,0,0,1,17,17Z"/></g></svg>`;

const DEFAULT_APPEARANCE: Appearance = { theme: 'auto', accent: 'blurple' };

const page = (
  status: number,
  body: string,
  headers = new Headers(),
  appearance = DEFAULT_APPEARANCE,
) => {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Splitfoolish</title><link rel="icon" type="image/svg+xml" href="/icon.svg">` +
      `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..600&display=swap">` +
      `<style>${colorsFor(appearance)}${STYLE}</style><body><main><div class="brand">${LOGO}Splitfoolish</div>${body}</main>`,
    { status, headers },
  );
};

const problem = (status: number, message: string) =>
  page(status, `<h1>Can't connect this app</h1><p class="muted">${escape(message)}</p>`);

/** The person's picture, or their initial on the accent, as the app shows them */
const avatar = (email: string, version: number | null) =>
  version == null
    ? `<span class="avatar" aria-hidden="true">${escape(email.slice(0, 1).toUpperCase())}</span>`
    : `<img class="avatar" alt="" src="/api/avatars/${encodeURIComponent(email)}?v=${version}">`;

/** The consent page: who is asking, where access goes, and what it may do */
async function showConsent(
  oauth: OAuthHelpers,
  request: AuthRequest,
  email: string,
  db: D1Database,
) {
  const [details, look] = await Promise.all([
    oauth.describeConsent(request),
    getAppearance(db, email),
  ]);
  // Everything this server grants, ticked, whatever the client asked for, so an app
  // that asked for less can still be allowed to add expenses; the person unticks what
  // it shouldn't do. Other scopes the client asked for are left out.
  const offered = SCOPES;
  const consent = await oauth.beginConsent(request);
  const name = escape(details.clientName);
  const verified = details.clientDomain != null;
  return page(
    200,
    `<h1>Allow ${name} to use Splitfoolish?</h1>
<dl class="facts">
<dt>Signed in as</dt><dd>${avatar(email, look.avatarVersion)}<span>${escape(email)}</span></dd>
<dt>Asking</dt><dd><span>${name}</span>${
      verified
        ? `<span class="tag">by ${escape(details.clientDomain!)}</span>`
        : '<span class="tag">name not verified</span>'
    }</dd>
<dt>Access goes to</dt><dd>${escape(details.redirectHost)}</dd>
</dl>
<p class="fine">${
      verified ? '' : "The app gave its own name, which Splitfoolish can't check. "
    }It acts as you: anything it adds or changes is saved under your account, whoever asked it to.</p>
${
  details.redirectIsLoopback
    ? '<p class="warn"><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting it.</p>'
    : ''
}
<form method="post">
<input type="hidden" name="handle" value="${escape(consent.handle)}">
<div class="label">It may</div>
${offered
  .map((s) => {
    const label = SCOPE_LABELS[s] ?? { title: s, detail: [] };
    // One line sits under the title; several are a list
    const detail =
      label.detail.length === 1
        ? `<span>${escape(label.detail[0])}</span>`
        : `<ul>${label.detail.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>`;
    return `<label class="scope"><input type="checkbox" name="scope" value="${escape(s)}" checked><b>${escape(label.title)}</b>${detail}</label>`;
  })
  .join('\n')}
<div class="actions"><button name="decision" value="deny">Deny</button><button class="primary" name="decision" value="approve">Allow</button></div>
</form>`,
    consent.headers,
    look,
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
    userId: grantUserId(email),
    // So Settings can tell this connection from others to the same app
    metadata: { approvedOn: describeDevice(req.headers.get('User-Agent')) ?? undefined },
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
      return await showConsent(oauth, await oauth.parseAuthRequest(req), email, env.DB);
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

const providers = new Map<
  string,
  { provider: OAuthProvider<Env>; options: OAuthProviderOptions<Env> }
>();

/** The provider for this deployment's address, and how it was made, once per Worker instance */
function providerFor(origin: string) {
  let made = providers.get(origin);
  if (made == null) {
    const options: OAuthProviderOptions<Env> = {
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
    };
    made = { provider: new OAuthProvider<Env>(options), options };
    providers.set(origin, made);
  }
  return made;
}

/** The OAuth provider's own helpers, for code outside its routes; null while MCP is off */
export function oauthHelpers(env: Env): OAuthHelpers | null {
  if (!env.MCP_ORIGIN || env.OAUTH_KV == null) return null;
  return getOAuthApi(providerFor(new URL(env.MCP_ORIGIN).origin).options, env);
}

/** The id the provider keeps an account's grants under; grant ids can't hold ':' */
export const grantUserId = (email: string) => encodeURIComponent(email);

/**
 * Answers /mcp, /oauth/* and /.well-known/*. Off (404) until the deployment says where
 * it lives (MCP_ORIGIN) and has somewhere to keep grants (OAUTH_KV).
 */
export async function handleOAuthRoute(req: Request, env: Env, ctx: ExecutionContext) {
  if (!env.MCP_ORIGIN || env.OAUTH_KV == null) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  const { provider } = providerFor(new URL(env.MCP_ORIGIN).origin);
  if (req.method === 'POST' && new URL(req.url).pathname === REGISTER_PATH) {
    const admitted = await admitRegistration(req, env);
    if (admitted instanceof Response) return admitted;
    return provider.fetch(admitted, env, ctx);
  }
  return provider.fetch(req, env, ctx);
}
