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

`web/` and `worker/` never import each other; anything both need lives in `shared/`.
Each has its own `tsconfig.json`, so the app gets browser types, the Worker gets Worker
types and `shared/` gets neither.

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
