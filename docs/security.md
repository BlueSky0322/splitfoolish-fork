# Security and recovery

How Splitfoolish keeps people's splits to the people in them, what it relies on outside
this repo, and what to do when something goes wrong. It lowers risk; it doesn't make the
app hack-proof, and the limits below are real.

## Who can do what

- **Signing in.** Cloudflare Access sits in front of the whole app. The Worker checks the
  Access token on every request against `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`
  (`worker/accounts/auth.ts`). With only one of the two set it refuses everyone. The
  developer stand-in (`DEV_USER_EMAIL`, `X-Dev-User`) works only with both unset, so
  never set `DEV_USER_EMAIL` on the deployed Worker, and never remove the Access
  settings from `wrangler.jsonc`.
- **What each person may do** is in `shared/rules.ts`, which the Worker enforces.
  Membership and the split's currency are checked again inside the same database batch
  as each write (`worker/bill/commit.ts`), so a write that waited on an exchange rate
  can't land after its writer was removed or the currency changed.
- **Whose a write is.** Every write from the app names the account it was made as
  (`X-Expected-Account`). One made as another account is refused before it changes
  anything, and the device keeps it for that account.
- **Agents (MCP)** sign in over OAuth with scopes the person approves on a consent page
  (`docs/mcp.md`), and can be disconnected one by one in Settings. Registering an agent
  app is rate limited per address and in total.

## Limits that bound abuse

- Changes: 60 a minute per account (`API_LIMITER`). Agent registration: 10 a minute
  per address, 100 a minute in all.
- Request bodies are read only up to their limit and within a deadline
  (`readBody` in `worker/http.ts`), for JSON, photos, the consent form and MCP.
- Money: an item comes to at most `MAX_ITEM_CENTS` and a split holds at most
  `MAX_ITEMS`, so totals stay exact.
- Photos: a split holds at most 300, each up to 8192 pixels on a side; the type comes
  from the bytes.
- A change sent again after its answer was lost counts once (change receipts, kept 90
  days).

## On the device

- What the app keeps (splits, the outbox, photos to send, pictures) is tagged with the
  account and shown only to it. Signing out clears it; another account signing in
  clears what's shown but keeps the first account's unsent work, unseen, for when it's
  back.
- Pictures and photos are sent `private, no-cache`, so a browser asks the server again
  before each showing. The service worker keeps a copy per account and shows it only
  offline, to that account.
- Once an Access session runs out, the app opens with the last account's kept splits
  and offers to sign in. Whoever holds the device can read those kept splits until
  someone signs in or signs out: an unlocked shared device is a risk, as with any app
  that works offline.

## Secrets and where they live

| What                                            | Where                                      | Used for                           |
| ----------------------------------------------- | ------------------------------------------ | ---------------------------------- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secrets                     | Migrations and deploys from `main` |
| Access team domain and audience                 | `wrangler.jsonc` vars (not secret)         | Checking sign-in tokens            |
| OAuth clients, grants, tokens                   | `OAUTH_KV`, hashed by the provider library | Agents                             |

Never commit `.dev.vars` or tokens, and keep tokens and private photos out of logs. CI
runs with a read-only GitHub token, and its actions are pinned to commits
(`.github/workflows/deploy.yml`).

## Backups and restoring

A push to `main` applies new migrations to production and deploys. Before merging a
migration:

1. Export the database somewhere private (not the repo or a CI artifact):
   `npx wrangler d1 export splitfoolish-db --remote --output=<private path>.sql`
2. Check the export loads, for example into a scratch SQLite database, and that its
   tables have rows.
3. Note the Time Travel bookmark: `npx wrangler d1 time-travel info splitfoolish-db`.
   The deploy also prints one in its log just before applying migrations.

To go back:

- **To a moment in the last 30 days** (D1 Time Travel; the window depends on the plan):
  `npx wrangler d1 time-travel restore splitfoolish-db --bookmark=<bookmark>`, or
  `--timestamp=<unix seconds>`. This replaces the whole database, so everything written
  since is lost; export first if any of it matters.
- **From an export**: restore into a fresh database
  (`npx wrangler d1 create <name>`, then `npx wrangler d1 execute <name> --remote
--file=<export>.sql`), check it, then point `database_id` in `wrangler.jsonc` at it
  and deploy.
- **A bad deploy without a migration**: revert the commit on `main` (the push deploys
  the revert), or `npx wrangler rollback` to the previous version.

Practise a restore into a scratch database now and then, so the steps are known to work
before they're needed.

## If something goes wrong

- **A leaked Cloudflare token**: revoke it in the Cloudflare dashboard, make a new one
  with only what the deploy needs (Workers scripts and D1 edit on this account), and
  replace the GitHub secret.
- **An agent to cut off**: the person disconnects it in Settings, under Connected agents,
  which ends its grant and tokens at once. An agent can also revoke its own token at
  `/oauth/token`. To cut off every agent for everyone, empty `OAUTH_KV`; each has to be
  connected and approved again.
- **Someone who shouldn't be in**: remove them in the Access policy; their next request
  is refused. Remove them from splits in the app to take away what they could see.
- **Data written wrongly**: restore as above, after exporting what's there now.

## Settings outside the repo

These are kept in Cloudflare and GitHub, not here; check them from time to time:

- Access: which emails or groups the policy allows, and how long a session lasts.
- The Cloudflare API token's permissions: no more than the deploy needs.
- `REQUIRE_EXPECTED_ACCOUNT=true` on the Worker, once installed apps have updated, so
  writes from apps too old to say whose they are are refused (they're kept on the
  device until the app updates).
- GitHub: only trusted people can push to `main`, since a push deploys.
