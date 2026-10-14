-- Items now list newest first unless someone picks otherwise. Settings still on the old
-- default (by date, oldest first) move to the new one; any other order was chosen and
-- stays. New rows are written with the app's defaults, so the column default no longer
-- matters.
UPDATE user_settings SET items_sort_dir = 'desc'
  WHERE items_sort_key = 'date' AND items_sort_dir = 'asc';
