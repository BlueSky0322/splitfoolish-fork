-- Checks a write makes in the same batch that saves it. One that no longer holds (the
-- writer was taken out of the split, or its currency changed while the write waited on
-- a rate) inserts NULL into its column here, which NOT NULL refuses, undoing the whole
-- batch. A check that holds inserts nothing, so this table stays empty.
CREATE TABLE write_guards (
  member INTEGER NOT NULL DEFAULT 1,
  currency INTEGER NOT NULL DEFAULT 1
);

-- The app's changes, by the id it gave each one, saved with them: one sent again (its
-- answer lost on the way back) is answered as saved rather than applied twice.
-- fingerprint is the change as sent, so the same id with a different change is refused.
CREATE TABLE change_receipts (
  split_id TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  change_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (split_id, email, change_id)
);
