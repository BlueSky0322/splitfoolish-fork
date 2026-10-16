// The routes MCP and its OAuth sign-in answer, ahead of the app's files. The service
// worker (web/public/sw.js) leaves the same paths to the browser.

export const isOAuthPath = (path: string) =>
  path === '/mcp' ||
  path.startsWith('/mcp/') ||
  path.startsWith('/oauth/') ||
  path.startsWith('/.well-known/');
