-- Where an item was paid for, and where a photo was taken: a point on the map, and for an
-- item, what is there once known ("Truz Tackles, Kuala Selangor"). All optional, kept to
-- 5 decimal places (about a metre). A photo's position is read from it on the device
-- before it is shrunk (which drops it) or taken from the phone as the photo is taken; the
-- picture itself never carries it. Both columns or neither, and on the map.
ALTER TABLE items ADD COLUMN place_lat REAL
  CHECK (place_lat IS NULL OR (place_lat BETWEEN -90 AND 90));
ALTER TABLE items ADD COLUMN place_lng REAL
  CHECK (place_lng IS NULL OR (place_lng BETWEEN -180 AND 180));
ALTER TABLE items ADD COLUMN place_name TEXT
  CHECK (place_name IS NULL OR (length(place_name) BETWEEN 1 AND 120));

ALTER TABLE attachments ADD COLUMN place_lat REAL
  CHECK (place_lat IS NULL OR (place_lat BETWEEN -90 AND 90));
ALTER TABLE attachments ADD COLUMN place_lng REAL
  CHECK (place_lng IS NULL OR (place_lng BETWEEN -180 AND 180));

-- Whether this account's photos and items keep where they were (on until turned off)
ALTER TABLE user_settings ADD COLUMN save_places INTEGER NOT NULL DEFAULT 1
  CHECK (save_places IN (0, 1));
