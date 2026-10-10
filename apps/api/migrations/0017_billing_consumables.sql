-- 0017 Consumable products declare what one purchase grants; Stripe customer per user.
ALTER TABLE billing_products
  ADD COLUMN consumable_item_key text CHECK (consumable_item_key IN ('boost','super_like','spotlight')),
  ADD COLUMN consumable_quantity int CHECK (consumable_quantity > 0),
  ADD CONSTRAINT billing_products_consumable_ck CHECK (kind <> 'consumable' OR (consumable_item_key IS NOT NULL AND consumable_quantity IS NOT NULL));

CREATE TABLE billing_customers (
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider             text NOT NULL CHECK (provider IN ('stripe')),
  provider_customer_id text NOT NULL,
  created_at           timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider),
  UNIQUE (provider, provider_customer_id)
);
