-- Each person's own order for their splits, set by dragging them in the app. NULL until
-- they first reorder; unordered splits (new or just joined) come first, newest first.
ALTER TABLE split_members ADD COLUMN sort_position INTEGER;
