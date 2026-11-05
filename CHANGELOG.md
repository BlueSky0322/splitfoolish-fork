# Changelog

Notable changes to this project's behavior, interfaces, data, configuration,
and developer workflows are recorded here.

Based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/).
Release versions follow the repository's existing versioning policy.

<!--
Instructions for agents:
- Read Unreleased before editing. Add each change to the matching category;
  consolidate related entries instead of duplicating them.
- Record implemented changes only. Do not list plans, TODOs, or unverified claims.
- Write one concise bullet per notable outcome: affected area, what changed,
  and the impact. For fixes, describe the incorrect behavior that was corrected.
- Include meaningful API, schema, configuration, dependency, build, and tooling
  changes when they affect consumers, maintainers, or future agent work.
- Skip routine formatting, renames, and test-only edits unless they change a
  documented contract or development workflow.
- Prefix incompatible changes with **Breaking:** and explain the required
  migration, or link to an existing migration guide.
- Add issue/PR links or repository-relative file links when useful and known.
  Never invent references, versions, dates, or release history.
- Update Unreleased during normal work. Create a release section only when
  explicitly asked to prepare a release; use the agreed version and release
  date, move the applicable entries, and keep Unreleased at the top.
- List releases newest first. Preserve released entries except to correct
  factual errors.
- Keep the six category names below. Remove empty categories from releases;
  empty categories under Unreleased may remain as a scaffold.

Entry format:
- <Area>: <concrete change and its impact>. <Optional reference or migration.>

Release heading format:
## <version> - <YYYY-MM-DD>
-->

## Unreleased

Everything from the first commit to now. The repository has no release tags, so nothing is
split into releases. Features that were added and later taken out again are left out, and
the entries describe how things work now. Commits from 2024 came before pull requests, and
are cited by their commit.

### Added

<!-- New features or capabilities. -->

- Splitting: the original app (2024). Add people and items with who paid and who shares,
  see who pays whom to settle up, optionally through one person, share the result as an
  image, and see the total spent. Commits `76c64fe` to `4edd2f0`.
