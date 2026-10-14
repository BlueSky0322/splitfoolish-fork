-- Notes on an item, such as what was ordered or who still owes their part. NULL when
-- there are none.
ALTER TABLE items ADD COLUMN notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000);
