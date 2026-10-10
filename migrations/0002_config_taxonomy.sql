-- 0002 Admin-managed configuration and taxonomy.
-- BRD §19 (country/city/language config, interest & lifestyle taxonomy, dating-intent management,
-- feature flags, A/B experiments, system settings), TECH §4 (feature_flags, experiments), DEC-006.

CREATE TABLE languages (
  code        text PRIMARY KEY,                 -- BCP-47, e.g. 'en', 'ar', 'pt-BR'
  name        text NOT NULL,
  native_name text NOT NULL,
  is_rtl      boolean NOT NULL DEFAULT false,
  is_app_locale boolean NOT NULL DEFAULT false, -- app UI translated into this language
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE countries (
  code             char(2) PRIMARY KEY,         -- ISO 3166-1 alpha-2
  name             text    NOT NULL,
  default_locale   text    REFERENCES languages(code),
  default_currency char(3) NOT NULL,
  measurement      text    NOT NULL DEFAULT 'metric' CHECK (measurement IN ('metric','imperial')),
  is_active        boolean NOT NULL DEFAULT false
);

-- Per-country compliance & product configuration (DEC-006, DEC-009, DEC-016).
CREATE TABLE country_configs (
  country_code          char(2) PRIMARY KEY REFERENCES countries(code) ON DELETE CASCADE,
  min_age               smallint NOT NULL DEFAULT 18 CHECK (min_age >= 18),
  emergency_number      text,
  crossed_paths_allowed boolean NOT NULL DEFAULT false,
  identity_verification_available boolean NOT NULL DEFAULT false,
  religion_field_enabled boolean NOT NULL DEFAULT true,
  data_region           text NOT NULL DEFAULT 'global',  -- regional privacy/residency (TECH §16)
  privacy_regime        text,                             -- 'GDPR', 'DPDP', 'CCPA', ...
  data_retention_days   int  NOT NULL DEFAULT 730,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid
);

CREATE TABLE cities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code char(2) NOT NULL REFERENCES countries(code),
  name         text    NOT NULL,
  admin_region text,
  latitude     double precision NOT NULL,
  longitude    double precision NOT NULL,
  geohash5     text    NOT NULL,
  timezone     text    NOT NULL,
  population   int,
  is_active    boolean NOT NULL DEFAULT true
);
CREATE INDEX cities_country_name_idx ON cities (country_code, name);
CREATE INDEX cities_name_trgm_idx ON cities USING gin (name gin_trgm_ops);
CREATE INDEX cities_geohash_idx ON cities (geohash5);

-- Generic admin-managed taxonomy: genders, orientations, dating intents, relationship goals,
-- lifestyle attributes (drinking, smoking, diet, exercise, pets, children, religion, education level ...).
-- One table + translations instead of a dozen look-alike tables; `kind` enforces the domain.
CREATE TABLE taxonomy_terms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN (
                'gender','orientation','dating_intent','relationship_goal','relationship_status',
                'lifestyle_drinking','lifestyle_smoking','lifestyle_cannabis','lifestyle_exercise','lifestyle_diet',
                'lifestyle_sleep','lifestyle_social','pets','children_have','children_want','family_plans',
                'religion','religion_importance','politics','education_level','communication_style',
                'love_language','travel_style','zodiac','event_category','report_reason','date_stage','budget_tier')),
  key         text NOT NULL,              -- stable machine key, e.g. 'long_term'
  parent_id   uuid REFERENCES taxonomy_terms(id),
  position    int  NOT NULL DEFAULT 0,
  is_sensitive boolean NOT NULL DEFAULT false,   -- DEC-007
  is_active   boolean NOT NULL DEFAULT true,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. intent group for intent-compatibility matrix
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key)
);
SELECT add_updated_at_trigger('taxonomy_terms');

CREATE TABLE taxonomy_term_translations (
  term_id     uuid NOT NULL REFERENCES taxonomy_terms(id) ON DELETE CASCADE,
  locale      text NOT NULL REFERENCES languages(code),
  label       text NOT NULL,
  description text,
  PRIMARY KEY (term_id, locale)
);

CREATE TABLE interest_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL UNIQUE,
  icon       text,
  position   int  NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true
);
CREATE TABLE interest_category_translations (
  category_id uuid NOT NULL REFERENCES interest_categories(id) ON DELETE CASCADE,
  locale      text NOT NULL REFERENCES languages(code),
  label       text NOT NULL,
  PRIMARY KEY (category_id, locale)
);
CREATE TABLE interests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES interest_categories(id),
  key         text NOT NULL UNIQUE,
  icon        text,
  position    int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE interest_translations (
  interest_id uuid NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
  locale      text NOT NULL REFERENCES languages(code),
  label       text NOT NULL,
  PRIMARY KEY (interest_id, locale)
);

-- Key/value system settings with typed values and audit (BRD §19 "System settings").
CREATE TABLE system_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  value_type  text  NOT NULL CHECK (value_type IN ('string','number','boolean','json','duration')),
  description text,
  is_secret   boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- Feature flags with global / country / percentage / segment targeting (prompt §27).
CREATE TABLE feature_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,         -- e.g. 'travel_mode', 'video_calls', 'matching.v2'
  description text,
  enabled     boolean NOT NULL DEFAULT false,  -- global kill switch
  default_value boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);
SELECT add_updated_at_trigger('feature_flags');

CREATE TABLE feature_flag_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_id      uuid NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  priority     int  NOT NULL,
  rule_type    text NOT NULL CHECK (rule_type IN ('country','percentage','segment','user','platform','app_version')),
  country_codes char(2)[],
  percentage   smallint CHECK (percentage BETWEEN 0 AND 100),
  segment_key  text,
  user_ids     uuid[],
  platforms    text[],
  min_app_version text,
  value        boolean NOT NULL,
  UNIQUE (flag_id, priority)
);

-- User segments used by flags, experiments and question targeting.
CREATE TABLE user_segments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  description text,
  definition  jsonb NOT NULL,     -- validated predicate tree (see shared/segments.ts)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('user_segments');

-- A/B experiments (BRD §19, prompt §28).
CREATE TABLE experiments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,
  surface      text NOT NULL CHECK (surface IN ('matching','profile_layout','onboarding','questionnaire','paywall','discovery','ai','notifications','other')),
  hypothesis   text,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','completed','archived')),
  segment_id   uuid REFERENCES user_segments(id),
  traffic_pct  smallint NOT NULL DEFAULT 100 CHECK (traffic_pct BETWEEN 0 AND 100),
  primary_metric text NOT NULL,
  started_at   timestamptz,
  ended_at     timestamptz,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('experiments');

CREATE TABLE experiment_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  key           text NOT NULL,
  allocation    smallint NOT NULL CHECK (allocation BETWEEN 0 AND 100),
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- e.g. {"matching_config_version_id": "..."}
  is_control    boolean NOT NULL DEFAULT false,
  UNIQUE (experiment_id, key)
);

CREATE TABLE experiment_assignments (
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  variant_id    uuid NOT NULL REFERENCES experiment_variants(id),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id, user_id)
);
