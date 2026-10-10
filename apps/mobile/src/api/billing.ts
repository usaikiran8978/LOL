import { client } from './index';

// Shapes mirror apps/api/src/modules/billing/billing.service.ts (products(), me()).

export type MeteredKey = 'likes' | 'super_likes' | 'rewinds' | 'smart_matches' | 'ai_requests';

/** One row per purchasable price (flat list — a product with several intervals appears several times). */
export interface ProductPrice {
  productKey: string;
  kind: 'subscription' | 'consumable';
  tier: 'premium' | 'ai_premium' | 'premium_plus' | null;
  rank: number;
  name: string;
  description: string | null;
  priceId: string;
  provider: 'apple' | 'google' | 'stripe';
  /** The store product identifier (App Store productId / Play "productId:basePlanId"). */
  providerPriceId: string;
  currency: string;
  amountMinor: number;
  interval: 'week' | 'month' | 'year' | null;
  intervalCount: number;
  trialDays: number;
  consumable: { itemKey: 'boost' | 'super_like' | 'spotlight'; quantity: number } | null;
  entitlements: Array<{ key: string; limit: number | null; period: 'day' | 'week' | 'month' | null }>;
}

export interface Subscription {
  id: string;
  provider: 'stripe' | 'apple' | 'google';
  status: 'trialing' | 'active' | 'past_due' | 'in_grace' | 'paused' | 'canceled' | 'expired' | 'refunded';
  productKey: string;
  tier: string | null;
  renewsAt: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  pendingProductKey: string | null;
  manageUrl: string | null;
}

export interface Allowance {
  unlimited: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  period: 'day' | 'week' | 'month' | null;
  resetsAt: string | null;
}

export interface BillingMe {
  subscriptions: Subscription[];
  /** Non-metered entitlement keys the user currently holds. */
  entitlements: string[];
  allowances: Partial<Record<MeteredKey, Allowance>>;
  balances: Record<string, number>;
  recentPayments: Array<{ id: string; provider: string; kind: string; productKey: string | null; amountMinor: number; currency: string; status: string; refundedMinor: number; receiptUrl: string | null; at: string }>;
}

export const billingApi = {
  products: (platform: 'ios' | 'android' | 'web') => client.get<ProductPrice[]>('/billing/products', { query: { platform } }),
  me: () => client.get<BillingMe>('/billing/me'),
  /** Server-side validation of a StoreKit 2 signed transaction (also how App Store purchases are re-linked). */
  appleReceipt: (signedTransaction: string) => client.post<BillingMe>('/billing/receipts/apple', { signedTransaction }),
  /**
   * Re-reads the account's Google Play subscriptions server-side and rebuilds entitlements. App Store purchases are not
   * covered: only the device can re-send StoreKit transactions (appleReceipt).
   */
  restore: () => client.post<BillingMe & { refreshed: number }>('/billing/restore', {}),
  googleReceipt: (b: { productId: string; purchaseToken: string; kind: 'subscription' | 'consumable' }) => client.post<BillingMe>('/billing/receipts/google', b),
};