- Accounts: sign in to keep your own splits. Each split has an owner and editors, and My
  splits lists yours in an order you drag, or sorted by recent activity, name or what you
  owe, with a per-person Archive and a search across your items. [#5] [#45] [#47] [#67]
  [#68] [#83]
- Sharing: every member has a share link. The owner's link gives an invite to accept; a
  member's link asks the owner to let the person in. Owners reset links and remove members,
  which ends their access; members leave from Split settings. [#24] [#26] [#27] [#28] [#39]
  [#40] [#82]
- Invites: invites and requests to join, which expire after 14 days, are answered on the
  Invites page. On phones a banner on the Splits list opens it, and the Splits tab counts
  them. [#6] [#27] [#39] [#172]
- People: someone with an account shows their own name and picture; guests are renamed by
  the owner, who can also link a guest to a member's account. Names are suggested when
  adding people, each person has a colour used for their name and avatar, and each has a
  page with their balance and transfers. [#7] [#19] [#26] [#101] [#102] [#145]
- Items: split equally, by shares or by exact amounts, with a category (none counts as
  Other), notes, and a date (Today, Yesterday or any day, or added straight to a day).
  Items can be duplicated, past names are suggested with their category, and several can be
  picked to delete or move to another day, with Undo. [#18] [#51] [#53] [#56] [#57] [#106]
  [#112] [#115] [#147]
- Item list: grouped by day, week or month and sorted either way, newest first. Rows say
  who paid for whom ("Ryan paid for Ann", "Ryan's own") and your share, when you have one.
  [#63] [#68] [#103] [#104] [#114] [#136]
- Currencies: each split has a currency, and an item can be paid in another. It is converted
  at the rate of the day it was paid (Wise or the ECB, the other as a fallback) or at a typed
  rate, and keeps what was paid and the rate through edits. Changing a split's currency
  converts every item in the background, retrying until done. Settings choose the default
  currency and the rate source. [#33] [#34] [#35] [#36] [#38] [#44] [#49] [#75] [#99] [#100]
- Convert: a currency converter page that remembers recent pairs and can add the amount to a
  split as an item. [#50] [#55] [#58]
- Settle up: balances and transfers, with how to pay each one (the method and a number to
  copy), and payments routed through one person. A Spending chart shows the money by
  category, by who paid or by whose share, and each slice opens its items. [#41] [#146]
  [#148] [#149]
- Payments: a record of payments between people, which balances subtract and the total
  ignores. Record one with Mark as paid on a transfer or from the Payments page, in any
  currency at its day's rate; exports list them. [#137] [#148] [#170]
- Payment methods: pick a type from a list, with bank details for transfers, or a QR code.
  [#48] [#54]
- Photos: receipts and photos are added on their item, shrunk first, and open in a
  full-screen viewer with swipe, pinch and drag to zoom. The Photos tab gathers every
  item's photos by day; pick some to download (one zip on computers) or remove, after
  asking. [#18] [#53] [#73] [#74] [#76] [#94] [#96] [#105] [#155] [#173]
- Places: an item or photo keeps where it was, from a photo's GPS, a Maps link in the
  notes, or Use my current location. Places are named from OpenStreetMap, or by their plus
  code where it only knows the area, and open in Maps. [#159] [#161] [#163] [#165] [#171]
- Notes: web addresses in notes open as links. Google Maps links, share.google places and
  dropped pins read as the place's name, as chips on their own line under the notes, in
  the item list and the item sheet. [#140] [#158] [#160] [#162] [#164] [#165] [#166] [#167]
  [#169] [#174]
- Pictures: a picture for each split, and profile pictures cropped square; any picture opens
  full size. [#22] [#53] [#105] [#107]
- Export: a split as a CSV or a PDF (which can hold Japanese text), shared on phones and
  downloaded on computers. The share image shows items, totals and where the money went.
  [#36] [#78] [#79] [#83] [#150]
- Live updates: changes others make show while the split is open. [#43]
- Offline: the app opens and works without a connection. Changes and new splits are kept on
  the device for the account that made them, and sent in order once back online, even with
  the app closed; photos picked offline upload later. A change sent twice counts once.
  [#52] [#72] [#80] [#81] [#122] [#125]
- App: installable, with an install prompt and help, a notice when a new version is ready,
  a launch screen in the chosen theme, and reopening on the last page. [#53] [#62] [#63]
  [#64] [#95] [#97] [#128]
- Phones: bottom tabs (You, Convert, Splits); the split page has Items, Settle up and Photos
  tabs to swipe between, and a balance bar that stays in view. Sheets stay above the
  keyboard and Back closes the top one first. [#59] [#60] [#61] [#67] [#69] [#70] [#135]
  [#151] [#172]
- Computers: keyboard shortcuts (? lists them) and a Select button for picking items. [#57]
  [#112]
- Look: light and dark themes with a one-tap toggle and accent colours, and placeholders the
  shape of each page while it loads. [#18] [#20] [#37] [#90]
- Settings: a menu of sections with their own pages: profile, payment methods, currency, and
  connected agents, each with where it connects from and when it was last used, and a
  Disconnect. [#65] [#127] [#129] [#130]
- Agents (MCP): an agent signs in over OAuth, as allowed on a consent page, and can list and
  read splits (re-reading cheaply when nothing changed), create splits, add (up to 50 at
  once), edit and remove expenses in any currency, record and remove payments, add, rename
  and remove people, route payments, and add photos to expenses (from base64 or a web
  address), move and remove them. People are named by name, and every write can be retried
  safely. See `docs/mcp.md`. [#91] [#92] [#93] [#131] [#132] [#133] [#134] [#137] [#138]
  [#141] [#143] [#153] [#173]
- Docs for contributors and agents: `AGENTS.md` (which `CLAUDE.md` imports), the feature map,
  the data model and the security notes, with import boundaries checked by lint and this
  changelog. [#71] [#77] [#86] [#126] [#175]
- Tests: Worker API tests run against a real local Worker and database, and screen tests
  render the whole app against an in-memory API. [#29] [#66]

### Changed

<!-- Changes to existing behavior or workflows. -->

- **Breaking:** Hosting and storage: the app runs on Cloudflare Workers with a D1 database
  instead of GitHub Pages and the browser's storage. Splits are saved online at their own
  link, and data kept in a browser was imported into its first split. [#1] [#2]
- **Breaking:** Accounts: every page and request needs signing in through Cloudflare Access.
  Splits saved online before accounts existed were removed (migration 0002), with no way
  back. [#5]
- Design: redesigned for computers and phones. [#18] [#20] [#67]
- Saving: a change shows at once and is saved in the background, in batches applied all or
  nothing; the bill is stored in tables, in whole cents. Splits open faster, from a copy on
  the device while the latest loads. [#8] [#10] [#11] [#21] [#139] [#154]
- Deploys: every pull request is built and tested; each push to `main` applies database
  migrations and deploys, noting a restore point first. [#3] [#126]
- Worker: routed with Hono and grouped into feature folders; the app loads data through
  TanStack Query; ESLint checks types. [#30] [#31] [#32] [#89]
- **Breaking:** Toolchain: Vite 8, Vitest 5 and TypeScript 5.9. Node 22.12 or later is
  needed; upgrade Node before `yarn install`. [#124]

### Deprecated

<!-- Features still available but planned for removal; include the replacement. -->

### Removed

<!-- Removed features or support; include the replacement when applicable. -->

- Splits: the "Are you testing? Load test data." link and its sample data, from the original
  app. [#9]

### Fixed

<!-- Corrections to incorrect behavior. -->

- Splitting: amounts are added with exact decimal arithmetic, not floating point (2024,
  commit `3fb7a84`).
- Items: an item without a payer crashed the split; a payer is now required. [#4]
- Money: very large amounts or long splits could lose cents in totals. An item may come to
  at most `MAX_ITEM_CENTS` once converted, and a split holds at most `MAX_ITEMS`, so every
  total and share is exact; bigger amounts, rates and currency changes are refused. [#119]

### Security

<!-- Security fixes; include a public advisory/CVE link when available. -->

- Sign-in: with only one of the two Access settings set, anyone could sign in as anyone; now
  everyone is refused until both are set. [#72]
- Requests: cross-site writes are refused, request bodies are bounded in size and time,
  errors answer in JSON, and pages send security headers. [#29] [#120]
- Limits: each account makes at most 60 changes a minute and registering agent apps is rate
  limited; a split's photo limit holds when photos arrive at once, images over 8192 pixels
  are refused, and unknown sign-in keys are fetched at most six times a minute. [#42] [#121]
- Writes: membership and currency are checked inside the commit, and each write names its
  account, so another account's queued change is refused (`account_mismatch`) and changes
  nothing. [#122]
- Pictures: private pictures and photos are checked with the server on every showing, and
  device copies are kept per account. [#123]
- Agents: the consent page says what each scope allows, a connection sees only the tools its
  grant allows, and connections can be listed and disconnected. [#120] [#127] [#131] [#138]
- CI: the workflow's token is read-only, actions are pinned to a commit, and
  `docs/security.md` covers access, backups, restoring and incidents. [#126]

[#1]: https://github.com/BlueSky0322/splitfoolish-fork/pull/1
[#2]: https://github.com/BlueSky0322/splitfoolish-fork/pull/2
[#3]: https://github.com/BlueSky0322/splitfoolish-fork/pull/3
[#4]: https://github.com/BlueSky0322/splitfoolish-fork/pull/4
[#5]: https://github.com/BlueSky0322/splitfoolish-fork/pull/5
[#6]: https://github.com/BlueSky0322/splitfoolish-fork/pull/6
[#7]: https://github.com/BlueSky0322/splitfoolish-fork/pull/7
[#8]: https://github.com/BlueSky0322/splitfoolish-fork/pull/8
[#9]: https://github.com/BlueSky0322/splitfoolish-fork/pull/9
[#10]: https://github.com/BlueSky0322/splitfoolish-fork/pull/10
[#11]: https://github.com/BlueSky0322/splitfoolish-fork/pull/11
[#18]: https://github.com/BlueSky0322/splitfoolish-fork/pull/18
[#19]: https://github.com/BlueSky0322/splitfoolish-fork/pull/19
[#20]: https://github.com/BlueSky0322/splitfoolish-fork/pull/20
[#21]: https://github.com/BlueSky0322/splitfoolish-fork/pull/21
[#22]: https://github.com/BlueSky0322/splitfoolish-fork/pull/22
[#24]: https://github.com/BlueSky0322/splitfoolish-fork/pull/24
[#26]: https://github.com/BlueSky0322/splitfoolish-fork/pull/26
[#27]: https://github.com/BlueSky0322/splitfoolish-fork/pull/27
[#28]: https://github.com/BlueSky0322/splitfoolish-fork/pull/28
[#29]: https://github.com/BlueSky0322/splitfoolish-fork/pull/29
[#30]: https://github.com/BlueSky0322/splitfoolish-fork/pull/30
[#31]: https://github.com/BlueSky0322/splitfoolish-fork/pull/31
[#32]: https://github.com/BlueSky0322/splitfoolish-fork/pull/32
[#33]: https://github.com/BlueSky0322/splitfoolish-fork/pull/33
[#34]: https://github.com/BlueSky0322/splitfoolish-fork/pull/34
[#35]: https://github.com/BlueSky0322/splitfoolish-fork/pull/35
[#36]: https://github.com/BlueSky0322/splitfoolish-fork/pull/36
[#37]: https://github.com/BlueSky0322/splitfoolish-fork/pull/37
[#38]: https://github.com/BlueSky0322/splitfoolish-fork/pull/38
[#39]: https://github.com/BlueSky0322/splitfoolish-fork/pull/39
[#40]: https://github.com/BlueSky0322/splitfoolish-fork/pull/40
[#41]: https://github.com/BlueSky0322/splitfoolish-fork/pull/41
[#42]: https://github.com/BlueSky0322/splitfoolish-fork/pull/42
[#43]: https://github.com/BlueSky0322/splitfoolish-fork/pull/43
[#44]: https://github.com/BlueSky0322/splitfoolish-fork/pull/44
[#45]: https://github.com/BlueSky0322/splitfoolish-fork/pull/45
[#47]: https://github.com/BlueSky0322/splitfoolish-fork/pull/47
[#48]: https://github.com/BlueSky0322/splitfoolish-fork/pull/48
[#49]: https://github.com/BlueSky0322/splitfoolish-fork/pull/49
[#50]: https://github.com/BlueSky0322/splitfoolish-fork/pull/50
[#51]: https://github.com/BlueSky0322/splitfoolish-fork/pull/51
[#52]: https://github.com/BlueSky0322/splitfoolish-fork/pull/52
[#53]: https://github.com/BlueSky0322/splitfoolish-fork/pull/53
[#54]: https://github.com/BlueSky0322/splitfoolish-fork/pull/54
[#55]: https://github.com/BlueSky0322/splitfoolish-fork/pull/55
[#56]: https://github.com/BlueSky0322/splitfoolish-fork/pull/56
[#57]: https://github.com/BlueSky0322/splitfoolish-fork/pull/57
[#58]: https://github.com/BlueSky0322/splitfoolish-fork/pull/58
[#59]: https://github.com/BlueSky0322/splitfoolish-fork/pull/59
[#60]: https://github.com/BlueSky0322/splitfoolish-fork/pull/60
[#61]: https://github.com/BlueSky0322/splitfoolish-fork/pull/61
[#62]: https://github.com/BlueSky0322/splitfoolish-fork/pull/62
[#63]: https://github.com/BlueSky0322/splitfoolish-fork/pull/63
[#64]: https://github.com/BlueSky0322/splitfoolish-fork/pull/64
[#65]: https://github.com/BlueSky0322/splitfoolish-fork/pull/65
[#66]: https://github.com/BlueSky0322/splitfoolish-fork/pull/66
[#67]: https://github.com/BlueSky0322/splitfoolish-fork/pull/67
[#68]: https://github.com/BlueSky0322/splitfoolish-fork/pull/68
[#69]: https://github.com/BlueSky0322/splitfoolish-fork/pull/69
[#70]: https://github.com/BlueSky0322/splitfoolish-fork/pull/70
[#71]: https://github.com/BlueSky0322/splitfoolish-fork/pull/71
[#72]: https://github.com/BlueSky0322/splitfoolish-fork/pull/72
[#73]: https://github.com/BlueSky0322/splitfoolish-fork/pull/73
[#74]: https://github.com/BlueSky0322/splitfoolish-fork/pull/74
[#75]: https://github.com/BlueSky0322/splitfoolish-fork/pull/75
[#76]: https://github.com/BlueSky0322/splitfoolish-fork/pull/76
[#77]: https://github.com/BlueSky0322/splitfoolish-fork/pull/77
[#78]: https://github.com/BlueSky0322/splitfoolish-fork/pull/78
[#79]: https://github.com/BlueSky0322/splitfoolish-fork/pull/79
[#80]: https://github.com/BlueSky0322/splitfoolish-fork/pull/80
[#81]: https://github.com/BlueSky0322/splitfoolish-fork/pull/81
[#82]: https://github.com/BlueSky0322/splitfoolish-fork/pull/82
[#83]: https://github.com/BlueSky0322/splitfoolish-fork/pull/83
[#86]: https://github.com/BlueSky0322/splitfoolish-fork/pull/86
[#89]: https://github.com/BlueSky0322/splitfoolish-fork/pull/89
[#90]: https://github.com/BlueSky0322/splitfoolish-fork/pull/90
[#91]: https://github.com/BlueSky0322/splitfoolish-fork/pull/91
[#92]: https://github.com/BlueSky0322/splitfoolish-fork/pull/92
[#93]: https://github.com/BlueSky0322/splitfoolish-fork/pull/93
[#94]: https://github.com/BlueSky0322/splitfoolish-fork/pull/94
[#95]: https://github.com/BlueSky0322/splitfoolish-fork/pull/95
[#96]: https://github.com/BlueSky0322/splitfoolish-fork/pull/96
[#97]: https://github.com/BlueSky0322/splitfoolish-fork/pull/97
[#99]: https://github.com/BlueSky0322/splitfoolish-fork/pull/99
[#100]: https://github.com/BlueSky0322/splitfoolish-fork/pull/100
[#101]: https://github.com/BlueSky0322/splitfoolish-fork/pull/101
[#102]: https://github.com/BlueSky0322/splitfoolish-fork/pull/102
[#103]: https://github.com/BlueSky0322/splitfoolish-fork/pull/103
[#104]: https://github.com/BlueSky0322/splitfoolish-fork/pull/104
[#105]: https://github.com/BlueSky0322/splitfoolish-fork/pull/105
[#106]: https://github.com/BlueSky0322/splitfoolish-fork/pull/106
[#107]: https://github.com/BlueSky0322/splitfoolish-fork/pull/107
[#112]: https://github.com/BlueSky0322/splitfoolish-fork/pull/112
[#114]: https://github.com/BlueSky0322/splitfoolish-fork/pull/114
[#115]: https://github.com/BlueSky0322/splitfoolish-fork/pull/115
[#119]: https://github.com/BlueSky0322/splitfoolish-fork/pull/119
[#120]: https://github.com/BlueSky0322/splitfoolish-fork/pull/120
[#121]: https://github.com/BlueSky0322/splitfoolish-fork/pull/121
[#122]: https://github.com/BlueSky0322/splitfoolish-fork/pull/122
[#123]: https://github.com/BlueSky0322/splitfoolish-fork/pull/123
[#124]: https://github.com/BlueSky0322/splitfoolish-fork/pull/124
[#125]: https://github.com/BlueSky0322/splitfoolish-fork/pull/125
[#126]: https://github.com/BlueSky0322/splitfoolish-fork/pull/126
[#127]: https://github.com/BlueSky0322/splitfoolish-fork/pull/127
[#128]: https://github.com/BlueSky0322/splitfoolish-fork/pull/128
[#129]: https://github.com/BlueSky0322/splitfoolish-fork/pull/129
[#130]: https://github.com/BlueSky0322/splitfoolish-fork/pull/130
[#131]: https://github.com/BlueSky0322/splitfoolish-fork/pull/131
[#132]: https://github.com/BlueSky0322/splitfoolish-fork/pull/132
[#133]: https://github.com/BlueSky0322/splitfoolish-fork/pull/133
[#134]: https://github.com/BlueSky0322/splitfoolish-fork/pull/134
[#135]: https://github.com/BlueSky0322/splitfoolish-fork/pull/135
[#136]: https://github.com/BlueSky0322/splitfoolish-fork/pull/136
[#137]: https://github.com/BlueSky0322/splitfoolish-fork/pull/137
[#138]: https://github.com/BlueSky0322/splitfoolish-fork/pull/138
[#139]: https://github.com/BlueSky0322/splitfoolish-fork/pull/139
[#140]: https://github.com/BlueSky0322/splitfoolish-fork/pull/140
[#141]: https://github.com/BlueSky0322/splitfoolish-fork/pull/141
[#143]: https://github.com/BlueSky0322/splitfoolish-fork/pull/143
[#145]: https://github.com/BlueSky0322/splitfoolish-fork/pull/145
[#146]: https://github.com/BlueSky0322/splitfoolish-fork/pull/146
[#147]: https://github.com/BlueSky0322/splitfoolish-fork/pull/147
[#148]: https://github.com/BlueSky0322/splitfoolish-fork/pull/148
[#149]: https://github.com/BlueSky0322/splitfoolish-fork/pull/149
[#150]: https://github.com/BlueSky0322/splitfoolish-fork/pull/150
[#151]: https://github.com/BlueSky0322/splitfoolish-fork/pull/151
[#153]: https://github.com/BlueSky0322/splitfoolish-fork/pull/153
[#154]: https://github.com/BlueSky0322/splitfoolish-fork/pull/154
[#155]: https://github.com/BlueSky0322/splitfoolish-fork/pull/155
[#158]: https://github.com/BlueSky0322/splitfoolish-fork/pull/158
[#159]: https://github.com/BlueSky0322/splitfoolish-fork/pull/159
[#160]: https://github.com/BlueSky0322/splitfoolish-fork/pull/160
[#161]: https://github.com/BlueSky0322/splitfoolish-fork/pull/161
[#162]: https://github.com/BlueSky0322/splitfoolish-fork/pull/162
[#163]: https://github.com/BlueSky0322/splitfoolish-fork/pull/163
[#164]: https://github.com/BlueSky0322/splitfoolish-fork/pull/164
[#165]: https://github.com/BlueSky0322/splitfoolish-fork/pull/165
[#166]: https://github.com/BlueSky0322/splitfoolish-fork/pull/166
[#167]: https://github.com/BlueSky0322/splitfoolish-fork/pull/167
[#169]: https://github.com/BlueSky0322/splitfoolish-fork/pull/169
[#170]: https://github.com/BlueSky0322/splitfoolish-fork/pull/170
[#171]: https://github.com/BlueSky0322/splitfoolish-fork/pull/171
[#172]: https://github.com/BlueSky0322/splitfoolish-fork/pull/172
[#173]: https://github.com/BlueSky0322/splitfoolish-fork/pull/173
[#174]: https://github.com/BlueSky0322/splitfoolish-fork/pull/174
[#175]: https://github.com/BlueSky0322/splitfoolish-fork/pull/175
