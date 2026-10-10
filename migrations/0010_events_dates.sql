-- 0010 Events and date planner / date safety.
-- BRD §13, §14, §15 (date safety mode, trusted contact, emergency escalation), §16 (post-date feedback);
-- TECH §4 (events, event_attendees, date_plans, date_feedback); DEC-016, DEC-017.

CREATE TABLE events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_type       text NOT NULL CHECK (organizer_type IN ('platform','user','partner')),
  organizer_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  organizer_admin_id   uuid REFERENCES admin_users(id),
  category_term_id     uuid NOT NULL REFERENCES taxonomy_terms(id),   -- kind='event_category'
  title                text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description          text NOT NULL CHECK (char_length(description) <= 5000),
  cover_media_key      text,
  city_id              uuid NOT NULL REFERENCES cities(id),
  venue_name           text,
  venue_address        text,               -- revealed to confirmed attendees only
  latitude             double precision,
  longitude            double precision,
  geohash5             text,
  is_online            boolean NOT NULL DEFAULT false,
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  timezone             text NOT NULL,
  capacity             int CHECK (capacity > 0),
  min_age              smallint,
  max_age              smallint,
  price_minor          bigint NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency             char(3),
  visibility           text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','premium_only')),
  pre_event_matching   boolean NOT NULL DEFAULT false,
  chat_enabled         boolean NOT NULL DEFAULT true,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','published','cancelled','completed','rejected')),
  moderation_note      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (price_minor = 0 OR currency IS NOT NULL)
);
SELECT add_updated_at_trigger('events');
CREATE INDEX events_discovery_idx ON events (city_id, starts_at) WHERE status = 'published';
CREATE INDEX events_geo_idx ON events (geohash5, starts_at) WHERE status = 'published';

CREATE TABLE event_interests (
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  interest_id uuid NOT NULL REFERENCES interests(id),
  PRIMARY KEY (event_id, interest_id)
);

ALTER TABLE conversations ADD CONSTRAINT conversations_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX conversations_event_uq ON conversations (event_id) WHERE kind = 'event';

CREATE TABLE event_attendees (
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('interested','registered','waitlisted','cancelled','checked_in','no_show','removed')),
  payment_id      uuid,           -- FK added in 0011
  check_in_code_hash bytea,
  registered_at   timestamptz NOT NULL DEFAULT now(),
  checked_in_at   timestamptz,
  open_to_meet    boolean NOT NULL DEFAULT true,   -- appears in attendee discovery
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_attendees_user_idx ON event_attendees (user_id, registered_at DESC);

CREATE TABLE event_feedback (
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  met_someone   boolean,
  felt_safe     boolean,
  would_attend_again boolean,
  comment       text CHECK (char_length(comment) <= 2000),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE trusted_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (char_length(name) <= 80),
  phone_e164_enc  bytea,           -- encrypted at application level
  email_enc       bytea,
  relationship    text,
  consent_confirmed_at timestamptz, -- contact confirmed they agree to receive safety alerts
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CHECK (phone_e164_enc IS NOT NULL OR email_enc IS NOT NULL)
);
CREATE INDEX trusted_contacts_user_idx ON trusted_contacts (user_id) WHERE deleted_at IS NULL;

CREATE TABLE date_plans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id            uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  proposed_by         uuid NOT NULL REFERENCES users(id),
  status              text NOT NULL DEFAULT 'proposed' CHECK (status IN ('draft','proposed','accepted','declined','rescheduled','cancelled','completed')),
  date_stage_term_id  uuid REFERENCES taxonomy_terms(id),  -- first date, second date ...
  activity_type       text NOT NULL,
  title               text NOT NULL CHECK (char_length(title) <= 120),
  notes               text CHECK (char_length(notes) <= 1000),
  venue_name          text,
  venue_address       text,
  venue_provider      text,
  venue_place_id      text,
  city_id             uuid REFERENCES cities(id),
  latitude            double precision,   -- visible to the two participants only
  longitude           double precision,
  starts_at           timestamptz NOT NULL,
  expected_duration_min int NOT NULL DEFAULT 90 CHECK (expected_duration_min BETWEEN 15 AND 1440),
  budget_term_id      uuid REFERENCES taxonomy_terms(id),
  ai_generated        boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('date_plans');
