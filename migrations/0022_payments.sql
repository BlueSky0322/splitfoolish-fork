-- Payments between two people in a split ("Tom paid Ryan back 30"), which balances
-- subtract and the split's total ignores. A payment is its own fact, not an item, so it
-- has its own table. item_id says which item it settles, when it settles one; the code
-- clears it when that item goes (ON DELETE SET NULL is the backstop). amount_cents is in
-- the split's currency; one paid in another currency keeps what was typed and the rate
-- it was converted at, as items do (0007), all NULL otherwise. Payments have no order of
-- their own: readers order by when they were paid.
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  split_id TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  from_person_id TEXT NOT NULL REFERENCES people(id),
  to_person_id TEXT NOT NULL REFERENCES people(id),
  item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at INTEGER NOT NULL,
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  original_currency TEXT CHECK (original_currency IS NULL OR length(original_currency) = 3),
  original_cents INTEGER CHECK (original_cents IS NULL OR original_cents >= 0),
  rate REAL CHECK (rate IS NULL OR rate > 0),
  rate_source TEXT CHECK (rate_source IS NULL OR rate_source IN ('wise', 'frankfurter', 'manual')),
  rate_at INTEGER,
  CHECK (from_person_id != to_person_id)
);

CREATE INDEX payments_by_split ON payments(split_id);
CREATE INDEX payments_by_from ON payments(from_person_id);
CREATE INDEX payments_by_to ON payments(to_person_id);
CREATE INDEX payments_by_item ON payments(item_id);
