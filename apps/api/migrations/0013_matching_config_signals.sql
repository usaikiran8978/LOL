-- 0013 Data-driven category signal sources and importance multipliers (TECH §7 "do not hard-code").
-- Which profile signals feed each compatibility category is admin configuration, not code.

ALTER TABLE compatibility_categories
  ADD COLUMN attribute_kinds text[] NOT NULL DEFAULT '{}',   -- taxonomy kinds compared for this category (e.g. lifestyle_*)
  ADD COLUMN uses_intent     boolean NOT NULL DEFAULT false, -- dating intent / relationship goal compatibility
  ADD COLUMN uses_interests  boolean NOT NULL DEFAULT false, -- shared interests
  ADD COLUMN uses_location   boolean NOT NULL DEFAULT false, -- distance decay
  ADD COLUMN in_overall      boolean NOT NULL DEFAULT true;  -- false = ranking-only signal (e.g. behavioral)

ALTER TABLE matching_config_versions
  -- Multiplier per answer importance 0..3 ("irrelevant" .. "very important").
  ADD COLUMN importance_multipliers numeric(6,3)[] NOT NULL DEFAULT '{0,1,2,4}' CHECK (array_length(importance_multipliers, 1) = 4),
  ADD COLUMN default_importance smallint NOT NULL DEFAULT 1 CHECK (default_importance BETWEEN 0 AND 3),
  -- Score used for an intent pair missing from intent_compatibility.
  ADD COLUMN intent_default_score numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (intent_default_score BETWEEN 0 AND 1),
  -- Confidence below which the UI shows "low confidence" and ranking discounts the score.
  ADD COLUMN min_confidence numeric(4,3) NOT NULL DEFAULT 0 CHECK (min_confidence BETWEEN 0 AND 1),
  ADD COLUMN top_factor_count smallint NOT NULL DEFAULT 3 CHECK (top_factor_count BETWEEN 1 AND 10),
  ADD COLUMN difference_threshold numeric(4,3) NOT NULL DEFAULT 0.5 CHECK (difference_threshold BETWEEN 0 AND 1),
  ADD COLUMN recommendation_ttl_hours int NOT NULL DEFAULT 24 CHECK (recommendation_ttl_hours > 0);
