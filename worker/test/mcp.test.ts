// MCP for agents, end to end against the real Worker and a fresh local database: signing
// in through the OAuth provider (register, PKCE authorize with consent, token), then the
// four tools through a real MCP client. Covers who may do what, that writes go through
// the bill's own rules, and that retries never apply a change twice.

import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LocalWorker } from './local-worker';
import { startLocalWorker } from './local-worker';

let api: LocalWorker;
let n = 0;
const person = (name: string) => `${name}${++n}@example.com`;
const hex = () => randomBytes(8).toString('hex');
const READ = 'splits:read';
const WRITE = 'splits:write';
const REDIRECT = 'http://127.0.0.1:9/callback';

beforeAll(async () => {
  api = await startLocalWorker();
}, 180_000);

afterAll(() => api?.stop(), 30_000);

const b64url = (bytes: Buffer) => bytes.toString('base64url');

/** What the provider answers at the token endpoint */
async function tokenRequest(fields: Record<string, string>) {
  const res = await fetch(`${api.base}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
  return { status: res.status, data: (await res.json()) as Record<string, string> };
}

/**
 * Connects an agent as `email`, the way a person would: the client registers, the person
 * (signed in as `email`) allows `scope` on the consent page, and the code is exchanged
 * with its PKCE verifier
 */
async function grant(email: string, scope: string[], requested = scope) {
  const registered = await fetch(`${api.base}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test agent',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  expect(registered.status).toBe(201);
  const clientId = ((await registered.json()) as { client_id: string }).client_id;

  const verifier = b64url(randomBytes(32));
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: requested.join(' '),
    state: 'state-1',
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    resource: `${api.base}/mcp`,
  });
  const authorize = `${api.base}/oauth/authorize?${query}`;
  const page = await fetch(authorize, { headers: { 'X-Dev-User': email } });
  const html = await page.text();
  expect(page.status).toBe(200);
  // The page says who is granting what, to which app
  expect(html).toContain(`Signed in as <strong>${email}</strong>`);
  expect(html).toContain('Test agent');
  // Both scopes are offered and ticked, whatever the client asked for
  for (const s of [READ, WRITE]) {
    expect(html).toContain(`name="scope" value="${s}" checked`);
  }
  const handle = /name="handle" value="([^"]+)"/.exec(html)![1];
  const cookie = page.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

  const form = new URLSearchParams({ handle, decision: 'approve' });
  for (const s of scope) form.append('scope', s);
  const allowed = await fetch(authorize, {
    method: 'POST',
    headers: {
      'X-Dev-User': email,
      'Cookie': cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    redirect: 'manual',
  });
  expect(allowed.status).toBe(302);
  const back = new URL(allowed.headers.get('Location')!);
  expect(back.searchParams.get('state')).toBe('state-1');

  const { status, data } = await tokenRequest({
    grant_type: 'authorization_code',
    code: back.searchParams.get('code')!,
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
  });
  expect(status).toBe(200);
  return { access: data.access_token, refresh: data.refresh_token, clientId };
}

