import type { adminCouponUpsert, adminFreeTierLimit, adminGrant, adminPriceUpsert, adminProductUpsert, adminRefund } from '@amora/shared';
import type { z } from 'zod';
import type { ApiClient } from '../client';

/*
 * Response shapes mirror apps/api/src/modules/billing (AdminBillingController + BillingService). The admin
 * endpoints return database rows as-is (snake_case). Postgres bigint columns (amounts, counts) are returned
 * as strings by the API's pg type parser, so they are typed `string | number` and converted with `toNumber`.
 */

type In<T extends z.ZodType> = z.input<T>;
type BigIntish = string | number;

export type ProductKind = z.infer<typeof adminProductUpsert>['kind'];
export type ProductTier = NonNullable<z.infer<typeof adminProductUpsert>['tier']>;
export type LimitPeriod = 'day' | 'week' | 'month';
export type BillingProvider = z.infer<typeof adminPriceUpsert>['provider'];
export type BillingInterval = 'week' | 'month' | 'year';
export type ConsumableItem = 'boost' | 'super_like' | 'spotlight';
export type DiscountType = z.infer<typeof adminCouponUpsert>['discountType'];

export interface BillingPriceRow {
  id: string;
  product_id: string;
  provider: BillingProvider;
  provider_price_id: string;
  currency: string;
  amount_minor: BigIntish;
  billing_interval: BillingInterval | null;
  interval_count: number | null;
  trial_days: number;
  quantity: number;
  country_codes: string[] | null;
  is_active: boolean;
}

export interface PlanEntitlementRow {
  product_id: string;
  entitlement_key: string;
  limit_value: number | null;
  limit_period: LimitPeriod | null;
}

export interface BillingProductRow {
  id: string;
  key: string;
  kind: ProductKind;
  tier: ProductTier | null;
  rank: number;
  is_active: boolean;
  consumable_item_key: ConsumableItem | null;
  consumable_quantity: number | null;
  created_at: string;
  updated_at: string;
  prices: BillingPriceRow[];
  entitlements: PlanEntitlementRow[];
  translations: Record<string, { name: string; description: string | null }>;
}

export interface FreeTierRow {
  entitlement_key: string;
  limit_value: number | null;
  limit_period: LimitPeriod | null;
  country_overrides: Record<string, number | null> | string | null;
}

export type SubscriptionStatus = 'incomplete' | 'trialing' | 'active' | 'past_due' | 'in_grace' | 'paused' | 'canceled' | 'expired' | 'refunded';

export interface SubscriptionRow {
  id: string;
  user_id: string;
  product_id: string;
  price_id: string | null;
  provider: BillingProvider | 'admin_grant';
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  pending_product_id: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed';

/** BillingService.paymentHistory item (already camelCase, amounts converted to numbers). */
export interface PaymentItem {
  id: string;
  provider: BillingProvider;
  kind: ProductKind;
  productKey: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  refundedMinor: number;
  receiptUrl: string | null;
  at: string;
}

export interface EntitlementRow {
  id: string;
  user_id: string;
  entitlement_key: string;
  source_type: 'subscription' | 'admin_grant' | 'promotion' | 'experiment';
  source_id: string | null;
  limit_value: number | null;
  limit_period: string | null;
  starts_at: string;
  ends_at: string | null;
  revoked_at: string | null;
}

export interface ConsumableBalanceRow {
  user_id: string;
  item_key: ConsumableItem;
  balance: number;
  updated_at: string;
}

export interface ConsumableLedgerRow {
  id: string;
  user_id: string;
  item_key: string;
  delta: number;
  reason: string;
  ref_id: string | null;
  created_at: string;
}

export interface UserBilling {
  subscriptions: SubscriptionRow[];
  /** Most recent 50 payments (the endpoint does not paginate). */
  payments: PaymentItem[];
  entitlements: EntitlementRow[];
  balances: ConsumableBalanceRow[];
  ledger: ConsumableLedgerRow[];
}

/** Stripe refunds return the provider status; App Store / Play refunds are only recorded ('requested'). */
export type RefundResult = { status: 'requested'; instructions: string } | { status: string; refundId: string };

/** Row of GET admin/billing/coupons: every editable field, so edit → PUT never wipes settings. */
export interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  discount_type: DiscountType;
  percent_off: number | null;
  amount_off_minor: BigIntish | null;
  currency: string | null;
  trial_days: number | null;
  grant_entitlement_key: string | null;
  grant_days: number | null;
  country_codes: string[] | null;
  per_user_limit: number | null;
  provider_coupon_id: string | null;
  /** Keys of the products the coupon is restricted to; empty = any product. */
  product_keys: string[] | null;
  is_active: boolean;
  valid_from: string;
  valid_until: string | null;
  max_redemptions: number | null;
  redemptions: BigIntish;
}

export interface WebhookEventRow {
  id: string;
  provider: string;
  provider_event_id: string;
  event_type: string;
  received_at: string;
  processed_at: string | null;
  attempts: number;
  last_error: string | null;
}

export function toNumber(v: BigIntish | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const enc = encodeURIComponent;

/** Typed wrappers for the billing admin endpoints (apps/api AdminBillingController, `admin/billing/*`). */
export function billingApi(c: ApiClient) {
  return {
    products: () => c.get<BillingProductRow[]>('/admin/billing/products'),
    upsertProduct: (body: In<typeof adminProductUpsert>) => c.put<unknown>(`/admin/billing/products/${enc(body.key)}`, body),
    upsertPrice: (productKey: string, body: In<typeof adminPriceUpsert>) => c.post<BillingPriceRow>(`/admin/billing/products/${enc(productKey)}/prices`, body),
    freeTier: () => c.get<FreeTierRow[]>('/admin/billing/free-tier'),
    setFreeTier: (key: string, body: In<typeof adminFreeTierLimit>) => c.put<FreeTierRow>(`/admin/billing/free-tier/${enc(key)}`, body),
    user: (userId: string) => c.get<UserBilling>(`/admin/billing/users/${enc(userId)}`),
    grant: (body: In<typeof adminGrant>) => c.post<void>('/admin/billing/grants', body),
    refund: (paymentId: string, body: In<typeof adminRefund>) => c.post<RefundResult>(`/admin/billing/payments/${enc(paymentId)}/refund`, body),
    coupons: () => c.get<CouponRow[]>('/admin/billing/coupons'),
    upsertCoupon: (body: In<typeof adminCouponUpsert>) => c.put<unknown>(`/admin/billing/coupons/${enc(body.code)}`, body),
    webhooks: (q: { limit?: number; failed?: boolean }) => c.get<WebhookEventRow[]>('/admin/billing/webhooks', { limit: q.limit, failed: q.failed || undefined }),
    replayWebhook: (id: string) => c.post<void>(`/admin/billing/webhooks/${enc(id)}/replay`),
  };
}
