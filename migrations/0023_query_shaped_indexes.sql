-- Indexes shaped like the queries that use them (docs/erd.md lists every index and
-- what it serves).
--
-- Every save deletes the split's change receipts older than 90 days (bill/commit.ts).
-- The primary key (split_id, email, change_id) can only find them by reading every
-- receipt of the split; by time, a save with nothing to delete reads none.
CREATE INDEX change_receipts_by_split_saved_at ON change_receipts(split_id, saved_at);

-- A split's people and items are read in position order (bill/read.ts), and a new one
-- takes max(position) + 1 (bill/model.ts, splits/sharing.ts). An index in that order
-- answers both without a sort; rowid, the tie-breaker, is the implied last key of
-- every index on these tables.
CREATE INDEX people_by_split_position ON people(split_id, position);
DROP INDEX people_by_split;
CREATE INDEX items_by_split_position ON items(split_id, position);
DROP INDEX items_by_split;

-- Photos are listed oldest first (photos/attachments.ts)
CREATE INDEX attachments_by_split_created_at ON attachments(split_id, created_at);
DROP INDEX attachments_by_split;
