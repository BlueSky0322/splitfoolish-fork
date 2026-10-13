-- Move each split's people and items out of the splits.data JSON blob into tables,
-- so items reference people by id and edits touch single rows.

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  split_id TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- The account this person is, when they were added from the split's members
  member_email TEXT,
  position INTEGER NOT NULL,
  UNIQUE (split_id, name)
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  split_id TEXT NOT NULL REFERENCES splits(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cost_cents INTEGER NOT NULL CHECK (cost_cents >= 0),
  payer_id TEXT NOT NULL REFERENCES people(id),
  position INTEGER NOT NULL
);

CREATE TABLE item_participants (
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  PRIMARY KEY (item_id, person_id)
);

CREATE INDEX people_by_split ON people(split_id);
CREATE INDEX items_by_split ON items(split_id);
CREATE INDEX items_by_payer ON items(payer_id);
CREATE INDEX item_participants_by_person ON item_participants(person_id);

-- People in list order. Duplicate names collapse into one person.
INSERT OR IGNORE INTO people (id, split_id, name, member_email, position)
SELECT lower(hex(randomblob(8))), s.id, trim(json_extract(p.value, '$.name')), NULL, p.key
FROM splits s, json_each(s.data, '$.people') p
WHERE trim(coalesce(json_extract(p.value, '$.name'), '')) != '';

-- Payers and participants missing from the people list become people too.
INSERT OR IGNORE INTO people (id, split_id, name, member_email, position)
SELECT lower(hex(randomblob(8))), s.id, trim(n.name), NULL, 1000000 + n.ord
FROM splits s,
  (
    SELECT s2.id AS split_id, json_extract(i.value, '$.payer.name') AS name, i.key * 1000 AS ord
    FROM splits s2, json_each(s2.data, '$.items') i
    UNION ALL
    SELECT s2.id, json_extract(pp.value, '$.name'), i.key * 1000 + 1 + pp.key
    FROM splits s2, json_each(s2.data, '$.items') i, json_each(i.value, '$.participants') pp
  ) n
WHERE n.split_id = s.id AND trim(coalesce(n.name, '')) != '';

-- Items keep a predictable id (split id + list index) so participants can be linked below.
-- Items with no payer can't be represented and are dropped.
INSERT INTO items (id, split_id, name, cost_cents, payer_id, position)
SELECT s.id || '-' || i.key, s.id, coalesce(json_extract(i.value, '$.name'), ''),
  max(0, CAST(round(coalesce(json_extract(i.value, '$.cost'), 0) * 100) AS INTEGER)),
  pay.id, i.key
FROM splits s, json_each(s.data, '$.items') i
JOIN people pay ON pay.split_id = s.id AND pay.name = trim(json_extract(i.value, '$.payer.name'));

INSERT OR IGNORE INTO item_participants (item_id, person_id)
SELECT s.id || '-' || i.key, per.id
FROM splits s, json_each(s.data, '$.items') i, json_each(i.value, '$.participants') pp
JOIN people per ON per.split_id = s.id AND per.name = trim(json_extract(pp.value, '$.name'))
WHERE EXISTS (SELECT 1 FROM items WHERE items.id = s.id || '-' || i.key);

ALTER TABLE splits DROP COLUMN data;
