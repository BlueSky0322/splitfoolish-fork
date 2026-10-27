-- A split's payments are read in the order they were paid (bill/read.ts). An index in
-- that order answers it without a sort; rowid, the tie-breaker for payments made in the
-- same millisecond, is the implied last key, so the order is the one readers have now.
-- The person and item indexes stay: removing a person or item asks whether it has any.
CREATE INDEX payments_by_split_created_at ON payments(split_id, created_at);
DROP INDEX payments_by_split;
