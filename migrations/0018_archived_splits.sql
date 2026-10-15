-- Each person can archive a split for themselves: it leaves their Active list but stays
-- theirs, and comes back with Unarchive. NULL while it isn't archived.
ALTER TABLE split_members ADD COLUMN archived_at INTEGER;
