-- The column holds which service an account prefers rates from ('wise' or 'ecb'), not
-- where a rate came from (items.rate_source, which also says 'manual'): named for it.
ALTER TABLE user_settings RENAME COLUMN rate_source TO rate_preference;
