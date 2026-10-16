-- Receipts for expense writes made through MCP, so an agent retrying a call after a
-- lost answer gets the saved result back instead of the expense being added or edited
-- again. One per account and request id; written in the same batch as the change it
-- records, so it exists exactly when the change was saved. Kept until the split is
-- deleted. `email` is the account the agent's grant acts as, which may not be the
-- person who paid or the person who asked the agent.
CREATE TABLE mcp_receipts (
  email TEXT NOT NULL,
  request_id TEXT NOT NULL,
  -- Which tool, split, expense and fields the request asked for (SHA-256, hex)
  fingerprint TEXT NOT NULL,
  tool TEXT NOT NULL,
  split_id TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  expense_id TEXT NOT NULL,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (email, request_id)
);

CREATE INDEX mcp_receipts_split ON mcp_receipts(split_id);
