import { X509Certificate } from 'node:crypto';
import { compactVerify, decodeProtectedHeader, importX509 } from 'jose';
import type { NormalizedPurchase } from './types';

/**
 * App Store Server API v2 signed data (JWS with an x5c chain). Verification: the chain must link
 * leaf → intermediate → root, the root must match the pinned Apple Root CA G3 fingerprint, certificates must be in
 * their validity window, and the JWS signature must verify with the leaf key.
 */
export class AppleVerifier {
  constructor(private readonly opts: { rootFingerprintsSha256: string[]; bundleId: string; environment: 'Production' | 'Sandbox' }) {}

  async verify<T>(jws: string): Promise<T> {
    const header = decodeProtectedHeader(jws);
    const x5c = header.x5c;
    if (!Array.isArray(x5c) || x5c.length < 3) throw new Error('x5c chain missing');
    const certs = x5c.map((b64) => new X509Certificate(Buffer.from(b64, 'base64')));
    const now = Date.now();
    for (const c of certs) if (now < Date.parse(c.validFrom) || now > Date.parse(c.validTo)) throw new Error('certificate outside validity window');
    for (let i = 0; i < certs.length - 1; i++) {
      if (!certs[i]!.checkIssued(certs[i + 1]!) || !certs[i]!.verify(certs[i + 1]!.publicKey)) throw new Error('certificate chain broken');
    }
    const root = certs.at(-1)!;
    const fp = root.fingerprint256.replace(/:/g, '').toUpperCase();
    if (!this.opts.rootFingerprintsSha256.map((f) => f.replace(/:/g, '').toUpperCase()).includes(fp)) throw new Error('untrusted root certificate');
    const key = await importX509(`-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`, 'ES256');
    const { payload } = await compactVerify(jws, key);
    return JSON.parse(Buffer.from(payload).toString('utf8')) as T;
  }

  normalize(tx: AppleTransaction, renewal?: AppleRenewalInfo): NormalizedPurchase {
    if (tx.bundleId !== this.opts.bundleId) throw new Error('bundle id mismatch');
    if (tx.environment && tx.environment !== this.opts.environment) throw new Error('environment mismatch');
    const now = Date.now();
    const subscription = tx.type === 'Auto-Renewable Subscription';
    let status: NormalizedPurchase['status'] = 'active';
    if (tx.revocationDate) status = 'refunded';
    else if (subscription && tx.expiresDate && tx.expiresDate < now) status = renewal?.gracePeriodExpiresDate && renewal.gracePeriodExpiresDate > now ? 'in_grace' : 'expired';
    else if (subscription && tx.offerType === 1 && tx.offerDiscountType === 'FREE_TRIAL') status = 'trialing';
    return {
      provider: 'apple',
      userId: tx.appAccountToken ?? null, // the app sets appAccountToken = our user id at purchase time
      kind: subscription ? 'subscription' : 'consumable',
      providerPriceId: tx.productId,
      providerSubscriptionId: subscription ? tx.originalTransactionId : null,
      status,
      currentPeriodStart: tx.purchaseDate ? new Date(tx.purchaseDate) : null,
      currentPeriodEnd: tx.expiresDate ? new Date(tx.expiresDate) : null,
      trialEnd: status === 'trialing' && tx.expiresDate ? new Date(tx.expiresDate) : null,
      cancelAtPeriodEnd: renewal ? renewal.autoRenewStatus === 0 : false,
      payment: {
        providerPaymentId: tx.transactionId,
        amountMinor: tx.price !== undefined ? Math.round(tx.price / 10) : 0, // App Store reports price in milli-units
        currency: tx.currency ?? 'USD',
        status: tx.revocationDate ? 'refunded' : 'succeeded',
      },
    };
  }
}

export interface AppleTransaction {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  bundleId: string;
  purchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  type: 'Auto-Renewable Subscription' | 'Consumable' | 'Non-Consumable' | 'Non-Renewing Subscription';
  appAccountToken?: string;
  environment?: 'Production' | 'Sandbox';
  offerType?: number;
  offerDiscountType?: string;
  price?: number;
  currency?: string;
}

export interface AppleRenewalInfo {
  autoRenewStatus: 0 | 1;
  gracePeriodExpiresDate?: number;
}

export interface AppleNotification {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  data: { signedTransactionInfo?: string; signedRenewalInfo?: string; bundleId: string; environment: string };
}
