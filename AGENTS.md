# Splitfoolish

Split shared expenses: React app (`web/`) and a Hono API on Cloudflare Workers with D1
(`worker/`), sharing code in `shared/`. Folder layout and local setup are in
[README.md](README.md); which module owns each feature, its data flow, invariants and
tests are in [docs/feature-map.md](docs/feature-map.md); the data model is in
[docs/erd.md](docs/erd.md); how the Worker's routes and modules fit together is at the
top of `worker/app.ts`.

Before extending a feature, find its owner in the feature map and follow its mutation
path. Update the map in the same change when ownership, entry points, shared contracts
or invariants change. Explain any new dependency, abstraction or boundary exception,
and report the checks you actually ran.

## Commands

- Install: `yarn install` (`--frozen-lockfile` in CI)
- Typecheck: `yarn typecheck` (app, Worker, Worker tests, shared, configs)
- Lint: `yarn lint` (zero warnings allowed; includes the import boundaries below)
- Tests: `yarn vitest run`, or one file: `yarn vitest run web/src/components/split/SplitScreen.test.tsx`
- Build: `yarn build`
- Run app and API locally: `yarn db:migrate:local`, then `yarn dev:worker` (http://localhost:8787).
  Every request is `DEV_USER_EMAIL` from `.dev.vars`, or whoever an `X-Dev-User` header names.
  Rebuild and restart it after changing `web/`.

The pre-commit hook runs `yarn build`, then eslint, prettier and the related tests on staged files.

## Boundaries checked by lint

`tools/lint/architecture.js` resolves every import (relative, `@shared/...`, re-exports,
type imports, literal `import()`) and refuses these. Its tests show each case.

- `web/src` and `worker/` never import each other; what both need lives in `shared/`
  (`@shared/...` in the app, a relative path in the Worker). Tests are held to this too.
- `shared/` imports only `shared/` and packages that run anywhere: no Node built-ins, no
  `cloudflare:` modules. It also uses no browser or Worker globals (`shared/tsconfig.json`
  has no runtime types).
- Node built-ins only in tests and their harness (`*.test.*`, `web/src/testing/`,
  `worker/test/`). The Worker runs without `nodejs_compat`.
- In `web/src`: state, hooks and utilities never import components (only screens and
  the entry points do); production code never imports `web/src/testing/`;
  `components/ui/` imports only itself, `hooks/`, `utils/`, `shared/` and packages.

## State and components

- Feature state owns loading, saving, optimistic updates, device copies and refreshing:
  `split/` (the open split), `my-splits/` (My splits and invites), `profile/` (account
  and settings) and `offline/` (device cache, outbox, splits made offline).
- The bill (people, items) changes only through `split/actions.ts` and the save queue
  (`split/useSaveQueue.ts`), so changes show at once, survive going offline and sync
  later. The split's other details change through `changeMeta` or `refreshMeta`
  (`split/useSplit.ts`). My splits changes go through `my-splits/my-splits.ts`;
  profile and settings through `useProfile().change`.
- Components draw and keep local interaction state (what's open, drafts, selection).
  A component may call the API itself only:
  - as the request inside an owner's change (`useProfile().change`, `changeMeta`,
    `sendMySplitsChange`), which keeps the optimistic update and undo; or
  - for a read or action whose result nothing else shows (search, suggestions, a new
    share link). If it changes something shown elsewhere, it tells the owner straight
    after (`reloadMySplits`, `refreshMeta`, `patchListedSplit`, `removeListedSplit`).
    Never keep a second copy of owned state.
- `components/<screen>/` draws one screen; `components/common/` is what several screens
  draw that knows the app; `components/ui/` knows nothing about splits or accounts.

## Money

- Item amounts in the API and the app are in currency units: `Item.cost`, `exact`, and
  `original.amount` / `original.exact` (`shared/types.ts`). Fields named `*Cents` are
  whole cents (totals, balances, `convertedCents`). The database stores whole cents
  (`*_cents` columns).
- Convert at those edges with `shared/rates.ts` (`toCents`, `convertCents`,
  `convertParts`), and settle in cents with `shared/settle.ts` (through
  `split/derive.ts` in the app). New money arithmetic works in cents through these;
  never add or split floating currency units.
- Show money with `formatMoney` / `formatAmount` (`web/src/utils/money.ts`), which take cents.

## Rules, offline and screens

- Who may do what is in `shared/rules.ts`. The app uses it to decide what to offer; the
  Worker enforces it and is the authority.
- Offline: device copies and the outbox are tagged with the signed-in account, and one
  account never sees another's. Changes are sent in order, at most `MAX_CHANGES` at a
  time, and leave the outbox only once the server answers with JSON. The page and the
  service worker take the same lock per split. `web/public/sw.js` can't import app
  code, so it keeps copies of the keys, locks and limits it shares: change both
  together (`offline/outbox.test.ts` runs it against the app's).
- `useIsMobile()` is under 768px (phones), `useIsDesktop()` is 1024px and up. Tablets in
  between show one page at a time with back buttons (no sidebar, no bottom tabs), and
  the phone split page. Phones have their own layouts
  (`components/split/layout/MobileSplitLayout.tsx`, `components/home/MobileHome.tsx`,
  bottom tabs in `components/shell/`). A phone change leaves desktop and tablet as
  they were unless asked.
- Pages come from the query string (`?s=<id>`, `?settings`, `?convert`, `?tab=invites`)
  via `navigate()` in `hooks/useRoute.ts`.
- On phones, Back closes the top sheet first. Open sheets and dialogs with
  `components/ui/ResponsiveDialog` (or `useBackDismiss`); never push history entries
  for them by hand.

## Database

- A schema change is a new numbered file in `migrations/`. It is applied to production by
  the deploy on every push to `main`, so back up production before merging one.
- Worker API tests (`worker/test/api.test.ts`) run against a real local Worker and database.

## Tests

- Screen tests render the whole app with `renderApp` against the in-memory API in
  `web/src/testing/app.ts`; a new endpoint needs a stand-in there that keeps the real
  one's contract (limits, error answers, ordering). Find elements by what a person sees
  (roles, labels, text), and pass `{ size: 'phone' }` for phone layouts.
- Assert what a person or caller observes, precisely enough that a plausible regression
  fails. When a change touches them, cover refusals and the order of asynchronous
  answers.
- Never skip or weaken a test to get a pass.

## Conventions

- Comments say what the code does for the person using the app, in plain sentences.
  Match the density of the file you are in.
- Prettier settings are in `.prettierrc` (100 columns, single quotes, one JSX attribute per line).
- No emojis in code, UI text, commits or pull requests.
- Commit titles: `<type>(<scope>): <summary>`, with at most three bullets in the body.
  Pull requests are squash-merged; a push to `main` deploys.
- Commits, pull requests and merge messages carry no AI attribution: no
  `Co-authored-by` or `Generated with` lines for an assistant.
- A change to a boundary or invariant, or a new dependency or abstraction, says why
  and what checked it in its pull request.
- Never commit `.dev.vars`, tokens or other secrets.
