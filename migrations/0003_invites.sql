-- Pending invitations by email. A row is deleted when it is accepted, declined or
-- revoked; expired rows are ignored and replaced by a fresh invite.
CREATE TABLE split_invites (
  id TEXT PRIMARY KEY,
  split_id TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (split_id, email)
);

CREATE INDEX split_invites_by_email ON split_invites(email);
