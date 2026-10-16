# Splitfoolish

Split shared expenses: React app (`web/`) and a Hono API on Cloudflare Workers with D1
(`worker/`), sharing code in `shared/`. Folder layout and local setup are in
[README.md](README.md); the data model is in [docs/erd.md](docs/erd.md); how the Worker's
routes and modules fit together is at the top of `worker/app.ts`.

## Commands

- Install: `yarn install`
- Typecheck: `yarn typecheck` (app, Worker, Worker tests, shared, configs)
- Lint: `yarn lint` (zero warnings allowed)
- Tests: `yarn vitest run`, or one file: `yarn vitest run web/src/components/split/SplitScreen.test.tsx`
- Build: `yarn build`
- Run app and API locally: `yarn db:migrate:local`, then `yarn dev:worker` (http://localhost:8787).
  Every request is `DEV_USER_EMAIL` from `.dev.vars`, or whoever an `X-Dev-User` header names.
  Rebuild and restart it after changing `web/`.

The pre-commit hook runs `yarn build`, then eslint, prettier and the related tests on staged files.

## Boundaries

- `web/` and `worker/` never import each other; what both need lives in `shared/` (imported
  in the app as `@shared/...`). Who may do what is in `shared/rules.ts`, used on both sides.
- In `web/src`, state folders (`split/`, `my-splits/`, `profile/`, `offline/`) own loading and
  saving; `components/<screen>/` only draws. `components/ui/` knows nothing about splits.
- Changes to a split go through its actions and save queue (`split/actions.ts`,
  `split/useSaveQueue.ts`) so they show at once, survive going offline and sync later.
  My splits changes go through `my-splits/my-splits.ts` the same way.
- Money is whole cents everywhere; show it with `formatMoney` / `formatAmount` (`utils/money.ts`).

## Screen sizes

- `useIsMobile()` is under 768px (phones), `useIsDesktop()` is 1024px and up. Tablets in
  between keep the older layout with back buttons.
- Phones have their own layouts (`components/split/layout/MobileSplitLayout.tsx`,
  `components/home/MobileHome.tsx`, bottom tabs in `components/shell/`). A phone change
  should leave desktop and tablet as they were unless asked.
- Pages come from the query string (`?s=<id>`, `?settings`, `?convert`, `?tab=invites`) via
  `navigate()` in `hooks/useRoute.ts`.
- On phones, Back closes the top sheet first. Open sheets and dialogs with
  `components/ui/ResponsiveDialog` (or `useBackDismiss`); never push history entries for
  them by hand.

## Database

- A schema change is a new numbered file in `migrations/`. It is applied to production by
  the deploy on every push to `main`, so back up production before merging one.
- Worker API tests (`worker/test/api.test.ts`) run against a real local Worker and database.

## Tests

- Screen tests render the whole app with `renderApp` against the in-memory API in
  `web/src/testing/app.ts`; a new endpoint needs a stand-in there. Find elements by what a
  person sees (roles, labels, text), and pass `{ size: 'phone' }` for phone layouts.
- Never skip or weaken a test to get a pass.

## Conventions

- Comments say what the code does for the person using the app, in plain sentences.
  Match the density of the file you are in.
- Prettier settings are in `.prettierrc` (100 columns, single quotes, one JSX attribute per line).
- No emojis in code, UI text, commits or pull requests.
- Commit titles: `<type>(<scope>): <summary>`, with at most three bullets in the body.
  Pull requests are squash-merged; a push to `main` deploys.
- Never commit `.dev.vars`, tokens or other secrets.