/** A real MCP client, connected with `token` */
async function connect(token: string) {
  const client = new Client({ name: 'test-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${api.base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  // The newest protocol this SDK speaks, agreed with the server
  expect(transport.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  return client;
}

type Answer = { error?: { code: string; message: string }; [key: string]: any };

/** A tool's answer: its structured result, or its error */
async function tool(client: Client, name: string, args: Record<string, unknown>): Promise<Answer> {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) {
    const text = (res.content as { text: string }[])[0].text;
    // The SDK refuses input that doesn't fit the tool's schema before the tool runs
    if (!text.startsWith('{')) return { error: { code: 'schema', message: text } };
    return JSON.parse(text) as Answer;
  }
  return res.structuredContent as Answer;
}

/** A raw JSON-RPC call to /mcp, for what happens before the MCP server is reached */
const rawCall = (token: string | null, body: unknown) =>
  fetch(`${api.base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

/** A split owned by `owner` with Bob and Cat in its bill, and `members` sharing it */
async function trip(owner: string, ...members: string[]) {
  const id = hex();
  await api.call(owner, 'POST', '/api/splits', { id, name: 'Trip', currency: 'MYR' });
  const token: string = (await api.call(owner, 'GET', `/api/splits/${id}`)).data.shareToken;
  for (const m of members) {
    const opened = await api.call(m, 'POST', `/api/join/${token}`);
    await api.call(m, 'POST', `/api/invites/${opened.data.inviteId}/accept`);
  }
  const [me, bob, cat] = [hex(), hex(), hex()];
  await api.call(owner, 'POST', `/api/splits/${id}/changes`, {
    changes: [
      { op: 'addPerson', id: me, name: 'Owner', memberEmail: owner },
      { op: 'addPerson', id: bob, name: 'Bob' },
      { op: 'addPerson', id: cat, name: 'Cat' },
    ],
  });
  return { id, shareToken: token, me, bob, cat };
}

const itemsOf = async (who: string, id: string) =>
  (await api.call(who, 'GET', `/api/splits/${id}`)).data.items as Record<string, any>[];

describe('signing in', () => {
  it('points an unauthenticated client at the OAuth metadata, and never serves the app there', async () => {
    const res = await rawCall(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain(
      `resource_metadata="${api.base}/.well-known/oauth-protected-resource/mcp"`,
    );
    const resource = await (
      await fetch(`${api.base}/.well-known/oauth-protected-resource/mcp`)
    ).json();
    expect(resource).toMatchObject({
      resource: `${api.base}/mcp`,
      authorization_servers: [api.base],
      scopes_supported: [READ, WRITE],
    });
    expect(res.headers.get('WWW-Authenticate')).toContain(`scope="${READ} ${WRITE}"`);
    const server = (await (
      await fetch(`${api.base}/.well-known/oauth-authorization-server`)
    ).json()) as Record<string, unknown>;
    expect(server).toMatchObject({
      authorization_endpoint: `${api.base}/oauth/authorize`,
      token_endpoint: `${api.base}/oauth/token`,
      code_challenge_methods_supported: ['S256'],
    });
    // Anything else there is a plain 404, not the app's page
    for (const path of ['/.well-known/openid-configuration', '/oauth/elsewhere', '/mcp/other']) {
      const other = await fetch(`${api.base}${path}`);
      expect([401, 404]).toContain(other.status);
      expect(other.headers.get('Content-Type') ?? '').not.toContain('text/html');
    }
  });

  it('refuses a missing, made-up or revoked token, and a refreshed one works', async () => {
    const { access, refresh, clientId } = await grant(person('alice'), [READ]);
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    expect((await rawCall('not-a-token', list)).status).toBe(401);
    // A page on another site can't use someone's token from the browser
    const fromElsewhere = await fetch(`${api.base}/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access}`,
        'Origin': 'https://elsewhere.example',
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(list),
    });
    expect(fromElsewhere.status).toBe(403);

    const refreshed = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId,
    });
    expect(refreshed.status).toBe(200);
    const client = await connect(refreshed.data.access_token);
    expect((await client.listTools()).tools).toHaveLength(4);

    const revocation = await fetch(`${api.base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: access, client_id: clientId }),
    });
    expect(revocation.status).toBe(200);
    expect((await rawCall(access, list)).status).toBe(401);
  });
});

