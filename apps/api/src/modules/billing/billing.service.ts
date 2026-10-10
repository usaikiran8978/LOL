import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { AuditService } from '../../common/audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../common/http/cursor';
import { localeChain } from '../../common/i18n/translations';
import { JobScheduler } from '../../common/jobs/scheduler';
import { OutboxService } from '../../common/outbox/outbox.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EntitlementsService } from '../platform/entitlements.service';
import { SettingsService } from '../platform/settings.service';
import { AppleVerifier, type AppleNotification, type AppleRenewalInfo, type AppleTransaction } from './providers/apple';
import { GooglePlayClient } from './providers/google';
import { normalizeStripeSubscription, StripeClient, verifyStripeSignature, type StripeSubscription } from './providers/stripe';
import type { NormalizedPurchase } from './providers/types';

// Subscriptions in these states keep their entitlements (grace/retry periods included).
const ENTITLED = ['active', 'trialing', 'in_grace', 'past_due'];
const METERED = ['likes', 'super_likes', 'rewinds', 'smart_matches', 'ai_requests'];
// Apple Root CA - G3 SHA-256 fingerprint (pinned; override via config for key rotation).
const APPLE_ROOT_G3 = '63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179';

/**
 * Subscriptions, consumables and entitlements (BRD §18, TECH §17). Provider adapters verify everything server-side
 * (Stripe webhooks with signatures, App Store JWS chains, Play Developer API); the client is never trusted for payment
 * state. Webhooks land in an idempotent inbox and are processed via the outbox with retries.
 */