CREATE INDEX date_plans_match_idx ON date_plans (match_id, starts_at DESC);
CREATE INDEX date_plans_upcoming_idx ON date_plans (starts_at) WHERE status = 'accepted';

CREATE TABLE date_plan_participants (
  date_plan_id    uuid NOT NULL REFERENCES date_plans(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response        text NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','accepted','declined','proposed_change')),
  responded_at    timestamptz,
  calendar_event_ref text,       -- external calendar id when the user authorized calendar sync
  reminder_minutes_before int[] NOT NULL DEFAULT '{60}',
  PRIMARY KEY (date_plan_id, user_id)
);

-- Date safety session: share date details with a trusted contact, check-in/out, escalate if overdue.
CREATE TABLE date_safety_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_plan_id        uuid REFERENCES date_plans(id) ON DELETE SET NULL,
  trusted_contact_id  uuid REFERENCES trusted_contacts(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','active','checked_in','checked_out','overdue','escalated','sos','ended','cancelled')),
  share_details       boolean NOT NULL DEFAULT true,
  share_live_location boolean NOT NULL DEFAULT false,   -- trusted contact only, never the date
  share_token_hash    bytea UNIQUE,                     -- trusted-contact view link
  starts_at           timestamptz NOT NULL,
  check_in_due_at     timestamptz NOT NULL,
  grace_minutes       int NOT NULL DEFAULT 15,
  checked_in_at       timestamptz,
  checked_out_at      timestamptz,
  overdue_at          timestamptz,
  escalated_at        timestamptz,
  sos_at              timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX date_safety_due_idx ON date_safety_sessions (check_in_due_at) WHERE status IN ('scheduled','active','checked_in');

CREATE TABLE date_safety_locations (
  session_id  uuid NOT NULL REFERENCES date_safety_sessions(id) ON DELETE CASCADE,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  accuracy_m  real,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, captured_at)
);

-- Private post-date feedback (BRD §16; DEC-017 — never shown to the other person, no public ratings).
CREATE TABLE date_feedback (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_plan_id     uuid REFERENCES date_plans(id) ON DELETE SET NULL,
  match_id         uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  author_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  about_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_happened    boolean NOT NULL,
  overall          smallint CHECK (overall BETWEEN 1 AND 5),
  felt_safe        boolean,
  matched_profile  boolean,      -- looked like their photos
  want_second_date text CHECK (want_second_date IN ('yes','maybe','no')),
  tags             text[] NOT NULL DEFAULT '{}',
  private_note     text CHECK (char_length(private_note) <= 2000),
  raise_safety_concern boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (match_id, author_id, date_plan_id)
);

-- Admin-managed date idea catalog (feeds AI date planner as grounding).
CREATE TABLE date_ideas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE,
  activity_type   text NOT NULL,
  budget_term_id  uuid REFERENCES taxonomy_terms(id),
  date_stage_term_ids uuid[] NOT NULL DEFAULT '{}',
  interest_ids    uuid[] NOT NULL DEFAULT '{}',
  indoor          boolean,
  time_of_day     text[] NOT NULL DEFAULT '{}',
  typical_duration_min int,
  safety_tips_key text,
  is_active       boolean NOT NULL DEFAULT true
);
CREATE TABLE date_idea_translations (
  idea_id     uuid NOT NULL REFERENCES date_ideas(id) ON DELETE CASCADE,
  locale      text NOT NULL REFERENCES languages(code),
  title       text NOT NULL,
  description text NOT NULL,
  PRIMARY KEY (idea_id, locale)
);
