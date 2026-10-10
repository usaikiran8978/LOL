-- 0007 Matching configuration, candidates, swipes, matches, journey.
-- BRD §8–9, §16; TECH §4 (matching_weights, match_candidates, matches, likes, passes, super_likes), §6–7; DEC-012, DEC-013.

-- Versioned matching configuration: everything the admin tunes. Exactly one published at a time
-- (experiments may route users to other versions through experiment_variants.config).
CREATE TABLE matching_config_versions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version                   int  NOT NULL UNIQUE,
  status                    text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  min_compatibility         numeric(5,2) NOT NULL DEFAULT 0 CHECK (min_compatibility BETWEEN 0 AND 100),
  candidate_pool_limit      int  NOT NULL DEFAULT 2000 CHECK (candidate_pool_limit > 0),
  recommendation_batch_size int  NOT NULL DEFAULT 50 CHECK (recommendation_batch_size > 0),
  daily_curated_count       int  NOT NULL DEFAULT 10 CHECK (daily_curated_count >= 0),
  behavioral_weight         numeric(5,4) NOT NULL DEFAULT 0 CHECK (behavioral_weight BETWEEN 0 AND 1),  -- blend of behavior score into final rank
  diversity_max_share       numeric(5,4) NOT NULL DEFAULT 1 CHECK (diversity_max_share BETWEEN 0 AND 1), -- max share of a batch from one segment bucket
  diversity_dimensions      text[] NOT NULL DEFAULT '{}',   -- e.g. {'age_band','intent','city'}
  repeat_suppression_days   int  NOT NULL DEFAULT 30,
  safety_exclude_threshold  numeric(5,4) NOT NULL DEFAULT 1 CHECK (safety_exclude_threshold BETWEEN 0 AND 1),
  safety_downrank_threshold numeric(5,4) NOT NULL DEFAULT 1 CHECK (safety_downrank_threshold BETWEEN 0 AND 1),
  safety_downrank_factor    numeric(5,4) NOT NULL DEFAULT 1 CHECK (safety_downrank_factor BETWEEN 0 AND 1),
  missing_answer_policy     text NOT NULL DEFAULT 'neutral' CHECK (missing_answer_policy IN ('neutral','penalize','ignore')),
  notes                     text,
  created_by                uuid REFERENCES admin_users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  published_at              timestamptz,
  published_by              uuid REFERENCES admin_users(id)
);
CREATE UNIQUE INDEX matching_config_one_published ON matching_config_versions ((true)) WHERE status = 'published';

-- Category weights (TECH §7 — configurable, never hard-coded). Validated to sum to 1 at publish.
CREATE TABLE matching_weights (
  config_version_id         uuid NOT NULL REFERENCES matching_config_versions(id) ON DELETE CASCADE,
  compatibility_category_id uuid NOT NULL REFERENCES compatibility_categories(id),
  weight                    numeric(6,5) NOT NULL CHECK (weight BETWEEN 0 AND 1),
  PRIMARY KEY (config_version_id, compatibility_category_id)
);

-- Ranking rules: boosts / penalties / exclusions on top of compatibility (BRD §9 human/admin override).
CREATE TABLE ranking_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_version_id uuid NOT NULL REFERENCES matching_config_versions(id) ON DELETE CASCADE,
  key               text NOT NULL,
  rule_type         text NOT NULL CHECK (rule_type IN ('boost','penalty','exclude')),
  condition         jsonb NOT NULL,     -- predicate over candidate features, validated by shared schema
  value             numeric(6,4) NOT NULL DEFAULT 0,
  priority          int NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  UNIQUE (config_version_id, key)
);

-- Intent compatibility matrix (e.g. 'long_term' x 'casual' = 0.2). Admin-managed per config version.
CREATE TABLE intent_compatibility (
  config_version_id uuid NOT NULL REFERENCES matching_config_versions(id) ON DELETE CASCADE,
  intent_a_id       uuid NOT NULL REFERENCES taxonomy_terms(id),
  intent_b_id       uuid NOT NULL REFERENCES taxonomy_terms(id),
  score             numeric(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  is_hard_exclusion boolean NOT NULL DEFAULT false,
  PRIMARY KEY (config_version_id, intent_a_id, intent_b_id)
);

-- User-level deal-breaker selections (attribute- or question-based).
CREATE TABLE user_deal_breakers (
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deal_breaker_id uuid NOT NULL REFERENCES deal_breakers(id),
  accepted_term_ids uuid[],      -- for attribute deal-breakers
  accepted_option_keys text[],   -- for question deal-breakers
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, deal_breaker_id)
);

-- Precomputed recommendations with explainability (TECH §6 "store top contributing factors").
CREATE TABLE match_candidates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config_version_id  uuid NOT NULL REFERENCES matching_config_versions(id),
  experiment_variant_id uuid REFERENCES experiment_variants(id),
  surface            text NOT NULL CHECK (surface IN ('swipe','smart','daily','nearby','travel','event','interest','intent','crossed_paths','search')),
  compatibility      numeric(5,2) NOT NULL,        -- 0..100 shown to user
  confidence         numeric(4,3) NOT NULL,        -- 0..1, based on answer overlap/coverage
  final_score        numeric(10,6) NOT NULL,       -- internal ranking score (never exposed)
  factor_scores      jsonb NOT NULL,               -- {"values": 93.1, "personality": 91.0, ...}
  top_factors        jsonb NOT NULL,               -- [{category, reasonKey, params}] for explanation
  differences        jsonb NOT NULL DEFAULT '[]'::jsonb,
  rank               int NOT NULL,
  batch_id           uuid NOT NULL,
  computed_at        timestamptz NOT NULL DEFAULT now(),
  served_at          timestamptz,
  acted_at           timestamptz,
  expires_at         timestamptz NOT NULL
);
CREATE INDEX match_candidates_feed_idx ON match_candidates (user_id, surface, rank) WHERE acted_at IS NULL;
CREATE UNIQUE INDEX match_candidates_batch_uq ON match_candidates (user_id, surface, batch_id, candidate_id);
CREATE INDEX match_candidates_expiry_idx ON match_candidates (expires_at);

