# Splitfoolish

Split shared expenses with friends: add what each person paid for, in any currency, and
see who owes whom. It installs as an app on phones and computers and keeps working
offline.

## Layout

| Folder        | What it is                                                                   |
| ------------- | ---------------------------------------------------------------------------- |
| `web/`        | The browser app: React, Mantine and Tailwind, built with Vite into `dist/`   |
| `worker/`     | The API: a Hono app on Cloudflare Workers that also serves `dist/`           |
| `shared/`     | Code both use: settling up, payment methods, rates and the API's data shapes |
| `migrations/` | D1 (SQLite) schema changes, applied in order on deploy                       |
| `docs/`       | The data model (`erd.md`)                                                    |
| `scripts/`    | Tools run by hand: `subset-font.sh` makes the font for PDF exports           |

`web/` and `worker/` never import each other; anything both need lives in `shared/`,
which the app imports as `@shared/...`.
Each has its own `tsconfig.json`, so the app gets browser types, the Worker gets Worker
types and `shared/` gets neither. Files are named for what they do on their side:
`shared/rates.ts` holds the arithmetic, `worker/exchange-rates.ts` fetches rates and
`web/src/utils/rate-labels.ts` says how they read.

Inside `web/src`, what the app knows is kept apart from how it looks:

| Folder                     | What it holds                                                                |
| -------------------------- | ---------------------------------------------------------------------------- |
| `split/`, `my-splits/`, …  | Shared state (the open bill, My splits, the profile): loading, saving, rules |
| `components/<screen>/`     | What a screen draws, reading from the folders above                          |
| `components/common/`       | What more than one screen draws that knows the app (a split's picture)       |
| `components/ui/`           | Plain building blocks that know nothing of splits (dialogs, a state card)    |
| `offline/`, `utils/`, etc. | What every feature leans on: the device cache, money, dates                  |

A screen may call the API itself for a one-off action that changes no shared state
(saving a payment method, say); anything the rest of the app shows goes through the
folder that owns it. So `split/` is the bill and `components/split/` is the split page:
its parts sit in subfolders (`items/`, `people/`, `dialogs/`, `layout/`, …) and read the
page's context from the folder above them.

## Running it

```sh
yarn install
cp .dev.vars.example .dev.vars
yarn db:migrate:local
yarn dev:worker      # builds the app, then serves app and API on http://localhost:8787
```

There is no Cloudflare Access locally, so every request is the `DEV_USER_EMAIL` in
`.dev.vars` (or whoever the `X-Dev-User` header names).

`yarn dev` runs the app alone with hot reload, without the API.

## Checks

```sh
yarn typecheck   # app, Worker, Worker tests, shared code and configs
yarn lint
yarn vitest run  # unit tests, plus API tests against a local Worker
```

## Deploying

Every push to `main` builds, checks and tests, applies new migrations to the production
database, then deploys the Worker (`.github/workflows/deploy.yml`).
