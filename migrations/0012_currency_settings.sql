-- The Currency section of Settings: a fixed currency for new splits (NULL: the one
-- used last, as before), and where exchange rates come from (Wise's live rate, or the
-- ECB's daily one).
ALTER TABLE user_settings ADD COLUMN default_currency TEXT
  CHECK (default_currency IS NULL OR length(default_currency) = 3);
ALTER TABLE user_settings ADD COLUMN rate_source TEXT NOT NULL DEFAULT 'wise'
  CHECK (rate_source IN ('wise', 'ecb'));
