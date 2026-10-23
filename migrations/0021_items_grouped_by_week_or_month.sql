-- Items can be grouped by week or month as well as by day. SQLite can't change a CHECK
-- in place, so the settings table is rebuilt with the two new groupings allowed;
-- nothing references it, and every column keeps its value.
CREATE TABLE user_settings_new (
  email TEXT PRIMARY KEY REFERENCES profiles(email) ON DELETE CASCADE,
  theme TEXT NOT NULL DEFAULT 'auto' CHECK (theme IN ('dark', 'light', 'auto')),
  accent TEXT NOT NULL DEFAULT 'blurple'
    CHECK (accent IN ('blurple', 'blue', 'teal', 'green', 'amber', 'rose')),
  last_currency TEXT CHECK (last_currency IS NULL OR length(last_currency) = 3),
  sidebar_open INTEGER NOT NULL DEFAULT 1 CHECK (sidebar_open IN (0, 1)),
  items_view TEXT NOT NULL DEFAULT 'card' CHECK (items_view IN ('card', 'table')),
  items_group_by TEXT NOT NULL DEFAULT 'day'
    CHECK (items_group_by IN ('none', 'day', 'week', 'month', 'payer', 'category')),
  items_sort_key TEXT NOT NULL DEFAULT 'date'
    CHECK (items_sort_key IN ('date', 'name', 'payer', 'amount')),
  items_sort_dir TEXT NOT NULL DEFAULT 'asc' CHECK (items_sort_dir IN ('asc', 'desc')),
  updated_at INTEGER NOT NULL,
  default_currency TEXT CHECK (default_currency IS NULL OR length(default_currency) = 3),
  rate_preference TEXT NOT NULL DEFAULT 'wise' CHECK (rate_preference IN ('wise', 'ecb'))
);

INSERT INTO user_settings_new (email, theme, accent, last_currency, sidebar_open, items_view,
  items_group_by, items_sort_key, items_sort_dir, updated_at, default_currency, rate_preference)
  SELECT email, theme, accent, last_currency, sidebar_open, items_view,
    items_group_by, items_sort_key, items_sort_dir, updated_at, default_currency, rate_preference
  FROM user_settings;

DROP TABLE user_settings;
ALTER TABLE user_settings_new RENAME TO user_settings;
