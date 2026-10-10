import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { activeUser, adminSession, createTestApp, discoverableUser, drainOutbox, type TestApp } from './helpers';

const WEBHOOK_SECRET = 'whsec_e2e_secret';

/** Records Stripe API calls and answers with canned objects (stand-in for api.stripe.com in tests only). */
function stripeStub() {
  const calls: Array<{ method: string; path: string; body: URLSearchParams }> = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = new URLSearchParams(raw);
      calls.push({ method: req.method!, path: req.url!, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/customers') return res.end(JSON.stringify({ id: `cus_${calls.length}` }));
      if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: `cs_${calls.length}`, url: `https://checkout.stripe.test/cs_${calls.length}` }));
      if (req.url === '/v1/refunds') return res.end(JSON.stringify({ id: `re_${calls.length}`, status: 'succeeded' }));
      res.statusCode = 404;
      res.end(JSON.stringify({ error: { message: 'not stubbed' } }));
    });
  });
  return { calls, server };
}

describe('Billing (e2e)', () => {
  let t: TestApp;
  const stub = stripeStub();
  let premiumPrice: string;
  let premiumMonthlyStripe = 'price_premium_month_e2e';

  beforeAll(async () => {
    await new Promise<void>((r) => stub.server.listen(0, r));
    t = await createTestApp({
      STRIPE_SECRET_KEY: 'sk_test_e2e', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_API_BASE: `http://127.0.0.1:${(stub.server.address() as AddressInfo).port}`,
      CHECKOUT_RETURN_ORIGINS: 'https://amora.test',
    });
    const fin = await adminSession(t, 'finance_admin');
    const p = await fin.as(t.http.post('/v1/admin/billing/products/premium/prices')).send({ provider: 'stripe', providerPriceId: premiumMonthlyStripe, currency: 'USD', amountMinor: 1999, billingInterval: 'month', trialDays: 7 }).expect(201);
    premiumPrice = p.body.id;
    await fin.as(t.http.post('/v1/admin/billing/products/ai_premium/prices')).send({ provider: 'stripe', providerPriceId: 'price_ai_month_e2e', currency: 'USD', amountMinor: 2999, billingInterval: 'month' }).expect(201);
    await fin.as(t.http.post('/v1/admin/billing/products/super_like_5/prices')).send({ provider: 'stripe', providerPriceId: 'price_sl5_e2e', currency: 'USD', amountMinor: 499 }).expect(201);
    await fin.as(t.http.post('/v1/admin/billing/products/boost_1/prices')).send({ provider: 'stripe', providerPriceId: 'price_boost1_e2e', currency: 'USD', amountMinor: 399 }).expect(201);
  });
  afterAll(async () => {
    await t.close();
    stub.server.close();
  });

  const sign = (payload: object) => {
    const body = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);
    return { body, sig: `t=${ts},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex')}` };
  };
  const webhook = async (evt: object) => {
    const { body, sig } = sign(evt);
    const res = await t.http.post('/v1/payments/webhooks/stripe').set('Stripe-Signature', sig).set('Content-Type', 'application/json').send(body).expect(200);
    await drainOutbox(t);
    return res.body;
  };
  const sub = (id: string, userId: string, price: string, over: Record<string, unknown> = {}) => ({
    id, customer: 'cus_x', status: 'active', current_period_start: Math.floor(Date.now() / 1000), current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    trial_end: null, cancel_at_period_end: false, metadata: { user_id: userId }, items: { data: [{ id: 'si_1', price: { id: price } }] }, ...over,
  });

  it('lists products with localized names and entitlements for the platform', async () => {
    const u = await activeUser(t);
    const web = (await t.http.get('/v1/billing/products?platform=web').set(u.auth).expect(200)).body;
    expect(web.find((p: { productKey: string }) => p.productKey === 'premium')).toMatchObject({ name: 'Premium', amountMinor: 1999, trialDays: 7, entitlements: expect.arrayContaining([{ key: 'likes', limit: null, period: null }]) });
    expect((await t.http.get('/v1/billing/products?platform=ios').set(u.auth).expect(200)).body).toEqual([]); // no App Store prices configured
  });

  it('creates a Stripe checkout session bound to the user, with the trial only once and a return-URL allow-list', async () => {
    const u = await activeUser(t);
    await t.http.post('/v1/billing/checkout').set(u.auth).send({ priceId: premiumPrice, successUrl: 'https://evil.test/ok', cancelUrl: 'https://amora.test/c' }).expect(400);
    const r = await t.http.post('/v1/billing/checkout').set(u.auth).send({ priceId: premiumPrice, successUrl: 'https://amora.test/ok', cancelUrl: 'https://amora.test/c' }).expect(201);
    expect(r.body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    const session = stub.calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1)!;
    expect(session.body.get('client_reference_id')).toBe(u.id);
    expect(session.body.get('subscription_data[trial_period_days]')).toBe('7');
    expect(session.body.get('line_items[0][price]')).toBe(premiumMonthlyStripe);
  });

  it('rejects unsigned webhooks and processes signed ones idempotently into entitlements', async () => {
    const u = await activeUser(t);
    await t.http.post('/v1/payments/webhooks/stripe').set('Stripe-Signature', 't=1,v1=00').set('Content-Type', 'application/json').send('{"id":"evt_x"}').expect(400);
    const evt = { id: `evt_${u.id}`, type: 'customer.subscription.created', data: { object: sub(`sub_${u.id}`, u.id, premiumMonthlyStripe) } };
    expect(await webhook(evt)).toEqual({ received: true, duplicate: false });
    expect(await webhook(evt)).toEqual({ received: true, duplicate: true });

    const me = (await t.http.get('/v1/billing/me').set(u.auth).expect(200)).body;
    expect(me.subscriptions[0]).toMatchObject({ status: 'active', productKey: 'premium', cancelAtPeriodEnd: false });
    expect(me.entitlements).toEqual(expect.arrayContaining(['advanced_filters', 'incognito', 'see_who_liked', 'priority_discovery']));
    expect(me.allowances.likes).toMatchObject({ unlimited: true });
    expect(me.allowances.super_likes).toMatchObject({ unlimited: false, limit: 5, period: 'week' });
    expect((await t.db.selectFrom('analytics_events').select('name').where('user_id', '=', u.id).execute()).map((e) => e.name)).toContain('subscription_started');

    // Premium entitlement immediately unlocks a premium feature server-side.
    await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'Paid' }).expect(200);
    await t.http.put('/v1/profiles/me/privacy').set(u.auth).send({ incognito: true }).expect(200);

    await webhook({ id: `evt_cancel_${u.id}`, type: 'customer.subscription.updated', data: { object: sub(`sub_${u.id}`, u.id, premiumMonthlyStripe, { cancel_at_period_end: true }) } });
    expect((await t.http.get('/v1/billing/me').set(u.auth)).body.subscriptions[0].cancelAtPeriodEnd).toBe(true);
    await webhook({ id: `evt_del_${u.id}`, type: 'customer.subscription.deleted', data: { object: sub(`sub_${u.id}`, u.id, premiumMonthlyStripe, { status: 'canceled' }) } });
    const after = (await t.http.get('/v1/billing/me').set(u.auth)).body;
    expect(after.entitlements).toEqual([]);
    expect(after.allowances.likes.unlimited).toBe(false);
  });

  it('keeps the higher plan until renewal on downgrade, and upgrades immediately', async () => {
    const u = await activeUser(t);
    const end = Math.floor(Date.now() / 1000) + 20 * 86400;
    await webhook({ id: `evt_ai_${u.id}`, type: 'customer.subscription.created', data: { object: sub(`sub_d_${u.id}`, u.id, 'price_ai_month_e2e', { current_period_end: end }) } });
    expect((await t.http.get('/v1/billing/me').set(u.auth)).body.entitlements).toContain('ai_coach_advanced');
    await webhook({ id: `evt_down_${u.id}`, type: 'customer.subscription.updated', data: { object: sub(`sub_d_${u.id}`, u.id, premiumMonthlyStripe, { current_period_end: end }) } });
    const mid = (await t.http.get('/v1/billing/me').set(u.auth)).body;
    expect(mid.subscriptions[0]).toMatchObject({ productKey: 'ai_premium', pendingProductKey: 'premium' });
    expect(mid.entitlements).toContain('ai_coach_advanced');
    await webhook({ id: `evt_renew_${u.id}`, type: 'customer.subscription.updated', data: { object: sub(`sub_d_${u.id}`, u.id, premiumMonthlyStripe, { current_period_start: end, current_period_end: end + 30 * 86400 }) } });
    const renewed = (await t.http.get('/v1/billing/me').set(u.auth)).body;
    expect(renewed.subscriptions[0]).toMatchObject({ productKey: 'premium', pendingProductKey: null });
    expect(renewed.entitlements).not.toContain('ai_coach_advanced');
  });

  it('credits consumables once, spends them (super likes, boosts) and claws back on refund', async () => {
    const u = await discoverableUser(t, { gender: 'woman', seeking: ['man'], lat: 25.2048, lon: 55.2708 });
    const target = await discoverableUser(t, { gender: 'man', seeking: ['woman'], lat: 25.2048, lon: 55.2708 });
    const paid = { id: `evt_pay_${u.id}`, type: 'checkout.session.completed', data: { object: { mode: 'payment', client_reference_id: u.id, metadata: { price_id: 'price_sl5_e2e' }, payment_intent: `pi_${u.id}`, amount_total: 499, currency: 'usd', payment_status: 'paid' } } };
    await webhook(paid);
    await webhook({ ...paid, id: `evt_pay2_${u.id}` }); // different event, same payment → still credited once
    expect((await t.http.get('/v1/billing/me').set(u.auth)).body.balances.super_like).toBe(5);

    await t.db.updateTable('free_tier_limits').set({ limit_value: 0 }).where('entitlement_key', '=', 'super_likes').execute();
    try {
      await t.http.post('/v1/likes').set(u.auth).send({ targetId: target.id, action: 'super_like' }).expect(201);
    } finally {
      await t.db.updateTable('free_tier_limits').set({ limit_value: 1 }).where('entitlement_key', '=', 'super_likes').execute();
    }
    expect((await t.http.get('/v1/billing/me').set(u.auth)).body.balances.super_like).toBe(4);

    await webhook({ id: `evt_ref_${u.id}`, type: 'charge.refunded', data: { object: { payment_intent: `pi_${u.id}`, amount: 499, amount_refunded: 499 } } });
    expect((await t.http.get('/v1/billing/me').set(u.auth)).body.balances.super_like).toBe(0);

    await t.http.post('/v1/billing/boosts').set(u.auth).send({}).expect(402);
    await webhook({ id: `evt_boost_${u.id}`, type: 'checkout.session.completed', data: { object: { mode: 'payment', client_reference_id: u.id, metadata: { price_id: 'price_boost1_e2e' }, payment_intent: `pi_b_${u.id}`, amount_total: 399, currency: 'usd', payment_status: 'paid' } } });
    const boost = await t.http.post('/v1/billing/boosts').set(u.auth).send({}).expect(201);
    expect(new Date(boost.body.endsAt).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    await t.http.post('/v1/billing/boosts').set(u.auth).send({}).expect(409);
  });

  it('notifies on failed renewals, supports admin grants/refunds/coupons and never trusts the client', async () => {
    const u = await activeUser(t);
    await webhook({ id: `evt_s_${u.id}`, type: 'customer.subscription.created', data: { object: sub(`sub_f_${u.id}`, u.id, premiumMonthlyStripe) } });
    await webhook({ id: `evt_inv_${u.id}`, type: 'invoice.paid', data: { object: { id: `in_${u.id}`, subscription: `sub_f_${u.id}`, payment_intent: `pi_inv_${u.id}`, amount_paid: 1999, currency: 'usd', hosted_invoice_url: 'https://invoice.test' } } });
    await webhook({ id: `evt_fail_${u.id}`, type: 'invoice.payment_failed', data: { object: { id: `in2_${u.id}`, subscription: `sub_f_${u.id}`, payment_intent: `pi_inv2_${u.id}`, amount_due: 1999, currency: 'usd' } } });
    const notes = await t.db.selectFrom('notifications').select('category').where('user_id', '=', u.id).where('category', '=', 'subscription').execute();
    expect(notes.length).toBeGreaterThan(0);
    const history = (await t.http.get('/v1/billing/payments').set(u.auth).expect(200)).body.items;
    expect(history.map((p: { status: string }) => p.status).sort()).toEqual(['failed', 'succeeded']);

    const fin = await adminSession(t, 'finance_admin');
    const paidId = history.find((p: { status: string }) => p.status === 'succeeded').id;
    const refund = await fin.as(t.http.post(`/v1/admin/billing/payments/${paidId}/refund`)).send({ reason: 'goodwill', amountMinor: 500 }).expect(200);
    expect(refund.body.status).toBe('succeeded');
    expect(stub.calls.find((c) => c.path === '/v1/refunds')!.body.get('amount')).toBe('500');

    await fin.as(t.http.put('/v1/admin/billing/coupons/WELCOME7')).send({ code: 'WELCOME7', discountType: 'grant_entitlement', grantEntitlementKey: 'see_who_liked', grantDays: 7 }).expect(200);
    const other = await activeUser(t);
    expect((await t.http.post('/v1/billing/coupons/redeem').set(other.auth).send({ code: 'welcome7' }).expect(200)).body).toMatchObject({ applied: true, entitlement: 'see_who_liked' });
    await t.http.post('/v1/billing/coupons/redeem').set(other.auth).send({ code: 'WELCOME7' }).expect(400); // per-user limit
    await fin.as(t.http.post('/v1/admin/billing/grants')).send({ userId: other.id, consumable: { itemKey: 'boost', quantity: 2 }, reasonKey: 'support_goodwill' }).expect(204);
    expect((await t.http.get('/v1/billing/me').set(other.auth)).body.balances.boost).toBe(2);

    // App Store purchases require server verification; with no App Store config the API refuses rather than trusting the client.
    expect((await t.http.post('/v1/billing/receipts/apple').set(other.auth).send({ signedTransaction: 'x'.repeat(60) }).expect(503)).body.error.code).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
    const analyst = await adminSession(t, 'analyst');
    await analyst.as(t.http.post(`/v1/admin/billing/payments/${paidId}/refund`)).send({ reason: 'x' }).expect(403);
  });
});
