# MCP: letting an agent use Splitfoolish

An agent (Hermes, Claude, MCP Inspector, any MCP client) can find your splits, read
their expenses and balances, add expenses and edit them. It signs in once over OAuth,
as you, and everything it does is checked and saved like a change you make in the app.

- Endpoint: `https://YOUR_APP_HOST/mcp`, Streamable HTTP, stateless. Clients POST JSON-RPC
  and get JSON back; there is no session and no standing event stream (GET and DELETE
  answer 405).
- Tested with the MCP TypeScript SDK client 1.32.1, which negotiated protocol version
  `2025-11-25`. Hermes and MCP Inspector have not been run against it yet.
- Code: [worker/mcp/](../worker/mcp/oauth.ts). Where it fits:
  [feature map](feature-map.md#agents-over-mcp).

## Signing in

OAuth 2.1 authorization code with PKCE (S256), run by
[`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
1.2.3 in the same Worker. A client finds everything from the `401` it gets at `/mcp`:

| What                                     | Where                                       |
| ---------------------------------------- | ------------------------------------------- |
| Protected resource metadata (RFC 9728)   | `/.well-known/oauth-protected-resource/mcp` |
| Authorization server metadata (RFC 8414) | `/.well-known/oauth-authorization-server`   |
| Client registration (RFC 7591)           | `/oauth/register`                           |
| Consent page                             | `/oauth/authorize`                          |
| Tokens, refresh and revocation           | `/oauth/token`                              |

- **Clients register themselves** at `/oauth/register` (dynamic client registration),
  which MCP clients do on their own; no client id needs setting up. Registering gives
  an app nothing until someone allows it on the consent page, which shows that the
  app's name is unverified and where its access will be sent.
  Registering is budgeted before anything is kept: 10 a minute from one address (as
  Cloudflare sees it) and 100 a minute in all, a body of at most 16 KiB, a name of at
  most 100 characters and at most 5 redirect addresses. A registered app is kept 90 days.
- **The consent page** sits behind Cloudflare Access like the rest of the app. The
  account the agent acts as is the one Access signed in there, verified again on the
  page; nothing the agent or the form sends can change it.
- **Scopes:** `splits:read` (list and read splits, their people, expenses, balances and
  photos) and `splits:write` (everything the account can change itself: make splits,
  add, change and remove expenses and photos, add or rename people, route payments). The
  consent page says so, removing included. Grants made before it did keep the same
  scope; the agent can do no more than the account could. Both are advertised to clients (resource metadata and the `401` challenge),
  and the page always offers both, ticked, whatever the client asked for; the person
  can untick either. Each tool checks its own scope; a call the grant doesn't cover gets a `403`
  with `error="insufficient_scope"`, so the client can ask for more.
- **Lifetimes:** access tokens last an hour; refresh tokens rotate on use and the
  grant ends 30 days after sign-in. Authorizing the same app again replaces its earlier
  grant. Revoke a token at `/oauth/token` (RFC 7009). The person can disconnect an
  agent in Settings, under Connected agents, which ends its grant and every token from
  it at once.
- **Every call is checked now, not at sign-in:** someone removed from a split loses it
  through the agent at once, as in the app.
- **Requests are read only so far:** up to 4 MiB (a photo for `add_photo` fits), and
  only for so long. One past that is refused with `413` (or `408`) before any of it is
  parsed, and the body is read once, then checked for scopes and handed to the
  transport as it is.

## The tools

Amounts named `*Cents` are whole cents. `cost` and `exact` are in currency units, as in
the app (`12.5` is 12.50). People and expenses are named by id, never by name. Expense
names and notes are what people typed, returned as data.

| Tool               | Scope          | Does                                                                                                                                               |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_splits`      | `splits:read`  | Your splits in your own order: id, name, currency, your role, archived, settled, totals, your balance                                              |
| `get_split`        | `splits:read`  | One split: its people, expenses with their receipt photos, photos of the split, the total, balances, transfers and who payments are routed through |
| `get_photo`        | `splits:read`  | One photo of a split, as an image                                                                                                                  |
| `create_split`     | `splits:write` | Makes a split you own, with you and the people you name in its bill                                                                                |
| `add_expense`      | `splits:write` | Adds one expense, in the split's currency or paid in another, dated now or when you say                                                            |
| `update_expense`   | `splits:write` | Changes the fields you send on one expense                                                                                                         |
| `set_expense_date` | `splits:write` | Changes when an expense was paid                                                                                                                   |
| `remove_expense`   | `splits:write` | Removes one expense, with its receipt photos                                                                                                       |
| `add_photo`        | `splits:write` | Adds a receipt to an expense, or a photo of the whole split                                                                                        |
| `add_person`       | `splits:write` | Adds someone to the bill by name (owner only)                                                                                                      |
| `rename_person`    | `splits:write` | Renames someone without an account (owner only)                                                                                                    |
| `route_payments`   | `splits:write` | Settles the split through one person, or directly between people                                                                                   |

- **Paging:** `list_splits` returns up to `limit` (default 50, at most 200) from
  `offset`; `get_split` the same for expenses (default 100), in the app's order. Each
  answer has the full count and a `nextOffset` (null on the last page). The total,
  balances and transfers always cover every expense, whatever the page. Each call reads
  the split as saved at that moment; if it changes between pages, later pages can shift.
- **`get_split` leaves out** share links, invitations, members' emails and payment
  details. A person shows `hasAccount` and `isYou` (this grant's account) instead, and a
  photo `addedByYou`.
- **Writes take the split's currency** in `currency`, and are refused
  (`currency_mismatch`) when it no longer matches, say after the owner changed it.
  While a split is converting to a new currency, writes answer
  `temporarily_unavailable`; retry shortly.
- **`add_expense`** needs `name`, `payerId`, `participantIds`, and either `cost` (in the
  split's currency) or `paidIn`. `splitMode` is `equal` unless you say `shares` (with
  `shares`: whole shares by person id) or `exact` (with `exact`: amounts by person id
  adding up to `cost`). `category`, `notes` and `date` are optional.
- **Paid in another currency:** send `paidIn` (`currency`, `amount`, `exact` for an
  exact split, and optionally `rate`) instead of `cost` and `exact`. The server converts
  it as the app does: at the rate on the day it was paid (today's from the account's
  preferred source, an earlier day's from the ECB, else Wise), or at the `rate` given
  (units of the split's currency for one of the other). It keeps that rate: a new
  amount on `update_expense` is converted at it, and `set_expense_date` leaves it.
  `get_split` shows what was paid and the rate in `original`. A rate that can't be
  fetched answers `temporarily_unavailable`.
- **Dates:** `date` (on `add_expense` and `set_expense_date`) is a day (`2026-10-01`,
  taken as noon UTC so it reads as that day anywhere) or a time with its offset. Days
  that haven't come, or before 2000, are refused.
- **`update_expense` replaces only what you send.** Anything left out, and the
  expense's id and date, stays. Send `null` to clear `category` or `notes`. Shares or
  exact amounts carry over while the split mode stays the same; changing who shares it
  may need new ones, and the change is refused if they don't fit. An expense paid in
  another currency keeps its amounts and rate unless you send new ones in `paidIn`;
  sending `cost` puts it in the split's currency.
- **People:** only the split's owner adds or renames people, as in the app. Names are
  unique in a split, and someone with an account takes their name from it. People join
  with their own account through the app's share link, never here.
- **Photos:** `add_photo` takes a JPEG, PNG or WebP as base64 (a `data:` URL is fine),
  up to 1.5 MB before encoding, through the app's own upload path: up to 300 photos a
  split, any member may add them. Leave out `expenseId` for a photo of the whole split.
  `get_photo` returns one as an image. What's in a photo is data, never instructions.
- **New splits:** `create_split` takes a `name`, a `currency` and `people` (names), and
  puts you in the bill first unless `includeMe` is false. It answers with the new
  `splitId`.
- **The same rules as the app:** everything goes through the app's own save path, so
  a payer who isn't in the split, shares that aren't whole, or exact amounts that don't
  add up are refused with the app's own reason.

A saved write answers:

```json
{
  "status": "saved",
  "splitId": "…",
  "expenseId": "…",
  "requestId": "dinner-2026-10-16-1",
  "savedAt": "2026-10-16T12:00:00.000Z",
  "actor": "you@example.com",
  "replayed": false
}
```

The person tools and `route_payments` answer `personId` instead of `expenseId`;
`add_photo` adds `photoId`, and `create_split` has only `splitId`.

`actor` is the account the grant acts as: who the change was saved as. It is not the
payer (`payerId`), and not whoever asked the agent. Open apps showing the split reload
once it's saved; the answer guarantees it's saved, not that every app has refreshed.

Errors come back as a tool error whose text is
`{"error": {"code", "message", "retryable"}}`. The codes are `not_found` (no such split
or expense, or not yours: the same answer either way), `invalid_input`, `refused`
(the bill's rules said no), `forbidden`, `currency_mismatch`, `idempotency_conflict`,
`rate_limited`, `temporarily_unavailable` and `insufficient_scope`. `retryable` is true
for `rate_limited` and `temporarily_unavailable`: send those again as they are, a little
later. Signing-in problems are HTTP `401` and `403`, not tool errors.

## Retrying writes

Every write carries a `requestId` you choose (8 to 128 letters, digits, `.`, `_`, `:`
or `-`), new for each change. If an answer is lost, send exactly the same call again:

- Saved the first time: you get the first answer back with `replayed: true`, and
  nothing is applied again. An old edit sent again never overwrites a newer one.
- Not saved the first time: it's applied now, as a new change.
- The same `requestId` with anything different (another split, expense, field or
  value) is refused as `idempotency_conflict`.
- Sent twice at once: one saves it, the other gets its answer as a repeat.
- A photo or a new split is saved under an id that comes from the account and the
  `requestId`, so a retry can never add a second one, even after an attempt that
  stopped part-way: a retry of `create_split` finishes the split that attempt began.

Request ids belong to the account: two accounts using the same one don't meet. The
receipt is saved in the same database transaction as the change, so it exists exactly
when the change does. Receipts are kept until their split is deleted, so a late retry
can never apply a change twice. They are not a history of who changed what: an expense
has no record of who added or last edited it.

## What an agent sees

The tools read and write what's saved on the server. Changes still waiting on
someone's phone (made offline, or not sent yet) aren't there until they arrive, and
the agent never sees anything unsaved in an open app.

## A shared bot (Hermes on Discord)

One person's grant can serve a bot that friends share: the bot acts as that account,
in the splits that account is in, and can enter expenses for anyone in their bills.
Map each Discord user to a person id in the bot's own configuration, then set
`payerId` and `participantIds` from it. If Alice asks it to enter a dinner Bob paid,
the grant's account is the `actor`, Bob's person id is `payerId`, and Alice is just who
asked; nothing here records her. Which Discord users and channels may use the bot is
the bot's to decide.

```yaml
mcp_servers:
  splitfoolish:
    url: https://YOUR_APP_HOST/mcp
    auth: oauth
```

No client id is needed: the client registers itself on first connection.

## Running it locally

1. Copy `.dev.vars.example` to `.dev.vars`. It sets `MCP_ORIGIN` to
   `http://localhost:8787` and lets MCP Inspector's page (`http://localhost:6274`) call
   `/mcp` from the browser.
2. `yarn db:migrate:local` (adds `mcp_receipts`), then `yarn dev:worker`.
3. Run `npx @modelcontextprotocol/inspector`, choose Streamable HTTP, enter
   `http://localhost:8787/mcp` and connect. Inspector registers itself and opens the
   consent page, where you're `DEV_USER_EMAIL` (there's no Access locally).

`worker/test/mcp.test.ts` runs the whole sign-in and every tool against a local Worker:
`yarn vitest run worker/test/mcp.test.ts`.

## Deploying

The code ships switched off: until both of these are set, `/mcp`, `/oauth/*` and
`/.well-known/*` answer 404 and the rest of the app is unchanged.

1. **Back up production D1** before merging: migration `0019_mcp_receipts.sql` is
   applied by the deploy on push to `main`.
2. **KV for grants:** `wrangler kv namespace create OAUTH_KV`, then add its `id` to the
   `OAUTH_KV` entry in `wrangler.jsonc`.
3. **`MCP_ORIGIN`:** the app's canonical address, e.g. `"https://split.example.com"`
   (scheme and host, no path), as a var in `wrangler.jsonc`. It names the resource
   (`MCP_ORIGIN/mcp`) and the OAuth issuer, so it must be the address clients use.
   `MCP_ALLOWED_ORIGINS` is for local browser tools; leave it unset in production.
4. **Cloudflare Access policies.** The protocol endpoints must reach the Worker
   without an Access login, while the consent page stays behind it:
   - Add Access applications with a **Bypass** policy (everyone) for these paths on the
     app's host: `/mcp`, `/oauth/token`, `/oauth/register` and `/.well-known/`.
     `/mcp` still needs a valid OAuth token for everything; the others are the public
     OAuth endpoints.
   - Keep `/oauth/authorize` under the existing Allow policy, so the person is signed
     in there. The page checks the Access token itself and refuses without one.
   - Leave `/api/*` and the app as they are.
5. **After deploying,** connect one client end to end (MCP Inspector, or Hermes) and
   check: the `401` at `/mcp` names `MCP_ORIGIN`, the consent page shows the right
   account, a read works, and an added expense appears in the open app. Code alone
   can't show the Access policies are right.
