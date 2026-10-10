-- 0009 Safety, verification, moderation, appeals.
-- BRD §15, §19 (profile review, verification mgmt, reports & moderation queue); TECH §4 (blocks, reports,
-- verification_requests, safety_events), §11 (safety architecture), prompt §15–16.

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

-- Mute (hide notifications/content) and restrict (limit what the other user can do) — BRD §15.
CREATE TABLE user_relationship_controls (
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  control    text NOT NULL CHECK (control IN ('mute','restrict')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, subject_id, control)
);

CREATE TABLE verification_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('selfie','identity')),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','needs_review','approved','rejected','expired','cancelled')),
  provider         text NOT NULL,               -- 'internal_liveness', 'onfido', 'veriff', ...
  provider_ref     text,
  pose_challenge   text,                        -- e.g. 'thumbs_up_left'
  evidence_keys    text[] NOT NULL DEFAULT '{}',-- storage keys in the restricted bucket; purged after decision + retention
  liveness_score   real,
  face_match_score real,
  document_country char(2),
  rejection_reason_key text,
  reviewer_id      uuid REFERENCES admin_users(id),
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  expires_at       timestamptz,                 -- reverification
  evidence_purged_at timestamptz
);
CREATE INDEX verification_requests_queue_idx ON verification_requests (status, submitted_at) WHERE status IN ('pending','needs_review');
CREATE INDEX verification_requests_user_idx ON verification_requests (user_id, submitted_at DESC);

-- Moderation cases group one or more reports/signals about a subject (TECH §11 case management).
CREATE TABLE moderation_cases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  category         text NOT NULL CHECK (category IN ('harassment','scam','fake_profile','spam','inappropriate_content','underage','violence','hate','self_harm','offline_safety','impersonation','other')),
  severity         text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  priority_score   numeric(6,3) NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','escalated','actioned','dismissed','closed')),
  source           text NOT NULL CHECK (source IN ('user_report','automated','admin','appeal')),
  assigned_to      uuid REFERENCES admin_users(id),
  assigned_at      timestamptz,
  sla_due_at       timestamptz NOT NULL,
  resolution_key   text,
  opened_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('moderation_cases');
CREATE INDEX moderation_cases_queue_idx ON moderation_cases (status, severity, priority_score DESC, opened_at) WHERE status IN ('open','in_review','escalated');
CREATE INDEX moderation_cases_subject_idx ON moderation_cases (subject_user_id, opened_at DESC);

CREATE TABLE reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  reported_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_type      text NOT NULL CHECK (target_type IN ('user','profile','media','message','prompt','event','date')),
  target_id        uuid,
  reason_term_id   uuid REFERENCES taxonomy_terms(id),   -- admin-managed reasons (kind='report_reason')
  details          text CHECK (char_length(details) <= 2000),
  evidence         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{type:'message', id}] references, snapshot taken server-side
  case_id          uuid REFERENCES moderation_cases(id),
  status           text NOT NULL DEFAULT 'received' CHECK (status IN ('received','triaged','resolved','dismissed')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_case_idx ON reports (case_id);
CREATE INDEX reports_reported_idx ON reports (reported_user_id, created_at DESC);
CREATE UNIQUE INDEX reports_dedupe_uq ON reports (reporter_id, target_type, target_id) WHERE status IN ('received','triaged');

-- Immutable evidence snapshot (content at the time of report, so deletion by the subject cannot erase it).
CREATE TABLE case_evidence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('message','media','profile_snapshot','prompt','event','note_attachment')),
  ref_id      uuid,
  snapshot    jsonb NOT NULL,
  storage_key text,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES moderation_cases(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES admin_users(id),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Moderation actions (warn/restrict/suspend/ban/remove/restore/escalate) — reversible states (TECH §11).
CREATE TABLE moderation_actions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id        uuid REFERENCES moderation_cases(id),
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action         text NOT NULL CHECK (action IN ('warn','restrict','suspend','ban','remove_content','restore_content','escalate','unban','unsuspend','lift_restriction','verify','unverify','force_logout')),
  content_type   text,
  content_id     uuid,
  params         jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_key     text NOT NULL,
  actor_type     text NOT NULL CHECK (actor_type IN ('admin','system')),
  actor_id       uuid REFERENCES admin_users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  reversed_at    timestamptz,
  reversed_by    uuid REFERENCES admin_users(id),
  reversal_action_id uuid REFERENCES moderation_actions(id)
);
CREATE INDEX moderation_actions_subject_idx ON moderation_actions (subject_user_id, created_at DESC);

-- Active restrictions applied to an account (enforced by guards in each module).
CREATE TABLE account_restrictions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('no_messaging','no_discovery','no_likes','no_media_upload','no_events','shadow_limited','review_required')),
  action_id   uuid REFERENCES moderation_actions(id),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  lifted_at   timestamptz
);
CREATE INDEX account_restrictions_active_idx ON account_restrictions (user_id) WHERE lifted_at IS NULL;

CREATE TABLE appeals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id   uuid NOT NULL REFERENCES moderation_actions(id),
  statement   text NOT NULL CHECK (char_length(statement) <= 3000),
  status      text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','in_review','upheld','overturned','partially_overturned')),
  reviewer_id uuid REFERENCES admin_users(id),
  decision_note text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  UNIQUE (action_id)
);

-- Automated safety signals (spam/scam/harassment/anomaly/fake/duplicate/AI-media). Internal only — never exposed.
CREATE TABLE safety_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  signal      text NOT NULL CHECK (signal IN ('spam','scam','harassment','behavior_anomaly','fake_profile','duplicate_account','ai_generated_media','underage_risk','off_platform_payment','sos','date_overdue','velocity')),
  source      text NOT NULL,            -- classifier key
  score       real NOT NULL,
  ref_type    text,
  ref_id      uuid,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  case_id     uuid REFERENCES moderation_cases(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX safety_events_user_idx ON safety_events (user_id, created_at DESC);

-- Rolling internal risk score per user (TECH §6 safety score). Never exposed to users.
CREATE TABLE user_risk_scores (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score       real NOT NULL CHECK (score BETWEEN 0 AND 1),
  components  jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- Admin-managed moderation rules: keyword lists, classifier thresholds, auto-actions, SLAs per severity.
CREATE TABLE moderation_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  rule_type   text NOT NULL CHECK (rule_type IN ('keyword','regex','classifier_threshold','velocity','auto_action','sla')),
  scope       text NOT NULL CHECK (scope IN ('message','profile_text','media','account','event','ai_output')),
  config      jsonb NOT NULL,
  locale      text,
  is_active   boolean NOT NULL DEFAULT true,
  version     int NOT NULL DEFAULT 1,
  updated_by  uuid REFERENCES admin_users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('moderation_rules');

-- Duplicate-account detection support: hashed device/phone fingerprints.
CREATE TABLE account_fingerprints (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('device','phone','email_normalized','photo_phash','payment')),
  value_hash  bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, value_hash)
);
CREATE INDEX account_fingerprints_lookup_idx ON account_fingerprints (kind, value_hash);
