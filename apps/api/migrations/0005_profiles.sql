-- 0005 Profiles, media, prompts, interests, preferences, privacy, location, onboarding, travel.
-- BRD §6 (onboarding + save/resume), §7 (profile), §8 (nearby, crossed paths, travel mode),
-- TECH §4 (user_profiles, profile_media, profile_prompts, user_preferences, interests, user_interests), §16 (location privacy).

CREATE TABLE user_profiles (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name         text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  bio                  text CHECK (char_length(bio) <= 1000),
  gender_id            uuid REFERENCES taxonomy_terms(id),
  orientation_id       uuid REFERENCES taxonomy_terms(id),
  dating_intent_id     uuid REFERENCES taxonomy_terms(id),
  relationship_goal_id uuid REFERENCES taxonomy_terms(id),
  relationship_status_id uuid REFERENCES taxonomy_terms(id),
  profession           text CHECK (char_length(profession) <= 100),
  employer             text CHECK (char_length(employer) <= 100),
  education_level_id   uuid REFERENCES taxonomy_terms(id),
  school               text CHECK (char_length(school) <= 120),
  height_cm            smallint CHECK (height_cm BETWEEN 90 AND 250),
  city_id              uuid REFERENCES cities(id),
  -- Coarse public location derived from user_locations; never exact (DEC-008).
  geohash5             text,
  home_country_code    char(2) REFERENCES countries(code),
  verification_level   text NOT NULL DEFAULT 'none' CHECK (verification_level IN ('none','phone','email','selfie','identity')),
  completeness_score   smallint NOT NULL DEFAULT 0 CHECK (completeness_score BETWEEN 0 AND 100),
  is_discoverable      boolean NOT NULL DEFAULT false,  -- true once onboarding + photo requirement met and not hidden
  incognito            boolean NOT NULL DEFAULT false,  -- premium: only visible to people you liked
  snoozed_until        timestamptz,
  moderation_status    text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','needs_changes','rejected')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('user_profiles');
CREATE INDEX user_profiles_discoverable_idx ON user_profiles (geohash5) WHERE is_discoverable AND NOT incognito;
CREATE INDEX user_profiles_city_idx ON user_profiles (city_id) WHERE is_discoverable;

-- Lifestyle & values attributes (single- or multi-valued) referencing the taxonomy (BRD §7).
CREATE TABLE user_profile_attributes (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term_id   uuid NOT NULL REFERENCES taxonomy_terms(id),
  kind      text NOT NULL,   -- denormalized from taxonomy_terms.kind for indexing/filters
  PRIMARY KEY (user_id, term_id)
);
CREATE INDEX user_profile_attributes_kind_idx ON user_profile_attributes (kind, term_id);

CREATE TABLE user_languages (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language_code text NOT NULL REFERENCES languages(code),
  proficiency   text NOT NULL DEFAULT 'fluent' CHECK (proficiency IN ('native','fluent','conversational','learning')),
  PRIMARY KEY (user_id, language_code)
);

CREATE TABLE user_interests (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_id uuid NOT NULL REFERENCES interests(id),
  position    smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, interest_id)
);
CREATE INDEX user_interests_interest_idx ON user_interests (interest_id);

-- Media: photos, short videos, voice intro. Storage keys only; access via signed URLs (TECH §15).
CREATE TABLE profile_media (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('photo','video','voice')),
  storage_key      text NOT NULL UNIQUE,
  mime_type        text NOT NULL,
  byte_size        bigint NOT NULL CHECK (byte_size > 0),
  width            int,
  height           int,
  duration_ms      int,
  position         smallint NOT NULL DEFAULT 0,
  blurhash         text,
  variants         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"thumb": key, "medium": key, "transcoded": key}
  processing_status text NOT NULL DEFAULT 'uploading' CHECK (processing_status IN ('uploading','processing','ready','failed')),
  moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected','needs_review')),
  moderation_labels jsonb,
  ai_generated_score real,   -- deceptive/AI media detection (BRD §15); internal only
  perceptual_hash  bytea,    -- duplicate / stolen-photo detection
  caption          text CHECK (char_length(caption) <= 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
SELECT add_updated_at_trigger('profile_media');
CREATE INDEX profile_media_user_idx ON profile_media (user_id, kind, position) WHERE deleted_at IS NULL;
CREATE INDEX profile_media_moderation_idx ON profile_media (moderation_status, created_at) WHERE deleted_at IS NULL;
CREATE INDEX profile_media_phash_idx ON profile_media (perceptual_hash) WHERE perceptual_hash IS NOT NULL;

-- Admin-managed profile prompts ("My ideal Sunday is…").
CREATE TABLE prompt_catalog (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL UNIQUE,
  category   text NOT NULL DEFAULT 'general',
  is_active  boolean NOT NULL DEFAULT true,
  position   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE prompt_catalog_translations (
  prompt_id uuid NOT NULL REFERENCES prompt_catalog(id) ON DELETE CASCADE,
  locale    text NOT NULL REFERENCES languages(code),
  text      text NOT NULL,
  PRIMARY KEY (prompt_id, locale)
);
CREATE TABLE profile_prompts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_id  uuid NOT NULL REFERENCES prompt_catalog(id),
  answer     text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 300),
  position   smallint NOT NULL DEFAULT 0,
  moderation_status text NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, prompt_id)
);
SELECT add_updated_at_trigger('profile_prompts');

