import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { jwtVerify } from 'jose';
import { DateSafetyService } from '../src/modules/dates/date-safety.service';
import { adminSession, createTestApp, discoverableUser, drainOutbox, type TestApp } from './helpers';

const PARIS = { lat: 48.8566, lon: 2.3522 };
const WEBHOOK_SECRET = 'whsec_events';

describe('Events, dates, date safety, calls & couple space (e2e)', () => {
  let t: TestApp;
  let stripe: Server;
  let parisId: string;

  beforeAll(async () => {
    stripe = createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/customers') return res.end(JSON.stringify({ id: 'cus_evt' }));
      if (req.url === '/v1/checkout/sessions') return res.end(JSON.stringify({ id: 'cs_evt', url: 'https://checkout.stripe.test/cs_evt' }));
      res.end('{}');
    });
    await new Promise<void>((r) => stripe.listen(0, r));
    t = await createTestApp({
      STRIPE_SECRET_KEY: 'sk_test', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_API_BASE: `http://127.0.0.1:${(stripe.address() as AddressInfo).port}`, CHECKOUT_RETURN_ORIGINS: 'https://amora.test',
      LIVEKIT_URL: 'wss://sfu.test', LIVEKIT_API_KEY: 'lk_key', LIVEKIT_API_SECRET: 'lk_secret_that_is_long_enough_123456',
    });
    parisId = (await t.db.selectFrom('cities').select('id').where('name', '=', 'Paris').executeTakeFirstOrThrow()).id;
  });
  afterAll(async () => {
    await t.close();
    stripe.close();
  });

  const hour = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  async function matched() {
    const a = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...PARIS });
    const b = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...PARIS });
    await t.http.post('/v1/likes').set(a.auth).send({ targetId: b.id, action: 'like' }).expect(201);
    const m = await t.http.post('/v1/likes').set(b.auth).send({ targetId: a.id, action: 'like' }).expect(201);
    return { a, b, matchId: m.body.matchId as string, conversationId: m.body.conversationId as string };
  }

  describe('events', () => {
    it('reviews community events, registers with capacity + waitlist promotion, hides venue until registered, checks in and collects feedback', async () => {
      const host = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...PARIS });
      const hiking = (await t.db.selectFrom('interests').select('id').where('key', '=', 'hiking').executeTakeFirstOrThrow()).id;
      const ev = await t.http.post('/v1/events').set(host.auth).send({
        categoryKey: 'sports_fitness', title: 'Sunrise trail run', description: 'An easy group run with coffee after.', cityId: parisId, venueName: 'Parc des Buttes-Chaumont, main gate',
        venueAddress: '1 Rue Botzaris', startsAt: hour(3), endsAt: hour(5), timezone: 'Europe/Paris', capacity: 2, interestIds: [hiking],
      }).expect(201);
      expect(ev.body.status).toBe('pending_review');

      const guest1 = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...PARIS });
      expect((await t.http.post(`/v1/events/${ev.body.id}/registration`).set(guest1.auth).send({}).expect(409)).body.error.code).toBe('EVENT_NOT_OPEN');
      const ts = await adminSession(t, 'trust_safety');
      await ts.as(t.http.post(`/v1/admin/events/${ev.body.id}/decision`)).send({ decision: 'publish' }).expect(204);

      const listed = (await t.http.get('/v1/events').set(guest1.auth).expect(200)).body.items.find((e: { id: string }) => e.id === ev.body.id);
      expect(listed).toMatchObject({ attending: 1, spotsLeft: 1, fit: 100 });
      expect((await t.http.get(`/v1/events/${ev.body.id}`).set(guest1.auth).expect(200)).body.venue.address).toBeNull();

      const reg1 = await t.http.post(`/v1/events/${ev.body.id}/registration`).set(guest1.auth).send({}).expect(201);
      expect(reg1.body).toMatchObject({ status: 'registered', checkInCode: expect.stringMatching(/^[A-Z0-9]{6}$/) });
      expect((await t.http.get(`/v1/events/${ev.body.id}`).set(guest1.auth).expect(200)).body).toMatchObject({ venue: { address: '1 Rue Botzaris' }, conversationId: expect.any(String) });

      const guest2 = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...PARIS });
      expect((await t.http.post(`/v1/events/${ev.body.id}/registration`).set(guest2.auth).send({}).expect(201)).body.status).toBe('waitlisted');
      await t.http.get(`/v1/events/${ev.body.id}/attendees`).set(guest2.auth).expect(403);
      const seen = (await t.http.get(`/v1/events/${ev.body.id}/attendees`).set(guest1.auth).expect(200)).body;
      expect(seen.map((x: { userId: string }) => x.userId)).toContain(host.id);

      await t.http.delete(`/v1/events/${ev.body.id}/registration`).set(guest1.auth).expect(204);
      const st2 = await t.db.selectFrom('event_attendees').select('status').where('event_id', '=', ev.body.id).where('user_id', '=', guest2.id).executeTakeFirstOrThrow();
      expect(st2.status).toBe('registered');

      // Re-register guest1 to get a code for check-in; event full now → waitlist.
      expect((await t.http.post(`/v1/events/${ev.body.id}/registration`).set(guest1.auth).send({}).expect(201)).body.status).toBe('waitlisted');
      const hostCode = await t.db.selectFrom('event_attendees').select('status').where('event_id', '=', ev.body.id).where('user_id', '=', host.id).executeTakeFirstOrThrow();
      expect(hostCode.status).toBe('registered');
      expect((await t.http.post(`/v1/events/${ev.body.id}/check-in`).set(host.auth).send({ userId: guest2.id, code: 'AAAAAA' }).expect(409)).body.error.code).toBe('EVENT_NOT_OPEN'); // 3h before start
      await t.db.updateTable('events').set({ starts_at: new Date(Date.now() + 30 * 60_000) }).where('id', '=', ev.body.id).execute();
      await t.http.post(`/v1/events/${ev.body.id}/check-in`).set(host.auth).send({ userId: guest2.id, code: 'AAAAAA' }).expect(400);
      // The promoted attendee can still see their code.
      const code2 = (await t.http.get(`/v1/events/${ev.body.id}`).set(guest2.auth).expect(200)).body.myCheckInCode;
      await t.http.post(`/v1/events/${ev.body.id}/check-in`).set(host.auth).send({ userId: guest2.id, code: code2 }).expect(204);
      await t.http.post(`/v1/events/${ev.body.id}/check-in`).set(guest2.auth).send({ userId: guest2.id, code: code2 }).expect(404); // only the organizer scans

      await t.db.updateTable('events').set({ starts_at: new Date(Date.now() - 60_000) }).where('id', '=', ev.body.id).execute();
      await t.http.post(`/v1/events/${ev.body.id}/feedback`).set(guest2.auth).send({ rating: 5, metSomeone: true }).expect(204);
      expect((await t.db.selectFrom('event_feedback').select('rating').where('event_id', '=', ev.body.id).execute()).length).toBe(1);
    });

    it('sells paid tickets through checkout and confirms the seat only from the signed payment webhook', async () => {
      const fin = await adminSession(t, 'super_admin');
      const ev = await fin.as(t.http.post('/v1/admin/events')).send({
        categoryKey: 'dating_mixer', title: 'Speed dating night', description: 'Ten short dates and a welcome drink.', cityId: parisId, venueName: 'Le Bar', venueAddress: '2 Rue X',
        startsAt: hour(48), endsAt: hour(51), timezone: 'Europe/Paris', capacity: 20, priceMinor: 1500, currency: 'EUR',
      }).expect(201);
      const u = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...PARIS });
      const reg = await t.http.post(`/v1/events/${ev.body.id}/registration`).set(u.auth).send({ successUrl: 'https://amora.test/ok', cancelUrl: 'https://amora.test/no' }).expect(201);
      expect(reg.body).toEqual({ status: 'payment_required', checkoutUrl: 'https://checkout.stripe.test/cs_evt' });
      expect((await t.db.selectFrom('event_attendees').select('status').where('event_id', '=', ev.body.id).where('user_id', '=', u.id).executeTakeFirstOrThrow()).status).toBe('interested');

      const body = JSON.stringify({ id: `evt_tkt_${u.id}`, type: 'checkout.session.completed', data: { object: { mode: 'payment', client_reference_id: u.id, metadata: { event_id: ev.body.id, user_id: u.id }, payment_intent: `pi_tkt_${u.id}`, amount_total: 1500, currency: 'eur', payment_status: 'paid' } } });
      const ts = Math.floor(Date.now() / 1000);
      await t.http.post('/v1/payments/webhooks/stripe').set('Stripe-Signature', `t=${ts},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex')}`).set('Content-Type', 'application/json').send(body).expect(200);
      await drainOutbox(t);
      const a = await t.db.selectFrom('event_attendees').select(['status', 'payment_id']).where('event_id', '=', ev.body.id).where('user_id', '=', u.id).executeTakeFirstOrThrow();
      expect(a.status).toBe('registered');
      expect(a.payment_id).not.toBeNull();
    });
  });

  describe('date planner & journey', () => {
    it('proposes, accepts, reschedules, exports to calendar, and records private feedback advancing the journey', async () => {
      const { a, b, matchId, conversationId } = await matched();
      const plan = await t.http.post('/v1/dates').set(a.auth).send({ matchId, title: 'Coffee at Café Kitsuné', activityType: 'coffee', stageKey: 'first_date', budgetKey: 'low', startsAt: hour(26), venueName: 'Café Kitsuné', latitude: 48.86, longitude: 2.34 }).expect(201);
      expect(plan.body).toMatchObject({ status: 'proposed', participants: expect.arrayContaining([{ userId: b.id, response: 'pending' }]) });
      const msgs = (await t.http.get(`/v1/conversations/${conversationId}/messages`).set(b.auth)).body.items;
      expect(msgs[0]).toMatchObject({ kind: 'date_invite' });

      await t.http.post(`/v1/dates/${plan.body.id}/response`).set(a.auth).send({ response: 'accepted' }).expect(409);
      expect((await t.http.post(`/v1/dates/${plan.body.id}/response`).set(b.auth).send({ response: 'accepted' }).expect(200)).body.status).toBe('accepted');
      const ics = await t.http.get(`/v1/dates/${plan.body.id}/calendar.ics`).set(a.auth).expect(200);
      expect(ics.text).toContain('BEGIN:VEVENT');
      expect(ics.text).toContain('SUMMARY:Coffee at Café Kitsuné');

      const moved = await t.http.put(`/v1/dates/${plan.body.id}`).set(b.auth).send({ startsAt: hour(30) }).expect(200);
      expect(moved.body).toMatchObject({ status: 'rescheduled', participants: expect.arrayContaining([{ userId: a.id, response: 'pending' }]) });
      await t.http.post(`/v1/dates/${plan.body.id}/response`).set(a.auth).send({ response: 'accepted' }).expect(200);

      const ideas = (await t.http.get(`/v1/dates/ideas?matchId=${matchId}&stageKey=first_date`).set(a.auth).expect(200)).body;
      expect(ideas[0].key).toBe('coffee_walk'); // shared "coffee" interest ranks first

      await t.http.post(`/v1/dates/${plan.body.id}/feedback`).set(a.auth).send({ dateHappened: true, overall: 5, wantSecondDate: 'yes' }).expect(400); // not started yet
      await t.db.updateTable('date_plans').set({ starts_at: new Date(Date.now() - 2 * 3_600_000) }).where('id', '=', plan.body.id).execute();
      await t.http.post(`/v1/dates/${plan.body.id}/feedback`).set(a.auth).send({ dateHappened: true, overall: 5, wantSecondDate: 'yes', tags: ['great_conversation'], privateNote: 'Lovely' }).expect(204);
      const j = (await t.http.get(`/v1/dates/journey/${matchId}`).set(b.auth).expect(200)).body;
      expect(j).toMatchObject({ milestones: { firstDateAt: expect.any(String), feedbackAt: expect.any(String) }, next: 'plan_second_date' });
      // b never sees a's private feedback.
      expect(JSON.stringify((await t.http.get(`/v1/dates/${plan.body.id}`).set(b.auth)).body)).not.toContain('Lovely');
    });
  });

  describe('date safety', () => {
    it('confirms trusted contacts, escalates a missed check-in to the contact and T&S, and supports SOS', async () => {
      const { a, matchId } = await matched();
      const plan = await t.http.post('/v1/dates').set(a.auth).send({ matchId, title: 'Dinner', activityType: 'dinner', startsAt: hour(1), venueName: 'Bistro', venueAddress: '3 Rue Y' }).expect(201);
      const phone = `+3361234${String(Date.now()).slice(-4)}`;
      await t.http.post('/v1/dates/safety/contacts').set(a.auth).send({ name: 'Sis', phone }).expect(201);
      const contacts = (await t.http.get('/v1/dates/safety/contacts').set(a.auth).expect(200)).body;
      expect(contacts[0]).toMatchObject({ name: 'Sis', phoneMasked: expect.stringMatching(/^•••\d{3}$/), confirmed: false });
      const stored = await t.db.selectFrom('trusted_contacts').select('phone_e164_enc').where('id', '=', contacts[0].id).executeTakeFirstOrThrow();
      expect(Buffer.from(stored.phone_e164_enc as Buffer).toString('utf8')).not.toContain(phone.slice(-4)); // encrypted at rest

      await t.http.post('/v1/dates/safety/sessions').set(a.auth).send({ datePlanId: plan.body.id, trustedContactId: contacts[0].id, startsAt: new Date().toISOString(), checkInAfterMin: 60 }).expect(409); // unconfirmed contact
      const firstToken = t.sink.lastTo(phone)!.match(/token=([A-Za-z0-9_-]+)/)![1]!;
      // Resend: throttled right after sending; later it issues a new token and the old link stops working.
      expect((await t.http.post(`/v1/dates/safety/contacts/${contacts[0].id}/resend`).set(a.auth).send({}).expect(429)).body.error.code).toBe('RATE_LIMITED');
      await t.db.updateTable('trusted_contacts').set({ confirm_expires_at: new Date(Date.now() + 86_400_000) }).where('id', '=', contacts[0].id).execute();
      await t.http.post(`/v1/dates/safety/contacts/${contacts[0].id}/resend`).set(a.auth).send({}).expect(200);
      const token = t.sink.lastTo(phone)!.match(/token=([A-Za-z0-9_-]+)/)![1]!;
      expect(token).not.toBe(firstToken);
      await t.http.post(`/v1/public/safety/trusted-contacts/${contacts[0].id}/confirm`).send({ token: firstToken }).expect(401);
      await t.http.post(`/v1/public/safety/trusted-contacts/${contacts[0].id}/confirm`).send({ token }).expect(204);
      await t.http.post(`/v1/dates/safety/contacts/${contacts[0].id}/resend`).set(a.auth).send({}).expect(409); // already confirmed

      // Live location needs precise-location consent.
      const startBody = { datePlanId: plan.body.id, trustedContactId: contacts[0].id, startsAt: new Date().toISOString(), checkInAfterMin: 30, graceMinutes: 5, shareLiveLocation: true };
      expect((await t.http.post('/v1/dates/safety/sessions').set(a.auth).send(startBody).expect(400)).body.error.details.consentType).toBe('precise_location');
      await t.http.post('/v1/users/me/consents').set(a.auth).send({ consentType: 'precise_location', granted: true }).expect(200);
      expect((await t.http.get('/v1/dates/safety/sessions/active').set(a.auth).expect(200)).body).toEqual({ session: null });

      const s = await t.http.post('/v1/dates/safety/sessions').set(a.auth).send(startBody).expect(201);
      expect((await t.http.get('/v1/dates/safety/sessions/active').set(a.auth).expect(200)).body.session.id).toBe(s.body.id);
      expect(s.body).toMatchObject({ status: 'active', emergencyNumber: '911', shareLink: expect.stringContaining('/safety/') }); // test users are in the US
      await t.http.post(`/v1/dates/safety/sessions/${s.body.id}/location`).set(a.auth).send({ latitude: 48.85, longitude: 2.35 }).expect(204);
      const viewToken = s.body.shareLink.split('/safety/')[1];
      const view = (await t.http.get(`/v1/public/safety/sessions/${viewToken}`).expect(200)).body;
      expect(view).toMatchObject({ status: 'active', date: { venue: 'Bistro' }, lastLocation: { latitude: 48.85 } });

      // Missed check-in: overdue → reminder, then escalation to the contact + a critical case.
      const svc = t.app.get(DateSafetyService);
      await t.db.updateTable('date_safety_sessions').set({ check_in_due_at: new Date(Date.now() - 60_000) }).where('id', '=', s.body.id).execute();
      await svc.overdueSweep();
      expect((await t.http.get(`/v1/dates/safety/sessions/${s.body.id}`).set(a.auth)).body.status).toBe('overdue');
      await t.db.updateTable('date_safety_sessions').set({ overdue_at: new Date(Date.now() - 20 * 60_000) }).where('id', '=', s.body.id).execute();
      await svc.overdueSweep();
      expect((await t.http.get(`/v1/dates/safety/sessions/${s.body.id}`).set(a.auth)).body.status).toBe('escalated');
      expect(t.sink.lastTo(phone)).toMatch(/has not checked in from a date/);
      const c = await t.db.selectFrom('moderation_cases').select(['category', 'severity']).where('category', '=', 'offline_safety').orderBy('opened_at', 'desc').executeTakeFirstOrThrow();
      expect(c).toEqual({ category: 'offline_safety', severity: 'critical' });

      const ok = (await t.http.post(`/v1/dates/safety/sessions/${s.body.id}/check-in`).set(a.auth).send({}).expect(200)).body;
      expect(t.sink.lastTo(phone)).toMatch(/checked in and is OK/);
      // The deadline had passed, so a fresh window starts instead of the next sweep flagging it overdue again.
      expect(new Date(ok.checkInDueAt).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
      await svc.overdueSweep();
      expect((await t.http.get(`/v1/dates/safety/sessions/${s.body.id}`).set(a.auth)).body.status).toBe('checked_in');
      const sos = await t.http.post(`/v1/dates/safety/sessions/${s.body.id}/sos`).set(a.auth).send({ latitude: 48.851, longitude: 2.351 }).expect(200);
      expect(sos.body).toMatchObject({ status: 'sos', emergencyNumber: '911' });
      await t.http.post(`/v1/dates/safety/sessions/${s.body.id}/check-out`).set(a.auth).send({}).expect(200);
      expect(await t.db.selectFrom('date_safety_locations').select('session_id').where('session_id', '=', s.body.id).execute()).toHaveLength(0);
    });
  });

  describe('calls & couple space', () => {
    it('issues SFU tokens only for active matches and records the voice/video milestone', async () => {
      const { a, b, conversationId, matchId } = await matched();
      expect((await t.http.post(`/v1/conversations/${conversationId}/calls`).set(a.auth).send({ kind: 'video' }).expect(403)).body.error.code).toBe('FEATURE_DISABLED');
      const admin = await adminSession(t, 'product_admin');
      await admin.as(t.http.put('/v1/admin/config/flags/video_calls')).send({ key: 'video_calls', enabled: true, defaultValue: true, rules: [] }).expect(200);
      const call = await t.http.post(`/v1/conversations/${conversationId}/calls`).set(a.auth).send({ kind: 'video' }).expect(201);
      const { payload } = await jwtVerify(call.body.token, new TextEncoder().encode('lk_secret_that_is_long_enough_123456'), { issuer: 'lk_key' });
      expect(payload).toMatchObject({ sub: a.id, video: { roomJoin: true, canPublishSources: ['camera', 'microphone'] } });
      await t.http.post(`/v1/conversations/${conversationId}/calls`).set(b.auth).send({ kind: 'video' }).expect(409);
      await t.http.post(`/v1/calls/${call.body.callId}/accept`).set(a.auth).expect(409);
      expect((await t.http.post(`/v1/calls/${call.body.callId}/accept`).set(b.auth).expect(200)).body.token).toEqual(expect.any(String));
      expect((await t.http.get(`/v1/dates/journey/${matchId}`).set(a.auth)).body).toMatchObject({ stage: 'voice_video', milestones: { voiceVideoAt: expect.any(String) } });
      await t.http.post(`/v1/calls/${call.body.callId}/end`).set(b.auth).expect(204);
    });

    it('opens the couple space only after a first date and with both people’s consent', async () => {
      const { a, b, matchId } = await matched();
      const admin = await adminSession(t, 'product_admin');
      await admin.as(t.http.put('/v1/admin/config/flags/couple_space')).send({ key: 'couple_space', enabled: true, defaultValue: true, rules: [] }).expect(200);
      expect((await t.http.post(`/v1/matches/${matchId}/couple-space`).set(a.auth).send({}).expect(409)).body.error.message).toMatch(/first date/);
      await t.db.updateTable('relationship_journeys').set({ first_date_at: new Date() }).where('match_id', '=', matchId).execute();
      expect((await t.http.post(`/v1/matches/${matchId}/couple-space`).set(a.auth).send({ pauseDiscovery: true }).expect(200)).body).toMatchObject({ status: 'pending', youConsented: true });
      expect((await t.http.post(`/v1/matches/${matchId}/couple-space`).set(b.auth).send({}).expect(200)).body.status).toBe('active');
      expect((await t.http.get(`/v1/dates/journey/${matchId}`).set(a.auth)).body.stage).toBe('relationship');
      expect((await t.db.selectFrom('user_profiles').select('is_discoverable').where('user_id', '=', a.id).executeTakeFirstOrThrow()).is_discoverable).toBe(false);
    });
  });
});
