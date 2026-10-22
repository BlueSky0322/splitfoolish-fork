// The agent apps an account has let in over OAuth (docs/mcp.md), for Settings to list
// and to disconnect one at a time. Each is a grant the OAuth provider keeps under the
// account, so one account can only ever see or end its own.

import { AGENT_SCOPES, type AgentScope, type ConnectedAgent } from '../../shared/api';
import type { Env } from '../app';

// Loaded only when asked, as worker/index.ts does: the OAuth library stays out of every
// other request
const loadOAuth = () => import('./oauth');

/** More than anyone connects; the rest of a longer list isn't read */
const MAX_LISTED = 200;
/** A grant's id as the provider makes them; anything else can't be one */
const GRANT_ID = /^[A-Za-z0-9_-]{1,128}$/;

const isAgentScope = (scope: string): scope is AgentScope =>
  (AGENT_SCOPES as readonly string[]).includes(scope);

/** The apps let in, newest first; none while MCP is off */
export async function listConnectedAgents(env: Env, email: string): Promise<ConnectedAgent[]> {
  const { grantUserId, oauthHelpers } = await loadOAuth();
  const oauth = oauthHelpers(env);
  if (oauth == null) return [];
  const userId = grantUserId(email);
  const grants = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(userId, { limit: 100, cursor });
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor != null && grants.length < MAX_LISTED);
  const agents = await Promise.all(
    grants.slice(0, MAX_LISTED).map(async (grant) => {
      // An app whose registration has run out still holds its grant until disconnected
      const client = await oauth.lookupClient(grant.clientId).catch(() => null);
      return {
        id: grant.id,
        name: client?.clientName?.trim() || 'An agent app',
        scopes: grant.scope.filter(isAgentScope),
        connectedAt: grant.createdAt * 1000,
      } satisfies ConnectedAgent;
    }),
  );
  return agents.sort((a, b) => b.connectedAt - a.connectedAt);
}

/**
 * Ends one of this account's grants, and with it every token the app holds from it.
 * One already gone, or never this account's, changes nothing.
 */
export async function disconnectAgent(env: Env, email: string, id: string): Promise<void> {
  if (!GRANT_ID.test(id)) return;
  const { grantUserId, oauthHelpers } = await loadOAuth();
  const oauth = oauthHelpers(env);
  if (oauth == null) return;
  await oauth.revokeGrant(id, grantUserId(email));
}