describe('the tools', () => {
  // The live channel can't send a sign-in header, so it listens as the local default user
  const devUser = 'nobody@example.com';

  it('find a split, read it, and add an expense that is saved and announced', async () => {
    const alice = person('alice');
    const split = await trip(devUser, alice);
    const { access } = await grant(alice, [READ, WRITE]);
    const client = await connect(access);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'add_expense',
      'get_split',
      'list_splits',
      'update_expense',
    ]);
    const add = tools.find((t) => t.name === 'add_expense')!;
    expect(add.inputSchema.required).toEqual(
      expect.arrayContaining(['splitId', 'requestId', 'currency', 'name', 'cost', 'payerId']),
    );
    expect(add.outputSchema?.properties).toHaveProperty('replayed');

    const listed = await tool(client, 'list_splits', {});
    expect(listed.splits).toEqual([
      expect.objectContaining({ id: split.id, currency: 'MYR', role: 'editor', totalCents: 0 }),
    ]);

    const live = new WebSocket(`${api.base.replace(/^http/, 'ws')}/api/splits/${split.id}/ws`);
    const heard: { type: string; by: string | null }[] = [];
    live.onmessage = (e) => heard.push(JSON.parse(String(e.data)));
    await new Promise((done) => (live.onopen = done));

    // Bob paid; Alice's agent enters it, so Alice is the actor and Bob the payer
    const saved = await tool(client, 'add_expense', {
      splitId: split.id,
      requestId: 'dinner-000001',
      currency: 'MYR',
      name: 'Dinner',
      cost: 10,
      payerId: split.bob,
      participantIds: [split.me, split.bob, split.cat],
    });
    expect(saved).toMatchObject({
      status: 'saved',
      splitId: split.id,
      requestId: 'dinner-000001',
      actor: alice,
      replayed: false,
    });
    const [item] = await itemsOf(devUser, split.id);
    expect(item).toMatchObject({
      id: saved.expenseId,
      name: 'Dinner',
      cost: 10,
      payerId: split.bob,
      splitMode: 'equal',
    });
    expect(item.participantIds).toHaveLength(3);
    for (let i = 0; i < 50 && heard.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
    live.close();
    // No tab made it, so every open app is told
    expect(heard).toEqual([{ type: 'changed', by: null }]);

    const read = await tool(client, 'get_split', { splitId: split.id });
    expect(Object.keys(read).sort()).toEqual([
      'balances',
      'expenseCount',
      'expenses',
      'nextOffset',
      'people',
      'split',
      'transfers',
    ]);
    // Share links, invitations and payment details are not part of it
    const text = JSON.stringify(read);
    expect(text).not.toContain(split.shareToken);
    expect(text).not.toMatch(/shareToken|invites|paymentMethods|@example\.com/);
    expect(read.split).toMatchObject({ currency: 'MYR', totalCents: 1000, converting: false });
    // 10.00 three ways is 3.34 + 3.33 + 3.33, as the app works it out; Alice, who joined
    // the split, isn't on it
    const balanceOf = (id: string) =>
      read.balances.find((b: { personId: string }) => b.personId === id);
    const shares = [split.me, split.bob, split.cat].map((id) => balanceOf(id).shareCents);
    expect(shares.sort()).toEqual([333, 333, 334]);
    expect(read.balances).toHaveLength(4);
    const bob = balanceOf(split.bob);
    expect(bob.paidCents).toBe(1000);
    expect(bob.balanceCents).toBe(1000 - bob.shareCents);
    expect(read.expenses).toEqual([
      expect.objectContaining({ id: saved.expenseId, cost: 10, costCents: 1000, notes: null }),
    ]);
  });

  it('keep to the bill’s rules and the split’s currency', async () => {
    const alice = person('alice');
    const split = await trip(alice);
    const client = await connect((await grant(alice, [READ, WRITE])).access);
    const dinner = {
      splitId: split.id,
      currency: 'MYR',
      name: 'Dinner',
      cost: 10,
      payerId: split.bob,
      participantIds: [split.bob, split.cat],
    };
    expect(
      (await tool(client, 'add_expense', { ...dinner, requestId: 'r-stranger', payerId: hex() }))
        .error,
    ).toEqual({
      code: 'refused',
      message: 'Who paid must be someone in this split',
      retryable: false,
    });
    expect(
      (await tool(client, 'add_expense', { ...dinner, requestId: 'r-dollars', currency: 'USD' }))
        .error?.code,
    ).toBe('currency_mismatch');

    // Paid in another currency: left to the app rather than losing what was typed
    const foreign = hex();
    await api.call(alice, 'POST', `/api/splits/${split.id}/changes`, {
      changes: [
        {
          op: 'addItem',
          item: {
            id: foreign,
            name: 'Taxi',
            payerId: split.bob,
            participantIds: [split.bob],
            original: { currency: 'USD', amount: 5, rateSource: 'manual', rate: 4 },
          },
        },
      ],
    });
    expect(
      (
        await tool(client, 'update_expense', {
          splitId: split.id,
          expenseId: foreign,
          requestId: 'r-foreign',
          currency: 'MYR',
          name: 'Cab',
        })
      ).error?.code,
    ).toBe('refused');
    expect((await itemsOf(alice, split.id)).map((i) => i.name)).toEqual(['Taxi']);
  });
});

