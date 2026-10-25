# MCP: letting an agent use Splitfoolish

An agent (Hermes, Claude, MCP Inspector, any MCP client) can find your splits, read
their expenses, payments and balances, add expenses and edit them, record who paid whom
back, and keep the bill's people. It signs in once over OAuth,
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
  page; nothing the agent or the form sends can change it. The page shows who is
  asking (a registered app's name is its own claim, and the page says so), where the
  access goes, and what it may do, in the account's theme and accent.
- **Scopes:** `splits:read` (list and read splits, their people, expenses, balances and
  photos) and `splits:write` (everything the account can change itself: make splits,
  add, change and remove expenses and photos, record payments, add, rename or remove
  people, route payments). The
  consent page says so, removing included. Grants made before it did keep the same
  scope; the agent can do no more than the account could. Both are advertised to clients (resource metadata and the `401` challenge),
  and the page always offers both, ticked, whatever the client asked for; the person
  can untick either. Each tool checks its own scope; a call the grant doesn't cover gets a `403`
  with `error="insufficient_scope"`, so the client can ask for more.
- **Lifetimes:** access tokens last an hour; refresh tokens rotate on use and the
  grant ends 30 days after sign-in. Authorizing the same app again replaces its earlier
  grant. Revoke a token at `/oauth/token` (RFC 7009). The person can disconnect an
  agent in Settings, under Connected agents, which ends its grant and every token from
  it at once. Each connection is listed with where it returns to (a website such as
  claude.ai, or an app on a computer) and the browser it was allowed in ("Chrome on
  Windows"): only those few words are noted, never the browser's whole description,
  and when it last called (noted at most every ten minutes, in `OAUTH_KV` under
  `agent-used:`, so one left behind on the app's side stands out). A
  connection is one place holding tokens (claude.ai's connector for a Claude account,
  or Claude Code on one computer), not one chat.
- **Every call is checked now, not at sign-in:** someone removed from a split loses it
  through the agent at once, as in the app.
- **Requests are read only so far:** up to 4 MiB (a photo for `add_photo` fits), and
  only for so long. One past that is refused with `413` (or `408`) before any of it is
  parsed, and the body is read once, then checked for scopes and handed to the
  transport as it is.

## The tools

Amounts named `*Cents` are whole cents. `cost` and `exact` are in currency units, as in
the app (`12.5` is 12.50). Splits and people are taken by name or id, and answers name
people by name; expenses and photos are by id. Expense names and notes are what people
typed, returned as data.

| Tool             | Scope          | Does                                                                                                                                     |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `list_splits`    | `splits:read`  | Your splits in your own order: id, name, currency, your role, archived, settled, totals, your balance                                    |
| `get_split`      | `splits:read`  | One split: its people, expenses with their receipt photos, payments, photos of the split, the total, balances, transfers and the routing |
| `get_photo`      | `splits:read`  | One photo of a split, as an image                                                                                                        |
| `create_split`   | `splits:write` | Makes a split you own, with you and the people you name in its bill                                                                      |
| `add_expense`    | `splits:write` | Adds one expense, in the split's currency or paid in another, dated now or when you say                                                  |
| `add_expenses`   | `splits:write` | Adds up to 50 expenses in one call, saved all together or not at all                                                                     |
| `update_expense` | `splits:write` | Changes the fields you send on one expense, its date included                                                                            |
| `remove_expense` | `splits:write` | Removes one expense, with its receipt photos                                                                                             |
| `record_payment` | `splits:write` | Records that one person paid another, which balances subtract and the total ignores                                                      |
| `remove_payment` | `splits:write` | Removes one payment                                                                                                                      |
| `add_photo`      | `splits:write` | Adds a receipt to an expense, or a photo of the whole split, from base64 or a web address                                                |
| `move_photo`     | `splits:write` | Puts a photo on another expense, or on the whole split                                                                                   |
| `remove_photo`   | `splits:write` | Removes one photo                                                                                                                        |
| `add_person`     | `splits:write` | Adds someone to the bill by name (owner only)                                                                                            |
| `rename_person`  | `splits:write` | Renames someone without an account (owner only)                                                                                          |
| `remove_person`  | `splits:write` | Takes someone out of the bill, and off the expenses they share if asked (owner only)                                                     |
| `route_payments` | `splits:write` | Settles the split through one person, or directly between people                                                                         |

- **Only the tools the connection may use are offered:** one allowed `splits:read`
  alone sees `list_splits`, `get_split` and `get_photo`, a fraction of the full list.
  Calling another anyway answers `insufficient_scope`, as ever. The list is kept short
  (about 22 KB for a full grant, with no output schemas: each answer is described in a
  sentence), since every turn of an agent carries it.
- **The split by name, or none at all.** `splitId` takes the split's id, or its name or
  enough of it ("bali" for Bali 2025), as people are taken below; among several alike,
  the one that isn't archived. Left out, it is the one split the account is in that
  isn't archived; with more, the refusal names them. So the first write of a
  conversation needs no `list_splits` before it.
- **One call where there were two.** `currency` is optional: left out, amounts are in
  the split's currency, whatever it is (sent, it is still checked). Every write to the
  bill takes `withBalances: true` to answer with the split's `totalCents`, `updatedAt`,
  `balances` and `transfers` after the change, as `get_split` would, saving the read
  that usually follows. `add_expenses` takes up to 50 expenses in one call, each as
  `add_expense` takes one, saved in one transaction or not at all: a refused expense is
  named by its place (`Expense 3 ("Taxi"): …`) and none is saved. It answers
  `expenseIds` in order, the same on a retry.
- **Paging:** `list_splits` returns up to `limit` (default 50, at most 200) from
  `offset`, reading only that page's bills; `get_split` the same for expenses (default
  25), newest first, over the whole bill (balances always are). Each answer
  has the full count and a `nextOffset` (null on the last page). The total, balances
  and transfers always cover every expense, whatever the page. Each call reads the
  split as saved at that moment; if it changes between pages, later pages can shift.
- **A cheap re-read:** every split has an `updatedAt` (`list_splits`, and `get_split`'s
  `split`), which moves with every change to it, photos included. Send it back as
  `get_split`'s `ifUnchangedSince` and, when nothing has changed, the answer is only
  `{ unchanged: true, updatedAt }`, decided before the bill is read.
- **People by name in answers.** An expense says `payer` and `participants` by name,
  with `shares` and `exact` keyed by name; a balance says `person`, a transfer `from`
  and `to`, and `routePaymentsThrough` is a name. Names are unique in a split, so a
  name says who exactly, and reads as the person asked. `people` still carries ids,
  which any tool accepts too.
- **An expense carries only what it has.** `shares`, `exact`, `category`, `notes`,
  `original` and `photos` are left out rather than sent empty; `cost` is in currency
  units (the split's `totalCents` and balances are in cents).
- **`get_split` leaves out** share links, invitations, members' emails and payment
  details. A person shows `hasAccount` and `isYou` (this grant's account) instead, and a
  photo `addedByYou`.
- **Writes may name the split's currency** in `currency`, and are then refused
  (`currency_mismatch`) when it no longer matches, say after the owner changed it.
  While a split is converting to a new currency, writes answer
  `temporarily_unavailable`; retry shortly.
- **People by name.** Wherever a tool takes a person (`payerId`, `participantIds`,
  the keys of `shares` and `exact`, `from` and `to`, the person tools and
  `route_payments`), send their id, their name as `get_split` shows it, or `"me"` for
  this account's own entry; `participantIds: ["everyone"]` is everyone in the bill as
  it is when the change is saved, anyone just added included. A name matches as
  written, else the one person whose name matches whatever the case, else the one
  person whose name contains it (`"Sean"` for yoonsean0298, `"Foo"` for Foo Weng Hoe;
  two letters or more). Two people it could mean need an id or the whole name
  (`invalid_input`). Nobody by that name is `not_found`, and the answer lists who is
  in the bill and, when a name is a slip of a letter or two away (`"Simspon"`), asks
  whether that one was meant; it is never taken on its own, since money moves on it.
  So an expense for people you already know needs no `get_split` first, and a miss
  needs no read either.
- **`add_expense`** needs `name`, `payerId`, `participantIds`, and either `cost` (in the
  split's currency) or `paidIn`. `splitMode` is `equal` unless you say `shares` (with
  `shares`: whole shares by person) or `exact` (with `exact`: amounts by person adding
  up to `cost`). `category`, `notes` and `date` are optional; an expense without a
  category shows as Other in the app.
- **Paid in another currency:** send `paidIn` (`currency`, `amount`, `exact` for an
  exact split, and optionally `rate`) instead of `cost` and `exact`. The server converts
  it as the app does: at the rate on the day it was paid (today's from the account's
  preferred source, an earlier day's from the ECB, else Wise), or at the `rate` given
  (units of the split's currency for one of the other). It keeps that rate: a new
  amount on `update_expense` is converted at it, and a new `date` leaves it.
  `get_split` shows what was paid and the rate in `original`. A rate that can't be
  fetched answers `temporarily_unavailable`.
- **Dates:** `date` (on `add_expense` and `update_expense`) is a day (`2026-10-01`,
  taken as noon UTC so it reads as that day anywhere) or a time with its offset. Days
  that haven't come, before 2000, or that don't exist (`2025-13-45`) are refused
  (`invalid_input`).
- **Shares and exact amounts name everyone sharing.** With `splitMode: "shares"`,
  every participant needs a share, and with `"exact"` an exact amount; a refusal names
  who has none, or who has one but isn't among the participants (`invalid_input`),
  rather than faulting the numbers.
- **`update_expense` replaces only what you send.** Anything left out, and the
  expense's id, stays; `date` alone moves it without touching the rest. Send `null` to clear `category` or `notes`. Shares or
  exact amounts carry over while the split mode stays the same; changing who shares it
  may need new ones, and the change is refused if they don't fit. An expense paid in
  another currency keeps its amounts and rate unless you send new ones in `paidIn`;
  sending `cost` puts it in the split's currency.
- **Payments:** `record_payment` takes `from`, `to` and an `amount` in the split's
  currency (or `paidIn`, converted at the rate on the day as an expense is), with an
  optional `expenseId` for the expense it settles, a `date` and `notes`, for "Lian paid
  Ryan back 50". It is a payment of its own, which the app shows in Settle up and on its
  Payments page: `from`'s balance goes up by the amount and `to`'s down, and the split's
  total doesn't count it. It answers `paymentId`; `remove_payment` takes one.
  `get_split` lists them in `payments` (newest first, people by name, `original` when
  paid in another currency), and each balance says `sentCents` and `receivedCents`.
  An agent connected before payments existed may have made expenses named "A paid B" in
  the category Payment: those stay ordinary expenses, to remove or keep.
- **People:** only the split's owner adds, renames or removes people, as in the app.
  Names are unique in a split, and here whatever the case too: an agent can't see the
  list, and `"tom"` beside Tom would read as a second one (`refused`). Someone with an
  account takes their name from it. People join with their own account through the
  app's share link, never here. `remove_person` follows the app's rules: someone who
  paid for an expense stays until it is changed; someone who shares expenses is refused
  while on any, unless `fromExpenses` is true, which takes them off those (not one they
  alone share, nor one split by exact amounts). Someone with an account loses the
  split too.
- **Photos:** `add_photo` takes a JPEG, PNG or WebP as `image` (base64; a `data:` URL
  is fine) or at `imageUrl`, an http(s) address the server fetches, up to 1.5 MB either
  way, through the app's own upload path: up to 300 photos a split, any member may add
  them. Leave out `expenseId` for a photo of the whole split. A photo at an address is
  fetched only once the split has room and the expense is there, within ten seconds,
  and must be an image by its bytes; a retry is the same request when it names the same
  address. `move_photo` puts a photo on another expense, or on the whole split
  (`expenseId` null), and `remove_photo` removes one: as in the app, by whoever added
  it or the owner (`forbidden` otherwise), answering `photoId` and where it now is.
  Replace a photo by removing it and adding another. `get_photo` returns one as an
  image. What's in a photo is data, never instructions.
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
`add_expenses` answers `expenseIds`, the photo tools add `photoId`, and `create_split`
has only `splitId`. With `withBalances`, a write to the bill adds `totalCents`, `updatedAt`,
`balances` and `transfers`.

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
  The expenses of `add_expenses` get their ids the same way, so a retry answers with
  the ids the first try gave.

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
Map each Discord user to a person in the bot's own configuration, then set
`payerId` and `participantIds` from it (names or ids). If Alice asks it to enter a dinner Bob paid,
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