@Injectable()
export class BillingService implements OnModuleInit {
  private readonly logger = new Logger(BillingService.name);
  readonly stripe: StripeClient | null;
  readonly apple: AppleVerifier | null;
  readonly google: GooglePlayClient | null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly outbox: OutboxService,
    private readonly entitlements: EntitlementsService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly jobs: JobScheduler,
  ) {
    this.stripe = cfg.STRIPE_SECRET_KEY ? new StripeClient(cfg.STRIPE_SECRET_KEY, cfg.STRIPE_API_BASE) : null;
    this.apple = cfg.APPLE_BUNDLE_ID ? new AppleVerifier({ bundleId: cfg.APPLE_BUNDLE_ID, environment: cfg.APPLE_ENVIRONMENT, rootFingerprintsSha256: cfg.APPLE_ROOT_FINGERPRINTS.length ? cfg.APPLE_ROOT_FINGERPRINTS : [APPLE_ROOT_G3] }) : null;
    this.google = cfg.GOOGLE_PLAY_PACKAGE && cfg.GOOGLE_PLAY_SA_JSON_B64 ? new GooglePlayClient(JSON.parse(Buffer.from(cfg.GOOGLE_PLAY_SA_JSON_B64, 'base64').toString('utf8')), cfg.GOOGLE_PLAY_PACKAGE) : null;
  }

  onModuleInit(): void {
    this.outbox.on('billing.webhook', (p) => this.processWebhook(String(p.inboxId)));
    // Safety net for missed webhooks: expire lapsed subscriptions and drop their entitlements.
    this.jobs.register('billing.expire', 900, async () => {
      const lapsed = await this.db.updateTable('subscriptions').set({ status: 'expired' })
        .where('status', 'in', ENTITLED).where('current_period_end', '<', new Date(Date.now() - 3 * 86_400_000)).returning('user_id').execute();
      for (const u of new Set(lapsed.map((l) => l.user_id))) await this.recomputeEntitlements(u);
    });
    this.jobs.register('billing.renewal_notices', 24 * 3600, () => this.renewalNotices());
  }

  // ------------------------------------------------------------------------------------ catalog

  async products(platform: 'ios' | 'android' | 'web', country: string | null, locale: string) {
    const provider = platform === 'ios' ? 'apple' : platform === 'android' ? 'google' : 'stripe';
    const rows = await this.db.selectFrom('billing_products as p').innerJoin('billing_prices as pr', 'pr.product_id', 'p.id')
      .select(['p.id as product_id', 'p.key', 'p.kind', 'p.tier', 'p.rank', 'p.consumable_item_key', 'p.consumable_quantity', 'pr.id as price_id', 'pr.provider_price_id', 'pr.currency', 'pr.amount_minor', 'pr.billing_interval', 'pr.interval_count', 'pr.trial_days', 'pr.country_codes'])
      .where('p.is_active', '=', true).where('pr.is_active', '=', true).where('pr.provider', '=', provider).where('p.kind', '<>', 'event_ticket')
      .orderBy('p.rank').execute();
    const ids = [...new Set(rows.map((r) => r.product_id))];
    const [tr, ents] = ids.length
      ? await Promise.all([
          this.db.selectFrom('billing_product_translations').selectAll().where('product_id', 'in', ids).where('locale', 'in', localeChain(locale)).execute(),
          this.db.selectFrom('plan_entitlements').selectAll().where('product_id', 'in', ids).execute(),
        ])
      : [[], []];
    // Country-specific prices win over global ones for the same product.
    const pick = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      if (r.country_codes && (!country || !r.country_codes.includes(country))) continue;
      const cur = pick.get(`${r.product_id}:${r.billing_interval}:${r.interval_count}`);
      if (!cur || (r.country_codes && !cur.country_codes)) pick.set(`${r.product_id}:${r.billing_interval}:${r.interval_count}`, r);
    }
    return [...pick.values()].map((r) => {
      const t = localeChain(locale).map((l) => tr.find((x) => x.product_id === r.product_id && x.locale === l)).find(Boolean);
      return {
        productKey: r.key, kind: r.kind, tier: r.tier, rank: r.rank, name: t?.name ?? r.key, description: t?.description ?? null,
        priceId: r.price_id, provider, providerPriceId: r.provider_price_id, currency: r.currency, amountMinor: Number(r.amount_minor),
        interval: r.billing_interval, intervalCount: r.interval_count, trialDays: r.trial_days,
        consumable: r.consumable_item_key ? { itemKey: r.consumable_item_key, quantity: r.consumable_quantity } : null,
        entitlements: ents.filter((e) => e.product_id === r.product_id).map((e) => ({ key: e.entitlement_key, limit: e.limit_value, period: e.limit_period })),
      };
    });
  }

  // ------------------------------------------------------------------------------------ purchase flows

  async checkout(userId: string, priceId: string, couponCode: string | undefined, successUrl: string, cancelUrl: string) {
    if (!this.stripe) throw new AppError('PAYMENT_PROVIDER_NOT_CONFIGURED', 'Stripe is not configured');
    this.assertReturnUrl(successUrl);
    this.assertReturnUrl(cancelUrl);
    const price = await this.db.selectFrom('billing_prices as pr').innerJoin('billing_products as p', 'p.id', 'pr.product_id')
      .select(['pr.provider_price_id', 'pr.trial_days', 'p.kind', 'p.id as product_id', 'p.key']).where('pr.id', '=', priceId).where('pr.provider', '=', 'stripe').where('pr.is_active', '=', true).where('p.is_active', '=', true).executeTakeFirst();
    if (!price || price.kind === 'event_ticket') throw new AppError('NOT_FOUND');
    if (price.kind === 'subscription') {
      const active = await this.db.selectFrom('subscriptions').select('id').where('user_id', '=', userId).where('status', 'in', ENTITLED).where('product_id', '=', price.product_id).executeTakeFirst();
      if (active) throw new AppError('CONFLICT', 'Already subscribed; use change plan');
    }
    // Free trial once per person per product.
    const hadBefore = await this.db.selectFrom('subscriptions').select('id').where('user_id', '=', userId).where('product_id', '=', price.product_id).executeTakeFirst();
    let promotion: string | null = null;
    if (couponCode) promotion = (await this.validateCoupon(userId, couponCode, price.key)).provider_coupon_id;
    const customer = await this.stripeCustomer(userId);
    const session = await this.stripe.createCheckoutSession({
      customer, userId, priceId: price.provider_price_id, mode: price.kind === 'subscription' ? 'subscription' : 'payment', successUrl, cancelUrl,
      trialDays: !hadBefore && price.trial_days > 0 ? price.trial_days : undefined, promotionCode: promotion, idem: `checkout:${userId}:${priceId}:${Math.floor(Date.now() / 60_000)}`,
    });
    await this.analytics.track('paywall_viewed', { userId, properties: { step: 'checkout', product: price.key } });
    return { checkoutUrl: session.url, sessionId: session.id };
  }

  private assertReturnUrl(url: string) {
    const allowed = this.cfg.CHECKOUT_RETURN_ORIGINS;
    if (!allowed.some((o) => url.startsWith(o))) throw new AppError('VALIDATION_FAILED', 'Return URL not allowed');
  }

  async stripeCustomer(userId: string): Promise<string> {
    const existing = await this.db.selectFrom('billing_customers').select('provider_customer_id').where('user_id', '=', userId).where('provider', '=', 'stripe').executeTakeFirst();
    if (existing) return existing.provider_customer_id;
    const u = await this.db.selectFrom('users').select('email').where('id', '=', userId).executeTakeFirstOrThrow();
    const c = await this.stripe!.createCustomer(userId, u.email, `customer:${userId}`);
    await this.db.insertInto('billing_customers').values({ user_id: userId, provider: 'stripe', provider_customer_id: c.id }).onConflict((oc) => oc.doNothing()).execute();
    return c.id;
  }

  async appleReceipt(userId: string, signedTransaction: string, locale = 'en') {
    if (!this.apple) throw new AppError('PAYMENT_PROVIDER_NOT_CONFIGURED', 'App Store purchases are not configured');
    let n: NormalizedPurchase;
    try {
      n = this.apple.normalize(await this.apple.verify<AppleTransaction>(signedTransaction));
    } catch (err) {
      throw new AppError('RECEIPT_INVALID', (err as Error).message);
    }
    if (n.userId && n.userId !== userId) throw new AppError('RECEIPT_INVALID', 'Purchase belongs to another account');
    await this.apply({ ...n, userId });
    return this.me(userId, locale);
  }

  async googleReceipt(userId: string, productId: string, purchaseToken: string, kind: 'subscription' | 'consumable', locale = 'en') {
    if (!this.google) throw new AppError('PAYMENT_PROVIDER_NOT_CONFIGURED', 'Google Play purchases are not configured');
    let n: NormalizedPurchase;
    try {
      n = kind === 'subscription' ? await this.google.subscription(purchaseToken) : await this.google.consumable(productId, purchaseToken);
    } catch (err) {
      throw new AppError('RECEIPT_INVALID', (err as Error).message);
    }
    if (n.userId && n.userId !== userId) throw new AppError('RECEIPT_INVALID', 'Purchase belongs to another account');
    await this.apply({ ...n, userId });
    return this.me(userId, locale);
  }

  /**
   * "Restore purchases": re-reads every store subscription we know for the member from the provider and rebuilds
   * entitlements. Google can be queried server-side by purchase token; Stripe state arrives by webhook; App Store
   * transactions can only be re-sent by the device (StoreKit restore → POST /billing/receipts/apple).
   */
  async restore(userId: string, locale: string) {
    const subs = await this.db.selectFrom('subscriptions').select(['provider', 'provider_subscription_id']).where('user_id', '=', userId).where('provider', '=', 'google').where('provider_subscription_id', 'is not', null).execute();
    let refreshed = 0;
    if (this.google) {
      for (const s of subs) {
        try {
          await this.apply({ ...(await this.google.subscription(s.provider_subscription_id!)), userId });
          refreshed++;
        } catch (err) {
          this.logger.warn(`restore ${s.provider_subscription_id}: ${(err as Error).message}`);
        }
      }
    }
    await this.recomputeEntitlements(userId);
    return { refreshed, ...(await this.me(userId, locale)) };
  }

  // ------------------------------------------------------------------------------------ webhooks

  async stripeWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!this.cfg.STRIPE_WEBHOOK_SECRET) throw new AppError('PAYMENT_PROVIDER_NOT_CONFIGURED');
    if (!rawBody || !verifyStripeSignature(rawBody, signature, this.cfg.STRIPE_WEBHOOK_SECRET)) throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    const evt = JSON.parse(rawBody.toString('utf8')) as { id: string; type: string };
    return this.inbox('stripe', evt.id, evt.type, evt);
  }

  async appleWebhook(signedPayload: string) {
    if (!this.apple) throw new AppError('PAYMENT_PROVIDER_NOT_CONFIGURED');
    let n: AppleNotification;
    try {
      n = await this.apple.verify<AppleNotification>(signedPayload);
    } catch {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }
    return this.inbox('apple', n.notificationUUID, n.notificationType, n);
  }

  async googleWebhook(bearer: string | undefined, body: { message?: { messageId?: string; data?: string } }) {
    if (!this.google || !this.cfg.GOOGLE_RTDN_AUDIENCE || !this.cfg.GOOGLE_RTDN_SA_EMAIL) throw new AppError('PAYMENT_PROVIDER_NOT_CONFIGURED');
    try {
      await this.google.verifyPushToken(bearer?.replace(/^Bearer\s+/i, '') ?? '', this.cfg.GOOGLE_RTDN_AUDIENCE, this.cfg.GOOGLE_RTDN_SA_EMAIL);
    } catch {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }
    const data = JSON.parse(Buffer.from(body.message?.data ?? '', 'base64').toString('utf8') || '{}');
    return this.inbox('google', body.message?.messageId ?? `${Date.now()}`, data.subscriptionNotification ? 'subscription' : data.oneTimeProductNotification ? 'one_time' : 'test', data);
  }

  /** Idempotent inbox: duplicate deliveries hit the unique key and are acknowledged without reprocessing. */
  private async inbox(provider: string, eventId: string, type: string, payload: unknown) {
    const row = await this.db.transaction().execute(async (trx) => {
      const r = await trx.insertInto('payment_webhook_events').values({ provider, provider_event_id: eventId, event_type: type, payload: JSON.stringify(payload) })
        .onConflict((oc) => oc.columns(['provider', 'provider_event_id']).doNothing()).returning('id').executeTakeFirst();
      if (r) await this.outbox.enqueue(trx, 'billing.webhook', { inboxId: r.id }, { aggregateId: r.id });
      return r;
    });
    return { received: true, duplicate: !row };
  }

  async processWebhook(inboxId: string): Promise<void> {
    const ev = await this.db.selectFrom('payment_webhook_events').selectAll().where('id', '=', inboxId).executeTakeFirst();
    if (!ev || ev.processed_at) return;
    try {
      if (ev.provider === 'stripe') await this.handleStripe(ev.event_type, ev.payload as unknown as StripeEvent);
      if (ev.provider === 'apple') await this.handleApple(ev.payload as unknown as AppleNotification);
      if (ev.provider === 'google') await this.handleGoogle(ev.payload as unknown as GoogleRtdn);
      await this.db.updateTable('payment_webhook_events').set({ processed_at: new Date(), attempts: sql`attempts + 1`, last_error: null }).where('id', '=', inboxId).execute();
    } catch (err) {
      await this.db.updateTable('payment_webhook_events').set({ attempts: sql`attempts + 1`, last_error: (err as Error).message.slice(0, 1000) }).where('id', '=', inboxId).execute();
      throw err; // outbox retries with backoff
    }
  }

  private async handleStripe(type: string, evt: StripeEvent): Promise<void> {
    const o = evt.data.object as Record<string, any>;
    switch (type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return this.apply(normalizeStripeSubscription(o as StripeSubscription));
      case 'checkout.session.completed': {
        if (o.mode === 'payment' && o.metadata?.event_id) {
          // Event tickets are owned by the events module.
          await this.outbox.enqueue(this.db, 'billing.event_ticket_paid', {
            eventId: o.metadata.event_id, userId: o.client_reference_id ?? o.metadata.user_id, paymentIntent: String(o.payment_intent), amountMinor: Number(o.amount_total ?? 0),
            currency: String(o.currency ?? 'usd').toUpperCase(), paid: o.payment_status === 'paid',
          });
          return;
        }
        if (o.mode === 'payment') {
          return this.apply({
            provider: 'stripe', userId: o.client_reference_id ?? o.metadata?.user_id ?? null, kind: 'consumable', providerPriceId: o.metadata?.price_id ?? '', providerSubscriptionId: null,
            status: 'active', currentPeriodStart: null, currentPeriodEnd: null, trialEnd: null, cancelAtPeriodEnd: false,
            payment: { providerPaymentId: String(o.payment_intent), amountMinor: Number(o.amount_total ?? 0), currency: String(o.currency ?? 'usd').toUpperCase(), status: o.payment_status === 'paid' ? 'succeeded' : 'pending' },
          });
        }
        if (o.subscription && this.stripe) return this.apply(normalizeStripeSubscription(await this.stripe.retrieveSubscription(String(o.subscription))));
        return;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        if (!o.subscription) return;
        const sub = await this.db.selectFrom('subscriptions').select(['id', 'user_id', 'product_id']).where('provider', '=', 'stripe').where('provider_subscription_id', '=', String(o.subscription)).executeTakeFirst();
        if (!sub) throw new Error(`unknown subscription ${o.subscription} (will retry after subscription event)`);
        await this.db.insertInto('payments').values({
          user_id: sub.user_id, provider: 'stripe', provider_payment_id: String(o.payment_intent ?? o.id), kind: 'subscription', subscription_id: sub.id, product_id: sub.product_id,
          amount_minor: Number(o.amount_paid ?? o.amount_due ?? 0), currency: String(o.currency ?? 'usd').toUpperCase(), tax_minor: o.tax ?? null,
          status: type === 'invoice.paid' ? 'succeeded' : 'failed', receipt_url: o.hosted_invoice_url ?? null, invoice_ref: String(o.id),
        }).onConflict((oc) => oc.columns(['provider', 'provider_payment_id']).doUpdateSet({ status: type === 'invoice.paid' ? 'succeeded' : 'failed', updated_at: new Date() })).execute();
        if (type === 'invoice.payment_failed') await this.notifications.notify(sub.user_id, 'subscription.payment_failed', { plan: await this.productName(sub.product_id) }, { dedupeKey: `payfail:${o.id}` });
        else await this.analytics.track('subscription_renewed', { userId: sub.user_id });
        return;
      }
      case 'charge.refunded': {
        const p = await this.db.updateTable('payments').set({ status: o.amount_refunded >= o.amount ? 'refunded' : 'partially_refunded', refunded_minor: Number(o.amount_refunded) })
          .where('provider', '=', 'stripe').where('provider_payment_id', '=', String(o.payment_intent)).returning(['user_id', 'kind', 'product_id', 'id']).executeTakeFirst();
        if (p?.user_id && p.kind === 'consumable' && o.amount_refunded >= o.amount) await this.reverseConsumable(p.user_id, p.id, p.product_id);
        return;
      }
      default:
        return; // other events are acknowledged and ignored
    }
  }

  private async handleApple(n: AppleNotification): Promise<void> {
    if (!n.data.signedTransactionInfo) return;
    const tx = await this.apple!.verify<AppleTransaction>(n.data.signedTransactionInfo);
    const renewal = n.data.signedRenewalInfo ? await this.apple!.verify<AppleRenewalInfo>(n.data.signedRenewalInfo) : undefined;
    const norm = this.apple!.normalize(tx, renewal);
    if (n.notificationType === 'REFUND' && norm.payment) norm.payment.status = 'refunded';
    if (['EXPIRED', 'GRACE_PERIOD_EXPIRED'].includes(n.notificationType)) norm.status = 'expired';
    if (n.notificationType === 'DID_FAIL_TO_RENEW') norm.status = n.subtype === 'GRACE_PERIOD' ? 'in_grace' : 'past_due';
    await this.apply(norm);
  }

  private async handleGoogle(d: GoogleRtdn): Promise<void> {
    if (d.subscriptionNotification) return this.apply(await this.google!.subscription(d.subscriptionNotification.purchaseToken));
    if (d.voidedPurchaseNotification) {
      const p = await this.db.updateTable('payments').set({ status: 'refunded' }).where('provider', '=', 'google').where('provider_payment_id', '=', d.voidedPurchaseNotification.orderId)
        .returning(['user_id', 'id', 'kind', 'product_id']).executeTakeFirst();
      if (p?.user_id && p.kind === 'consumable') await this.reverseConsumable(p.user_id, p.id, p.product_id);
    }
  }

  // ------------------------------------------------------------------------------------ apply

  /** Applies a verified purchase state. Idempotent: replays converge to the same rows. */
  async apply(n: NormalizedPurchase): Promise<void> {
    const price = await this.db.selectFrom('billing_prices as pr').innerJoin('billing_products as p', 'p.id', 'pr.product_id')
      .select(['pr.id as price_id', 'p.id as product_id', 'p.kind', 'p.rank', 'p.key', 'p.consumable_item_key', 'p.consumable_quantity', 'pr.quantity', 'pr.amount_minor', 'pr.currency'])
      .where('pr.provider', '=', n.provider).where('pr.provider_price_id', '=', n.providerPriceId).executeTakeFirst();
    // A store product nobody configured in Admin → Billing. Typed for clients; webhooks keep retrying until it exists.
    if (!price) throw new AppError('PAYMENT_PROVIDER_NOT_CONFIGURED', 'This product is not configured for sale', { provider: n.provider, providerPriceId: n.providerPriceId });
    let userId = n.userId;
    if (!userId && n.providerSubscriptionId) userId = (await this.db.selectFrom('subscriptions').select('user_id').where('provider', '=', n.provider).where('provider_subscription_id', '=', n.providerSubscriptionId).executeTakeFirst())?.user_id ?? null;
    if (!userId || !(await this.db.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst())) throw new Error('purchase not linked to a known user');

    const events: Array<'subscription_started' | 'subscription_cancelled' | 'purchase_completed'> = [];
    await this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${userId}`}, 0))`.execute(trx);
      if (n.kind === 'subscription' && n.providerSubscriptionId) {
        const existing = await trx.selectFrom('subscriptions as s').innerJoin('billing_products as p', 'p.id', 's.product_id').select(['s.id', 's.status', 's.product_id', 's.cancel_at_period_end', 's.current_period_end', 'p.rank'])
          .where('s.provider', '=', n.provider).where('s.provider_subscription_id', '=', n.providerSubscriptionId).forUpdate().executeTakeFirst();
        // Downgrades keep the higher plan until the paid period ends (provider bills the new price next cycle).
        const isDowngradeMidPeriod = existing && price.rank < existing.rank && n.currentPeriodEnd && existing.current_period_end && new Date(existing.current_period_end).getTime() === n.currentPeriodEnd.getTime();
        const values = {
          user_id: userId, product_id: isDowngradeMidPeriod ? existing!.product_id : price.product_id, price_id: price.price_id, provider: n.provider,
          provider_subscription_id: n.providerSubscriptionId, provider_customer_id: n.providerCustomerId ?? null, status: n.status,
          current_period_start: n.currentPeriodStart, current_period_end: n.currentPeriodEnd, trial_end: n.trialEnd, cancel_at_period_end: n.cancelAtPeriodEnd,
          canceled_at: ['canceled', 'expired'].includes(n.status) || n.cancelAtPeriodEnd ? new Date() : null, pending_product_id: isDowngradeMidPeriod ? price.product_id : null,
        };
        const sub = await trx.insertInto('subscriptions').values(values).onConflict((oc) => oc.columns(['provider', 'provider_subscription_id']).doUpdateSet(values)).returning('id').executeTakeFirstOrThrow();
        if ((!existing || !ENTITLED.includes(existing.status)) && ENTITLED.includes(n.status)) events.push('subscription_started');
        if (existing && ((!existing.cancel_at_period_end && n.cancelAtPeriodEnd) || (ENTITLED.includes(existing.status) && ['canceled', 'expired'].includes(n.status)))) events.push('subscription_cancelled');
        if (n.payment) await this.upsertPayment(trx, userId, n, price, sub.id, 'subscription');
      } else if (n.kind === 'consumable' && n.payment) {
        const { inserted, paymentId } = await this.upsertPayment(trx, userId, n, price, null, 'consumable');
        if (inserted && n.payment.status === 'succeeded' && price.consumable_item_key) {
          const qty = (price.consumable_quantity ?? 1) * (price.quantity ?? 1);
          await this.credit(trx, userId, price.consumable_item_key, qty, 'purchase', paymentId);
          events.push('purchase_completed');
        }
        if (n.payment.status === 'refunded') await this.reverseConsumableTx(trx, userId, paymentId, price.product_id);
      }
    });
    await this.recomputeEntitlements(userId);
    for (const e of events) await this.analytics.track(e, { userId, properties: { product: price.key, provider: n.provider } });
  }

  private async upsertPayment(trx: Tx, userId: string, n: NormalizedPurchase, price: { product_id: string; amount_minor: string | number; currency: string }, subscriptionId: string | null, kind: 'subscription' | 'consumable') {
    const p = n.payment!;
    const productId = price.product_id;
    const existing = await trx.selectFrom('payments').select('id').where('provider', '=', n.provider).where('provider_payment_id', '=', p.providerPaymentId).executeTakeFirst();
    const values = {
      user_id: userId, provider: n.provider, provider_payment_id: p.providerPaymentId, kind, subscription_id: subscriptionId, product_id: productId,
      amount_minor: p.amountMinor ?? Number(price.amount_minor), currency: p.currency ?? price.currency, status: p.status, receipt_url: p.receiptUrl ?? null,
    };
    const row = await trx.insertInto('payments').values(values).onConflict((oc) => oc.columns(['provider', 'provider_payment_id']).doUpdateSet({ status: p.status, updated_at: new Date() })).returning('id').executeTakeFirstOrThrow();
    return { inserted: !existing, paymentId: row.id };
  }

  private async credit(trx: Tx, userId: string, itemKey: string, delta: number, reason: string, refId: string | null) {
    await trx.insertInto('consumable_balances').values({ user_id: userId, item_key: itemKey, balance: Math.max(0, delta) })
      .onConflict((oc) => oc.columns(['user_id', 'item_key']).doUpdateSet({ balance: sql`GREATEST(consumable_balances.balance + ${delta}, 0)`, updated_at: new Date() })).execute();
    await trx.insertInto('consumable_ledger').values({ user_id: userId, item_key: itemKey, delta, reason, ref_id: refId }).execute();
  }

  private async reverseConsumable(userId: string, paymentId: string, productId: string | null) {
    await this.db.transaction().execute((trx) => this.reverseConsumableTx(trx, userId, paymentId, productId));
  }

  private async reverseConsumableTx(trx: Tx, userId: string, paymentId: string, productId: string | null) {
    const already = await trx.selectFrom('consumable_ledger').select('id').where('ref_id', '=', paymentId).where('reason', '=', 'refund').executeTakeFirst();
    const credited = await trx.selectFrom('consumable_ledger').select(['item_key', 'delta']).where('ref_id', '=', paymentId).where('reason', '=', 'purchase').executeTakeFirst();
    if (already || !credited || !productId) return;
    await this.credit(trx, userId, credited.item_key, -credited.delta, 'refund', paymentId);
  }

  /** Entitlements from subscriptions are rebuilt from scratch so every state change converges correctly. */
  async recomputeEntitlements(userId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const subs = await trx.selectFrom('subscriptions').select(['id', 'product_id', 'status', 'current_period_end']).where('user_id', '=', userId).where('status', 'in', ENTITLED).execute();
      const live = subs.filter((s) => !s.current_period_end || new Date(s.current_period_end).getTime() > Date.now() - 3 * 86_400_000);
      const grants = live.length ? await trx.selectFrom('plan_entitlements').selectAll().where('product_id', 'in', live.map((s) => s.product_id)).execute() : [];
      await trx.updateTable('entitlements').set({ revoked_at: new Date() }).where('user_id', '=', userId).where('source_type', '=', 'subscription').where('revoked_at', 'is', null).execute();
      const rows = live.flatMap((s) => grants.filter((g) => g.product_id === s.product_id).map((g) => ({
        user_id: userId, entitlement_key: g.entitlement_key, source_type: 'subscription', source_id: s.id, limit_value: g.limit_value, limit_period: g.limit_period,
        ends_at: s.current_period_end ? new Date(new Date(s.current_period_end).getTime() + 3 * 86_400_000) : null, // grace for webhook latency
      })));
      if (rows.length) await trx.insertInto('entitlements').values(rows).execute();
    });
  }

  // ------------------------------------------------------------------------------------ account views & management

  async me(userId: string, locale: string) {
    const [subs, ents, balances, payments] = await Promise.all([
      this.db.selectFrom('subscriptions as s').innerJoin('billing_products as p', 'p.id', 's.product_id').leftJoin('billing_products as pp', 'pp.id', 's.pending_product_id')
        .select(['s.id', 's.provider', 's.status', 's.current_period_end', 's.trial_end', 's.cancel_at_period_end', 'p.key as product_key', 'p.tier', 'pp.key as pending_product_key'])
        .where('s.user_id', '=', userId).where('s.status', 'not in', ['incomplete']).orderBy('s.created_at', 'desc').limit(10).execute(),
      this.entitlements.active(userId),
      this.db.selectFrom('consumable_balances').select(['item_key', 'balance']).where('user_id', '=', userId).execute(),
      this.paymentHistory(userId, 5),
    ]);
    const facts = await this.db.selectFrom('users').select('country_code').where('id', '=', userId).executeTakeFirstOrThrow();
    const allowances = Object.fromEntries(await Promise.all(METERED.map(async (k) => [k, await this.entitlements.allowance(userId, k, facts.country_code)] as const)));
    void locale;
    return {
      subscriptions: subs.map((s) => ({
        id: s.id, provider: s.provider, status: s.status, productKey: s.product_key, tier: s.tier, renewsAt: s.current_period_end ? new Date(s.current_period_end).toISOString() : null,
        trialEndsAt: s.trial_end ? new Date(s.trial_end).toISOString() : null, cancelAtPeriodEnd: s.cancel_at_period_end, pendingProductKey: s.pending_product_key,
        manageUrl: s.provider === 'apple' ? 'https://apps.apple.com/account/subscriptions' : s.provider === 'google' ? `https://play.google.com/store/account/subscriptions?package=${this.cfg.GOOGLE_PLAY_PACKAGE ?? ''}` : null,
      })),
      entitlements: ents.filter((e) => !METERED.includes(e.key)).map((e) => e.key),
      allowances,
      balances: Object.fromEntries(balances.map((b) => [b.item_key, b.balance])),
      recentPayments: payments.items,
    };
  }

  async paymentHistory(userId: string, limit: number, cursor?: string) {
    const c = decodeCursor<[string, string]>(cursor, 2);
    let qb = this.db.selectFrom('payments as pay').leftJoin('billing_products as p', 'p.id', 'pay.product_id')
      .select(['pay.id', 'pay.provider', 'pay.kind', 'pay.amount_minor', 'pay.currency', 'pay.status', 'pay.refunded_minor', 'pay.receipt_url', 'pay.created_at', 'p.key as product_key'])
      .where('pay.user_id', '=', userId).orderBy('pay.created_at', 'desc').orderBy('pay.id', 'desc').limit(limit + 1);
    if (c) qb = qb.where((eb) => eb.or([eb('pay.created_at', '<', new Date(c[0])), eb.and([eb('pay.created_at', '=', new Date(c[0])), eb('pay.id', '<', c[1])])]));
    const rows = await qb.execute();
    const items = rows.slice(0, limit);
    return {
      items: items.map((r) => ({ id: r.id, provider: r.provider, kind: r.kind, productKey: r.product_key, amountMinor: Number(r.amount_minor), currency: r.currency, status: r.status, refundedMinor: Number(r.refunded_minor), receiptUrl: r.receipt_url, at: new Date(r.created_at).toISOString() })),
      nextCursor: rows.length > limit ? encodeCursor([new Date(items.at(-1)!.created_at).toISOString(), items.at(-1)!.id]) : null,
    };
  }

  private async ownedSub(userId: string, subId: string) {
    const s = await this.db.selectFrom('subscriptions').selectAll().where('id', '=', subId).where('user_id', '=', userId).executeTakeFirst();
    if (!s) throw new AppError('NOT_FOUND');
    if (s.provider !== 'stripe') throw new AppError('MANAGE_IN_STORE', 'Manage this subscription in the app store', { provider: s.provider });
    if (!this.stripe) throw new AppError('PAYMENT_PROVIDER_NOT_CONFIGURED');
    return s;
  }

  async setCancel(userId: string, subId: string, cancel: boolean) {
    const s = await this.ownedSub(userId, subId);
    await this.apply(normalizeStripeSubscription(await this.stripe!.cancelAtPeriodEnd(s.provider_subscription_id!, cancel)));
    return this.me(userId, 'en');
  }

  async changePlan(userId: string, subId: string, priceId: string) {
    const s = await this.ownedSub(userId, subId);
    const [cur, next] = await Promise.all([
      this.db.selectFrom('billing_products').select('rank').where('id', '=', s.product_id).executeTakeFirstOrThrow(),
      this.db.selectFrom('billing_prices as pr').innerJoin('billing_products as p', 'p.id', 'pr.product_id').select(['pr.provider_price_id', 'p.rank', 'p.kind']).where('pr.id', '=', priceId).where('pr.provider', '=', 'stripe').where('pr.is_active', '=', true).executeTakeFirst(),
    ]);
    if (!next || next.kind !== 'subscription') throw new AppError('NOT_FOUND');
    const upgrade = next.rank > cur.rank;
    const sub = await this.stripe!.retrieveSubscription(s.provider_subscription_id!);
    // Upgrades apply now with proration; downgrades take effect at renewal (no proration).
    await this.apply(normalizeStripeSubscription(await this.stripe!.changePrice(sub, next.provider_price_id, upgrade, `change:${subId}:${priceId}`)));
    return this.me(userId, 'en');
  }

  // ------------------------------------------------------------------------------------ coupons & boosts

  async validateCoupon(userId: string, code: string, productKey?: string) {
    const c = await this.db.selectFrom('coupons').selectAll().where('code', '=', code).where('is_active', '=', true).executeTakeFirst();
    const now = new Date();
    if (!c || new Date(c.valid_from) > now || (c.valid_until && new Date(c.valid_until) < now)) throw new AppError('COUPON_INVALID');
    const [{ total }, { mine }, user] = await Promise.all([
      this.db.selectFrom('coupon_redemptions').select(sql<number>`count(*)::int`.as('total')).where('coupon_id', '=', c.id).executeTakeFirstOrThrow(),
      this.db.selectFrom('coupon_redemptions').select(sql<number>`count(*)::int`.as('mine')).where('coupon_id', '=', c.id).where('user_id', '=', userId).executeTakeFirstOrThrow(),
      this.db.selectFrom('users').select('country_code').where('id', '=', userId).executeTakeFirstOrThrow(),
    ]);
    if ((c.max_redemptions && total >= c.max_redemptions) || mine >= c.per_user_limit) throw new AppError('COUPON_INVALID', 'Coupon fully redeemed');
    if (c.country_codes && (!user.country_code || !c.country_codes.includes(user.country_code))) throw new AppError('COUPON_INVALID', 'Not available in your country');
    if (productKey && c.product_ids) {
      const p = await this.db.selectFrom('billing_products').select('id').where('key', '=', productKey).executeTakeFirst();
      if (!p || !c.product_ids.includes(p.id)) throw new AppError('COUPON_INVALID', 'Not valid for this product');
    }
    if (['percent', 'amount', 'free_trial_days'].includes(c.discount_type) && productKey && !c.provider_coupon_id) throw new AppError('COUPON_INVALID', 'Coupon not configured with the payment provider');
    return c;
  }

  /** Grant-type coupons apply immediately; discount coupons are validated here and applied at checkout. */
  async redeem(userId: string, code: string) {
    const c = await this.validateCoupon(userId, code);
    if (c.discount_type !== 'grant_entitlement') return { type: c.discount_type, applied: false, message: 'apply_at_checkout' };
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('coupon_redemptions').values({ coupon_id: c.id, user_id: userId }).execute();
      await trx.insertInto('entitlements').values({ user_id: userId, entitlement_key: c.grant_entitlement_key!, source_type: 'promotion', source_id: c.id, ends_at: new Date(Date.now() + c.grant_days! * 86_400_000) }).execute();
    });
    return { type: c.discount_type, applied: true, entitlement: c.grant_entitlement_key, days: c.grant_days };
  }

  async activateBoost(userId: string, kind: 'boost' | 'spotlight') {
    const minutes = await this.settings.get<number>(`${kind}.duration_minutes`, kind === 'boost' ? 30 : 60);
    const active = await this.db.selectFrom('boosts').select(['ends_at']).where('user_id', '=', userId).where('ends_at', '>', new Date()).executeTakeFirst();
    if (active) throw new AppError('CONFLICT', 'A boost is already running', { endsAt: new Date(active.ends_at).toISOString() });
    const profile = await this.db.selectFrom('user_profiles').select(['city_id', 'is_discoverable']).where('user_id', '=', userId).executeTakeFirst();
    if (!profile?.is_discoverable) throw new AppError('PROFILE_INCOMPLETE', 'Your profile must be visible to boost it');
    const boost = await this.db.transaction().execute(async (trx) => {
      const bal = await trx.updateTable('consumable_balances').set((eb) => ({ balance: eb('balance', '-', 1), updated_at: new Date() }))
        .where('user_id', '=', userId).where('item_key', '=', kind).where('balance', '>', 0).returning('balance').executeTakeFirst();
      if (!bal) throw new AppError('ENTITLEMENT_REQUIRED', 'No boosts left', { item: kind });
      const ledger = await trx.insertInto('consumable_ledger').values({ user_id: userId, item_key: kind, delta: -1, reason: 'consume' }).returning('id').executeTakeFirstOrThrow();
      return trx.insertInto('boosts').values({ user_id: userId, kind, ends_at: new Date(Date.now() + minutes * 60_000), city_id: profile.city_id, ledger_id: ledger.id }).returning(['id', 'ends_at']).executeTakeFirstOrThrow();
    });
    await this.analytics.track('boost_activated', { userId, properties: { kind, minutes } });
    return { boostId: boost.id, endsAt: new Date(boost.ends_at).toISOString() };
  }

  // ------------------------------------------------------------------------------------ admin helpers

  async adminGrant(adminId: string, input: { userId: string; entitlementKey?: string; days?: number; consumable?: { itemKey: string; quantity: number }; reasonKey: string }) {
    await this.db.transaction().execute(async (trx) => {
      if (input.entitlementKey) {
        await trx.insertInto('entitlements').values({ user_id: input.userId, entitlement_key: input.entitlementKey, source_type: 'admin_grant', ends_at: input.days ? new Date(Date.now() + input.days * 86_400_000) : null }).execute();
      }
      if (input.consumable) await this.credit(trx, input.userId, input.consumable.itemKey, input.consumable.quantity, 'admin_adjustment', null);
      await this.audit.record({ actorType: 'admin', actorId: adminId, action: 'billing.granted', targetType: 'user', targetId: input.userId, after: input }, trx);
    });
  }

  /** `adminId` null = system-initiated (e.g. event cancelled by organizer). */
  async adminRefund(adminId: string | null, paymentId: string, amountMinor: number | undefined, reason: string) {
    const p = await this.db.selectFrom('payments').selectAll().where('id', '=', paymentId).executeTakeFirst();
    if (!p) throw new AppError('NOT_FOUND');
    if (p.status !== 'succeeded' && p.status !== 'partially_refunded') throw new AppError('CONFLICT', `Payment is ${p.status}`);
    const amount = amountMinor ?? Number(p.amount_minor) - Number(p.refunded_minor);
    if (amount <= 0 || amount > Number(p.amount_minor) - Number(p.refunded_minor)) throw new AppError('VALIDATION_FAILED', 'Invalid refund amount');
    if (p.provider !== 'stripe') {
      // Store refunds are issued by Apple/Google; we record the request and the store notification finalizes it.
      await this.db.insertInto('refunds').values({ payment_id: paymentId, amount_minor: amount, reason, status: 'requested', requested_by_admin: adminId }).execute();
      await this.audit.record({ actorType: adminId ? 'admin' : 'system', actorId: adminId, action: 'billing.refund_requested', targetType: 'payment', targetId: paymentId, after: { amount, provider: p.provider } });
      return { status: 'requested', instructions: p.provider === 'apple' ? 'Refunds for App Store purchases are issued by Apple (reportaproblem.apple.com).' : 'Issue the refund in Google Play Console; the voided-purchase notification updates this payment.' };
    }
    if (!this.stripe) throw new AppError('PAYMENT_PROVIDER_NOT_CONFIGURED');
    const r = await this.stripe.refund(p.provider_payment_id, amount, `refund:${paymentId}:${amount}`);
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('refunds').values({ payment_id: paymentId, provider_refund_id: r.id, amount_minor: amount, reason, status: r.status === 'succeeded' ? 'succeeded' : 'pending', requested_by_admin: adminId }).execute();
      await this.audit.record({ actorType: adminId ? 'admin' : 'system', actorId: adminId, action: 'billing.refunded', targetType: 'payment', targetId: paymentId, after: { amount, refundId: r.id }, reason }, trx);
    });
    return { status: r.status, refundId: r.id };
  }

  private async productName(productId: string): Promise<string> {
    return (await this.db.selectFrom('billing_product_translations').select('name').where('product_id', '=', productId).where('locale', '=', 'en').executeTakeFirst())?.name ?? 'your plan';
  }

  private async renewalNotices(): Promise<void> {
    const soon = await this.db.selectFrom('subscriptions').select(['id', 'user_id', 'product_id', 'current_period_end']).where('status', '=', 'active').where('cancel_at_period_end', '=', false)
      .where('current_period_end', '>', new Date(Date.now() + 2 * 86_400_000)).where('current_period_end', '<', new Date(Date.now() + 3 * 86_400_000)).execute();
    for (const s of soon) {
      await this.notifications.notify(s.user_id, 'subscription.renewal', { plan: await this.productName(s.product_id), date: new Date(s.current_period_end!).toISOString().slice(0, 10) }, { dedupeKey: `renewal:${s.id}:${new Date(s.current_period_end!).toISOString().slice(0, 10)}` });
    }
  }
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}
interface GoogleRtdn {
  subscriptionNotification?: { purchaseToken: string; subscriptionId: string; notificationType: number };
  voidedPurchaseNotification?: { purchaseToken: string; orderId: string };
}
