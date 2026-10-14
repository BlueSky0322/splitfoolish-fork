# Data model

Splitfoolish keeps everything in one Cloudflare D1 (SQLite) database. Accounts come
from Cloudflare Access, which signs people in by email, so an email address is the
account key everywhere.

```mermaid
erDiagram
    splits ||--o{ split_members : "shared with"
    splits ||--o{ split_invites : "pending invites"
    splits ||--o{ people : "in the bill"
    splits ||--o{ items : "bought"
    splits ||--o{ attachments : "photos"
    splits |o--o| people : "settle up through"
    splits ||--o| split_pictures : "pictured by"
    people ||--o{ items : "paid for"
    items ||--|{ item_participants : "split between"
    people ||--o{ item_participants : "shares in"
    items ||--o{ attachments : "receipts"
    attachments ||--|| attachment_data : "bytes"
    profiles ||--o| user_settings : "prefers"
    profiles ||--o| avatars : "pictured by"
    profiles ||--o{ payment_methods : "paid back by"

    splits {
        text id PK
        text name
        text currency "ISO 4217, e.g. MYR"
        text distributor_person_id FK "null: fewest transfers"
        text invite_token UK "share link"
        text converting_from "while items are converted to a new currency"
        int converting_since
        int created_at
        int updated_at
    }
    split_members {
        text split_id PK, FK
        text email PK "the account"
        text role "owner or editor"
        int joined_at
    }
    split_invites {
        text id PK
        text split_id FK
        text email
        text invited_by
        int created_at
        int expires_at
    }
    people {
        text id PK
        text split_id FK
        text name UK "unique per split"
        text member_email "the account this person is, if linked"
        int position
    }
    items {
        text id PK
        text split_id FK
        text name
        int cost_cents
        text payer_id FK
        text split_mode "equal, shares or exact"
        text category
        int position
        int created_at
        text original_currency "null: entered in the split's currency"
        int original_cents "as typed, in original_currency"
        real rate "original to split currency, as saved"
        text rate_source "wise, frankfurter or manual"
        int rate_at
    }
    item_participants {
        text item_id PK, FK
        text person_id PK, FK
        int shares "for split_mode shares"
        int exact_cents "for split_mode exact"
        int original_exact_cents "as typed, for items in another currency"
    }
    attachments {
        text id PK
        text split_id FK
        text item_id FK "null: a photo of the whole split"
        text content_type
        int size
        text uploaded_by
        int created_at
    }
    attachment_data {
        text id PK, FK
        blob data
    }
    split_pictures {
        text split_id PK, FK
        text content_type
        int version "changes with each picture"
        blob data
    }
    profiles {
        text email PK
        text display_name
        int created_at
        int updated_at
    }
    user_settings {
        text email PK, FK
        text theme "dark, light or auto"
        text accent
        text last_currency "default for new splits"
        int sidebar_open
        text items_view "card or table"
        text items_group_by "none, day, payer or category"
        text items_sort_key "date, name, payer or amount"
        text items_sort_dir "asc or desc"
        int updated_at
    }
    avatars {
        text email PK, FK
        text content_type
        int version "changes with each picture"
        blob data
    }
    payment_methods {
        text id PK
        text email FK
        text type "e.g. DuitNow"
        text detail
        int position
        int is_preferred "at most one per account"
    }
```

## Why it's shaped this way

- **A split's bill.** `people`, `items` and `item_participants` are separate tables, so
  an edit touches only the rows it changes and items refer to people by id. Money is
  whole cents, so totals always add up.
- **What others see and what only you see.** `profiles` holds what people in your
  splits see: your display name, with your picture in `avatars` and how to pay you in
  `payment_methods`. `user_settings` holds private preferences (theme, accent, the
  default currency, how items are shown), which follow you between devices.
- **Large values live apart.** Picture and photo bytes sit in `avatars`,
  `split_pictures` and `attachment_data`, so reading names or listing splits and
  photos never loads images.
- **Other currencies.** An item entered in another currency keeps what was typed
  (`original_currency`, `original_cents`) and the rate it was converted at, while
  `cost_cents` holds the amount in the split's currency, worked out once by the server
  when the item is saved. Totals never drift as rates move, and settling up only ever
  sees one currency. Editing an item without changing its amount keeps its rate.
- **Changing a split's currency.** The new currency is saved at once and the items
  are converted in the background (`converting_from` and `converting_since` mark it).
  Plain items become "paid in the old currency", items paid in the new one become
  plain again, so changing back restores the exact amounts. Items can't be added or
  edited until it's done; the app holds such changes and sends them again.
- **Shared, not per person.** Who to route payments through is a property of the split
  (`splits.distributor_person_id`), so everyone in it sees the same transfers.
- **Deleting cleans up.** Deleting a split removes its members, invites, people, items,
  picture, photos and photo bytes. Deleting an item removes its receipts. Removing a person who
  was the settle-up route sets the route back to none.
- **Joining.** Opening the share link doesn't join you: it gives you a `split_invites`
  row (one per person per split, so opening it again changes nothing) that waits in
  Invites. Accepting deletes it, adds you to `split_members` and puts you in the bill: a
  guest with your name becomes you (so someone who was removed and comes back gets
  their old entry), otherwise a new `people` row is added. Declining or the owner
  withdrawing it deletes it; an expired one is ignored and replaced if you open the
  link again.
- **Removing someone.** When the owner takes an account out of a split, its
  `split_members` row goes, the person it was in the bill stays as a guest
  (`people.member_email` cleared), and `splits.invite_token` changes so the old link
  can't bring them back. Changing the link, by reset or removal, also withdraws the
  invites picked up from it. Only the owner changes `people`; anyone in the split can
  change `items`.
- **Lazy profiles.** A profile row is made the first time someone saves a setting,
  name, picture or payment method; until then the defaults apply. Emails in
  `split_members`, `split_invites` and `people.member_email` don't reference
  `profiles`, because someone can be invited, or join a split, before they have one.
