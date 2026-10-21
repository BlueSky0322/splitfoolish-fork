// What an agent may be allowed to do, chosen on the consent page. Every tool checks its
// own scope: MCP reads are POSTs too, so the HTTP method says nothing about them.

/** Seeing splits: their people, expenses, balances and photos */
export const READ_SCOPE = 'splits:read';
/**
 * Changing splits as the account can itself: making them, adding, changing and removing
 * expenses and photos, adding and renaming people, and routing payments
 */
export const WRITE_SCOPE = 'splits:write';

export const SCOPES = [READ_SCOPE, WRITE_SCOPE];
