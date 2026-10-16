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
import { isCrossSiteWrite } from '../http';
import { mcpHandler } from './server';
import { READ_SCOPE, SCOPES, WRITE_SCOPE } from './scopes';

/** What a grant carries to each MCP request: the account it acts as */
export interface GrantProps {
  email: string;
}

const AUTHORIZE_PATH = '/oauth/authorize';

const SCOPE_LABELS: Record<string, string> = {
  [READ_SCOPE]: 'See your splits, their expenses and balances',
  [WRITE_SCOPE]: 'Add and edit expenses in your splits',
};

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (status: number, body: string, headers = new Headers()) => {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
      `<title>Splitfoolish</title><body style="font:16px system-ui;max-width:32rem;margin:2rem auto;padding:0 1rem">${body}`,
    { status, headers },
  );
};

const problem = (status: number, message: string) =>
  page(status, `<h1>Can't connect this app</h1><p>${escape(message)}</p>`);

/** The consent page: who is asking, where access goes, and what it may do */
async function showConsent(oauth: OAuthHelpers, request: AuthRequest, email: string) {
  const details = await oauth.describeConsent(request);
  // Only what this server grants; anything else the client asked for is left out
  const scopes = details.scope.filter((s) => SCOPES.includes(s));
  const offered = scopes.length > 0 ? scopes : [READ_SCOPE];
  const consent = await oauth.beginConsent(request);
  const name = escape(details.clientName);
  return page(
    200,
    `<h1>Allow ${name} to use Splitfoolish as you?</h1>
<p>Signed in as <strong>${escape(email)}</strong>. ${
      details.clientDomain
        ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
        : 'This app named itself; its name is not verified.'
    } Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${
  details.redirectIsLoopback
    ? '<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting it.</p>'
    : ''
}
<form method="post">
<input type="hidden" name="handle" value="${escape(consent.handle)}">
${offered
  .map(
    (s) =>
      `<p><label><input type="checkbox" name="scope" value="${escape(s)}" checked> ${escape(SCOPE_LABELS[s] ?? s)}</label></p>`,
  )
  .join('\n')}
<p>It acts as you: anything it adds or changes is saved under your account, whoever asked it to.</p>
<p><button name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></p>
</form>`,
    consent.headers,
  );
}

/** Saves the person's answer and sends the browser back to the app that asked */
async function answerConsent(oauth: OAuthHelpers, req: Request, email: string) {
  const form = await req.formData();
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
      clientRegistrationEndpoint: '/oauth/register',
      scopesSupported: [...SCOPES, 'offline_access'],
      resourceMetadata: {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        resource_name: 'Splitfoolish',
      },
      requiredScopes: [READ_SCOPE],
    });
    providers.set(origin, provider);
  }
  return provider;
}

/**
 * Answers /mcp, /oauth/* and /.well-known/*. Off (404) until the deployment says where
 * it lives (MCP_ORIGIN) and has somewhere to keep grants (OAUTH_KV).
 */
export function handleOAuthRoute(req: Request, env: Env, ctx: ExecutionContext) {
  if (!env.MCP_ORIGIN || env.OAUTH_KV == null) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return providerFor(new URL(env.MCP_ORIGIN).origin).fetch(req, env, ctx);
}
