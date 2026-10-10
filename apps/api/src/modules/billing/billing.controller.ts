import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards, type RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
  adminCouponUpsert, adminFreeTierLimit, adminGrant, adminPriceUpsert, adminProductUpsert, adminRefund, appleReceipt, boostActivate, changePlanRequest, checkoutRequest,
  googleReceipt, pageQuery, productsQuery, queryBool, redeemCoupon,
} from '@amora/shared';
import type { Request } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { requestLocale } from '../../common/http/locale';
import { ZodPipe } from '../../common/http/zod.pipe';
import { assertUserInScope } from '../admin/auth/country-scope';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../admin/auth/admin.guard';
import { AuditedController } from '../admin/common/audited';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';
import { BillingService } from './billing.service';

type B<T extends z.ZodType> = z.infer<T>;
const id = new ParseUUIDPipe();

@ApiTags('billing')
@Controller('billing')
@UseGuards(UserAuthGuard)
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
  ) {}

  private async enabled(userId: string) {
    await this.flags.assertEnabled('subscriptions', await this.facts.load(userId));
  }

  @Get('products')
  async products(@CurrentUser() u: AuthContext, @Query(new ZodPipe(productsQuery)) q: B<typeof productsQuery>, @Req() req: Request) {
    await this.enabled(u.userId);
    const country = q.country ?? (await this.facts.load(u.userId)).countryCode;
    return this.billing.products(q.platform, country, requestLocale(req));
  }

  @Get('me')
  me(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.billing.me(u.userId, requestLocale(req));
  }

  @Get('payments')
  payments(@CurrentUser() u: AuthContext, @Query(new ZodPipe(pageQuery)) q: B<typeof pageQuery>) {
    return this.billing.paymentHistory(u.userId, q.limit, q.cursor);
  }

  @Post('checkout')
  async checkout(@CurrentUser() u: AuthContext, @Body(new ZodPipe(checkoutRequest)) b: B<typeof checkoutRequest>) {
    await this.enabled(u.userId);
    return this.billing.checkout(u.userId, b.priceId, b.couponCode, b.successUrl, b.cancelUrl);
  }

  @Post('receipts/apple')
  @HttpCode(200)
  async apple(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(new ZodPipe(appleReceipt)) b: B<typeof appleReceipt>) {
    return this.billing.appleReceipt(u.userId, b.signedTransaction, requestLocale(req));
  }

  @Post('receipts/google')
  @HttpCode(200)
  async google(@CurrentUser() u: AuthContext, @Req() req: Request, @Body(new ZodPipe(googleReceipt)) b: B<typeof googleReceipt>) {
    return this.billing.googleReceipt(u.userId, b.productId, b.purchaseToken, b.kind, requestLocale(req));
  }

  @Post('restore')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  restore(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.billing.restore(u.userId, requestLocale(req));
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthContext, @Param('id', id) sid: string) {
    return this.billing.setCancel(u.userId, sid, true);
  }

  @Post('subscriptions/:id/resume')
  @HttpCode(200)
  resume(@CurrentUser() u: AuthContext, @Param('id', id) sid: string) {
    return this.billing.setCancel(u.userId, sid, false);
  }

  @Post('subscriptions/:id/change')
  @HttpCode(200)
  change(@CurrentUser() u: AuthContext, @Param('id', id) sid: string, @Body(new ZodPipe(changePlanRequest)) b: B<typeof changePlanRequest>) {
    return this.billing.changePlan(u.userId, sid, b.priceId);
  }

  @Post('coupons/redeem')
  @HttpCode(200)
  redeem(@CurrentUser() u: AuthContext, @Body(new ZodPipe(redeemCoupon)) b: B<typeof redeemCoupon>) {
    return this.billing.redeem(u.userId, b.code);
  }

  @Post('boosts')
  boost(@CurrentUser() u: AuthContext, @Body(new ZodPipe(boostActivate)) b: B<typeof boostActivate>) {
    return this.billing.activateBoost(u.userId, b.kind);
  }
}

/** Provider webhooks: unauthenticated by design, authenticated by signature; never rate-limited away. */
@ApiTags('billing-webhooks')
@Controller('payments/webhooks')
@SkipThrottle()
export class WebhooksController {
  constructor(private readonly billing: BillingService) {}

  @Post('stripe')
  @HttpCode(200)
  stripe(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig?: string) {
    return this.billing.stripeWebhook(req.rawBody, sig);
  }

  @Post('apple')
  @HttpCode(200)
  apple(@Body(new ZodPipe(z.object({ signedPayload: z.string().min(50).max(100_000) }))) b: { signedPayload: string }) {
    return this.billing.appleWebhook(b.signedPayload);
  }

  @Post('google')
  @HttpCode(200)
  google(@Headers('authorization') auth: string | undefined, @Body() body: { message?: { messageId?: string; data?: string } }) {
    return this.billing.googleWebhook(auth, body);
  }
}

@ApiTags('admin-billing')
@Controller('admin/billing')
@UseGuards(AdminGuard)
export class AdminBillingController extends AuditedController {
  constructor(
    @Inject(DATABASE) db: Database,
    audit: AuditService,
    private readonly billing: BillingService,
  ) {
    super(db, audit);
  }

