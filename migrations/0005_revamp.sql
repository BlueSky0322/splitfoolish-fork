-- Data for the redesign: split currency and settle-up routing, item categories and
-- split modes, user profiles, settings, profile pictures and payment methods, and
-- photos. See docs/erd.md for how the tables relate.

-- Splits have a currency (ISO 4217 code); existing splits were in ringgit
ALTER TABLE splits ADD COLUMN currency TEXT NOT NULL DEFAULT 'MYR';

-- Items: an optional category, how the cost is split, and when it was added
ALTER TABLE items ADD COLUMN category TEXT;
ALTER TABLE items ADD COLUMN split_mode TEXT NOT NULL DEFAULT 'equal'
  CHECK (split_mode IN ('equal', 'shares', 'exact'));
ALTER TABLE items ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
UPDATE items SET created_at = (SELECT created_at FROM splits WHERE splits.id = items.split_id) + position;

-- Per participant: shares (for 'shares' mode) or an exact amount (for 'exact' mode)
ALTER TABLE item_participants ADD COLUMN shares INTEGER NOT NULL DEFAULT 1;
ALTER TABLE item_participants ADD COLUMN exact_cents INTEGER;

-- Who will be paid back through whom when settling up ("route payments through").
-- Shared by everyone in the split, so everyone sees the same transfers.
ALTER TABLE splits ADD COLUMN distributor_person_id TEXT REFERENCES people(id) ON DELETE SET NULL;

-- One row per account, made the first time they save anything. Holds what other
-- people in their splits see of them.
CREATE TABLE profiles (
  email TEXT PRIMARY KEY,
  display_name TEXT CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 32),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Private preferences that follow the account between devices
CREATE TABLE user_settings (
  email TEXT PRIMARY KEY REFERENCES profiles(email) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'auto' CHECK (theme IN ('dark', 'light', 'auto')),
  accent TEXT NOT NULL DEFAULT 'blurple'
    CHECK (accent IN ('blurple', 'blue', 'teal', 'green', 'amber', 'rose')),
  -- Default currency for new splits
  last_currency TEXT CHECK (last_currency IS NULL OR length(last_currency) = 3),
  sidebar_open INTEGER NOT NULL DEFAULT 1 CHECK (sidebar_open IN (0, 1)),
  -- How a split's items are shown
  items_view TEXT NOT NULL DEFAULT 'card' CHECK (items_view IN ('card', 'table')),
  items_group_by TEXT NOT NULL DEFAULT 'day'
    CHECK (items_group_by IN ('none', 'day', 'payer', 'category')),
  items_sort_key TEXT NOT NULL DEFAULT 'date'
    CHECK (items_sort_key IN ('date', 'name', 'payer', 'amount')),
  items_sort_dir TEXT NOT NULL DEFAULT 'asc' CHECK (items_sort_dir IN ('asc', 'desc')),
  updated_at INTEGER NOT NULL
);

-- Profile pictures, apart from profiles so reading names never loads image bytes
CREATE TABLE avatars (
  email TEXT PRIMARY KEY REFERENCES profiles(email) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  -- Changes with each new picture, so browsers can cache each version forever
  version INTEGER NOT NULL,
  data BLOB NOT NULL
);

-- How someone likes to be paid back, e.g. DuitNow 012-345 6789. At most one each
-- is preferred; it's shown first to people who owe them.
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES profiles(email) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 32),
  detail TEXT NOT NULL CHECK (length(detail) BETWEEN 1 AND 120),
  position INTEGER NOT NULL,
  is_preferred INTEGER NOT NULL DEFAULT 0 CHECK (is_preferred IN (0, 1))
);

CREATE INDEX payment_methods_by_email ON payment_methods(email, position);
CREATE UNIQUE INDEX one_preferred_payment_method ON payment_methods(email) WHERE is_preferred = 1;

-- Photos: receipts on items and photos of a whole split. Image bytes sit in their
-- own table so listing photos stays light. Photos are shrunk in the browser to a few
-- hundred KB; D1 allows up to 2 MB a value.
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  split_id TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  -- Set for a receipt on an item; null for a photo of the whole split
  item_id TEXT REFERENCES items(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX attachments_by_split ON attachments(split_id);
CREATE INDEX attachments_by_item ON attachments(item_id);

-- Deleting an item or split removes its attachments, and with them their bytes
CREATE TABLE attachment_data (
  id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
  data BLOB NOT NULL
);
