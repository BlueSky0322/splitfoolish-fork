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
- API: [worker/splits/summaries.ts](../worker/splits/summaries.ts) (the list with totals, search, item name
  suggestions, used currencies), [worker/splits/lifecycle.ts](../worker/splits/lifecycle.ts)
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

**What it is.** The split page (`?s=<id>`): its people, its items (added, edited,
duplicated, moved to another day, deleted) and its details.

**Owner.** The bill (people and items) is changed only through
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
  [split/bill-rules.ts](../web/src/split/bill-rules.ts).
- API: [worker/bill/changes.ts](../worker/bill/changes.ts) applies a batch of changes
  (all or none), checking each against the bill as it stands
  ([model.ts](../worker/bill/model.ts)) with what [input.ts](../worker/bill/input.ts)
  reads from it; [worker/bill/read.ts](../worker/bill/read.ts) reads the bill, and
  [worker/splits/detail.ts](../worker/splits/detail.ts)
  reads a whole split in one round trip.
- Shared: `Item` and `Change` in [shared/types.ts](../shared/types.ts), who may do what
  in [shared/rules.ts](../shared/rules.ts), `MAX_CHANGES` in [shared/api.ts](../shared/api.ts).

**Flow.** Action → state shows it → change queued and written to the outbox → sent in
order, at most `MAX_CHANGES` at a time → the server checks each batch against the
split as it is now. A refused batch drops what was queued after it and reloads the split.

**Invariants.**

- Changes are applied in the order they were made, and a refused batch never applies
  part of itself (`bill/changes.ts`).
- Only the newest load of a split is shown, and a device copy never replaces what the
  server said (`useSplit.ts`).

**Tests.** [actions.test.ts](../web/src/split/actions.test.ts),
[state.test.ts](../web/src/split/state.test.ts),
[item-input.test.ts](../web/src/split/item-input.test.ts),
[SplitScreen.test.tsx](../web/src/components/split/SplitScreen.test.tsx),
[SplitLoading.test.tsx](../web/src/components/split/SplitLoading.test.tsx) (load
order), and the change and permission cases in
[worker/test/api.test.ts](../worker/test/api.test.ts).

## Settling up and currencies

**What it is.** Who owes whom and how they pay, items paid in other currencies, the
Currencies sheet, and the Convert page (`?convert`).

**Owner.** Settling is worked out, not stored: [split/derive.ts](../web/src/split/derive.ts)
turns the bill into totals, balances and transfers with
[shared/settle.ts](../shared/settle.ts). Converted items keep their original amount and
rate; [split/currencies.ts](../web/src/split/currencies.ts) lists them for the
Currencies sheet, and rate changes go through the split's actions.

**Parts.**

- UI: [components/split/balances/](../web/src/components/split/balances/BalancePanel.tsx),
  [CurrenciesSheet](../web/src/components/split/dialogs/CurrenciesSheet.tsx),
  [components/convert/](../web/src/components/convert/ConvertPage.tsx), and the rate
  hook [hooks/useRate.ts](../web/src/hooks/useRate.ts).
- API: [worker/currency/exchange-rates.ts](../worker/currency/exchange-rates.ts) (Wise and the ECB,
  cached), [worker/routes/rates.ts](../worker/routes/rates.ts), and
  [worker/currency/reconvert.ts](../worker/currency/reconvert.ts) (converting every item after the
  split's currency changes, in the background). A failed conversion is retried by the
  `reconvert` queue with growing waits ([worker/currency/reconvert-queue.ts](../worker/currency/reconvert-queue.ts),
  wired in `worker/index.ts` and `wrangler.jsonc`); opening a split retries one stuck
  for 10 minutes.
- Shared: [shared/rates.ts](../shared/rates.ts) (`toCents`, `convertCents`,
  `convertParts`, rate validity) and [shared/settle.ts](../shared/settle.ts).

**Invariants.**

- Item amounts are currency units; settling and storage are integer cents (see Money in
  [AGENTS.md](../AGENTS.md)).
- Converted exact parts add up to the converted total, the leftover cents going by
  largest remainder (`convertParts`).
- A rate someone typed is kept as typed; only live rates are refreshed.
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
spreadsheets or a PDF to keep or send, shared on phones and saved elsewhere.

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
pictures, and sends the outbox and kept photos by background sync. It can't import app code, so the
keys, lock names and limits it shares with `offline/` and `shared/api.ts` are copied in
it. The build writes `precache.json`, every built file the app needs offline: the entry
and its styles, and the chunks the app's own code loads later (sharing an image, PDF
export) with their imports, but not a library's own optional extras
([web/build/precache.ts](../web/build/precache.ts)). The PDF font is not in it: it's
kept the first time Export opens.

