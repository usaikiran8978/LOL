/** Provider-neutral view of a purchase, produced by every adapter and applied by BillingService. */
export interface NormalizedPurchase {
  provider: 'stripe' | 'apple' | 'google';
  userId: string | null;                 // resolved from provider metadata (client_reference_id / appAccountToken / obfuscatedAccountId)
  kind: 'subscription' | 'consumable';
  providerPriceId: string;               // Stripe price id / App Store productId / Play productId(:basePlan)
  providerSubscriptionId: string | null; // Stripe sub id / originalTransactionId / purchaseToken
  providerCustomerId?: string | null;
  status: 'incomplete' | 'trialing' | 'active' | 'past_due' | 'in_grace' | 'paused' | 'canceled' | 'expired' | 'refunded';
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** amountMinor/currency null = the provider API doesn't report the charged amount (Google Play); the configured list price is recorded. */
  payment: { providerPaymentId: string; amountMinor: number | null; currency: string | null; status: 'succeeded' | 'failed' | 'refunded' | 'pending'; receiptUrl?: string | null } | null;
}
