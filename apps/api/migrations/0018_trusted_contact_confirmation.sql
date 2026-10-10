-- 0018 Trusted contacts confirm via a one-time link before receiving any alerts.
ALTER TABLE trusted_contacts
  ADD COLUMN confirm_token_hash bytea UNIQUE,
  ADD COLUMN confirm_expires_at timestamptz(3);
