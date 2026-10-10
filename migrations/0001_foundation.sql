-- 0001 Foundation: extensions, shared helpers, outbox, audit, analytics.
-- TECH §4 (audit_logs), §5 async (outbox), §19 analytics events, DEC-018, DEC-020.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- pgvector is optional in dev (DEC-020). Record availability so later migrations can branch.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Attach the updated_at trigger to a table in one line.
CREATE OR REPLACE FUNCTION add_updated_at_trigger(tbl regclass) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                 replace(tbl::text, '.', '_'), tbl);
END $$;

-- Transactional outbox: domain events written in the same transaction as the state change.
CREATE TABLE outbox_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic         text        NOT NULL,
  aggregate_id  uuid,
  payload       jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  available_at  timestamptz NOT NULL DEFAULT now(),
  attempts      int         NOT NULL DEFAULT 0,
  last_error    text,
  dispatched_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox_events (available_at) WHERE dispatched_at IS NULL;

-- Audit log for admin and security-relevant actions. Append-only (enforced by trigger).
CREATE TABLE audit_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type    text        NOT NULL CHECK (actor_type IN ('user','admin','system')),
  actor_id      uuid,
  action        text        NOT NULL,           -- e.g. 'auth.login', 'admin.users.ban', 'questions.publish'
  target_type   text,
  target_id     text,
  before_state  jsonb,
  after_state   jsonb,
  reason        text,
  ip            inet,
  user_agent    text,
  request_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_actor_idx  ON audit_logs (actor_type, actor_id, created_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Product analytics events (TECH §19). Partitioned by month; partitions created by the maintenance job.
CREATE TABLE analytics_events (
  id           bigint GENERATED ALWAYS AS IDENTITY,
  name         text        NOT NULL,
  user_id      uuid,
  session_id   uuid,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  platform     text CHECK (platform IN ('ios','android','web','admin','server')),
  app_version  text,
  country_code char(2),
  properties   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE TABLE analytics_events_default PARTITION OF analytics_events DEFAULT;
CREATE INDEX analytics_events_name_time_idx ON analytics_events (name, occurred_at);
CREATE INDEX analytics_events_user_idx      ON analytics_events (user_id, occurred_at);

-- Daily aggregates feeding the admin KPI dashboard (BRD §21).
CREATE TABLE analytics_daily_metrics (
  metric_date  date    NOT NULL,
  metric       text    NOT NULL,
  dimension    text    NOT NULL DEFAULT 'all',   -- e.g. 'country:IN', 'platform:ios'
  value        numeric NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, metric, dimension)
);

-- Idempotency keys for unsafe client retries (payments, likes, message send).
CREATE TABLE idempotency_keys (
  key           text        NOT NULL,
  scope         text        NOT NULL,
  request_hash  text        NOT NULL,
  response_code int,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
