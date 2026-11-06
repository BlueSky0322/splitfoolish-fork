# Changelog

Notable changes to Splitfoolish, newest first, by the day they reached `main` (UTC).

<!--
For agents:
- Add one line under today's date, starting a `## YYYY-MM-DD` heading at the top if needed.
- Format: `- <Kind>: <what changed, in plain words> [#<PR>]`, with the link defined at the end.
- Kinds: Added, Changed, Fixed, Removed, Security. Start an incompatible change with
  **Breaking:** and say how to migrate.
- Keep it to one short line. Skip tests, formatting and internal refactors.
- Never invent references, versions or dates.
-->

## 2026-11-06

- Changed: the changelog lists changes by date, one line each [#177]

## 2026-11-05

- Added: a changelog of notable changes [#175] [#176]

## 2026-11-03

- Fixed: Maps places sit on their own line under an item's notes [#174]

## 2026-11-02

- Removed: the small maps [#168]
- Removed: the Maps cards under notes; links show as place chips [#169]
- Removed: Paid back on items; record payments from Settle up or Payments [#170]
- Removed: automatic location and the place search box [#171]
- Changed: on phones, invites open from a banner on Splits instead of their own tab [#172]
- Changed: the Photos tab shows only photos on items, and adds none [#173]

## 2026-10-30

- Added: Google Maps links in notes show the place they name [#158] [#162]
- Added: items and photos keep where they were, named from OpenStreetMap [#159]
- Added: unnamed spots and dropped pins read as their plus code [#160] [#163] [#165]
- Added: links in notes show as chips in the item form and the list [#164] [#166] [#167]

## 2026-10-27

- Fixed: Back closes a sheet over picked items before it stops picking [#151]
- Fixed: agents' re-reads see archives, display names and unlinked people [#153]
- Changed: a split's payments load faster [#154]

## 2026-10-26

- Added: the share image shows where the money went [#150]

## 2026-10-25

- Added: the owner can link a guest to a member's account [#145]
- Added: a Spending chart in Settle up, by category, payer or share [#146] [#149]
- Changed: an item without a category counts as Other [#147]
- Changed: Mark as paid is a chip at the end of its transfer [#148]

## 2026-10-24

- Added: web addresses in notes open as links [#140]
- Added: agents can add a photo from a web address, and move or remove photos [#141] [#143]
- Fixed: long titles on phone sheets wrap instead of being cut off [#142]

## 2026-10-23

- Added: group items by week or month [#136]
- Added: record payments between people, which balances subtract [#137]
- Added: agents can add expenses in batches and name splits by name [#134]
- Changed: phone tabs put You first and Splits last [#135]
- Changed: the agent consent page follows your theme and is easier to read [#138]
- Changed: faster reads for splits and agents [#139]

## 2026-10-22

- Added: Settings lists connected agents, with Disconnect [#127] [#129] [#130]
- Added: agents can name people, record payments and re-read a split cheaply [#131] [#132] [#133]
- Fixed: the installed app keeps its manifest and icons offline [#128]
- Security: read-only CI token, pinned actions and a restore point before migrations [#126]

## 2026-10-21

- Fixed: totals stay exact to the cent; huge amounts are refused [#119]
- Fixed: when Access asks to sign in again, the saved splits show with Sign in [#125]
- Security: request bodies are bounded, and agent grants say all they allow [#120]
- Security: limits on agent sign-ups, photos, image sizes and key fetches [#121]
- Security: writes are checked as they commit, count once, and stay with their account [#122]
- Security: private pictures are checked on every showing and kept per account [#123]
- Changed: **Breaking:** building needs Node 22.12 or later (Vite 8, Vitest 5); upgrade Node [#124]

## 2026-10-20

- Added: pick the date when adding or editing an item [#115]

## 2026-10-19

- Added: each person has their own colour for their name and avatar [#101] [#102]
- Added: tap any picture to open it; drag a zoomed photo [#105]
- Added: Undo after moving items to another day [#106]
- Added: add to a day, keyboard shortcuts, and camera or library for item photos [#112]
- Fixed: items say who paid for whom, or that it was someone's own [#103] [#104]
- Fixed: an item you're not on shows no share for you [#114]
- Fixed: an item keeps the rate it was recorded with [#100]

## 2026-10-18

- Fixed: items convert at the rate of the day they were paid [#99]

## 2026-10-17

- Added: the app opens in your theme, with a launch screen [#95]
- Changed: phone sort, grouping and photo choices are menus [#96]
- Fixed: the installed app keeps one identity whatever page it was installed from [#97]

## 2026-10-16

- Added: a Photos tab on computers, and picking photos on phones [#73] [#74]
- Added: ask before removing photos [#76]
- Added: export a split as CSV or PDF [#78] [#79]
- Added: failed currency conversions retry until they finish [#75]
- Added: hold a split to drag it on phones; exports download on computers [#83]
- Added: placeholders while pages load [#90]
- Added: agents can read splits and add, edit and remove expenses over MCP [#91] [#92] [#93]
- Added: agent instructions, a feature map and lint-checked import boundaries [#71] [#77] [#86]
- Fixed: offline changes and photos are delivered reliably, once each [#80] [#81]
- Fixed: reset the share link in place; amounts select on tap [#82]
- Fixed: phones sort photos as computers do [#94]
- Fixed: phone titles, Add photos and pinch zoom [#70]
- Security: Access set up halfway refuses everyone instead of letting anyone in [#72]

## 2026-10-15

- Added: phone redesign with bottom tabs, Archive and Search [#67]
- Added: sort menus on computers; Duplicate on the phone item sheet [#68]
- Added: swipe between a split's tabs [#69]
- Fixed: lost offline changes, missing invites and double account links [#66]

## 2026-10-14

- Added: owners manage people; removing someone ends their access [#24]
- Added: people who join are added to the bill [#26]
- Added: a share link gives an invite to accept [#27] [#28]
- Added: members can share splits, with the owner approving who joins [#39]
- Added: items in another currency, converted at a fetched or typed rate [#33] [#34] [#35]
- Added: changing a split's currency converts its items in the background [#36]
- Added: a light and dark toggle [#37]
- Added: a Currencies sheet [#38]
- Added: Delete and Leave in Split settings [#40]
- Added: how to pay shows in your transfers [#41]
- Added: changes from others show live [#43]
- Added: drag splits into your own order [#45] [#47]
- Added: payment types, bank details and QR codes [#48] [#54]
- Added: a default currency and rate source in Settings [#49]
- Added: a Convert page that can add the amount to a split [#50] [#55] [#58]
- Added: item name suggestions and Duplicate [#51]
- Added: works offline and syncs when back online [#52]
- Added: photo viewer, item notes, and reopening on the last page [#53]
- Added: pick several items to delete or move [#56] [#57]
- Added: a sticky balance bar and sheets above the keyboard on phones [#59] [#60] [#61]
- Added: install prompt, install help and a new-version notice [#62] [#63] [#64]
- Added: Settings as a menu of sections [#65]
- Changed: rates are reused for 4 hours [#44]
- Changed: the API runs on Hono, with tests and stricter lint [#29] [#30] [#31] [#32]
- Security: each account makes at most 60 changes a minute [#42]
- Security: cross-site writes refused, bodies size-checked, security headers [#29]

## 2026-10-13

- Changed: **Breaking:** splits are saved online at their own link; browser data was imported [#1]
- Changed: **Breaking:** sign-in through Cloudflare Access is required; older splits were removed [#5]
- Changed: every pull request is built, and `main` deploys to Cloudflare [#3]
- Added: invites to splits, and suggestions when adding people [#6] [#7]
- Added: redesign with split modes, categories, receipt photos and per-split currency [#18] [#20]
- Added: account names and pictures for people, and a page per person [#19]
- Added: a picture for each split [#22]
- Changed: changes show at once and save in the background, in whole cents [#8] [#10] [#11] [#21]
- Removed: the "Load test data" link [#9]
- Removed: inviting by email [#23]
- Fixed: items without a payer no longer crash the split [#4]

## 2024-07-15

- Added: total spent in the summary (`4edd2f0`)

## 2024-05-24

- Fixed: amounts add with exact decimals (`3fb7a84`)

## 2024-05-21

- Added: share the split as an image (`65cbc9f`)

## 2024-05-20

- Added: splits are kept in the browser, and items can be edited (`aae4606`, `f42dcd9`)

## 2024-05-19

- Added: the first version: people, items and who pays whom (`76c64fe`, `b3dd7eb`)

[#1]: https://github.com/BlueSky0322/splitfoolish-fork/pull/1
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
[#23]: https://github.com/BlueSky0322/splitfoolish-fork/pull/23
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
[#142]: https://github.com/BlueSky0322/splitfoolish-fork/pull/142
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
[#158]: https://github.com/BlueSky0322/splitfoolish-fork/pull/158
[#159]: https://github.com/BlueSky0322/splitfoolish-fork/pull/159
[#160]: https://github.com/BlueSky0322/splitfoolish-fork/pull/160
[#162]: https://github.com/BlueSky0322/splitfoolish-fork/pull/162
[#163]: https://github.com/BlueSky0322/splitfoolish-fork/pull/163
[#164]: https://github.com/BlueSky0322/splitfoolish-fork/pull/164
[#165]: https://github.com/BlueSky0322/splitfoolish-fork/pull/165
[#166]: https://github.com/BlueSky0322/splitfoolish-fork/pull/166
[#167]: https://github.com/BlueSky0322/splitfoolish-fork/pull/167
[#168]: https://github.com/BlueSky0322/splitfoolish-fork/pull/168
[#169]: https://github.com/BlueSky0322/splitfoolish-fork/pull/169
[#170]: https://github.com/BlueSky0322/splitfoolish-fork/pull/170
[#171]: https://github.com/BlueSky0322/splitfoolish-fork/pull/171
[#172]: https://github.com/BlueSky0322/splitfoolish-fork/pull/172
[#173]: https://github.com/BlueSky0322/splitfoolish-fork/pull/173
[#174]: https://github.com/BlueSky0322/splitfoolish-fork/pull/174
[#175]: https://github.com/BlueSky0322/splitfoolish-fork/pull/175
[#176]: https://github.com/BlueSky0322/splitfoolish-fork/pull/176
[#177]: https://github.com/BlueSky0322/splitfoolish-fork/pull/177
