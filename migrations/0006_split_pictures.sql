-- A picture for each split, chosen in New split or split settings and shown wherever
-- the split is listed. Kept apart from splits so listing splits never loads image bytes.
CREATE TABLE split_pictures (
  split_id TEXT PRIMARY KEY REFERENCES splits(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  -- Changes with each new picture, so browsers can keep each version forever
  version INTEGER NOT NULL,
  data BLOB NOT NULL
);
