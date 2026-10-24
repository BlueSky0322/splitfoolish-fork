# Feature map

Where each feature lives, which module owns its state and changes, what it must keep
true, and which tests hold it to that. Read the entry for a feature before extending
it, and update the entry in the same change when its owner, entry points, data flow or
contracts change. Presentation-only changes need no update here.

The data model is in [erd.md](erd.md). How the Worker's routes and modules fit together
is at the top of [worker/app.ts](../worker/app.ts). The rules every change follows are
in [AGENTS.md](../AGENTS.md).

| Feature                                                                        | State owner (app)                                                                                 | Worker                                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Sign-in, profile and settings](#sign-in-profile-and-settings)                 | `profile/ProfileContext.tsx`                                                                      | `accounts/`, `routes/me.ts`                                      |
| [My splits](#my-splits-archive-search-and-order)                               | `my-splits/my-splits.ts`                                                                          | `splits/summaries.ts`, `splits/lifecycle.ts`, `routes/splits.ts` |
| [Editing a split](#editing-a-split-items-and-people)                           | `split/actions.ts`, `split/useSaveQueue.ts`, `split/useSplit.ts`                                  | `bill/`, `splits/detail.ts`                                      |
| [Settling up and currencies](#settling-up-and-currencies)                      | `split/derive.ts`, `split/currencies.ts`                                                          | `currency/`, `routes/rates.ts`                                   |
| [Exporting a split](#exporting-a-split)                                        | `split/export/`                                                                                   | (none)                                                           |
| [Sharing, invites and live updates](#sharing-invites-and-live-updates)         | `split/useSplit.ts`, `split/useSplitLive.ts`, `my-splits/my-splits.ts`                            | `splits/sharing.ts`, `splits/room.ts`, `routes/invites.ts`       |
| [Offline start and delivery](#offline-start-and-delivery)                      | `offline/`                                                                                        | (none; the API is the same)                                      |
| [Pictures, photos and payment QR codes](#pictures-photos-and-payment-qr-codes) | `split/usePhotos.ts`, `offline/photo-queue.ts`, `split/pictures.ts`, `profile/ProfileContext.tsx` | `photos/`                                                        |
| [Pages, layouts and Back](#pages-layouts-and-back)                             | `hooks/useRoute.ts`, `hooks/useBackDismiss.ts`                                                    | (none)                                                           |
| [Agents over MCP](#agents-over-mcp)                                            | `components/settings/AgentsSection.tsx` (listing and disconnecting)                               | `mcp/`, `bill/changes.ts` (`saveChanges`)                        |

App paths are under `web/src/`, Worker paths under `worker/`.

## Sign-in, profile and settings

**What it is.** Cloudflare Access signs people in before the app loads. Settings (the
You tab on phones, `?settings`) edit the profile others see (display name, picture,
payment methods) and private settings (currency, rate source, appearance).

**Owner.** [profile/ProfileContext.tsx](../web/src/profile/ProfileContext.tsx) loads
the profile, keeps a device copy, and owns every change through
`useProfile().change(show, save)`, which shows the change at once and undoes it if
`save` fails (the caller says what went wrong).

**Parts.**

- UI: [components/settings/](../web/src/components/settings/SettingsPage.tsx).
- API: [worker/accounts/auth.ts](../worker/accounts/auth.ts) checks the Access token (or the local dev
  user), [worker/routes/me.ts](../worker/routes/me.ts) serves `/api/me`, and
  [worker/accounts/profiles.ts](../worker/accounts/profiles.ts) stores profiles and settings.
- Shared: `Settings`, `DEFAULT_SETTINGS` and the profile shapes in
  [shared/api.ts](../shared/api.ts); payment method shapes in
  [shared/payments.ts](../shared/payments.ts).

**Invariants.**

- Without both Access values set, the API refuses everyone, unless both are blank and a
  local dev user is set (`getUserEmail` in `accounts/auth.ts`).
- A new settings row takes every value from `DEFAULT_SETTINGS`, so defaults change in
  `shared/api.ts` alone (`accounts/profiles.ts`).
- A stale save answer never overwrites a newer change (`ProfileContext.tsx`).

**Tests.** [worker/accounts/auth.test.ts](../worker/accounts/auth.test.ts) (tokens, keys, configuration,
401 versus 500), [SettingsPage.test.tsx](../web/src/components/settings/SettingsPage.test.tsx)
(saving, out-of-order answers), and the profile and payment cases in
[worker/test/api.test.ts](../worker/test/api.test.ts).

## My splits: archive, search and order

**What it is.** The list of splits on the home page and sidebar, with totals and your
balance, pending invites, archive, your own order, and search across items and splits.

**Owner.** [my-splits/my-splits.ts](../web/src/my-splits/my-splits.ts) holds the list
(through React Query, with a device copy) and its changes: `createSplit`, `moveSplit`,
`archiveSplit`, `patchListedSplit`, `removeListedSplit`, `sendMySplitsChange` and
`reloadMySplits`. Screens read it through
[useMySplits](../web/src/my-splits/useMySplits.ts).

**Parts.**

- UI: [components/home/](../web/src/components/home/SplitsHome.tsx) (desktop and
  [MobileHome](../web/src/components/home/MobileHome.tsx), search, sorting, invites)
  and the [sidebar](../web/src/components/shell/Sidebar.tsx).
- API: [worker/splits/summaries.ts](../worker/splits/summaries.ts) (the list with totals, all of it or a
  page cut in the database, with the count over all; search, item name suggestions,
  used currencies), [worker/splits/lifecycle.ts](../worker/splits/lifecycle.ts)
  (create, rename, order, delete), and [worker/routes/splits.ts](../worker/routes/splits.ts)
  (archive, search).
- Shared: `SplitSummary` and the list shapes in [shared/api.ts](../shared/api.ts).

**Flow.** A change shows in the list at once, is sent, and the list is reloaded or the
change undone. Splits made offline are added from `offline/pending-creates.ts` until the
server has them. Your own order is changed by dragging
([SortableSplits](../web/src/components/home/SortableSplits.tsx), then `moveSplit`): with a
mouse on computers, and by tapping and holding a split on phones, where a quick sideways
swipe still shows Archive and Leave. Only Your order can be dragged; the other sorts are
worked out.

**Invariants.**

- Totals and balances use the same arithmetic as the split page
  ([shared/settle.ts](../shared/settle.ts)), so both always agree.
- Archive and order are per person: only the caller's own `split_members` rows change.

**Tests.** [SplitsHome.test.tsx](../web/src/components/home/SplitsHome.test.tsx)
(sorting, search, archive, invites) and the listing, search and order cases in
[worker/test/api.test.ts](../worker/test/api.test.ts).

## Editing a split: items and people

**What it is.** The split page (`?s=<id>`): its people, its items (added, added to a
day from its heading, edited, duplicated, moved to another day, deleted), the payments
between its people (recorded, edited, deleted) and its details.

**Owner.** The bill (people, items and payments) is changed only through
[split/actions.ts](../web/src/split/actions.ts), which updates
[split/state.ts](../web/src/split/state.ts) at once and queues the matching `Change` in
[split/useSaveQueue.ts](../web/src/split/useSaveQueue.ts). The split's other details
(name, members, photos, routing) change through its `metaChanges` (`changeMeta` for
a request to undo if it fails, and helpers such as `addAttachment` and `patchSettings`)
or `refreshMeta` from
[split/useSplit.ts](../web/src/split/useSplit.ts), which also loads the split and keeps
it current.

**Parts.**

- UI: [components/split/](../web/src/components/split/SplitScreen.tsx) (items, people,
  dialogs and the two layouts), reading the page's context from
  [SplitPageContext](../web/src/components/split/SplitPageContext.tsx) and the bill from
  [SplitStateContext](../web/src/split/SplitStateContext.tsx).
- Form logic: [split/item-input.ts](../web/src/split/item-input.ts) and
  [split/bill-rules.ts](../web/src/split/bill-rules.ts). The form's date uses
  [DayField](../web/src/components/split/items/DayField.tsx), as Move to a day does: a new
  item goes on the day picked at the time it is now (from a day's heading, that day:
  `openDialog({ kind: 'add', day })`), and an edit to another day keeps its time of day
  (`updateItem(id, input, { day })` queues the date before the edit, so the server
  converts on the new day) ([utils/date-input.ts](../web/src/utils/date-input.ts)).
- People's colours: [split/person-colors.ts](../web/src/split/person-colors.ts) gives
  each person one (`personColors`), SplitScreen provides them through
  [person-colors-context.ts](../web/src/components/split/person-colors-context.ts), and
  `PersonAvatar`, `PersonName` and account avatars and names in the split read them.
- API: [worker/bill/changes.ts](../worker/bill/changes.ts) applies a batch of changes
  (all or none, `saveChanges`, which the MCP tools use too), checking each against the
  bill as it stands
  ([model.ts](../worker/bill/model.ts)) with what [input.ts](../worker/bill/input.ts)
  reads from it; [worker/bill/read.ts](../worker/bill/read.ts) reads the bill, and
  [worker/splits/detail.ts](../worker/splits/detail.ts)
  reads a whole split in one round trip.
- Shared: `Item` and `Change` in [shared/types.ts](../shared/types.ts), who may do what
  in [shared/rules.ts](../shared/rules.ts), `MAX_CHANGES` in [shared/api.ts](../shared/api.ts).

**Flow.** Action → state shows it → change queued (with the split's currency) and written
to the outbox → sent in order, at most `MAX_CHANGES` at a time, each with its id → the
server skips ones it has receipts for, checks the rest against the split as it is now,
and saves them with their receipts and its checks
([bill/commit.ts](../worker/bill/commit.ts)) in one batch. A refused batch drops what was
queued after it and reloads the split.

**Invariants.**

- Changes are applied in the order they were made, and a refused batch never applies
  part of itself (`bill/changes.ts`).
- What a write read before it saves is checked again as it saves, in the same batch
  (`guardStatements`): the writer still in the split with the same role, and, for
  amounts, the split still in the currency they were worked out in. A check that fails
  undoes the batch (`write_guards`, migration 0020): a removed writer gets 404, a changed
  currency 503, after which the app sends the change again. Photos check membership the
  same way.
- A change sent with an id counts once: its receipt (`change_receipts`) is saved with it,
  and the same id with a different change is refused. Plain amounts sent with an older
  currency than the split's are items paid in that currency, never amounts in the new
  one. Apps from before ids get the old behaviour.
- An item comes to at most `MAX_ITEM_CENTS` once converted (`fitsItemCents`), and a split
  holds at most `MAX_ITEMS`, so totals and shares stay exact. A currency change an item
  is too large for puts the split back in its old currency (`currency/reconvert.ts`).
- A payment (`addPayment`, `updatePayment`, `removePayment`; `readPayment` in
  `bill/input.ts`) is between two different people in the split, of more than nothing,
  and may name an item that is there. Someone who made or received a payment stays in
  the split (`removalBlocker`), and the people can't be cleared while any remain. An
  item that goes leaves its payments, untied (`item_id` cleared by `changes.ts`, SET
  NULL as the backstop). A payment is capped like items and converted like them.
- Only the newest load of a split is shown, and a device copy never replaces what the
  server said (`useSplit.ts`).
- People's colours are worked out, not stored: by their order in the split, the first
  four on the four most distinct hues in an order picked by the split's id. Green and
  red stay for owed and owing, and a name is always shown beside a colour.

**Tests.** [actions.test.ts](../web/src/split/actions.test.ts),
[state.test.ts](../web/src/split/state.test.ts),
[item-input.test.ts](../web/src/split/item-input.test.ts),
[SplitScreen.test.tsx](../web/src/components/split/SplitScreen.test.tsx),
[SplitLoading.test.tsx](../web/src/components/split/SplitLoading.test.tsx) (load
order), [person-colors.test.ts](../web/src/split/person-colors.test.ts),
[PersonColors.test.tsx](../web/src/components/split/PersonColors.test.tsx),
[AddToDay.test.tsx](../web/src/components/split/AddToDay.test.tsx), and the change and permission cases in
[worker/test/api.test.ts](../worker/test/api.test.ts).

## Settling up and currencies

**What it is.** Who owes whom and how they pay, payments made between people (Mark as
paid on a transfer, Paid back on someone's part of an item, the Payments page at
`?s=<id>&payments`), items paid in other currencies, the Currencies sheet, and the
Convert page (`?convert`).

**Owner.** Settling is worked out, not stored: [split/derive.ts](../web/src/split/derive.ts)
turns the bill into totals, balances and transfers with
[shared/settle.ts](../shared/settle.ts), each balance paid less share, plus payments
made less received. Payments themselves are part of the bill (see Editing a split):
[components/split/payments/](../web/src/components/split/payments/PaymentsPage.tsx)
records, lists, edits and deletes them through the split's actions. Converted items keep their original amount and
the rate on the day they were paid (`getRateOn` in
[worker/currency/exchange-rates.ts](../worker/currency/exchange-rates.ts)), so settling
never moves with today's rates; [split/currencies.ts](../web/src/split/currencies.ts)
lists them for the Currencies sheet, and typed rates go through the split's actions.

**Parts.**

- UI: [components/split/balances/](../web/src/components/split/balances/BalancePanel.tsx),
  [CurrenciesSheet](../web/src/components/split/dialogs/CurrenciesSheet.tsx),
  [components/convert/](../web/src/components/convert/ConvertPage.tsx), and the rate
  hook [hooks/useRate.ts](../web/src/hooks/useRate.ts).
- API: [worker/currency/exchange-rates.ts](../worker/currency/exchange-rates.ts) (Wise and the ECB,
  cached; `getRateOn` for an item's day: today's live rate, or the ECB's for an earlier
  day, then Wise's), [worker/routes/rates.ts](../worker/routes/rates.ts) (`?at=` for the
  item form's preview of an item's day), and
  [worker/currency/reconvert.ts](../worker/currency/reconvert.ts) (converting every item after the
  split's currency changes, each at its own day's rate, in the background). A failed conversion is retried by the
  `reconvert` queue with growing waits ([worker/currency/reconvert-queue.ts](../worker/currency/reconvert-queue.ts),
  wired in `worker/index.ts` and `wrangler.jsonc`); opening a split retries one stuck
  for 10 minutes.
- Shared: [shared/rates.ts](../shared/rates.ts) (`toCents`, `convertCents`,
  `convertParts`, `rateDay`, rate validity) and [shared/settle.ts](../shared/settle.ts).

**Invariants.**

- Item amounts are currency units; settling and storage are integer cents (see Money in
  [AGENTS.md](../AGENTS.md)).
- Converted exact parts add up to the converted total, the leftover cents going by
  largest remainder (`convertParts`).
- A payment never counts in the split's total, and is never shown as an item: the
  total is what was spent, settling is what moved between people.
- An item, or a payment, is recorded at the rate on the UTC day it was paid (`rateDay`) and kept at
  it, so what someone owes never moves with the rates: a new amount is converted at the
  same rate (`keepsSavedConversion`), and moving it to another day (`setItemDate`)
  leaves the rate. Only a typed rate, a new currency for the item, or a new currency for
  the split gives it another, the last two at the rate for its day. With no rate for
  that day from either service, today's is used and its date says so; with a service
  down, the change waits (503) rather than taking today's.
- A rate someone typed is kept as typed until `setRate` with no rate puts the
  currency's items back on their days' rates. `refreshRates`, sent by older apps, does
  nothing.
- Every conversion run is idempotent and only finishes the change it was started for
  (`converting_since`), so the first attempt, queued retries and the open-split retry
  can overlap safely.

**Tests.** [shared/settle.test.ts](../shared/settle.test.ts),
[worker/currency/reconvert-queue.test.ts](../worker/currency/reconvert-queue.test.ts) (acks, retries,
backoff, given-up jobs),
[derive.test.ts](../web/src/split/derive.test.ts),
[currencies.test.ts](../web/src/split/currencies.test.ts),
[worker/currency/exchange-rates.test.ts](../worker/currency/exchange-rates.test.ts),
[ConvertPage.test.tsx](../web/src/components/convert/ConvertPage.test.tsx),
[CurrenciesSheet.test.tsx](../web/src/components/split/CurrenciesSheet.test.tsx), and
the rate and reconversion cases in [worker/test/api.test.ts](../worker/test/api.test.ts) (including a photo sent
again with its id).

## Exporting a split

**What it is.** Export in the split's menu (More on computers, ⋯ on phones): a CSV for
spreadsheets or a PDF to keep or send, shared on phones and saved elsewhere. Both list
the items, the balances, who pays who, and the payments made.

**Owner.** [split/export/](../web/src/split/export/export.ts) builds both from the
split as this device shows it (unsaved changes included); nothing is sent to the
server. [rows.ts](../web/src/split/export/rows.ts) works out the rows both formats use,
from `computeTotals` in `split/derive.ts`.

**Parts.**

- UI: [ExportDialog](../web/src/components/split/dialogs/ExportDialog.tsx), opened as
  the `export` dialog of the split page.
- Formats: [csv.ts](../web/src/split/export/csv.ts) and
  [pdf.ts](../web/src/split/export/pdf.ts) (jspdf, loaded only when Export opens).
- Font: [font.ts](../web/src/split/export/font.ts) fetches
  `web/public/fonts/NotoSansJP-subset-v2.ttf` (Latin, kana, and the everyday and name kanji, made by
  [scripts/subset-font.sh](../scripts/subset-font.sh)); `sw.js` keeps it offline.
- Delivery: [utils/deliver-file.ts](../web/src/utils/deliver-file.ts), the share sheet
  or a download, also used by Share image. Computers always download, even where the
  browser has a share sheet (it would only offer to copy the file).

**Invariants.**

- Amounts come from cents: the CSV writes plain decimals to the cent, the PDF uses
  `formatMoney`.
- CSV text a spreadsheet would run as a formula starts with `'`; amounts stay numbers.
- A font change gets a new file name, since the service worker keeps `/fonts/*` for good.

**Tests.** [rows.test.ts](../web/src/split/export/rows.test.ts),
[csv.test.ts](../web/src/split/export/csv.test.ts),
[pdf.test.ts](../web/src/split/export/pdf.test.ts),
[font.test.ts](../web/src/split/export/font.test.ts),
[ExportDialog.test.tsx](../web/src/components/split/ExportDialog.test.tsx), and the font
cases in [sw.test.ts](../web/src/offline/sw.test.ts).

## Sharing, invites and live updates

**What it is.** Share links, requests to join and their approval, invites on the home
page (`?tab=invites` on phones), removing members, and seeing other people's changes
as they happen.

**Owner.** Membership is the server's: the app shows it from the split's details
(`useSplit.ts`) and from My splits (pending invites). Answering an invite goes through
`sendMySplitsChange`; changes to a split's members go through `changeMeta` or
`refreshMeta`. [split/useSplitLive.ts](../web/src/split/useSplitLive.ts) listens for
changes to the open split and asks `useSplit` to reload.

**Parts.**

- UI: [SplitMembers](../web/src/components/split/people/SplitMembers.tsx),
  [JoinSplit](../web/src/components/split/JoinSplit.tsx) and
  [invite-answers.ts](../web/src/components/home/invite-answers.ts).
- API: [worker/splits/sharing.ts](../worker/splits/sharing.ts) (links, invites, removing someone),
  [worker/routes/invites.ts](../worker/routes/invites.ts), and
  [worker/splits/room.ts](../worker/splits/room.ts), one Durable Object per split that tells open
  apps a change was saved. [worker/index.ts](../worker/index.ts) tells the room after
  a successful change (`changedSplit`).
- Shared: roles and permissions in [shared/rules.ts](../shared/rules.ts).

**Invariants.**

- A removed member's live sockets are closed (`evictFromRoom` in `routes/splits.ts`) and
  the owner's share link changes, so the old link can't bring them back
  (`splits/sharing.ts`).
- The room carries no data, only "changed"; each app fetches the split again.

**Tests.** [SplitScreen.test.tsx](../web/src/components/split/SplitScreen.test.tsx)
(live reloads and reconnecting), [SplitsHome.test.tsx](../web/src/components/home/SplitsHome.test.tsx)
(answering invites), and the sharing and removal cases in
[worker/test/api.test.ts](../worker/test/api.test.ts).

## Offline start and delivery

**What it is.** The app opens and works offline: pages show the last copy seen, splits
can be made and changed, and everything is sent once the connection is back, by the
page or, if it's closed, by the service worker.

**Owner.** [offline/](../web/src/offline/cache.ts):

- [cache.ts](../web/src/offline/cache.ts): device copies tagged with the signed-in
  account.
- [outbox.ts](../web/src/offline/outbox.ts): unsent changes, batching and the
  per-split lock.
- [pending-creates.ts](../web/src/offline/pending-creates.ts): splits made offline.
- [photo-queue.ts](../web/src/offline/photo-queue.ts): photos and receipts still to
  upload (see Pictures below).
- [sync.ts](../web/src/offline/sync.ts): sending all of it, started by
  [main.tsx](../web/src/main.tsx) when the connection or the app comes back, and
  counting what signing out would lose, changes and photos (Settings asks first).
- [storage-health.ts](../web/src/offline/storage-health.ts): whether the device kept the
  latest unsent work (changes, new splits, photos); the shell's `OfflineNotice` says
  when it couldn't.
- [storage.ts](../web/src/offline/storage.ts): once the app is installed, asks the
  browser (once per device) not to clear what's kept when space runs low.

An open split sends its own changes through `useSaveQueue`.

**Parts.** [web/public/sw.js](../web/public/sw.js) keeps the page, the built files and
each account's pictures, and sends the outbox and kept photos by background sync. It can't import app code, so the
keys, lock names and limits it shares with `offline/` and `shared/api.ts` are copied in
it. The build writes `precache.json`, every built file the app needs offline: the entry
and its styles, and the chunks the app's own code loads later (sharing an image, PDF
export) with their imports, but not a library's own optional extras
([web/build/precache.ts](../web/build/precache.ts)). The PDF font is not in it: it's
kept the first time Export opens.

Opening the app: [web/index.html](../web/index.html) paints a first screen before the
app's code loads, in the theme this device saved (`sf-appearance`) or the phone's own
on Auto, with the logo drawing itself, and sets the status bar's colour;
[pwa/launch-screen.ts](../web/src/pwa/launch-screen.ts) fades it out once the app is up
and keeps the status bar following the theme. Before that, iPhones show plain launch
screens in the theme's background, made at build time with their links
([web/build/launch-images.ts](../web/build/launch-images.ts)); Android shows the
manifest's dark one, which can't follow the theme. Both need the manifest and icons let
past Cloudflare Access (Deploying in [README.md](../README.md)); without them Chrome
installs the page with no manifest, and a white launch screen.

**Flow.** A page load waits up to 3 seconds for the network; offline, slower, or a
5xx or non-page answer, and the kept page opens instead, marked as opened from the
device. When Cloudflare Access asks to sign in again (a redirect) and a page is kept,
the kept page opens, marked as signed out (`OPENED_SIGNED_OUT`): the last account's saved
splits show, changes are kept on the device, and the notice offers Sign in once there's
a connection. Sign in goes to the same page marked with `SIGN_IN_PARAM`, which the
service worker leaves to the browser so Access answers; the mark comes off the address
once back (`dropSignInMark`). With nothing kept yet, a sign-in redirect goes to the
browser. A 4xx goes to the browser too, and `/cdn-cgi/` (Access) is never handled. A good page is kept in the background, even when it came too late. Opened
from the device, the profile waits 2 seconds on `/api/me` (or not at all if it fails
with a 5xx), then shows the last account's saved copies
([ProfileContext](../web/src/profile/ProfileContext.tsx)).

**Invariants.**

- Nothing kept on the device is shown before the signed-in account is known, and one
  account never sees another's. The last account is only assumed offline, or when the
  page was opened from the device; if the server then names someone else, their copies
  are dropped and the app reloads. Their unsent changes, splits and photos are kept,
  unseen, and sent once they sign in again; signing out keeps them too.
- Every write names the account it was made as (`X-Expected-Account`, from
  `writeAs` in [api.ts](../web/src/api.ts), and each entry's own account in `sw.js`).
  The server refuses one for another account (409 `account_mismatch`) before it changes
  anything, and the entry stays queued without retrying on a timer. With
  `REQUIRE_EXPECTED_ACCOUNT=true` a write that names no account is refused (503
  `client_update_required`) and kept; off until installed apps send the header.
- The manifest and the icons it names (and the iPhone icon) are kept beside the page,
  refreshed whenever the page is, and answered from there when the network fails or
  something answers in their place (Access), so a page opened from the device installs
  with its manifest (`INSTALL_FILES` in `sw.js`; `shell.test.ts` checks it against the
  manifest and `index.html`).
- The kept page is only replaced once every file it and `precache.json` name is kept,
  so a stopped update leaves the old page whole. Built files of the newest two pages
  are kept, for a tab still open on the older one; others go when a new page is kept.
- A batch leaves the outbox once the server accepts it with a JSON answer; a refused
  batch is dropped with everything queued after it. Where the browser has Web Locks,
  the page and the service worker take the same lock per split, so a change is sent
  once.
- Batches are at most `MAX_CHANGES` and `MAX_CHANGES_BYTES` of JSON (one larger change
  goes alone), in order; what's left is kept after each batch. Sends while the page is
  hidden use keepalive, which browsers allow only for small requests.
- Unsent work the device couldn't keep is still sent from memory while the app is
  open, and is never taken for sent elsewhere.
- Signed out (401), an open split stops retrying on a timer until the app is shown
  again or the connection returns. A 401 for who's signed in, or a page opened signed
  out, shows the last account's saved profile when there is one (`signInToSync`), and
  "You're signed out" only when nothing is kept. Its Sign in never reloads, which would
  open the kept page again.

**Tests.** [cache.test.ts](../web/src/offline/cache.test.ts),
[outbox.test.ts](../web/src/offline/outbox.test.ts) (runs `sw.js` against what the app
writes, so the copied keys and lock names can't drift),
[sw.test.ts](../web/src/offline/sw.test.ts) (batches by count and size and every kind
of answer, on the page and in `sw.js` alike),
[shell.test.ts](../web/src/offline/shell.test.ts) (slow, failing and redirected page
loads, stopped updates, which files are kept),
[start.test.tsx](../web/src/offline/start.test.tsx) (starting from the device's copy,
and once Access asks to sign in again),
[storage.test.ts](../web/src/offline/storage.test.ts),
[web/build/precache.test.ts](../web/build/precache.test.ts) (what the build lists),
[delivery.test.ts](../web/src/offline/delivery.test.ts) (page and service worker
together, keepalive, coming back to the app, signed-out retries), and [pending-creates.test.ts](../web/src/offline/pending-creates.test.ts).

## Pictures, photos and payment QR codes

**What it is.** Profile pictures, split pictures, photos of a split and receipts on its
items (the Photos tab), and QR codes on payment methods.

**Owner.** Split photos and receipts: [split/usePhotos.ts](../web/src/split/usePhotos.ts)
(add, remove, remove several, and the photos still to upload) keeping the split's
details in step (`addAttachment` once one is uploaded, and `changeMeta` for removals).
Adding goes through [offline/photo-queue.ts](../web/src/offline/photo-queue.ts), which
keeps each photo on the device until it's uploaded. Split pictures: [split/pictures.ts](../web/src/split/pictures.ts),
through My splits and `patchSettings`. Profile pictures:
[ProfileContext](../web/src/profile/ProfileContext.tsx) changes, with the upload as the
`save`. QR codes are uploaded first (`api.setPaymentQr`), then saved with their payment
method through a profile change.

**Parts.**

- UI: [components/split/photos/](../web/src/components/split/photos/PhotosTab.tsx),
  [UserAvatar](../web/src/components/common/UserAvatar.tsx),
  [PhotoViewer](../web/src/components/ui/PhotoViewer.tsx), and
  [ProfileSection](../web/src/components/settings/ProfileSection.tsx) and
  [PaymentMethods](../web/src/components/settings/PaymentMethods.tsx) in settings.
- Ordering and downloads: [split/photo-days.ts](../web/src/split/photo-days.ts) (the
  orders and kinds shown, the same on phones and computers) and
  [split/photo-download.ts](../web/src/split/photo-download.ts).
- Choosing photos to add: [usePhotoPicker](../web/src/components/split/photos/usePhotoPicker.tsx)
  (the camera or the library) and, on phones and tablets,
  [AddPhotosSheet](../web/src/components/split/photos/AddPhotosSheet.tsx) to pick
  between them: for the Photos tab and an item's Add photo alike.
- Shrinking before upload: [utils/image.ts](../web/src/utils/image.ts).
- Photos still to upload: [QueuedPhotoTile](../web/src/components/split/photos/QueuedPhotoTile.tsx)
  on the Photos tab and [PhotoStrip](../web/src/components/split/photos/PhotoStrip.tsx)
  in the item form, with a spinner on their way up or marked as waiting.
- API: [worker/photos/](../worker/photos/) stores images in D1 and serves them only to
  members: photos on a split in `attachments.ts` (`addAttachment` checks and saves one,
  for the app's uploads and the MCP's `add_photo`, which may also fetch it from a web
  address through `fetchImage` in `images.ts`); profile, split and payment QR pictures
  in `pictures.ts` (profile pictures and QR codes also to people who share a split);
  checking and serving the bytes in `images.ts`.
- Shared: size limits and `Attachment` in [shared/api.ts](../shared/api.ts), and
  `canRemovePhoto` in [shared/rules.ts](../shared/rules.ts).

**Flow.** Picked → shrunk once (at most two photos shrunk or sent at a time) → kept on
the device as bytes, tagged with the account → shown at once → sent once online, the
split is on the server (`pending-creates.ts`) and, for a receipt, its item is saved
(the open split's `whenSaved`, and no `addItem` for it left in the outbox) → joins the
split's photos. Opening a split, signing in, coming back online or to the app picks up
what's kept, oldest first. With the app closed, the service worker's background sync
sends them, one at a time and oldest first, after the changes kept with them.

**Invariants.**

- A photo leaves the device only once the server has it, or refused it (any 4xx but
  401 and 429: its item gone, too large, too many photos), which is explained. Anything
  else (offline, 401, 429, 5xx) keeps it to try again.
- A photo is sent with its own id (`PHOTO_ID_PARAM`), the same each time, so one sent
  again after its answer was lost (or by the app and the service worker both) is added
  once: the server answers with the photo it saved. An id already used for another
  photo is refused.
- One account never sees or sends another's; another account's stay on the device,
  unseen, for when it signs in again, and uploads under way stop (`onCacheCleared`).
  Where the browser has Web Locks, each upload takes a lock per photo and checks it's
  still kept, so two tabs (or a tab and the service worker) don't both send it.
- The file type comes from the bytes, not what the upload says.
- Pictures and photos are private, so every showing is checked by the server: they're
  sent `private, no-cache` with an ETag naming their content (a photo's id, a picture's
  version), and a browser's copy is answered with a 304 once the viewer is checked
  again. A removed member, or another account on the same browser, gets a 404.
- The service worker asks the server each time while online, and keeps each picture
  for the account the server names (`IMAGE_VIEWER_HEADER`), in that account's own cache
  (`IMAGE_CACHE_PREFIX`). It shows a kept copy only offline or while the server fails
  (5xx), and only to the account signed in (`SW_USER_KEY`). A 403 or 404 forgets every
  account's copy, and signing out or another account signing in clears them all.

**Tests.** [photo-queue.test.ts](../web/src/offline/photo-queue.test.ts) (kept through a
reload, accounts kept apart, order, two at a time, refused or retried, the same id when
sent again, sent by the service worker and not again by the app, waiting for the split
and the item), [sw.test.ts](../web/src/offline/sw.test.ts) (the service worker's photo
sending: order, ids, retries and refusals; pictures kept per account and shown offline
only to it), [api.test.ts](../worker/test/api.test.ts) (a browser's copy checked again
for each viewer),
[worker/photos/attachments.test.ts](../worker/photos/attachments.test.ts) (the same photo sent twice at once), [OfflinePhotos.test.tsx](../web/src/components/split/OfflinePhotos.test.tsx)
(waiting through the app reopening, removing one, a new item's receipt, online uploads,
a refusal), [DesktopPhotos.test.tsx](../web/src/components/split/DesktopPhotos.test.tsx),
[PhonePhotos.test.tsx](../web/src/components/split/PhonePhotos.test.tsx),
[photo-days.test.ts](../web/src/split/photo-days.test.ts),
[photo-download.test.ts](../web/src/split/photo-download.test.ts), and the image
cases in [worker/test/api.test.ts](../worker/test/api.test.ts).

## Pages, layouts and Back

**What it is.** Which page shows, the layouts for phones, tablets and computers, and
what Back does.

**Owner.**

- [hooks/useRoute.ts](../web/src/hooks/useRoute.ts): pages come from the query string
  (`?s=<id>`, `?s=<id>&payments`, `?settings`, `?convert`, `?tab=invites`) through
  `navigate()` (`splitAddress` for a split's pages), and the last page reopens on a
  fresh start. A page opened from another goes back up with `goUp`: Back when it came
  from there, else straight there in its own place.
- [hooks/useBreakpoints.ts](../web/src/hooks/useBreakpoints.ts): `useIsMobile` (under
  768px) and `useIsDesktop` (1024px and up).
- [hooks/useBackDismiss.ts](../web/src/hooks/useBackDismiss.ts): Back closes the top
  sheet on phones.

**Parts.**

- [components/shell/](../web/src/components/shell/AppLayout.tsx): sidebar, bottom tabs,
  notices, and the keyboard shortcuts on computers: `[` and `?` (the list,
  [ShortcutsDialog](../web/src/components/shell/ShortcutsDialog.tsx)) in AppLayout, the
  split's own keys in DesktopSplitLayout, and Esc and Del while picking items in
  `useSelectionKeys`. Change the list with the keys.
- [ResponsiveDialog](../web/src/components/ui/ResponsiveDialog.tsx): a sheet on phones,
  a dialog elsewhere.
- [DesktopSplitLayout](../web/src/components/split/layout/DesktopSplitLayout.tsx) and
  [MobileSplitLayout](../web/src/components/split/layout/MobileSplitLayout.tsx) (also
  used on tablets).
- [Skeleton](../web/src/components/ui/Skeleton.tsx): the shimmering placeholders a page
  shows until its data arrives, shaped by each screen
  ([HomeSkeletons](../web/src/components/home/HomeSkeletons.tsx),
  [SplitSkeletons](../web/src/components/split/layout/SplitSkeletons.tsx), Settings,
  Convert and the sidebar).

**Invariants.**

- Sheets and dialogs never push history entries themselves; they open through
  `ResponsiveDialog` or `useBackDismiss`, so Back closes the top one first.
- The split's tabs on phones are not history entries, so Back leaves the split rather
  than stepping through tabs.
- Keyboard shortcuts never fire while typing in a field or inside a dialog.
- Until a page's data arrives it shows placeholders the size of what will replace them,
  never an empty or zero state that then changes (no "RM 0.00" before the split loads).
  A copy kept on the device shows instead of them when there is one.

**Tests.** [App.test.tsx](../web/src/App.test.tsx) (pages and Back), the placeholder
cases in [SplitLoading.test.tsx](../web/src/components/split/SplitLoading.test.tsx),
[SettingsPage.test.tsx](../web/src/components/settings/SettingsPage.test.tsx) and
[ConvertPage.test.tsx](../web/src/components/convert/ConvertPage.test.tsx),
[Shortcuts.test.tsx](../web/src/components/split/Shortcuts.test.tsx), and the phone
cases (`{ size: 'phone' }`) in
[SplitScreen.test.tsx](../web/src/components/split/SplitScreen.test.tsx) and
[SplitsHome.test.tsx](../web/src/components/home/SplitsHome.test.tsx).

## Agents over MCP

**What it is.** An agent signs in over OAuth as one account and uses tools at `/mcp`
to read splits and their photos, create splits, add (one or many at once), edit, date
and remove expenses (in the split's currency or another), record and remove payments
between two people, add receipts and split photos, add, rename and remove people, and
route payments. Splits and people can be named by id, name or enough of a
name, and answers name people by name; a miss lists what there is. A write can answer
with the balances after it, and reads membership, the retry receipt and the bill in one
database round trip (`loadSplit`). The contracts, units, retries and deployment steps are in
[mcp.md](mcp.md).

**Owner.** The Worker; the app doesn't use MCP, and only lists and disconnects the
agents an account let in (Settings, Connected agents). A split's bill still changes only
through [bill/changes.ts](../worker/bill/changes.ts): `saveChanges` checks and saves a
batch, `applyChanges` answers the API with it, and the expense tools call it with their
retry receipt saved alongside. Photos go through `addAttachment` in
[photos/attachments.ts](../worker/photos/attachments.ts), new splits through
`createSplitStatements` (`splits/lifecycle.ts`), as for the app.

**Parts.**

- Entry: [worker/index.ts](../worker/index.ts) sends `/mcp`, `/oauth/*` and
  `/.well-known/*` to [mcp/oauth.ts](../worker/mcp/oauth.ts) before the app's files
  (`run_worker_first` in `wrangler.jsonc` too). Off (404) until `MCP_ORIGIN` and
  `OAUTH_KV` are set.
- Sign-in: [mcp/oauth.ts](../worker/mcp/oauth.ts), with
  `@cloudflare/workers-oauth-provider` running discovery, registration, tokens and the
  bearer check; the consent page at `/oauth/authorize` is the app's, behind Access.
  Grants live in the `OAUTH_KV` namespace (hashed by the library). The page follows
  the account's theme and accent (`getAppearance` in `accounts/profiles.ts`, the ramps
  in `shared/accents.ts`); it can't import the app, so it keeps copies of the app's
  neutral colours (`web/src/theme/tokens.css`) and icon (`web/public/icon.svg`): change
  both together.
- Tools: [mcp/server.ts](../worker/mcp/server.ts) (a fresh stateless MCP server per
  request, the Origin check and scope step-up) and
  [mcp/tools.ts](../worker/mcp/tools.ts). Reads reuse `listSplitSummaries` (a page
  at a time), `contentStatements`, `listAttachmentsStatement` and `shared/settle.ts`;
  rates come from `getRate` with the account's preference, as for the API. A
  `get_split` with `ifUnchangedSince` reads only the split's `updated_at` (as a
  member) before deciding whether to read the bill.
- Receipts: [mcp/receipts.ts](../worker/mcp/receipts.ts) and the `mcp_receipts` table
  ([0019](../migrations/0019_mcp_receipts.sql)), deleted with their split
  (`splits/lifecycle.ts`).
- The service worker leaves these routes to the browser (`web/public/sw.js`).
- Connected agents: [mcp/agents.ts](../worker/mcp/agents.ts) lists the account's grants
  (`GET /api/me/agents`, as `ConnectedAgent` in `shared/api.ts`) and ends one
  (`DELETE /api/me/agents/:id`, `revokeGrant`), through the provider's helpers
  (`oauthHelpers`). Each says where it's from, to tell two connections of the same app
  apart: the website it returns to, or an app on a computer (`returnsTo`, from the
  grant's redirect address), and the browser it was allowed in (`approvedOn`, a few
  words the consent page notes in the grant's metadata). Each also says when it last
  called (`lastUsedAt`): every MCP request notes it, after answering and at most every
  ten minutes, in `OAUTH_KV` under `agent-used:<user>:<grant>` beside the provider's own
  keys (`noteAgentUse`); it expires with the grant and goes when it's disconnected. Use
  was noted from 2026-10-22 (`AGENT_USE_NOTED_SINCE`), so older connections say "not
  used since" then until they call. Settings shows them in
  [AgentsSection](../web/src/components/settings/AgentsSection.tsx), which reads and
  disconnects through the API itself, as nothing else shows them.

**Flow.** Agent → `401` with the resource metadata → registers and sends the person to
`/oauth/authorize` → Access signs them in, they allow it → token → `POST /mcp` → the
provider checks the token and hands the grant's account to the tools → membership,
scope, change limit and the bill's rules are checked as for the app → saved with a
receipt → the split's room tells open apps.

**Invariants.**

- The acting account is the one Access verified on the consent page, carried in the
  grant; nothing the agent sends can change it. Each request builds its own server and
  tools for its own account.
- Clients are told to ask for both scopes, and the consent page offers both, ticked,
  whatever the client asked for; the person decides what the grant carries.
- Membership, scope and roles are checked on every call, retries included; a split
  you're not in is `not_found`, like a missing one.
- The one outside address the Worker fetches on an agent's say is a photo's
  (`add_photo` with `imageUrl`): http(s) only, bounded in size and time, checked as an
  upload is, and nothing of the answer but that check's verdict comes back.
- An expense write and its receipt are saved in one transaction: a retry with the same
  `requestId` returns the first answer and never applies the change again, and the same
  id for a different change is refused.
- A write that names the split's currency is refused when it's another; one that
  doesn't is in the split's currency as it is. An expense paid in another currency
  keeps its amounts and rate unless new ones are sent, and is converted at the rate on
  the day it was paid, as in the app.
- A photo, a new split, or each expense of a batch is saved under an id that comes
  from the account and request id, so a retry never adds a second one and a batch
  retry answers the same ids; a split's people are saved with its receipt, so a retry
  finishes a split an earlier try began.
- `/api/*` keeps its own sign-in and cross-site checks; MCP never goes through them,
  and they never accept an OAuth token.
- Answers leave out share links, invitations, emails and payment details; a photo says
  only whether this account added it.
- Grants are kept under the account they were made for, so listing and disconnecting
  reach only the signed-in account's own; an id that isn't theirs changes nothing.
  Disconnecting ends the grant's access and refresh tokens at once.

**Tests.** [worker/test/mcp.test.ts](../worker/test/mcp.test.ts) (sign-in through the
provider, every tool through a real MCP client, retries, scopes and membership against
a local Worker, listing and disconnecting agents for one account only),
[SettingsPage.test.tsx](../web/src/components/settings/SettingsPage.test.tsx)
(Connected agents: listing, asking first, a refusal) and [mcp/receipts.test.ts](../worker/mcp/receipts.test.ts) (the same
request saved twice at once, which a local Worker can't race).
