-- 0011 Subscriptions, entitlements, payments, boosts, coupons.
-- BRD §18 + appendix tiers (Free, Premium, Boosts, AI Premium, Events), §19 (plans & entitlements, promotions/coupons);
-- TECH §4 (subscriptions, entitlements, payments), §17 (lifecycle, trials, refunds, webhooks, idempotency, regional pricing); DEC-014.

CREATE TABLE billing_products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,          -- 'premium', 'ai_premium', 'boost_1', 'super_like_5', 'event_ticket'
  kind        text NOT NULL CHECK (kind IN ('subscription','consumable','event_ticket')),
  tier        text CHECK (tier IN ('premium','ai_premium','premium_plus')),
  rank        int NOT NULL DEFAULT 0,        -- for upgrade/downgrade ordering
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
SELECT add_updated_at_trigger('billing_products');
CREATE TABLE billing_product_translations (
  product_id  uuid NOT NULL REFERENCES billing_products(id) ON DELETE CASCADE,
  locale      text NOT NULL REFERENCES languages(code),
  name        text NOT NULL,
  description text,
  PRIMARY KEY (product_id, locale)
);

-- Regional prices per provider (TECH §17 regional pricing).
CREATE TABLE billing_prices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES billing_products(id) ON DELETE CASCADE,
  provider          text NOT NULL CHECK (provider IN ('stripe','apple','google')),
  provider_price_id text NOT NULL,
  currency          char(3) NOT NULL,
  amount_minor      bigint NOT NULL CHECK (amount_minor >= 0),
  billing_interval  text CHECK (billing_interval IN ('week','month','year')),
  interval_count    smallint DEFAULT 1,
  trial_days        smallint NOT NULL DEFAULT 0,
  quantity          int NOT NULL DEFAULT 1,       -- consumables: e.g. 5 super likes
  country_codes     char(2)[],                    -- NULL = all
  is_active         boolean NOT NULL DEFAULT true,
  UNIQUE (provider, provider_price_id)
);

-- What each product grants (entitlement catalog).
CREATE TABLE plan_entitlements (
  product_id      uuid NOT NULL REFERENCES billing_products(id) ON DELETE CASCADE,
  entitlement_key text NOT NULL,     -- 'unlimited_likes','advanced_filters','compatibility_insights','incognito','travel_mode','priority_discovery','see_who_liked','rewind','ai_coach_advanced', ...
  limit_value     int,               -- NULL = unlimited
  limit_period    text CHECK (limit_period IN ('day','week','month')),
  PRIMARY KEY (product_id, entitlement_key)
);

-- Free-tier limits (admin-managed; e.g. likes/day).
CREATE TABLE free_tier_limits (
  entitlement_key text PRIMARY KEY,
  limit_value     int,
  limit_period    text CHECK (limit_period IN ('day','week','month')),
  country_overrides jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id               uuid NOT NULL REFERENCES billing_products(id),
  price_id                 uuid REFERENCES billing_prices(id),
  provider                 text NOT NULL CHECK (provider IN ('stripe','apple','google','admin_grant')),
  provider_subscription_id text,
  provider_customer_id     text,
  status                   text NOT NULL CHECK (status IN ('incomplete','trialing','active','past_due','in_grace','paused','canceled','expired','refunded')),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  trial_end                timestamptz,
  cancel_at_period_end     boolean NOT NULL DEFAULT false,
  canceled_at              timestamptz,
  pending_product_id       uuid REFERENCES billing_products(id),   -- scheduled downgrade
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id)
);
SELECT add_updated_at_trigger('subscriptions');
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, status);

-- Materialized grants. Derived only from server-verified sources (DEC-014).
CREATE TABLE entitlements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement_key text NOT NULL,
  source_type     text NOT NULL CHECK (source_type IN ('subscription','admin_grant','promotion','experiment')),
  source_id       uuid,
  limit_value     int,
  limit_period    text,
  starts_at       timestamptz NOT NULL DEFAULT now(),
  ends_at         timestamptz,
  revoked_at      timestamptz
);
CREATE INDEX entitlements_user_active_idx ON entitlements (user_id, entitlement_key) WHERE revoked_at IS NULL;

