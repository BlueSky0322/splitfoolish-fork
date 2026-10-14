-- Bank transfers name the bank and the account holder; detail is then the account
-- number. Both NULL for other types, and for bank transfers saved before this, whose
-- detail still holds everything as one line. Cash needs no details, so detail may now
-- be empty. SQLite can't change a CHECK in place, so the table is rebuilt; nothing
-- references it.
CREATE TABLE payment_methods_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES profiles(email) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (length(type) BETWEEN 1 AND 32),
  detail TEXT NOT NULL CHECK (length(detail) <= 120),
  bank TEXT CHECK (bank IS NULL OR length(bank) BETWEEN 1 AND 40),
  account_name TEXT CHECK (account_name IS NULL OR length(account_name) BETWEEN 1 AND 80),
  position INTEGER NOT NULL,
  is_preferred INTEGER NOT NULL DEFAULT 0 CHECK (is_preferred IN (0, 1))
);

INSERT INTO payment_methods_new (id, email, type, detail, position, is_preferred)
  SELECT id, email, type, detail, position, is_preferred FROM payment_methods;

DROP TABLE payment_methods;
ALTER TABLE payment_methods_new RENAME TO payment_methods;

CREATE INDEX payment_methods_by_email ON payment_methods(email, position);
CREATE UNIQUE INDEX one_preferred_payment_method ON payment_methods(email) WHERE is_preferred = 1;
