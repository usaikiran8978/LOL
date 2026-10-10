-- 0012 Notifications, AI orchestration config, CMS, privacy requests, retention.
-- BRD §12, §17, §19 (AI prompt/config mgmt, notification templates, push/email/SMS config, content mgmt,
-- FAQ/help/safety content, data/privacy requests); TECH §4 (notifications, notification_templates), §8–9, §16, §18.

-- ---------- Notifications ----------
CREATE TABLE notification_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,   -- 'match.new', 'message.new', 'like.received', 'date.reminder', ...
  category    text NOT NULL CHECK (category IN ('match','message','like','ai_recommendation','event','date','safety','verification','subscription','moderation','system','marketing')),
  channels    text[] NOT NULL CHECK (channels <@ ARRAY['push','email','sms','in_app']::text[]),
  is_transactional boolean NOT NULL DEFAULT true,   -- transactional bypasses marketing opt-outs (not safety)
  respects_quiet_hours boolean NOT NULL DEFAULT true,
  deep_link_pattern text,             -- e.g. 'amora://matches/{{matchId}}'
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_template_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES notification_templates(id) ON DELETE CASCADE,
  version      int  NOT NULL,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  variables    text[] NOT NULL DEFAULT '{}',
  created_by   uuid REFERENCES admin_users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  published_by uuid REFERENCES admin_users(id),
  UNIQUE (template_id, version)
);
CREATE UNIQUE INDEX notification_template_one_published ON notification_template_versions (template_id) WHERE status = 'published';

CREATE TABLE notification_template_contents (
  version_id uuid NOT NULL REFERENCES notification_template_versions(id) ON DELETE CASCADE,
  locale     text NOT NULL REFERENCES languages(code),
  channel    text NOT NULL CHECK (channel IN ('push','email','sms','in_app')),
  title      text,
  subject    text,
  body       text NOT NULL,
  html_body  text,
  PRIMARY KEY (version_id, locale, channel)
);

CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_version_id uuid REFERENCES notification_template_versions(id),
  category      text NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('push','email','sms','in_app')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  rendered_title text,
  rendered_body  text,
  deep_link     text,
  dedupe_key    text,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','deferred','sent','delivered','failed','dead_letter','suppressed','read')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  attempts      smallint NOT NULL DEFAULT 0,
  last_error    text,
  provider_message_id text,
  sent_at       timestamptz,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_inbox_idx ON notifications (user_id, created_at DESC) WHERE channel = 'in_app';
CREATE INDEX notifications_dispatch_idx ON notifications (scheduled_for) WHERE status IN ('queued','deferred');
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications (user_id, channel, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE notification_preferences (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL,
  channel  text NOT NULL CHECK (channel IN ('push','email','sms','in_app')),
  enabled  boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category, channel)
);

CREATE TABLE notification_settings (
  user_id           uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quiet_hours_start time,
  quiet_hours_end   time,
  timezone          text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Channel provider configuration (FCM, APNs, SES, Twilio...). Secrets are references, never values.
CREATE TABLE notification_channel_configs (
  channel        text NOT NULL CHECK (channel IN ('push','email','sms')),
  provider       text NOT NULL,
  is_enabled     boolean NOT NULL DEFAULT false,
  priority       smallint NOT NULL DEFAULT 0,
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- non-secret settings (sender id, from address, region)
  secret_ref     text,                                 -- key in the secrets manager
  country_codes  char(2)[],
  updated_by     uuid REFERENCES admin_users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, provider)
);

-- ---------- AI orchestration ----------
CREATE TABLE ai_providers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  kind        text NOT NULL CHECK (kind IN ('openai_compatible','anthropic')),
  base_url    text,
  secret_ref  text NOT NULL,
  is_enabled  boolean NOT NULL DEFAULT false,
  timeout_ms  int NOT NULL DEFAULT 30000,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('ai_providers');

CREATE TABLE ai_models (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        uuid NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  model_name         text NOT NULL,
  purpose            text NOT NULL CHECK (purpose IN ('chat','embedding','moderation','translation','vision')),
  context_tokens     int,
  input_cost_per_mtok  numeric(10,4),
  output_cost_per_mtok numeric(10,4),
  is_enabled         boolean NOT NULL DEFAULT true,
  UNIQUE (provider_id, model_name)
);

CREATE TABLE ai_prompt_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,      -- 'profile_coach', 'match_explanation', 'conversation_starter', ...
  feature_key text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_prompt_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES ai_prompt_templates(id) ON DELETE CASCADE,
  version        int  NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  system_prompt  text NOT NULL,
  user_template  text NOT NULL,         -- variables in {{double_braces}}, user content always wrapped in delimiters
  output_schema  jsonb NOT NULL,        -- JSON Schema; responses validated before use (TECH §8)
  input_variables text[] NOT NULL DEFAULT '{}',
  temperature    numeric(3,2),
  max_output_tokens int,
  change_note    text,
  created_by     uuid REFERENCES admin_users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  published_by   uuid REFERENCES admin_users(id),
  UNIQUE (template_id, version)
);
CREATE UNIQUE INDEX ai_prompt_one_published ON ai_prompt_versions (template_id) WHERE status = 'published';