CREATE TABLE consumable_balances (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key  text NOT NULL CHECK (item_key IN ('boost','super_like','spotlight')),
  balance   int  NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_key)
);
CREATE TABLE consumable_ledger (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key   text NOT NULL,
  delta      int  NOT NULL,
  reason     text NOT NULL CHECK (reason IN ('purchase','subscription_allowance','consume','refund','admin_adjustment','promotion','expiry')),
  ref_id     uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consumable_ledger_user_idx ON consumable_ledger (user_id, created_at DESC);

-- Usage counters for metered entitlements (likes/day, AI calls/day).
CREATE TABLE usage_counters (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counter_key  text NOT NULL,
  period_start timestamptz NOT NULL,
  count        int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, counter_key, period_start)
);

CREATE TABLE boosts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('boost','spotlight')),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL,
  city_id     uuid REFERENCES cities(id),
  ledger_id   uuid REFERENCES consumable_ledger(id)
);
CREATE INDEX boosts_active_idx ON boosts (ends_at, city_id);

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  provider            text NOT NULL CHECK (provider IN ('stripe','apple','google')),
  provider_payment_id text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('subscription','consumable','event_ticket')),
  subscription_id     uuid REFERENCES subscriptions(id),
  product_id          uuid REFERENCES billing_products(id),
  event_id            uuid REFERENCES events(id),
  amount_minor        bigint NOT NULL,
  currency            char(3) NOT NULL,
  tax_minor           bigint,
  status              text NOT NULL CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded','disputed')),
  refunded_minor      bigint NOT NULL DEFAULT 0,
  receipt_url         text,
  invoice_ref         text,
  coupon_id           uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id)
);
SELECT add_updated_at_trigger('payments');
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);

ALTER TABLE event_attendees ADD CONSTRAINT event_attendees_payment_fk FOREIGN KEY (payment_id) REFERENCES payments(id);

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL REFERENCES payments(id),
  provider_refund_id text,
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  reason             text,
  status             text NOT NULL CHECK (status IN ('requested','pending','succeeded','failed')),
  requested_by_admin uuid REFERENCES admin_users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_refund_id)
);

-- Webhook inbox: idempotent processing keyed on provider event id (TECH §17).
CREATE TABLE payment_webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,
  provider_event_id text NOT NULL,
  event_type        text NOT NULL,
  payload           jsonb NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  attempts          int NOT NULL DEFAULT 0,
  last_error        text,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX payment_webhook_pending_idx ON payment_webhook_events (received_at) WHERE processed_at IS NULL;

CREATE TABLE coupons (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext NOT NULL UNIQUE,
  description      text,
  discount_type    text NOT NULL CHECK (discount_type IN ('percent','amount','free_trial_days','grant_entitlement')),
  percent_off      smallint CHECK (percent_off BETWEEN 1 AND 100),
  amount_off_minor bigint,
  currency         char(3),
  trial_days       smallint,
  grant_entitlement_key text,
  grant_days       smallint,
  product_ids      uuid[],
  country_codes    char(2)[],
  max_redemptions  int,
  per_user_limit   int NOT NULL DEFAULT 1,
  valid_from       timestamptz NOT NULL DEFAULT now(),
  valid_until      timestamptz,
  provider_coupon_id text,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES admin_users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE coupon_redemptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id   uuid NOT NULL REFERENCES coupons(id),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payment_id  uuid REFERENCES payments(id),
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX coupon_redemptions_coupon_user_idx ON coupon_redemptions (coupon_id, user_id);
ALTER TABLE payments ADD CONSTRAINT payments_coupon_fk FOREIGN KEY (coupon_id) REFERENCES coupons(id);
