-- 0006 Questionnaire engine (admin-managed, versioned).
-- BRD §10, §20; TECH §4 (question_categories, questions, question_versions, question_options, question_answers,
-- compatibility_rules, deal_breakers), TECH §5 (versioning, answers pinned to version, rule schema, publish audit,
-- impact preview), DEC-010, DEC-011.

-- Compatibility categories (relationship intent, values, personality, lifestyle, interests, communication, location, behavioral ...).
-- Admin-managed; matching weights are attached per matching-config version (0007).
CREATE TABLE compatibility_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  source      text NOT NULL CHECK (source IN ('questionnaire','profile_attributes','interests','location','behavioral','mixed')),
  is_active   boolean NOT NULL DEFAULT true,
  position    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE compatibility_category_translations (
  category_id uuid NOT NULL REFERENCES compatibility_categories(id) ON DELETE CASCADE,
  locale      text NOT NULL REFERENCES languages(code),
  label       text NOT NULL,
  description text,
  PRIMARY KEY (category_id, locale)
);

CREATE TABLE question_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  compatibility_category_id uuid REFERENCES compatibility_categories(id),
  position    int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('question_categories');
CREATE TABLE question_category_translations (
  category_id uuid NOT NULL REFERENCES question_categories(id) ON DELETE CASCADE,
  locale      text NOT NULL REFERENCES languages(code),
  label       text NOT NULL,
  description text,
  PRIMARY KEY (category_id, locale)
);

-- Stable question identity. Everything that can change lives on question_versions.
CREATE TABLE questions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                  text NOT NULL UNIQUE,     -- e.g. 'wants_children'
  category_id          uuid NOT NULL REFERENCES question_categories(id),
  position             int  NOT NULL DEFAULT 0,  -- drag/order within category
  is_active            boolean NOT NULL DEFAULT false, -- activate/deactivate without unpublishing history
  published_version_id uuid,                     -- FK added below (circular)
  created_by           uuid REFERENCES admin_users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  archived_at          timestamptz
);
SELECT add_updated_at_trigger('questions');
CREATE INDEX questions_category_pos_idx ON questions (category_id, position) WHERE archived_at IS NULL;

CREATE TABLE question_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id        uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  version            int  NOT NULL,
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','scheduled','published','superseded','archived')),
  answer_type        text NOT NULL CHECK (answer_type IN
                     ('single_choice','multiple_choice','yes_no','scale','numeric_range','ranking','text','structured_preference')),
  is_required        boolean NOT NULL DEFAULT false,
  weight             numeric(6,3) NOT NULL DEFAULT 1 CHECK (weight >= 0),  -- weight within its compatibility category
  compatibility_category_id uuid REFERENCES compatibility_categories(id),  -- overrides category default
  is_scored          boolean NOT NULL DEFAULT true,   -- false for text / informational questions
  visibility         text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','matches_only','public_profile')),
  allow_importance   boolean NOT NULL DEFAULT true,   -- user can say how much the answer matters
  allow_dealbreaker  boolean NOT NULL DEFAULT false,  -- user may mark as deal-breaker
  allow_skip         boolean NOT NULL DEFAULT true,
  -- type-specific constraints (NULL when not applicable)
  min_selections     smallint,
  max_selections     smallint,
  scale_min          smallint,
  scale_max          smallint,
  scale_step         smallint,
  numeric_min        numeric,
  numeric_max        numeric,
  numeric_unit       text,
  text_max_length    smallint,
  -- targeting / applicability: predicate tree over user attributes (country, age band, intent, gender, segment ...)
  targeting          jsonb,
  answer_carry_over  text NOT NULL DEFAULT 'none' CHECK (answer_carry_over IN ('none','same_options','mapped')),
  effective_at       timestamptz,     -- scheduled publish
  change_note        text,
  created_by         uuid REFERENCES admin_users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  published_at       timestamptz,
  published_by       uuid REFERENCES admin_users(id),
  UNIQUE (question_id, version),
  CHECK (scale_min IS NULL OR scale_max > scale_min),
  CHECK (numeric_min IS NULL OR numeric_max IS NULL OR numeric_max >= numeric_min)
);
SELECT add_updated_at_trigger('question_versions');
-- At most one published version per question.
CREATE UNIQUE INDEX question_versions_one_published ON question_versions (question_id) WHERE status = 'published';
CREATE INDEX question_versions_scheduled_idx ON question_versions (effective_at) WHERE status = 'scheduled';

ALTER TABLE questions ADD CONSTRAINT questions_published_version_fk
  FOREIGN KEY (published_version_id) REFERENCES question_versions(id);

-- Published versions are immutable (TECH §5: never silently reinterpret historical answers).
CREATE OR REPLACE FUNCTION question_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('published','superseded','archived') THEN
    IF (to_jsonb(NEW) - ARRAY['status','updated_at','effective_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at','effective_at']) THEN
      RAISE EXCEPTION 'question_version % is % and immutable; create a new version', OLD.id, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER question_versions_immutable BEFORE UPDATE ON question_versions
  FOR EACH ROW EXECUTE FUNCTION question_versions_guard();

CREATE TABLE question_version_translations (
  version_id  uuid NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
  locale      text NOT NULL REFERENCES languages(code),
  text        text NOT NULL,
  help_text   text,
  scale_min_label text,
  scale_max_label text,
  PRIMARY KEY (version_id, locale)
);