CREATE TABLE ai_feature_configs (
  feature_key          text PRIMARY KEY,   -- 'profile_coach','match_explanation','conversation_starter','conversation_coach','translation','date_planner','event_recommendation','safety_classifier','profile_quality','scam_risk','onboarding_assistant','post_date_reflection','relationship_insights'
  is_enabled           boolean NOT NULL DEFAULT false,
  primary_model_id     uuid REFERENCES ai_models(id),
  fallback_model_id    uuid REFERENCES ai_models(id),
  prompt_template_id   uuid REFERENCES ai_prompt_templates(id),
  temperature          numeric(3,2),
  max_input_tokens     int NOT NULL DEFAULT 4000,
  max_output_tokens    int NOT NULL DEFAULT 800,
  per_user_daily_limit int,
  premium_daily_limit  int,
  requires_entitlement text,
  monthly_budget_usd   numeric(12,2),
  moderate_input       boolean NOT NULL DEFAULT true,
  moderate_output      boolean NOT NULL DEFAULT true,
  safety_threshold     numeric(4,3) NOT NULL DEFAULT 0.5,
  run_async            boolean NOT NULL DEFAULT false,
  requires_consent     text,   -- consent_type required before use, e.g. 'ai_assistance'
  updated_by           uuid REFERENCES admin_users(id),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- AI audit metadata — no prompt/response bodies retained (TECH §8).
CREATE TABLE ai_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key       text NOT NULL,
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  prompt_version_id uuid REFERENCES ai_prompt_versions(id),
  model_id          uuid REFERENCES ai_models(id),
  used_fallback     boolean NOT NULL DEFAULT false,
  status            text NOT NULL CHECK (status IN ('succeeded','failed','blocked_input','blocked_output','schema_invalid','rate_limited','budget_exceeded','escalated')),
  input_tokens      int,
  output_tokens     int,
  cost_usd          numeric(12,6),
  latency_ms        int,
  moderation_flags  text[],
  error_code        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_requests_feature_time_idx ON ai_requests (feature_key, created_at);
CREATE INDEX ai_requests_user_time_idx ON ai_requests (user_id, created_at);

-- ---------- CMS (FAQ / help / safety education / announcements / pages) ----------
CREATE TABLE cms_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  kind        text NOT NULL CHECK (kind IN ('faq','help_article','safety_tip','safety_guide','announcement','page','onboarding_tip','paywall_copy')),
  category    text,
  position    int NOT NULL DEFAULT 0,
  country_codes char(2)[],
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  publish_at  timestamptz,
  unpublish_at timestamptz,
  created_by  uuid REFERENCES admin_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('cms_entries');
CREATE TABLE cms_entry_translations (
  entry_id  uuid NOT NULL REFERENCES cms_entries(id) ON DELETE CASCADE,
  locale    text NOT NULL REFERENCES languages(code),
  title     text NOT NULL,
  body_md   text NOT NULL,
  PRIMARY KEY (entry_id, locale)
);

-- ---------- Privacy ----------
CREATE TABLE data_privacy_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  subject_email   citext,
  kind            text NOT NULL CHECK (kind IN ('export','delete','rectify','restrict_processing','object')),
  status          text NOT NULL DEFAULT 'received' CHECK (status IN ('received','verifying','in_progress','completed','rejected','cancelled')),
  regime          text,
  due_at          timestamptz NOT NULL,
  export_storage_key text,
  export_expires_at timestamptz,
  handled_by      uuid REFERENCES admin_users(id),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX data_privacy_requests_open_idx ON data_privacy_requests (status, due_at) WHERE status IN ('received','verifying','in_progress');

CREATE TABLE retention_policies (
  entity          text PRIMARY KEY,     -- 'messages','verification_evidence','crossed_path_sightings','ai_requests','analytics_events', ...
  retention_days  int  NOT NULL CHECK (retention_days > 0),
  action          text NOT NULL CHECK (action IN ('delete','anonymize')),
  country_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by      uuid REFERENCES admin_users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Admin access to user PII (TECH §16 "admin access logging") — separate from audit_logs for fast per-user lookup.
CREATE TABLE admin_data_access_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_user_id uuid NOT NULL REFERENCES admin_users(id),
  user_id       uuid NOT NULL,
  resource      text NOT NULL,     -- 'profile','messages','verification_evidence','location','payments'
  purpose       text NOT NULL,
  case_id       uuid,
  accessed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_data_access_user_idx ON admin_data_access_logs (user_id, accessed_at DESC);
