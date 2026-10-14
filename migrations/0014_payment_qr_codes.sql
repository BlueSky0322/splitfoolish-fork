-- QR codes for payment methods of type 'QR code' (a DuitNow QR, say): the image someone
-- who owes you scans. Kept apart from payment_methods, which is rewritten whole on every
-- save, and from its rows' lifetime: a code is uploaded before its method is saved, and
-- codes whose method is gone are dropped when methods are next saved.
CREATE TABLE payment_qr_codes (
  method_id TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES profiles(email) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  -- Changes with each new image, so browsers can cache each version forever
  version INTEGER NOT NULL,
  data BLOB NOT NULL
);

CREATE INDEX payment_qr_codes_by_email ON payment_qr_codes(email);
