// What an agent may be allowed to do, chosen on the consent page. Every tool checks its
// own scope: MCP reads are POSTs too, so the HTTP method says nothing about them.

import { AGENT_SCOPES } from '../../shared/api';

/** Seeing splits: their people, expenses, balances and photos */
export const READ_SCOPE = AGENT_SCOPES[0];
/**
 * Changing splits as the account can itself: making them, adding, changing and removing
 * expenses and photos, adding and renaming people, and routing payments
 */
export const WRITE_SCOPE = AGENT_SCOPES[1];

export const SCOPES: string[] = [READ_SCOPE, WRITE_SCOPE];