-- Discovery preferences (BRD §6 "discovery preferences").
CREATE TABLE user_preferences (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_min            smallint NOT NULL DEFAULT 18 CHECK (age_min >= 18),
  age_max            smallint NOT NULL DEFAULT 99 CHECK (age_max <= 120),
  max_distance_km    int      NOT NULL DEFAULT 50 CHECK (max_distance_km BETWEEN 1 AND 20000),
  distance_strict    boolean  NOT NULL DEFAULT false,
  age_strict         boolean  NOT NULL DEFAULT true,
  height_min_cm      smallint,
  height_max_cm      smallint,
  global_mode        boolean  NOT NULL DEFAULT false,
  verified_only      boolean  NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (age_min <= age_max)
);
SELECT add_updated_at_trigger('user_preferences');

-- Multi-valued preference sets: which genders / intents / attributes the user wants to see.
CREATE TABLE user_preference_terms (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  term_id   uuid NOT NULL REFERENCES taxonomy_terms(id),
  kind      text NOT NULL,
  is_dealbreaker boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, term_id)
);
CREATE INDEX user_preference_terms_kind_idx ON user_preference_terms (kind, term_id);

-- Field-level privacy controls (BRD §7 "privacy controls", DEC-007).
CREATE TABLE user_privacy_settings (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  show_age             boolean NOT NULL DEFAULT true,
  show_distance        boolean NOT NULL DEFAULT true,
  show_city            boolean NOT NULL DEFAULT true,
  show_online_status   boolean NOT NULL DEFAULT true,
  show_read_receipts   boolean NOT NULL DEFAULT true,
  show_orientation     boolean NOT NULL DEFAULT false,
  show_religion        boolean NOT NULL DEFAULT true,
  show_verification    boolean NOT NULL DEFAULT true,
  allow_ai_profile_analysis boolean NOT NULL DEFAULT false,
  allow_ai_message_analysis boolean NOT NULL DEFAULT false,
  allow_translation    boolean NOT NULL DEFAULT true,
  discoverable_by      text NOT NULL DEFAULT 'everyone' CHECK (discoverable_by IN ('everyone','liked_only','nobody')),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('user_privacy_settings');

-- Exact location: restricted table, never returned to other users (TECH §16).
CREATE TABLE user_locations (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  latitude     double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude    double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m   real,
  geohash7     text NOT NULL,
  source       text NOT NULL CHECK (source IN ('gps','network','manual_city','ip')),
  captured_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_locations_geohash_idx ON user_locations (geohash7 text_pattern_ops);

-- Travel mode (BRD §8): discover users in a destination before/during a trip.
CREATE TABLE travel_plans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id      uuid NOT NULL REFERENCES cities(id),
  starts_on    date NOT NULL,
  ends_on      date NOT NULL,
  visible_to_locals boolean NOT NULL DEFAULT true,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX travel_plans_city_dates_idx ON travel_plans (city_id, starts_on, ends_on) WHERE is_active;

-- Crossed paths (DEC-009): coarse cell + hour bucket only, short retention.
CREATE TABLE crossed_path_sightings (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  geohash6    text NOT NULL,
  hour_bucket timestamptz NOT NULL,
  PRIMARY KEY (user_id, geohash6, hour_bucket)
);
CREATE INDEX crossed_path_cell_idx ON crossed_path_sightings (geohash6, hour_bucket);

-- Onboarding save/resume (BRD §6).
CREATE TABLE onboarding_progress (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  flow_version   int  NOT NULL,
  current_step   text NOT NULL,
  completed_steps text[] NOT NULL DEFAULT '{}',
  draft          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- unsaved form state for the current step only
  started_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz
);
SELECT add_updated_at_trigger('onboarding_progress');

-- Admin-defined onboarding flow (steps are data, not code).
CREATE TABLE onboarding_flows (
  version      int PRIMARY KEY,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  steps        jsonb NOT NULL,   -- ordered [{key, required, condition}] validated by shared schema
  published_at timestamptz,
  published_by uuid REFERENCES admin_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Profile views (BRD §21 analytics, "who viewed me" premium surface).
CREATE TABLE profile_views (
  viewer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surface    text NOT NULL,
  viewed_on  date NOT NULL DEFAULT current_date,
  view_count int  NOT NULL DEFAULT 1,
  last_viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_id, viewed_id, viewed_on)
);
CREATE INDEX profile_views_viewed_idx ON profile_views (viewed_id, last_viewed_at DESC);
