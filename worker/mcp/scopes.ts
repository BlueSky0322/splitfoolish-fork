// What an agent may be allowed to do, chosen on the consent page. Every tool checks its
// own scope: MCP reads are POSTs too, so the HTTP method says nothing about them.

/** Seeing splits, their expenses and balances */
export const READ_SCOPE = 'splits:read';
/** Adding and editing expenses */
export const WRITE_SCOPE = 'splits:write';

export const SCOPES = [READ_SCOPE, WRITE_SCOPE];
