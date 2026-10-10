-- 0004 Admin users, roles, permissions (RBAC with least privilege).
-- BRD §19 (roles and permissions, audit logs), TECH §12–13 (RBAC, role table), prompt §26.

CREATE TABLE admin_users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email              citext NOT NULL UNIQUE,
  display_name       text   NOT NULL,
  password_hash      text,
  mfa_secret_enc     bytea,              -- TOTP secret encrypted with the app KMS key
  mfa_enabled_at     timestamptz,
  status             text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  failed_login_count int  NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  last_login_at      timestamptz,
  token_version      int  NOT NULL DEFAULT 0,
  created_by         uuid REFERENCES admin_users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('admin_users');

CREATE TABLE admin_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,      -- super_admin, product_admin, trust_safety, support, finance_admin, analyst, content_admin
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,  -- system roles cannot be deleted
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_permissions (
  key         text PRIMARY KEY,          -- '<domain>.<action>', e.g. 'questions.publish'
  domain      text NOT NULL,
  description text NOT NULL,
  is_sensitive boolean NOT NULL DEFAULT false   -- access to PII / verification data → extra audit
);

CREATE TABLE admin_role_permissions (
  role_id        uuid NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES admin_permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE admin_user_roles (
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  role_id       uuid NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  -- Optional ABAC scope, e.g. a regional moderator limited to certain countries (TECH §15 RBAC/ABAC).
  country_scope char(2)[],
  granted_by    uuid REFERENCES admin_users(id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, role_id)
);

CREATE TABLE admin_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  csrf_hash     bytea NOT NULL,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX admin_sessions_user_idx ON admin_sessions (admin_user_id) WHERE revoked_at IS NULL;

ALTER TABLE country_configs ADD CONSTRAINT country_configs_updated_by_fk FOREIGN KEY (updated_by) REFERENCES admin_users(id);
ALTER TABLE system_settings ADD CONSTRAINT system_settings_updated_by_fk FOREIGN KEY (updated_by) REFERENCES admin_users(id);
ALTER TABLE feature_flags   ADD CONSTRAINT feature_flags_updated_by_fk   FOREIGN KEY (updated_by) REFERENCES admin_users(id);
ALTER TABLE experiments     ADD CONSTRAINT experiments_created_by_fk     FOREIGN KEY (created_by) REFERENCES admin_users(id);
ALTER TABLE legal_documents ADD CONSTRAINT legal_documents_created_by_fk FOREIGN KEY (created_by) REFERENCES admin_users(id);
ALTER TABLE experiment_assignments ADD CONSTRAINT experiment_assignments_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
