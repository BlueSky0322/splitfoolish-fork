// /mcp, reached only with a valid access token (the provider in oauth.ts checks it).
// Stateless Streamable HTTP: each POST gets a fresh MCP server whose tools act as the
// token's account, so nothing about one caller is kept for, or shared with, the next.

import type { OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import { insufficientScope } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';
import type { Env } from '../app';
import { readBody } from '../http';
import type { GrantProps } from './oauth';
import { READ_SCOPE } from './scopes';
import { TOOL_SCOPES, registerTools } from './tools';
import { noteAgentUse } from './agents';

const jsonError = (status: number, message: string, headers?: HeadersInit) =>
  Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message }, id: null },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );

/**
 * A browser may only call from this app's own origin or one the deployment allows (MCP
 * Inspector, say). Command-line clients send no Origin and aren't affected.
 */
function originRefused(req: Request, env: Env) {
  const origin = req.headers.get('Origin');
  if (origin == null) return false;
  const allowed = [
    new URL(env.MCP_ORIGIN!).origin,
    ...(env.MCP_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ];
  return !allowed.includes(origin);
}

/**
 * The most a request may send: a photo for add_photo (MAX_PHOTO_BYTES) is about a third
 * larger as base64, well within this
 */
const MAX_MCP_BODY_BYTES = 4 * 1024 * 1024;

/** The scopes a message's tool calls need that the token doesn't carry */
function missingScopes(body: unknown, granted: string[]) {
  const messages = Array.isArray(body) ? body : [body];
  const needed = new Set<string>();
  for (const m of messages as { method?: unknown; params?: { name?: unknown } }[]) {
    if (m?.method !== 'tools/call' || typeof m.params?.name !== 'string') continue;
    const scope = TOOL_SCOPES[m.params.name];
    if (scope != null && !granted.includes(scope)) needed.add(scope);
  }
  return [...needed];
}

export const mcpHandler = {
  async fetch(req: Request, env: Env, executionCtx: ExecutionContext) {
    // What the provider verified about the token, and the grant's account
    const ctx = executionCtx as OAuthResourceContext<GrantProps>;
    if (originRefused(req, env)) return jsonError(403, 'Not allowed from this origin');
    // Stateless: no standing event stream (GET) and no session to end (DELETE)
    if (req.method !== 'POST') return jsonError(405, 'Method not allowed', { Allow: 'POST' });

    // Read once, and only so far: past the limit, or too slow, it's turned away before
    // anything is parsed or kept
    const bytes = await readBody(req, MAX_MCP_BODY_BYTES);
    if (bytes === 'too large') return jsonError(413, 'Request body too large');
    if (bytes === 'too slow') return jsonError(408, 'Request body took too long to send');
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      // Not JSON: left to the transport, which answers it as ever
    }

    // A call the grant doesn't cover gets the standard challenge, so the client can ask
    // the person for more; the tool would refuse it anyway
    const missing = missingScopes(parsedBody, ctx.auth.scope);
    if (missing.length > 0) {
      return insufficientScope(ctx.auth, [...new Set([READ_SCOPE, ...missing])]);
    }

    const server = new McpServer(
      { name: 'splitfoolish', version: '1.0.0' },
      // The SDK's default validator compiles code at runtime, which Workers don't allow
      { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    );
    registerTools(server, { email: ctx.props.email, scopes: ctx.auth.scope, env, ctx });
    // So Settings can say when this connection was last used
    if (env.OAUTH_KV != null) {
      ctx.waitUntil(noteAgentUse(env.OAUTH_KV, ctx.auth.token).catch(() => {}));
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    // The body as read here: the transport neither reads it again nor applies its own limit
    const res =
      parsedBody === undefined
        ? await transport.handleRequest(
            new Request(req.url, { method: req.method, headers: req.headers, body: bytes }),
          )
        : await transport.handleRequest(req, { parsedBody });
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  },
};