CREATE TABLE question_options (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id    uuid NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
  key           text NOT NULL,
  position      smallint NOT NULL DEFAULT 0,
  numeric_value numeric,            -- ordinal value for distance-based scoring
  is_exclusive  boolean NOT NULL DEFAULT false,  -- e.g. "prefer not to say" clears others
  UNIQUE (version_id, key)
);
CREATE TABLE question_option_translations (
  option_id uuid NOT NULL REFERENCES question_options(id) ON DELETE CASCADE,
  locale    text NOT NULL REFERENCES languages(code),
  label     text NOT NULL,
  PRIMARY KEY (option_id, locale)
);

-- Explicit carry-over mapping between versions (DEC-011).
CREATE TABLE question_option_mappings (
  from_option_id uuid NOT NULL REFERENCES question_options(id) ON DELETE CASCADE,
  to_option_id   uuid NOT NULL REFERENCES question_options(id) ON DELETE CASCADE,
  PRIMARY KEY (from_option_id, to_option_id)
);

-- Conditional display: show this version only if another question's answer matches.
CREATE TABLE question_conditions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id            uuid NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
  group_no              smallint NOT NULL DEFAULT 0,   -- conditions in the same group AND; groups OR
  depends_on_question_id uuid NOT NULL REFERENCES questions(id),
  operator              text NOT NULL CHECK (operator IN ('answered','not_answered','includes_any','includes_all','excludes','eq','gte','lte','between')),
  option_keys           text[],
  number_a              numeric,
  number_b              numeric
);
CREATE INDEX question_conditions_version_idx ON question_conditions (version_id);

-- User answers: pinned to the exact version (TECH §5 answer schema).
CREATE TABLE question_answers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id         uuid NOT NULL REFERENCES questions(id),
  question_version_id uuid NOT NULL REFERENCES question_versions(id),
  value               jsonb,                  -- raw answer as submitted, shape validated per answer_type
  normalized_value    jsonb,                  -- canonical form used by the scorer (e.g. sorted option keys, 0..1 scale)
  importance          smallint CHECK (importance BETWEEN 0 AND 3),  -- 0 irrelevant .. 3 very important
  is_dealbreaker      boolean NOT NULL DEFAULT false,
  is_skipped          boolean NOT NULL DEFAULT false,
  carried_over_from   uuid REFERENCES question_answers(id),
  answered_at         timestamptz NOT NULL DEFAULT now(),
  superseded_at       timestamptz            -- set when the user re-answers or a new version replaces this one
);
CREATE UNIQUE INDEX question_answers_current_uq ON question_answers (user_id, question_id) WHERE superseded_at IS NULL;
CREATE INDEX question_answers_version_idx ON question_answers (question_version_id) WHERE superseded_at IS NULL;

-- Normalized selected options (enables SQL-side filtering & answer-distribution analytics).
CREATE TABLE question_answer_options (
  answer_id uuid NOT NULL REFERENCES question_answers(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES question_options(id),
  rank      smallint,      -- for ranking questions
  PRIMARY KEY (answer_id, option_id)
);
CREATE INDEX question_answer_options_option_idx ON question_answer_options (option_id);

-- Structured preference: which partner answers the user accepts.
CREATE TABLE question_answer_acceptable (
  answer_id uuid NOT NULL REFERENCES question_answers(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES question_options(id),
  PRIMARY KEY (answer_id, option_id)
);

-- Compatibility rules (TECH §5 rule schema). Bound to the source question version; the builder copies/re-points
-- rules when a new version is drafted. Target may be the same question (mirror) or another.
CREATE TABLE compatibility_rules (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_question_version_id uuid NOT NULL REFERENCES question_versions(id) ON DELETE CASCADE,
  source_option_id           uuid REFERENCES question_options(id) ON DELETE CASCADE,   -- NULL = any answer
  target_question_id         uuid NOT NULL REFERENCES questions(id),
  target_option_key          text,      -- resolved against target's published version (keys are stable across versions by convention + mapping)
  rule_type                  text NOT NULL CHECK (rule_type IN ('positive','negative','dealbreaker','similarity','distance')),
  score_delta                numeric(6,3) NOT NULL DEFAULT 0,
  is_exclusion               boolean NOT NULL DEFAULT false,
  is_bidirectional           boolean NOT NULL DEFAULT true,
  description                text,
  created_by                 uuid REFERENCES admin_users(id),
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX compatibility_rules_source_idx ON compatibility_rules (source_question_version_id);
CREATE INDEX compatibility_rules_target_idx ON compatibility_rules (target_question_id);

-- Platform-level deal-breaker definitions (BRD §19 "Deal-breakers/exclusions").
-- Defines which attributes/questions users may set as hard filters, and any always-on platform exclusions.
CREATE TABLE deal_breakers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL UNIQUE,
  subject_type   text NOT NULL CHECK (subject_type IN ('question','attribute','age','distance','intent','verification')),
  question_id    uuid REFERENCES questions(id),
  attribute_kind text,
  mode           text NOT NULL CHECK (mode IN ('user_optional','always_on')),
  requires_entitlement text,     -- e.g. 'advanced_filters'
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Questionnaire publish history + impact analysis snapshot (BRD §20 "impact analysis before publishing").
CREATE TABLE questionnaire_publish_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_version_id uuid NOT NULL REFERENCES question_versions(id),
  action             text NOT NULL CHECK (action IN ('publish','schedule','rollback','archive','activate','deactivate')),
  impact_summary     jsonb,   -- {usersAffected, reanswerRequired, avgScoreDelta, matchesBelowThreshold, ...}
  performed_by       uuid REFERENCES admin_users(id),
  performed_at       timestamptz NOT NULL DEFAULT now()
);
