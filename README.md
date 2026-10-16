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
| `docs/`       | The data model (`erd.md`) and where each feature lives (`feature-map.md`)    |
| `tools/`      | Repository checks, such as the import boundaries `yarn lint` enforces        |

`web/` and `worker/` never import each other; anything both need lives in `shared/`,
which the app imports as `@shared/...`. `yarn lint` checks this
(`tools/lint/architecture.js`).
Each has its own `tsconfig.json`, so the app gets browser types, the Worker gets Worker
types and `shared/` gets neither. Files are named for what they do on their side:
`shared/rates.ts` holds the arithmetic, `worker/exchange-rates.ts` fetches rates and
`web/src/utils/rate-labels.ts` says how they read.

Inside `web/src`, what the app knows is kept apart from how it looks:

| Folder                                         | What it holds                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `split/`, `my-splits/`, `profile/`, `offline/` | Shared state (the open split, My splits, the profile, what's kept on the device) |
| `components/<screen>/`                         | What a screen draws, reading from the folders above                              |
| `components/common/`                           | What more than one screen draws that knows the app (a split's picture, avatars)  |
| `components/ui/`                               | Plain building blocks that know nothing of splits or accounts (dialogs)          |
| `hooks/`, `utils/`                             | What every feature leans on: screen sizes, the page address, money, dates        |

So `split/` is the open split and `components/split/` is the split page: its parts sit in
subfolders (`items/`, `people/`, `dialogs/`, `layout/`, …) and read the page's context
from the folder above them.

Anything the rest of the app shows is loaded and changed by the folder that owns it. A
screen may still make the request itself, either inside the owner's change (saving a
payment method goes through the profile's, which shows it at once and undoes it if the
save fails) or for something nothing else shows, such as a search; when such an action
changes what other screens show, the screen tells the owner to refresh. The rules are in
`AGENTS.md`, and each feature's owner in `docs/feature-map.md`.

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
yarn lint        # includes the import boundaries between app, Worker and shared code
yarn vitest run  # unit tests, plus API tests against a local Worker
```

## Deploying

Every push to `main` builds, checks and tests, applies new migrations to the production
database, then deploys the Worker (`.github/workflows/deploy.yml`).
