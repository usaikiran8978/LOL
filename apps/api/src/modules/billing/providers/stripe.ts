import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NormalizedPurchase } from './types';

type Fetch = typeof fetch;

/**
 * Minimal Stripe REST client (form-encoded API, idempotency keys). Only the calls the platform needs; avoids pulling
 * the full SDK. `fetchImpl` is injectable so the contract can be exercised against a local stub in tests.
 */
export class StripeClient {
  constructor(private readonly secretKey: string, private readonly base = 'https://api.stripe.com', private readonly fetchImpl: Fetch = fetch) {}

  private async call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Record<string, string | number | boolean | undefined>, idempotencyKey?: string): Promise<T> {
    const body = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)] as [string, string])).toString() : undefined;
    const res = await this.fetchImpl(`${this.base}${path}${method === 'GET' && body ? `?${body}` : ''}`, {
      method,
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2025-01-27.acacia', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: method === 'GET' ? undefined : body,
    });
    const json = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new Error(`Stripe ${method} ${path} failed: ${res.status} ${json.error?.message ?? ''}`);
    return json;
  }

  createCustomer(userId: string, email: string | null, idem: string) {
    return this.call<{ id: string }>('POST', '/v1/customers', { 'metadata[user_id]': userId, email: email ?? undefined }, idem);
  }

  createCheckoutSession(p: { customer: string; userId: string; priceId: string; mode: 'subscription' | 'payment'; successUrl: string; cancelUrl: string; trialDays?: number; promotionCode?: string | null; idem: string }) {
    return this.call<{ id: string; url: string }>('POST', '/v1/checkout/sessions', {
      customer: p.customer, client_reference_id: p.userId, mode: p.mode, 'line_items[0][price]': p.priceId, 'line_items[0][quantity]': 1,
      success_url: p.successUrl, cancel_url: p.cancelUrl, 'metadata[user_id]': p.userId, 'metadata[price_id]': p.priceId,
      ...(p.mode === 'subscription' ? { 'subscription_data[metadata][user_id]': p.userId, ...(p.trialDays ? { 'subscription_data[trial_period_days]': p.trialDays } : {}) } : { 'payment_intent_data[metadata][user_id]': p.userId }),
      ...(p.promotionCode ? { 'discounts[0][promotion_code]': p.promotionCode } : { allow_promotion_codes: false }),
    }, p.idem);
  }

  /** One-off ticket checkout with inline price data (event prices live on our events table, not in Stripe). */
  createTicketCheckout(p: { customer: string; userId: string; eventId: string; name: string; amountMinor: number; currency: string; successUrl: string; cancelUrl: string; idem: string }) {
    return this.call<{ id: string; url: string }>('POST', '/v1/checkout/sessions', {
      customer: p.customer, client_reference_id: p.userId, mode: 'payment', 'line_items[0][quantity]': 1, 'line_items[0][price_data][currency]': p.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': p.amountMinor, 'line_items[0][price_data][product_data][name]': p.name, success_url: p.successUrl, cancel_url: p.cancelUrl,
      'metadata[user_id]': p.userId, 'metadata[event_id]': p.eventId, 'payment_intent_data[metadata][event_id]': p.eventId,
    }, p.idem);
  }

  retrieveSubscription(id: string) {
    return this.call<StripeSubscription>('GET', `/v1/subscriptions/${id}`);
  }

  cancelAtPeriodEnd(id: string, cancel: boolean) {
    return this.call<StripeSubscription>('POST', `/v1/subscriptions/${id}`, { cancel_at_period_end: cancel });
  }

  changePrice(sub: StripeSubscription, priceId: string, prorate: boolean, idem: string) {
    return this.call<StripeSubscription>('POST', `/v1/subscriptions/${sub.id}`, {
      'items[0][id]': sub.items.data[0]!.id, 'items[0][price]': priceId, proration_behavior: prorate ? 'create_prorations' : 'none',
    }, idem);
  }

  refund(paymentIntent: string, amountMinor: number | undefined, idem: string) {
    return this.call<{ id: string; status: string }>('POST', '/v1/refunds', { payment_intent: paymentIntent, amount: amountMinor }, idem);
  }
}

export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  trial_end: number | null;
  cancel_at_period_end: boolean;
  metadata: Record<string, string>;
  items: { data: Array<{ id: string; price: { id: string } }> };
}

/** Verifies the Stripe-Signature header (v1 HMAC-SHA256 over `${t}.${payload}`) with a timestamp tolerance. */
export function verifyStripeSignature(rawBody: Buffer, header: string | undefined, secret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]).filter((kv) => kv.length === 2).map(([k, v]) => [k, v]));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest();
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => Buffer.from(p.slice(3), 'hex'));
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(s, expected));
}

const STATUS: Record<string, NormalizedPurchase['status']> = {
  trialing: 'trialing', active: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'canceled', incomplete: 'incomplete', incomplete_expired: 'expired', paused: 'paused',
};

export function normalizeStripeSubscription(sub: StripeSubscription): NormalizedPurchase {
  return {
    provider: 'stripe', userId: sub.metadata.user_id ?? null, kind: 'subscription', providerPriceId: sub.items.data[0]!.price.id, providerSubscriptionId: sub.id, providerCustomerId: sub.customer,
    status: STATUS[sub.status] ?? 'incomplete', currentPeriodStart: new Date(sub.current_period_start * 1000), currentPeriodEnd: new Date(sub.current_period_end * 1000),
    trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null, cancelAtPeriodEnd: sub.cancel_at_period_end, payment: null,
  };
}