-- Swipe actions: like / pass / super_like with rewind (DEC-013).
CREATE TABLE swipe_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action        text NOT NULL CHECK (action IN ('like','pass','super_like')),
  surface       text NOT NULL,
  candidate_id  uuid REFERENCES match_candidates(id) ON DELETE SET NULL,
  comment       text CHECK (char_length(comment) <= 300),   -- optional note on a like
  liked_item    jsonb,      -- which photo/prompt was liked {type, id}
  created_at    timestamptz NOT NULL DEFAULT now(),
  rewound_at    timestamptz,
  CHECK (actor_id <> target_id)
);
CREATE UNIQUE INDEX swipe_actions_active_uq ON swipe_actions (actor_id, target_id) WHERE rewound_at IS NULL;
CREATE INDEX swipe_actions_target_likes_idx ON swipe_actions (target_id, created_at DESC) WHERE action IN ('like','super_like') AND rewound_at IS NULL;
CREATE INDEX swipe_actions_actor_time_idx ON swipe_actions (actor_id, created_at DESC);

-- TECH §4 names likes / passes / super_likes; exposed as views over swipe_actions.
CREATE VIEW likes AS SELECT id, actor_id, target_id, surface, comment, created_at FROM swipe_actions WHERE action = 'like' AND rewound_at IS NULL;
CREATE VIEW passes AS SELECT id, actor_id, target_id, surface, created_at FROM swipe_actions WHERE action = 'pass' AND rewound_at IS NULL;
CREATE VIEW super_likes AS SELECT id, actor_id, target_id, surface, comment, created_at FROM swipe_actions WHERE action = 'super_like' AND rewound_at IS NULL;

CREATE TABLE matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','unmatched','blocked','closed_by_moderation')),
  surface       text NOT NULL,
  compatibility numeric(5,2),
  created_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  ended_by      uuid REFERENCES users(id),
  CHECK (user_low_id < user_high_id)
);
CREATE UNIQUE INDEX matches_pair_active_uq ON matches (user_low_id, user_high_id) WHERE status = 'active';
CREATE INDEX matches_low_idx  ON matches (user_low_id, created_at DESC);
CREATE INDEX matches_high_idx ON matches (user_high_id, created_at DESC);

-- Relationship journey (BRD §16): match → conversation → voice/video → first date → feedback → second date → relationship.
CREATE TABLE relationship_journeys (
  match_id            uuid PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  stage               text NOT NULL DEFAULT 'matched' CHECK (stage IN ('matched','conversation','voice_video','first_date','feedback','second_date','relationship','ended')),
  conversation_at     timestamptz,
  voice_video_at      timestamptz,
  first_date_at       timestamptz,
  first_feedback_at   timestamptz,
  second_date_at      timestamptz,
  relationship_at     timestamptz,
  ended_at            timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('relationship_journeys');

-- Optional couple space for established couples (BRD §16; Phase 2, flag 'couple_space').
CREATE TABLE couple_spaces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id      uuid NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','closed')),
  low_consented_at  timestamptz,
  high_consented_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);

-- Behavioral signals aggregated per user (TECH §6 behavior score). Recomputed by a job.
CREATE TABLE user_behavior_stats (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  likes_sent_30d         int NOT NULL DEFAULT 0,
  passes_sent_30d        int NOT NULL DEFAULT 0,
  likes_received_30d     int NOT NULL DEFAULT 0,
  matches_30d            int NOT NULL DEFAULT 0,
  conversations_started_30d int NOT NULL DEFAULT 0,
  reply_rate_30d         numeric(5,4),
  median_reply_minutes   int,
  dates_completed_90d    int NOT NULL DEFAULT 0,
  positive_feedback_rate numeric(5,4),
  recommendation_accept_rate numeric(5,4),
  last_active_at         timestamptz,
  computed_at            timestamptz NOT NULL DEFAULT now()
);

-- Learned per-user category affinities from outcomes (BRD §9 continuous learning; Phase 2 adaptive matching).
CREATE TABLE user_preference_signals (
  user_id                   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  compatibility_category_id uuid NOT NULL REFERENCES compatibility_categories(id),
  affinity                  numeric(6,5) NOT NULL,   -- multiplier around 1.0
  sample_size               int NOT NULL,
  computed_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, compatibility_category_id)
);

-- Explicit recommendation feedback ("not for me because…") — BRD §9 learning, TECH §19 recommendation_accepted/rejected.
CREATE TABLE recommendation_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_row_id uuid REFERENCES match_candidates(id) ON DELETE SET NULL,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outcome       text NOT NULL CHECK (outcome IN ('accepted','rejected','hidden')),
  reason_key    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recommendation_feedback_user_idx ON recommendation_feedback (user_id, created_at DESC);

-- Embeddings (DEC-020): vector column when pgvector exists, otherwise real[].
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE TABLE user_embeddings (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN (''profile'',''preferences'',''bio'')),
      model text NOT NULL,
      dims int NOT NULL,
      embedding vector NOT NULL,
      computed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, kind))';
  ELSE
    EXECUTE 'CREATE TABLE user_embeddings (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN (''profile'',''preferences'',''bio'')),
      model text NOT NULL,
      dims int NOT NULL,
      embedding real[] NOT NULL,
      computed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, kind))';
  END IF;
END $$;