  @Get('products')
  @RequirePermissions('billing.view')
  async products() {
    const [p, pr, e, tr] = await Promise.all([
      this.db.selectFrom('billing_products').selectAll().orderBy('rank').execute(),
      this.db.selectFrom('billing_prices').selectAll().execute(),
      this.db.selectFrom('plan_entitlements').selectAll().execute(),
      this.db.selectFrom('billing_product_translations').selectAll().execute(),
    ]);
    return p.map((x) => ({
      ...x, prices: pr.filter((y) => y.product_id === x.id), entitlements: e.filter((y) => y.product_id === x.id),
      translations: Object.fromEntries(tr.filter((t) => t.product_id === x.id).map((t) => [t.locale, { name: t.name, description: t.description }])),
    }));
  }

  @Put('products/:key')
  @RequirePermissions('billing.plans.manage')
  async upsertProduct(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminProductUpsert)) b: B<typeof adminProductUpsert>) {
    if (key !== b.key) throw new AppError('VALIDATION_FAILED', 'key mismatch');
    if (b.kind === 'consumable' && !b.consumableGrant) throw new AppError('VALIDATION_FAILED', 'Consumables need consumableGrant');
    const before = await this.db.selectFrom('billing_products').selectAll().where('key', '=', key).executeTakeFirst();
    return this.write(a, req, 'billing.product_upserted', { type: 'billing_product', id: key }, before ?? null, async (trx) => {
      const v = { kind: b.kind, tier: b.tier, rank: b.rank, is_active: b.isActive, consumable_item_key: b.consumableGrant?.itemKey ?? null, consumable_quantity: b.consumableGrant?.quantity ?? null };
      const row = await trx.insertInto('billing_products').values({ key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
      await trx.deleteFrom('billing_product_translations').where('product_id', '=', row.id).execute();
      await trx.insertInto('billing_product_translations').values(Object.entries(b.translations).map(([locale, t]) => ({ product_id: row.id, locale, name: t.name, description: t.description ?? null }))).execute();
      await trx.deleteFrom('plan_entitlements').where('product_id', '=', row.id).execute();
      if (b.entitlements.length) await trx.insertInto('plan_entitlements').values(b.entitlements.map((e) => ({ product_id: row.id, entitlement_key: e.key, limit_value: e.limit, limit_period: e.period }))).execute();
      return row;
    });
  }

  @Post('products/:key/prices')
  @RequirePermissions('billing.plans.manage')
  async upsertPrice(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminPriceUpsert)) b: B<typeof adminPriceUpsert>) {
    const p = await this.db.selectFrom('billing_products').select(['id', 'kind']).where('key', '=', key).executeTakeFirst();
    if (!p) throw new AppError('NOT_FOUND');
    if (p.kind === 'subscription' && !b.billingInterval) throw new AppError('VALIDATION_FAILED', 'Subscriptions need billingInterval');
    return this.write(a, req, 'billing.price_upserted', { type: 'billing_price', id: `${b.provider}:${b.providerPriceId}` }, null, (trx) => {
      const v = { product_id: p.id, currency: b.currency, amount_minor: b.amountMinor, billing_interval: b.billingInterval, interval_count: b.intervalCount, trial_days: b.trialDays, quantity: b.quantity, country_codes: b.countryCodes, is_active: b.isActive };
      return trx.insertInto('billing_prices').values({ provider: b.provider, provider_price_id: b.providerPriceId, ...v }).onConflict((oc) => oc.columns(['provider', 'provider_price_id']).doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
    });
  }

  @Get('free-tier')
  @RequirePermissions('billing.view')
  freeTier() {
    return this.db.selectFrom('free_tier_limits').selectAll().orderBy('entitlement_key').execute();
  }

  @Put('free-tier/:key')
  @RequirePermissions('billing.plans.manage')
  async setFreeTier(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminFreeTierLimit)) b: B<typeof adminFreeTierLimit>) {
    const before = await this.db.selectFrom('free_tier_limits').selectAll().where('entitlement_key', '=', key).executeTakeFirst();
    return this.write(a, req, 'billing.free_tier_updated', { type: 'free_tier_limit', id: key }, before ?? null, (trx) => {
      const v = { limit_value: b.limitValue, limit_period: b.limitPeriod, country_overrides: JSON.stringify(b.countryOverrides) };
      return trx.insertInto('free_tier_limits').values({ entitlement_key: key, ...v }).onConflict((oc) => oc.column('entitlement_key').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
    });
  }

  @Get('users/:id')
  @RequirePermissions('billing.view')
  async user(@CurrentAdmin() a: AdminContext, @Param('id', id) uid: string) {
    await assertUserInScope(this.db, a, uid);
    const [subs, payments, ents, balances, ledger] = await Promise.all([
      this.db.selectFrom('subscriptions').selectAll().where('user_id', '=', uid).orderBy('created_at', 'desc').execute(),
      this.billing.paymentHistory(uid, 50),
      this.db.selectFrom('entitlements').selectAll().where('user_id', '=', uid).orderBy('starts_at', 'desc').limit(100).execute(),
      this.db.selectFrom('consumable_balances').selectAll().where('user_id', '=', uid).execute(),
      this.db.selectFrom('consumable_ledger').selectAll().where('user_id', '=', uid).orderBy('created_at', 'desc').limit(100).execute(),
    ]);
    return { subscriptions: subs, payments: payments.items, entitlements: ents, balances, ledger };
  }

  @Post('grants')
  @HttpCode(204)
  @RequirePermissions('billing.grant')
  async grant(@CurrentAdmin() a: AdminContext, @Body(new ZodPipe(adminGrant)) b: B<typeof adminGrant>) {
    await assertUserInScope(this.db, a, b.userId);
    await this.billing.adminGrant(a.adminId, b);
  }

  @Post('payments/:id/refund')
  @HttpCode(200)
  @RequirePermissions('billing.refund')
  async refund(@CurrentAdmin() a: AdminContext, @Param('id', id) pid: string, @Body(new ZodPipe(adminRefund)) b: B<typeof adminRefund>) {
    const p = await this.db.selectFrom('payments').select('user_id').where('id', '=', pid).executeTakeFirst();
    if (!p) throw new AppError('NOT_FOUND');
    await assertUserInScope(this.db, a, p.user_id);
    return this.billing.adminRefund(a.adminId, pid, b.amountMinor, b.reason);
  }

  @Get('coupons')
  @RequirePermissions('billing.coupons.manage')
  coupons() {
    // Every editable field is returned so the console's edit → PUT round-trip never wipes settings.
    return this.db.selectFrom('coupons as c').select(['c.id', 'c.code', 'c.description', 'c.discount_type', 'c.percent_off', 'c.amount_off_minor', 'c.currency', 'c.trial_days',
      'c.grant_entitlement_key', 'c.grant_days', 'c.country_codes', 'c.per_user_limit', 'c.provider_coupon_id', 'c.is_active', 'c.valid_from', 'c.valid_until', 'c.max_redemptions',
      (eb) => eb.selectFrom('billing_products as bp').select((e) => sql<string[]>`coalesce(array_agg(${e.ref('bp.key')}), '{}')`.as('k')).where(sql<boolean>`bp.id = ANY(c.product_ids)`).as('product_keys'),
      (eb) => eb.selectFrom('coupon_redemptions as r').select((e) => e.fn.countAll<number>().as('n')).whereRef('r.coupon_id', '=', 'c.id').as('redemptions')]).orderBy('c.created_at', 'desc').execute();
  }

  @Put('coupons/:code')
  @RequirePermissions('billing.coupons.manage')
  async upsertCoupon(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('code') code: string, @Body(new ZodPipe(adminCouponUpsert)) b: B<typeof adminCouponUpsert>) {
    if (code.toLowerCase() !== b.code.toLowerCase()) throw new AppError('VALIDATION_FAILED', 'code mismatch');
    const productIds = b.productKeys ? (await this.db.selectFrom('billing_products').select('id').where('key', 'in', b.productKeys.length ? b.productKeys : ['__none__']).execute()).map((p) => p.id) : null;
    const before = await this.db.selectFrom('coupons').selectAll().where('code', '=', b.code).executeTakeFirst();
    return this.write(a, req, 'billing.coupon_upserted', { type: 'coupon', id: b.code }, before ?? null, (trx) => {
      const v = {
        description: b.description ?? null, discount_type: b.discountType, percent_off: b.percentOff, amount_off_minor: b.amountOffMinor, currency: b.currency, trial_days: b.trialDays,
        grant_entitlement_key: b.grantEntitlementKey, grant_days: b.grantDays, product_ids: productIds, country_codes: b.countryCodes, max_redemptions: b.maxRedemptions,
        per_user_limit: b.perUserLimit, valid_from: b.validFrom ? new Date(b.validFrom) : new Date(), valid_until: b.validUntil ? new Date(b.validUntil) : null, provider_coupon_id: b.providerCouponId, is_active: b.isActive,
      };
      return trx.insertInto('coupons').values({ code: b.code, created_by: a.adminId, ...v }).onConflict((oc) => oc.column('code').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
    });
  }

  @Get('webhooks')
  @RequirePermissions('billing.view')
  webhooks(@Query(new ZodPipe(pageQuery.extend({ failed: queryBool.optional() }))) q: { limit: number; failed?: boolean }) {
    let qb = this.db.selectFrom('payment_webhook_events').select(['id', 'provider', 'provider_event_id', 'event_type', 'received_at', 'processed_at', 'attempts', 'last_error']).orderBy('received_at', 'desc').limit(q.limit);
    if (q.failed) qb = qb.where('processed_at', 'is', null).where('attempts', '>', 0);
    return qb.execute();
  }

  @Post('webhooks/:id/replay')
  @HttpCode(204)
  @RequirePermissions('billing.plans.manage')
  async replay(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', id) wid: string) {
    await this.write(a, req, 'billing.webhook_replayed', { type: 'payment_webhook_event', id: wid }, null, async () => ({ ok: true }));
    await this.billing.processWebhook(wid);
  }
}
