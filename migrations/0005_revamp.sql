-- Data for the redesign: split currency, item categories and split modes, user
-- profiles (display name, appearance, payment methods, profile picture) and photos.

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

CREATE TABLE profiles (
  email TEXT PRIMARY KEY,
  display_name TEXT,
  theme TEXT NOT NULL DEFAULT 'auto' CHECK (theme IN ('dark', 'light', 'auto')),
  accent TEXT NOT NULL DEFAULT 'blurple',
  last_currency TEXT,
  preferred_payment_method_id TEXT,
  -- Bumped on each new picture so browsers fetch the new one; null means none
  avatar_version INTEGER,
  avatar_type TEXT,
  avatar BLOB,
  updated_at INTEGER NOT NULL
);

-- How someone likes to be paid back, e.g. DuitNow 012-345 6789
CREATE TABLE payment_methods (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  type TEXT NOT NULL,
  detail TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE INDEX payment_methods_by_email ON payment_methods(email);

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