describe('retries', () => {
  it('never apply an expense twice, and a changed request under the same id is refused', async () => {
    const alice = person('alice');
    const dave = person('dave');
    const split = await trip(alice, dave);
    const client = await connect((await grant(alice, [READ, WRITE])).access);
    const lunch = {
      splitId: split.id,
      requestId: 'lunch-000001',
      currency: 'MYR',
      name: 'Lunch',
      cost: 12,
      payerId: split.bob,
      participantIds: [split.bob, split.cat],
    };

    const first = await tool(client, 'add_expense', lunch);
    // The answer was lost; the agent sends it again
    const again = await tool(client, 'add_expense', lunch);
    expect(again).toEqual({ ...first, replayed: true });

    // The same new request three times at once ends as one expense
    const together = await Promise.all(
      [1, 2, 3].map(() => tool(client, 'add_expense', { ...lunch, requestId: 'lunch-000002' })),
    );
    expect(new Set(together.map((t) => t.expenseId)).size).toBe(1);
    expect(together.filter((t) => t.replayed === false)).toHaveLength(1);
    expect(await itemsOf(alice, split.id)).toHaveLength(2);

    expect((await tool(client, 'add_expense', { ...lunch, cost: 99 })).error?.code).toBe(
      'idempotency_conflict',
    );
    // Request ids belong to the account: Dave's agent using the same one adds its own
    const daves = await connect((await grant(dave, [READ, WRITE])).access);
    expect(await tool(daves, 'add_expense', lunch)).toMatchObject({ actor: dave, replayed: false });
    expect((await itemsOf(alice, split.id)).map((i) => i.cost)).toEqual([12, 12, 12]);
  });

  it('of an older edit never undo a newer one', async () => {
    const alice = person('alice');
    const split = await trip(alice);
    const client = await connect((await grant(alice, [READ, WRITE])).access);
    const { expenseId } = await tool(client, 'add_expense', {
      splitId: split.id,
      requestId: 'snack-000001',
      currency: 'MYR',
      name: 'Snacks',
      cost: 6,
      payerId: split.bob,
      participantIds: [split.bob, split.cat],
      notes: 'From the station',
    });
    const edit = (requestId: string, name: string) =>
      tool(client, 'update_expense', {
        splitId: split.id,
        expenseId,
        requestId,
        currency: 'MYR',
        name,
      });
    expect(await edit('edit-000001', 'Crisps')).toMatchObject({ replayed: false });
    await edit('edit-000002', 'Crackers');
    expect(await edit('edit-000001', 'Crisps')).toMatchObject({ replayed: true });
    const [item] = await itemsOf(alice, split.id);
    // Only the name changed; what wasn't sent stayed
    expect(item).toMatchObject({
      name: 'Crackers',
      cost: 6,
      notes: 'From the station',
      payerId: split.bob,
    });
  });
});

describe('who may do what', () => {
  it('a read-only grant reads but is asked to step up before writing', async () => {
    const alice = person('alice');
    const split = await trip(alice);
    const { access } = await grant(alice, [READ]);
    expect((await tool(await connect(access), 'get_split', { splitId: split.id })).split.id).toBe(
      split.id,
    );
    const res = await rawCall(access, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'add_expense', arguments: {} },
    });
    expect(res.status).toBe(403);
    const challenge = res.headers.get('WWW-Authenticate');
    expect(challenge).toContain('insufficient_scope');
    expect(challenge).toContain(WRITE);
    expect(await itemsOf(alice, split.id)).toEqual([]);
  });

  it('a client that asks only to read can still be allowed to add expenses', async () => {
    const alice = person('alice');
    const split = await trip(alice);
    const { access } = await grant(alice, [READ, WRITE], [READ]);
    const saved = await tool(await connect(access), 'add_expense', {
      splitId: split.id,
      requestId: 'asked-read-01',
      currency: 'MYR',
      name: 'Dinner',
      cost: 10,
      payerId: split.bob,
      participantIds: [split.me, split.bob],
    });
    expect(saved).toMatchObject({ status: 'saved', replayed: false });
    expect(await itemsOf(alice, split.id)).toEqual([
      expect.objectContaining({ name: 'Dinner', cost: 10, payerId: split.bob }),
    ]);
  });

  it('a split is out of reach to anyone not in it, including someone removed after granting', async () => {
    const owner = person('owner');
    const dave = person('dave');
    const stranger = person('stranger');
    const split = await trip(owner, dave);
    const write = (client: Client, requestId: string) =>
      tool(client, 'add_expense', {
        splitId: split.id,
        requestId,
        currency: 'MYR',
        name: 'Fuel',
        cost: 30,
        payerId: split.bob,
        participantIds: [split.bob],
      });

    const strangers = await connect((await grant(stranger, [READ, WRITE])).access);
    expect((await tool(strangers, 'get_split', { splitId: split.id })).error?.code).toBe(
      'not_found',
    );
    expect((await write(strangers, 'fuel-000001')).error?.code).toBe('not_found');
    expect((await tool(strangers, 'list_splits', {})).splits).toEqual([]);

    const daves = await connect((await grant(dave, [READ, WRITE])).access);
    expect(await write(daves, 'fuel-000002')).toMatchObject({ status: 'saved', actor: dave });
    await api.call(owner, 'DELETE', `/api/splits/${split.id}/members/${encodeURIComponent(dave)}`);
    expect((await tool(daves, 'get_split', { splitId: split.id })).error?.code).toBe('not_found');
    // Even a retry of what was saved before
    expect((await write(daves, 'fuel-000002')).error?.code).toBe('not_found');
    expect(await itemsOf(owner, split.id)).toHaveLength(1);
  });
});
