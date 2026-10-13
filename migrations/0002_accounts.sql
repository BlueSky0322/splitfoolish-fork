-- Splits now belong to signed-in users. Splits from before accounts are dropped.
DROP TABLE IF EXISTS splits;

CREATE TABLE splits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  invite_token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE split_members (
  split_id TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (split_id, email)
);

CREATE INDEX split_members_by_email ON split_members(email);