**Flow.** A page load waits up to 3 seconds for the network; offline, slower, or a
5xx or non-page answer, and the kept page opens instead, marked as opened from the
device. A sign-in redirect or a 4xx goes to the browser, and `/cdn-cgi/` (Access) is
never handled. A good page is kept in the background, even when it came too late. Opened
from the device, the profile waits 2 seconds on `/api/me` (or not at all if it fails
with a 5xx), then shows the last account's saved copies
([ProfileContext](../web/src/profile/ProfileContext.tsx)).

**Invariants.**

- Nothing kept on the device is shown before the signed-in account is known, and one
  account never sees another's. The last account is only assumed offline, or when the
  page was opened from the device; if the server then names someone else, their copies
  are dropped and the app reloads.
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
  again or the connection returns.

**Tests.** [cache.test.ts](../web/src/offline/cache.test.ts),
[outbox.test.ts](../web/src/offline/outbox.test.ts) (runs `sw.js` against what the app
writes, so the copied keys and lock names can't drift),
[sw.test.ts](../web/src/offline/sw.test.ts) (batches by count and size and every kind
of answer, on the page and in `sw.js` alike),
[shell.test.ts](../web/src/offline/shell.test.ts) (slow, failing and redirected page
loads, stopped updates, which files are kept),
[start.test.tsx](../web/src/offline/start.test.tsx) (starting from the device's copy),
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
- Ordering and downloads: [split/photo-days.ts](../web/src/split/photo-days.ts) and
  [split/photo-download.ts](../web/src/split/photo-download.ts).
- Shrinking before upload: [utils/image.ts](../web/src/utils/image.ts).
- Photos still to upload: [QueuedPhotoTile](../web/src/components/split/photos/QueuedPhotoTile.tsx)
  on the Photos tab and [PhotoStrip](../web/src/components/split/photos/PhotoStrip.tsx)
  in the item form, with a spinner on their way up or marked as waiting.
- API: [worker/photos/](../worker/photos/) stores images in D1 and serves them only to
  members: photos on a split in `attachments.ts`; profile, split and payment QR pictures
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
- One account never sees or sends another's; they're forgotten with the cache
  (`onCacheCleared`). Where the browser has Web Locks, each upload takes a lock per
  photo and checks it's still kept, so two tabs (or a tab and the service worker) don't
  both send it.
- The file type comes from the bytes, not what the upload says.
- A profile picture's, split picture's or QR code's address names its version, and a
  photo never changes once added, so the service worker and browsers can keep them for
  good.

**Tests.** [photo-queue.test.ts](../web/src/offline/photo-queue.test.ts) (kept through a
reload, accounts kept apart, order, two at a time, refused or retried, the same id when
sent again, sent by the service worker and not again by the app, waiting for the split
and the item), [sw.test.ts](../web/src/offline/sw.test.ts) (the service worker's photo
sending: order, ids, retries and refusals),
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
  (`?s=<id>`, `?settings`, `?convert`, `?tab=invites`) through `navigate()`, and the
  last page reopens on a fresh start.
- [hooks/useBreakpoints.ts](../web/src/hooks/useBreakpoints.ts): `useIsMobile` (under
  768px) and `useIsDesktop` (1024px and up).
- [hooks/useBackDismiss.ts](../web/src/hooks/useBackDismiss.ts): Back closes the top
  sheet on phones.

**Parts.**

- [components/shell/](../web/src/components/shell/AppLayout.tsx): sidebar, bottom tabs,
  notices.
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
- Until a page's data arrives it shows placeholders the size of what will replace them,
  never an empty or zero state that then changes (no "RM 0.00" before the split loads).
  A copy kept on the device shows instead of them when there is one.

**Tests.** [App.test.tsx](../web/src/App.test.tsx) (pages and Back), the placeholder
cases in [SplitLoading.test.tsx](../web/src/components/split/SplitLoading.test.tsx),
[SettingsPage.test.tsx](../web/src/components/settings/SettingsPage.test.tsx) and
[ConvertPage.test.tsx](../web/src/components/convert/ConvertPage.test.tsx), and the phone
cases (`{ size: 'phone' }`) in
[SplitScreen.test.tsx](../web/src/components/split/SplitScreen.test.tsx) and
[SplitsHome.test.tsx](../web/src/components/home/SplitsHome.test.tsx).
