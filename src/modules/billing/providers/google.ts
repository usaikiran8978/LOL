import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';
import type { NormalizedPurchase } from './types';

type Fetch = typeof fetch;

/** Google Play Developer API (subscriptionsv2 / products) with service-account auth, plus RTDN push verification. */
export class GooglePlayClient {
  private token: { value: string; exp: number } | null = null;
  private jwks: JWTVerifyGetKey | null = null;

  constructor(
    private readonly sa: { client_email: string; private_key: string },
    private readonly packageName: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const key = await importPKCS8(this.sa.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/androidpublisher' })
      .setProtectedHeader({ alg: 'RS256' }).setIssuer(this.sa.client_email).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key);
    const res = await this.fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (!res.ok) throw new Error(`Play auth failed: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async api<T>(method: 'GET' | 'POST', path: string): Promise<T> {
    const res = await this.fetchImpl(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${this.packageName}/${path}`, { method, headers: { Authorization: `Bearer ${await this.accessToken()}` } });
    if (!res.ok) throw new Error(`Play ${method} ${path} failed: ${res.status}`);
    return (res.status === 204 ? {} : await res.json()) as T;
  }

  async subscription(purchaseToken: string): Promise<NormalizedPurchase> {
    const s = await this.api<PlaySubscriptionV2>('GET', `purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`);
    const line = s.lineItems?.[0];
    const STATUS: Record<string, NormalizedPurchase['status']> = {
      SUBSCRIPTION_STATE_ACTIVE: 'active', SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'in_grace', SUBSCRIPTION_STATE_ON_HOLD: 'past_due', SUBSCRIPTION_STATE_PAUSED: 'paused',
      SUBSCRIPTION_STATE_CANCELED: 'canceled', SUBSCRIPTION_STATE_EXPIRED: 'expired', SUBSCRIPTION_STATE_PENDING: 'incomplete',
    };
    if (s.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING' && line) {
      // Unacknowledged purchases are refunded by Google after 3 days.
      await this.api('POST', `purchases/subscriptions/${encodeURIComponent(line.productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`);
    }
    return {
      provider: 'google', userId: s.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null, kind: 'subscription',
      providerPriceId: line ? `${line.productId}${line.offerDetails?.basePlanId ? `:${line.offerDetails.basePlanId}` : ''}` : 'unknown',
      providerSubscriptionId: purchaseToken, status: STATUS[s.subscriptionState] ?? 'incomplete',
      currentPeriodStart: s.startTime ? new Date(s.startTime) : null, currentPeriodEnd: line?.expiryTime ? new Date(line.expiryTime) : null,
      trialEnd: null, cancelAtPeriodEnd: s.subscriptionState === 'SUBSCRIPTION_STATE_CANCELED' || line?.autoRenewingPlan?.autoRenewEnabled === false,
      payment: s.latestOrderId ? { providerPaymentId: s.latestOrderId, amountMinor: null, currency: null, status: 'succeeded' } : null,
    };
  }

  async consumable(productId: string, purchaseToken: string): Promise<NormalizedPurchase> {
    const p = await this.api<{ purchaseState: number; orderId: string; obfuscatedExternalAccountId?: string; consumptionState: number }>('GET', `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`);
    if (p.purchaseState !== 0) throw new Error('purchase not completed');
    if (p.consumptionState === 0) await this.api('POST', `purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:consume`);
    return {
      provider: 'google', userId: p.obfuscatedExternalAccountId ?? null, kind: 'consumable', providerPriceId: productId, providerSubscriptionId: null, status: 'active',
      currentPeriodStart: null, currentPeriodEnd: null, trialEnd: null, cancelAtPeriodEnd: false, payment: { providerPaymentId: p.orderId, amountMinor: null, currency: null, status: 'succeeded' },
    };
  }

  /** Real-time developer notifications arrive via Pub/Sub push with a Google-signed OIDC token. */
  async verifyPushToken(bearer: string, audience: string, serviceAccountEmail: string): Promise<void> {
    this.jwks ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
    const { payload } = await jwtVerify(bearer, this.jwks, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience });
    if (payload.email !== serviceAccountEmail || payload.email_verified !== true) throw new Error('unexpected push identity');
  }
}

interface PlaySubscriptionV2 {
  subscriptionState: string;
  startTime?: string;
  latestOrderId?: string;
  acknowledgementState?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{ productId: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean }; offerDetails?: { basePlanId?: string } }>;
}
