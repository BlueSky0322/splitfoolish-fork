-- Items entered in another currency. cost_cents stays the amount in the split's
-- currency, converted once when the item is saved; these keep what was typed and the
-- rate used, so totals never drift and the item can be shown as entered. All NULL for
-- items in the split's own currency.
ALTER TABLE items ADD COLUMN original_currency TEXT
  CHECK (original_currency IS NULL OR length(original_currency) = 3);
ALTER TABLE items ADD COLUMN original_cents INTEGER
  CHECK (original_cents IS NULL OR original_cents >= 0);
ALTER TABLE items ADD COLUMN rate REAL CHECK (rate IS NULL OR rate > 0);
ALTER TABLE items ADD COLUMN rate_source TEXT
  CHECK (rate_source IS NULL OR rate_source IN ('wise', 'frankfurter', 'manual'));
ALTER TABLE items ADD COLUMN rate_at INTEGER;

-- For items split by exact amounts in another currency: each share as typed
ALTER TABLE item_participants ADD COLUMN original_exact_cents INTEGER
  CHECK (original_exact_cents IS NULL OR original_exact_cents >= 0);
