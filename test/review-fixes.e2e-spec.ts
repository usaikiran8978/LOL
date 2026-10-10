import { randomUUID } from 'node:crypto';
import { EventsService } from '../src/modules/events/events.service';
import { BillingService } from '../src/modules/billing/billing.service';
import { activeUser, adminSession, createTestApp, discoverableUser, drainOutbox, type TestApp } from './helpers';

/**
 * Regressions for defects found while building the admin console and the mobile app against the API
 * (country scope, permission gaps, contract bugs, idempotency races). One test per defect family.
 */
const PARIS = { lat: 48.8566, lon: 2.3522 };
const hour = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('Defect regressions (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  /** An admin with a custom role; optionally restricted to some countries. */
  async function customAdmin(permissions: string[], countryScope: string[] | null = null) {
    const key = `custom_${randomUUID().slice(0, 8)}`;
    const role = await t.db.insertInto('admin_roles').values({ key, name: key, is_system: false }).returning('id').executeTakeFirstOrThrow();
    await t.db.insertInto('admin_role_permissions').values(permissions.map((permission_key) => ({ role_id: role.id, permission_key }))).execute();
    const s = await adminSession(t, 'analyst');
    await t.db.deleteFrom('admin_user_roles').where('admin_user_id', '=', s.id).execute();
    await t.db.insertInto('admin_user_roles').values({ admin_user_id: s.id, role_id: role.id, country_scope: countryScope }).execute();
    return s;
  }

  async function matched() {
    const a = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...PARIS });
    const b = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...PARIS });
    await t.http.post('/v1/likes').set(a.auth).send({ targetId: b.id, action: 'like' }).expect(201);
    const m = await t.http.post('/v1/likes').set(b.auth).send({ targetId: a.id, action: 'like' }).expect(201);
    return { a, b, matchId: m.body.matchId as string, conversationId: m.body.conversationId as string };
  }

  it('enforces country scope on every user-targeted admin endpoint (out of scope = 404)', async () => {
    const u = await activeUser(t); // test users live in the US
    const ts = await adminSession(t, 'trust_safety');
    const kase = (await ts.as(t.http.post('/v1/admin/moderation/cases')).send({ subjectUserId: u.id, category: 'spam', severity: 'low' }).expect(201)).body.caseId as string;
    const act = (await ts.as(t.http.post(`/v1/admin/moderation/cases/${kase}/actions`)).send({ action: 'warn', reasonKey: 'spam' }).expect(200)).body.actionId as string;
    const pay = await t.db.insertInto('payments').values({ user_id: u.id, provider: 'stripe', provider_payment_id: `pi_scope_${u.id}`, kind: 'subscription', amount_minor: 999, currency: 'USD', status: 'succeeded' }).returning('id').executeTakeFirstOrThrow();
    const india = await customAdmin(['moderation.view', 'moderation.action', 'moderation.ban', 'billing.view', 'billing.grant', 'billing.refund', 'privacy.requests'], ['IN']);

    await india.as(t.http.put(`/v1/admin/moderation/cases/${kase}`)).send({ status: 'in_review' }).expect(404);
    await india.as(t.http.post(`/v1/admin/moderation/cases/${kase}/notes`)).send({ body: 'note' }).expect(404);
    await india.as(t.http.post(`/v1/admin/moderation/actions/${act}/reverse`)).send({}).expect(404);
    await india.as(t.http.get(`/v1/admin/billing/users/${u.id}`)).expect(404);
    await india.as(t.http.post('/v1/admin/billing/grants')).send({ userId: u.id, entitlementKey: 'see_who_liked', days: 1, reasonKey: 'goodwill' }).expect(404);
    await india.as(t.http.post(`/v1/admin/billing/payments/${pay.id}/refund`)).send({ reason: 'test' }).expect(404);
    await india.as(t.http.post('/v1/admin/privacy/requests')).send({ userId: u.id, kind: 'export' }).expect(404);
    const reports = (await india.as(t.http.get(`/v1/admin/moderation/reports?reportedUserId=${u.id}`)).expect(200)).body;
    expect(reports.items).toEqual([]);

    // The same admin unscoped can act.
    await t.db.updateTable('admin_user_roles').set({ country_scope: null }).where('admin_user_id', '=', india.id).execute();
    await india.as(t.http.get(`/v1/admin/billing/users/${u.id}`)).expect(200);
  });

  it('requires moderation.ban to lift a ban, by reversal or by overturning an appeal', async () => {
    const u = await activeUser(t);
    const ts = await adminSession(t, 'trust_safety');
    const kase = (await ts.as(t.http.post('/v1/admin/moderation/cases')).send({ subjectUserId: u.id, category: 'spam', severity: 'high' }).expect(201)).body.caseId as string;
    const ban = (await ts.as(t.http.post(`/v1/admin/moderation/cases/${kase}/actions`)).send({ action: 'ban', reasonKey: 'spam' }).expect(200)).body.actionId as string;
    const noBan = await customAdmin(['moderation.view', 'moderation.action', 'moderation.appeals']);
    expect((await noBan.as(t.http.post(`/v1/admin/moderation/actions/${ban}/reverse`)).send({}).expect(403)).body.error.details.missing).toEqual(['moderation.ban']);
    const appeal = await t.db.insertInto('appeals').values({ user_id: u.id, action_id: ban, statement: 'Please review.' }).returning('id').executeTakeFirstOrThrow();
    const list = (await noBan.as(t.http.get('/v1/admin/moderation/appeals')).expect(200)).body;
    await noBan.as(t.http.get('/v1/admin/moderation/appeals?status=partially_overturned')).expect(200);
    expect(list.items.find((x: { id: string }) => x.id === appeal.id)).toMatchObject({ actor_id: ts.id }); // console can pre-empt the reviewer rule
    await noBan.as(t.http.post(`/v1/admin/moderation/appeals/${appeal.id}/decision`)).send({ decision: 'overturned' }).expect(403);
    await noBan.as(t.http.post(`/v1/admin/moderation/appeals/${appeal.id}/decision`)).send({ decision: 'upheld' }).expect(200);
  });

  it('parses boolean query parameters ("false" is false)', async () => {
    const sa = await adminSession(t, 'super_admin');
    const unverified = (await sa.as(t.http.get('/v1/admin/users?verified=false&limit=5')).expect(200)).body;
    const verified = (await sa.as(t.http.get('/v1/admin/users?verified=true&limit=5')).expect(200)).body;
    expect(unverified.items.every((u: { verification_level?: string; verificationLevel?: string }) => (u.verification_level ?? u.verificationLevel ?? 'none') === 'none')).toBe(true);
    expect(verified.items.every((u: { verification_level?: string; verificationLevel?: string }) => (u.verification_level ?? u.verificationLevel) !== 'none')).toBe(true);
    await sa.as(t.http.get('/v1/admin/users?verified=nope')).expect(400);
  });

  it('returns every editable coupon field so an edit round-trip keeps settings', async () => {
    const fin = await adminSession(t, 'finance_admin');
    const code = `KEEP${Date.now()}`;
    await fin.as(t.http.put(`/v1/admin/billing/coupons/${code}`)).send({ code, discountType: 'grant_entitlement', grantEntitlementKey: 'see_who_liked', grantDays: 7, perUserLimit: 1, countryCodes: ['US'], maxRedemptions: 50 }).expect(200);
    const c = (await fin.as(t.http.get('/v1/admin/billing/coupons')).expect(200)).body.find((x: { code: string }) => x.code === code);
    expect(c).toMatchObject({ grant_entitlement_key: 'see_who_liked', grant_days: 7, per_user_limit: 1, country_codes: ['US'], max_redemptions: 50, product_keys: [] });
  });

  it('returns a disabled-then-enabled invitee to "invited" (they have no password yet)', async () => {
    const sa = await adminSession(t, 'super_admin');
    const inv = await sa.as(t.http.post('/v1/admin/admins')).send({ email: `inv-${Date.now()}@amora.test`, displayName: 'Inv', roleKeys: ['analyst'] }).expect(201);
    await sa.as(t.http.post(`/v1/admin/admins/${inv.body.id}/disable`)).send({}).expect(204);
    await sa.as(t.http.post(`/v1/admin/admins/${inv.body.id}/enable`)).send({}).expect(204);
    expect((await t.db.selectFrom('admin_users').select('status').where('id', '=', inv.body.id).executeTakeFirstOrThrow()).status).toBe('invited');
  });

  it('keeps the numeric unit across drafts and refuses a new draft while a version is scheduled', async () => {
    const product = await adminSession(t, 'product_admin');
    const categoryId = (await t.db.selectFrom('question_categories').select('id').where('key', '=', 'lifestyle').executeTakeFirstOrThrow()).id;
    const version = { answerType: 'numeric_range', numericMin: 140, numericMax: 220, numericUnit: 'cm', translations: { en: { text: 'Preferred height?' } }, options: [] };
    const q = (await product.as(t.http.post('/v1/admin/questions')).send({ key: `height_${Date.now()}`, categoryId, version }).expect(201)).body;
    await product.as(t.http.post(`/v1/admin/questions/versions/${q.versionId}/publish`)).send({}).expect(200);
    const d = (await product.as(t.http.post(`/v1/admin/questions/${q.questionId}/drafts`)).send({}).expect(201)).body;
    expect((await t.db.selectFrom('question_versions').select('numeric_unit').where('id', '=', d.versionId).executeTakeFirstOrThrow()).numeric_unit).toBe('cm');
    await product.as(t.http.post(`/v1/admin/questions/versions/${d.versionId}/publish`)).send({ effectiveAt: hour(2) }).expect(200);
    const blocked = await product.as(t.http.post(`/v1/admin/questions/${q.questionId}/drafts`)).send({}).expect(409);
    expect(blocked.body.error.details.scheduledVersionId).toBe(d.versionId);
  });

  it('runs events end to end: transitions, edits with notice, counts, organizer roster and check-in by code', async () => {
    const sa = await adminSession(t, 'super_admin');
    const parisId = (await t.db.selectFrom('cities').select('id').where('name', '=', 'Paris').executeTakeFirstOrThrow()).id;
    const ev = (await sa.as(t.http.post('/v1/admin/events')).send({
      categoryKey: 'dating_mixer', title: 'Board games night', description: 'Bring a friend and a favourite game.', cityId: parisId, venueName: 'Cafe A', venueAddress: '1 Rue A',
      startsAt: hour(1), endsAt: hour(4), timezone: 'Europe/Paris', capacity: 10,
    }).expect(201)).body.id as string;
    await sa.as(t.http.post(`/v1/admin/events/${ev}/decision`)).send({ decision: 'reject' }).expect(409); // already published

    const shy = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...PARIS });
    await t.http.post(`/v1/events/${ev}/registration`).set(shy.auth).send({ openToMeet: false }).expect(201);
    const counts = (await sa.as(t.http.get('/v1/admin/events?limit=100')).expect(200)).body.items.find((e: { id: string }) => e.id === ev);
    expect(counts).toMatchObject({ registered_count: 1, waitlist_count: 0, checked_in_count: 0, capacity: 10 });
    const roster = (await sa.as(t.http.get(`/v1/admin/events/${ev}/attendees`)).expect(200)).body;
    expect(roster.map((r: { userId: string }) => r.userId)).toContain(shy.id); // includes people hidden from attendees

    await sa.as(t.http.put(`/v1/admin/events/${ev}`)).send({ capacity: 0 }).expect(400);
    await sa.as(t.http.put(`/v1/admin/events/${ev}`)).send({}).expect(400);
    await sa.as(t.http.put(`/v1/admin/events/${ev}`)).send({ venueName: 'Cafe B', changeNote: 'Bigger room.' }).expect(200);
    await sa.as(t.http.put(`/v1/admin/events/${ev}`)).send({ capacity: null }).expect(200); // back to unlimited
    const detail = (await sa.as(t.http.get(`/v1/admin/events/${ev}`)).expect(200)).body;
    expect(detail).toMatchObject({ id: ev, venue_name: 'Cafe B', capacity: null, category_key: 'dating_mixer', city: 'Paris' });
    await drainOutbox(t);
    const n = await t.db.selectFrom('notifications').select('rendered_body').where('user_id', '=', shy.id).where('rendered_body', 'like', '%Bigger room.%').executeTakeFirst();
    expect(n?.rendered_body).toContain('Board games night');

    const code = t.app.get(EventsService).checkInCode(ev, shy.id);
    await sa.as(t.http.post(`/v1/admin/events/${ev}/check-in`)).send({ code: 'ZZZZZZ' }).expect(400);
    await sa.as(t.http.post(`/v1/admin/events/${ev}/check-in`)).send({ code }).expect(204);
    expect((await t.db.selectFrom('event_attendees').select('status').where('event_id', '=', ev).where('user_id', '=', shy.id).executeTakeFirstOrThrow()).status).toBe('checked_in');
    expect((await sa.as(t.http.post(`/v1/admin/events/${ev}/check-in`)).send({ code, userId: shy.id }).expect(409)).body.error.details).toEqual({ alreadyCheckedIn: true });

    await sa.as(t.http.post(`/v1/admin/events/${ev}/decision`)).send({ decision: 'cancel' }).expect(204);
    await sa.as(t.http.post(`/v1/admin/events/${ev}/decision`)).send({ decision: 'cancel' }).expect(409); // no second round of notices
  });

  it('makes concurrent sends with one client id idempotent and serves a single conversation', async () => {
    const { a, conversationId } = await matched();
    const body = { clientMessageId: `race-${randomUUID()}`, kind: 'text', body: 'Hello there!' };
    const [r1, r2] = await Promise.all([
      t.http.post(`/v1/conversations/${conversationId}/messages`).set(a.auth).send(body),
      t.http.post(`/v1/conversations/${conversationId}/messages`).set(a.auth).send(body),
    ]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    expect(r1.body.id).toBe(r2.body.id);
    const conv = (await t.http.get(`/v1/conversations/${conversationId}`).set(a.auth).expect(200)).body;
    expect(conv).toMatchObject({ id: conversationId, kind: 'match', participants: [expect.objectContaining({ displayName: expect.any(String) })] });
    const stranger = await activeUser(t);
    await t.http.get(`/v1/conversations/${conversationId}`).set(stranger.auth).expect(404);
  });

  it('never strips a push token from another device when registration is rejected', async () => {
    const u = await activeUser(t);
    const other = await activeUser(t);
    const token = `fcm-token-${randomUUID()}`;
    const dev = await t.db.selectFrom('user_devices').select('installation_id').where('user_id', '=', other.id).executeTakeFirstOrThrow();
    await t.http.post('/v1/devices/push-token').set(other.auth).send({ installationId: dev.installation_id, provider: 'fcm', token }).expect(204);
    await t.http.post('/v1/devices/push-token').set(u.auth).send({ installationId: 'not-my-device-123', provider: 'fcm', token }).expect(404);
    expect((await t.db.selectFrom('user_devices').select('push_token').where('user_id', '=', other.id).executeTakeFirstOrThrow()).push_token).toBe(token);
  });

  it('previews a draft notification template version', async () => {
    const admin = await adminSession(t, 'super_admin');
    const v = (await admin.as(t.http.post('/v1/admin/notifications/templates/system.announcement/versions')).send({ variables: ['title', 'body'], contents: [{ locale: 'en', channel: 'in_app', title: 'DRAFT {{title}}', body: '{{body}}' }] }).expect(201)).body;
    const draft = (await admin.as(t.http.post('/v1/admin/notifications/templates/system.announcement/preview')).send({ channel: 'in_app', versionId: v.id, variables: { title: 'T', body: 'B' } }).expect(200)).body;
    expect(draft.title).toBe('DRAFT T');
    const live = (await admin.as(t.http.post('/v1/admin/notifications/templates/system.announcement/preview')).send({ channel: 'in_app', variables: { title: 'T', body: 'B' } }).expect(200)).body;
    expect(live.title).toBe('T');
    await admin.as(t.http.post('/v1/admin/notifications/templates/auth.otp/preview')).send({ channel: 'email', versionId: v.id }).expect(404);
  });

  it('lets date-safety managers tune limits and the date-idea catalog', async () => {
    const ts = await adminSession(t, 'trust_safety');
    const settings = (await ts.as(t.http.get('/v1/admin/dates/safety/settings')).expect(200)).body;
    expect(settings.map((s: { key: string }) => s.key)).toContain('date_safety.max_trusted_contacts');
    await ts.as(t.http.put('/v1/admin/dates/safety/settings/date_safety.max_trusted_contacts')).send({ value: 99 }).expect(400);
    await ts.as(t.http.put('/v1/admin/dates/safety/settings/nope')).send({ value: 1 }).expect(404);
    await ts.as(t.http.put('/v1/admin/dates/safety/settings/date_safety.max_trusted_contacts')).send({ value: 1 }).expect(200);
    const u = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...PARIS });
    await t.http.post('/v1/dates/safety/contacts').set(u.auth).send({ name: 'One', phone: `+3361234${String(Date.now()).slice(-4)}` }).expect(201);
    expect((await t.http.post('/v1/dates/safety/contacts').set(u.auth).send({ name: 'Two', phone: `+3361235${String(Date.now()).slice(-4)}` }).expect(429)).body.error.details.limit).toBe(1);
    await ts.as(t.http.put('/v1/admin/dates/safety/settings/date_safety.max_trusted_contacts')).send({ value: 5 }).expect(200);
    // An SOS session is still open: no second session until it is resolved.
    const open = await t.db.insertInto('date_safety_sessions').values({ user_id: u.id, status: 'sos', share_details: false, share_live_location: false, starts_at: new Date(), check_in_due_at: new Date(Date.now() + 3_600_000), grace_minutes: 5 }).returning('id').executeTakeFirstOrThrow();
    expect((await t.http.post('/v1/dates/safety/sessions').set(u.auth).send({ startsAt: new Date().toISOString(), checkInAfterMin: 60 }).expect(409)).body.error.details.sessionId).toBe(open.id);

    const key = `picnic_${Date.now()}`;
    await ts.as(t.http.put(`/v1/admin/dates/ideas/${key}`)).send({ activityType: 'outdoor', translations: { fr: { title: 'Pique-nique', description: 'Au parc.' } } }).expect(400); // en required
    await ts.as(t.http.put(`/v1/admin/dates/ideas/${key}`)).send({ activityType: 'outdoor', indoor: false, timeOfDay: ['afternoon'], translations: { en: { title: 'Picnic', description: 'In the park.' } } }).expect(200);
    const ideas = (await ts.as(t.http.get('/v1/admin/dates/ideas')).expect(200)).body;
    expect(ideas.find((i: { key: string }) => i.key === key)).toMatchObject({ indoor: false, timeOfDay: ['afternoon'], translations: { en: { title: 'Picnic' } } });
    const support = await adminSession(t, 'support');
    await support.as(t.http.get('/v1/admin/dates/ideas')).expect(403);
  });

  it('reports an unconfigured store product as a typed error and records list prices for Google', async () => {
    const u = await activeUser(t);
    const billing = t.app.get(BillingService);
    const base = { provider: 'google' as const, userId: u.id, kind: 'consumable' as const, providerSubscriptionId: null, status: 'active' as const, currentPeriodStart: null, currentPeriodEnd: null, trialEnd: null, cancelAtPeriodEnd: false };
    await expect(billing.apply({ ...base, providerPriceId: 'not.configured', payment: { providerPaymentId: `GPA.none.${u.id}`, amountMinor: null, currency: null, status: 'succeeded' } }))
      .rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_NOT_CONFIGURED' });
    const product = await t.db.selectFrom('billing_products').select('id').where('kind', '=', 'consumable').executeTakeFirstOrThrow();
    const priceId = `boost_pack_${Date.now()}`;
    await t.db.insertInto('billing_prices').values({ product_id: product.id, provider: 'google', provider_price_id: priceId, currency: 'EUR', amount_minor: 499 }).execute();
    await billing.apply({ ...base, providerPriceId: priceId, payment: { providerPaymentId: `GPA.list.${u.id}`, amountMinor: null, currency: null, status: 'succeeded' } });
    const p = await t.db.selectFrom('payments').select(['amount_minor', 'currency']).where('provider_payment_id', '=', `GPA.list.${u.id}`).executeTakeFirstOrThrow();
    expect({ amount: Number(p.amount_minor), currency: p.currency }).toEqual({ amount: 499, currency: 'EUR' });
    const restored = (await t.http.post('/v1/billing/restore').set(u.auth).send({}).expect(200)).body;
    expect(restored.refreshed).toBe(0); // Google Play not configured in tests; entitlements still rebuilt
  });

  it('returns travel plans in camelCase', async () => {
    const u = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...PARIS });
    const sa = await adminSession(t, 'super_admin');
    await sa.as(t.http.put('/v1/admin/config/flags/travel_mode')).send({ key: 'travel_mode', enabled: true, defaultValue: true, rules: [] }).expect(200);
    await t.db.insertInto('entitlements').values({ user_id: u.id, entitlement_key: 'travel_mode', source_type: 'admin_grant' }).execute();
    const city = await t.db.selectFrom('cities').select('id').where('name', '=', 'Paris').executeTakeFirstOrThrow();
    const start = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const created = (await t.http.post('/v1/travel-plans').set(u.auth).send({ cityId: city.id, startsOn: start, endsOn: start }).expect(201)).body;
    expect(created).toMatchObject({ cityId: city.id, cityName: 'Paris', startsOn: start, endsOn: start, isActive: true });
    expect(Object.keys(created).some((k) => k.includes('_'))).toBe(false);
  });
});
