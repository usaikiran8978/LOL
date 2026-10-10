-- 0016 Admin invitations (one-time links to set a password) — admins are never created with shared passwords.
CREATE TABLE admin_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  invited_by    uuid REFERENCES admin_users(id),
  created_at    timestamptz(3) NOT NULL DEFAULT now(),
  expires_at    timestamptz(3) NOT NULL,
  used_at       timestamptz(3)
);
CREATE INDEX admin_invites_admin_idx ON admin_invites (admin_user_id) WHERE used_at IS NULL;
