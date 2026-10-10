import { z } from 'zod';
import { countryCode, locale, uuid } from './common';

export const BILLING_PROVIDERS = ['stripe', 'apple', 'google'] as const;
export const ENTITLEMENT_KEYS = [
  'likes', 'super_likes', 'rewinds', 'smart_matches', 'ai_requests',            // metered
  'advanced_filters', 'compatibility_insights', 'incognito', 'travel_mode', 'priority_discovery', 'see_who_liked', 'rewind',
  'ai_coach_advanced', 'read_receipts_control',
] as const;

export const productsQuery = z.object({ platform: z.enum(['ios', 'android', 'web']), country: countryCode.optional() });
export const checkoutRequest = z.object({ priceId: uuid, couponCode: z.string().max(50).optional(), successUrl: z.url().max(500), cancelUrl: z.url().max(500) });
export const appleReceipt = z.object({ signedTransaction: z.string().min(50).max(20000) });
export const googleReceipt = z.object({ productId: z.string().max(200), purchaseToken: z.string().min(10).max(4000), kind: z.enum(['subscription', 'consumable']) });
export const changePlanRequest = z.object({ priceId: uuid });
export const redeemCoupon = z.object({ code: z.string().trim().min(3).max(50) });
export const boostActivate = z.object({ kind: z.enum(['boost', 'spotlight']).default('boost') });

// ------------------------------------------------------------------ admin

export const adminProductUpsert = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,64}$/),
  kind: z.enum(['subscription', 'consumable', 'event_ticket']),
  tier: z.enum(['premium', 'ai_premium', 'premium_plus']).nullable().default(null),
  rank: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
  translations: z.record(locale, z.object({ name: z.string().min(1).max(100), description: z.string().max(500).optional() })).refine((r) => 'en' in r, 'an "en" translation is required'),
  entitlements: z.array(z.object({ key: z.enum(ENTITLEMENT_KEYS), limit: z.number().int().min(0).nullable().default(null), period: z.enum(['day', 'week', 'month']).nullable().default(null) })).max(30),
  /** Consumables: what one unit grants, e.g. { super_like: 5 }. */
  consumableGrant: z.object({ itemKey: z.enum(['boost', 'super_like', 'spotlight']), quantity: z.number().int().min(1).max(1000) }).nullable().default(null),
});

export const adminPriceUpsert = z.object({
  provider: z.enum(BILLING_PROVIDERS),
  providerPriceId: z.string().min(3).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/),
  amountMinor: z.number().int().min(0),
  billingInterval: z.enum(['week', 'month', 'year']).nullable().default(null),
  intervalCount: z.number().int().min(1).max(12).default(1),
  trialDays: z.number().int().min(0).max(90).default(0),
  quantity: z.number().int().min(1).default(1),
  countryCodes: z.array(countryCode).nullable().default(null),
  isActive: z.boolean().default(true),
});

export const adminFreeTierLimit = z.object({
  limitValue: z.number().int().min(0).nullable(),
  limitPeriod: z.enum(['day', 'week', 'month']).nullable(),
  countryOverrides: z.record(countryCode, z.number().int().min(0).nullable()).default({}),
});

export const adminGrant = z.object({
  userId: uuid,
  entitlementKey: z.enum(ENTITLEMENT_KEYS).optional(),
  days: z.number().int().min(1).max(3650).optional(),
  consumable: z.object({ itemKey: z.enum(['boost', 'super_like', 'spotlight']), quantity: z.number().int().min(-1000).max(1000) }).optional(),
  reasonKey: z.string().regex(/^[a-z_]{2,60}$/),
}).refine((g) => !!g.entitlementKey !== !!g.consumable, { message: 'Provide exactly one of entitlementKey or consumable' });

export const adminRefund = z.object({ amountMinor: z.number().int().positive().optional(), reason: z.string().max(300) });

export const adminCouponUpsert = z.object({
  code: z.string().trim().min(3).max(50),
  description: z.string().max(300).optional(),
  discountType: z.enum(['percent', 'amount', 'free_trial_days', 'grant_entitlement']),
  percentOff: z.number().int().min(1).max(100).nullable().default(null),
  amountOffMinor: z.number().int().min(1).nullable().default(null),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().default(null),
  trialDays: z.number().int().min(1).max(90).nullable().default(null),
  grantEntitlementKey: z.enum(ENTITLEMENT_KEYS).nullable().default(null),
  grantDays: z.number().int().min(1).max(365).nullable().default(null),
  productKeys: z.array(z.string()).nullable().default(null),
  countryCodes: z.array(countryCode).nullable().default(null),
  maxRedemptions: z.number().int().min(1).nullable().default(null),
  perUserLimit: z.number().int().min(1).default(1),
  validFrom: z.iso.datetime().optional(),
  validUntil: z.iso.datetime().nullable().default(null),
  providerCouponId: z.string().max(200).nullable().default(null),
  isActive: z.boolean().default(true),
}).refine((c) => ({ percent: !!c.percentOff, amount: !!c.amountOffMinor && !!c.currency, free_trial_days: !!c.trialDays, grant_entitlement: !!c.grantEntitlementKey && !!c.grantDays })[c.discountType], { message: 'Fields for the chosen discountType are missing' });
