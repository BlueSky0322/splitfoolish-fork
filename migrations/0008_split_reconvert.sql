-- Changing a split's currency converts its items in the background. While that runs,
-- converting_from is the currency its plain items are still in, and converting_since
-- when the change was made; both NULL otherwise.
ALTER TABLE splits ADD COLUMN converting_from TEXT
  CHECK (converting_from IS NULL OR length(converting_from) = 3);
ALTER TABLE splits ADD COLUMN converting_since INTEGER;
