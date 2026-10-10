import { OBJECT_STORAGE, type InMemoryObjectStorage } from '../src/common/storage/object-storage';
import { SafetyAutomationService } from '../src/modules/safety/safety-automation.service';
import { activeUser, adminSession, createTestApp, device, discoverableUser, drainOutbox, type TestApp } from './helpers';

const HERE = { lat: -37.8136, lon: 144.9631 };

describe('Safety, verification & moderation (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  async function pair() {
    const a = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...HERE });
    const b = await discoverableUser(t, { gender: 'man', seeking: ['woman'], ...HERE });
    await t.http.post('/v1/likes').set(a.auth).send({ targetId: b.id, action: 'like' }).expect(201);
    const m = await t.http.post('/v1/likes').set(b.auth).send({ targetId: a.id, action: 'like' }).expect(201);
    return { a, b, conversationId: m.body.conversationId as string, matchId: m.body.matchId as string };
  }

  describe('reports & blocks', () => {
    it('captures immutable evidence, opens one case per subject+category and can block at the same time', async () => {
      const { a, b, conversationId } = await pair();
      const msg = await t.http.post(`/v1/conversations/${conversationId}/messages`).set(b.auth).send({ clientMessageId: 'ev-12345678', kind: 'text', body: 'You are worthless' }).expect(201);
      const r = await t.http.post('/v1/reports').set(a.auth).send({ targetType: 'message', targetId: msg.body.id, reasonKey: 'harassment', details: 'Insulting me', alsoBlock: true }).expect(201);
      expect(r.body).toEqual({ reportId: expect.any(String), blocked: true });
      await t.http.post('/v1/reports').set(a.auth).send({ targetType: 'message', targetId: msg.body.id, reasonKey: 'harassment' }).expect(409);

      // b deletes the message (still allowed for the sender) — the evidence snapshot survives.
      await t.http.delete(`/v1/messages/${msg.body.id}`).set(b.auth).expect(204);
      const c = await t.db.selectFrom('moderation_cases').selectAll().where('subject_user_id', '=', b.id).executeTakeFirstOrThrow();
      expect(c).toMatchObject({ category: 'harassment', severity: 'high', status: 'open', source: 'user_report' });
      const ev = await t.db.selectFrom('case_evidence').select('snapshot').where('case_id', '=', c.id).execute();
      expect(ev.map((e) => (e.snapshot as { body?: string }).body)).toContain('You are worthless');

      expect((await t.http.get('/v1/matches').set(a.auth)).body.items).toHaveLength(0);
      expect((await t.http.get('/v1/blocks').set(a.auth)).body[0].userId).toBe(b.id);
      await t.http.get(`/v1/profiles/${b.id}`).set(a.auth).expect(404);
    });

    it('rejects reports on content the reporter could not see', async () => {
      const { conversationId, b } = await pair();
      const outsider = await activeUser(t);
      const msg = await t.http.post(`/v1/conversations/${conversationId}/messages`).set(b.auth).send({ clientMessageId: 'x-12345678', kind: 'text', body: 'hi' }).expect(201);
      await t.http.post('/v1/reports').set(outsider.auth).send({ targetType: 'message', targetId: msg.body.id, reasonKey: 'spam' }).expect(404);
    });
  });

  describe('moderation workflow', () => {
    it('lets T&S act on a case, notifies the user, supports appeals decided by another reviewer, and reverses on overturn', async () => {
      const { a, b } = await pair();
      await t.http.post('/v1/reports').set(a.auth).send({ targetType: 'user', targetId: b.id, reasonKey: 'scam' }).expect(201);
      const ts1 = await adminSession(t, 'trust_safety');
      const ts2 = await adminSession(t, 'trust_safety');
      const queue = (await ts1.as(t.http.get('/v1/admin/moderation/cases?assignedTo=unassigned')).expect(200)).body.items;
      const theCase = queue.find((x: { subject_user_id: string }) => x.subject_user_id === b.id);
      expect(theCase).toMatchObject({ category: 'scam', severity: 'high', report_count: 1, sla_breached: false });

      await ts1.as(t.http.put(`/v1/admin/moderation/cases/${theCase.id}`)).send({ assignTo: 'me' }).expect(200);
      const detail = (await ts1.as(t.http.get(`/v1/admin/moderation/cases/${theCase.id}`)).expect(200)).body;
      expect(detail).toMatchObject({ status: 'in_review', assigned_to: ts1.id, reports: [{ reason: 'scam' }] });

      const act = await ts1.as(t.http.post(`/v1/admin/moderation/cases/${theCase.id}/actions`)).send({ action: 'suspend', reasonKey: 'scam_behaviour', durationHours: 72, note: 'Asked for money' }).expect(200);
      expect((await t.http.get('/v1/users/me').set(b.auth)).status).toBe(401); // all sessions revoked
      const status = await t.db.selectFrom('users').select(['status', 'status_until']).where('id', '=', b.id).executeTakeFirstOrThrow();
      expect(status.status).toBe('suspended');
      const notice = await t.db.selectFrom('notifications').select('category').where('user_id', '=', b.id).where('category', '=', 'moderation').executeTakeFirst();
      expect(notice).toBeDefined();

      // Appeal (user logs in again once the suspension is lifted early for the test).
      await t.db.updateTable('users').set({ status_until: new Date(Date.now() - 1000) }).where('id', '=', b.id).execute();
      const login = await t.http.post('/v1/auth/login').send({ identifier: b.email, password: b.password, device: device() }).expect(200);
      const auth = { Authorization: `Bearer ${login.body.tokens.accessToken}` };
      const st = (await t.http.get('/v1/account/status').set(auth).expect(200)).body;
      expect(st.actions[0]).toMatchObject({ id: act.body.actionId, action: 'suspend', canAppeal: true });
      const appeal = await t.http.post('/v1/appeals').set(auth).send({ actionId: act.body.actionId, statement: 'This was a misunderstanding about splitting a bill.' }).expect(201);

      await ts1.as(t.http.post(`/v1/admin/moderation/appeals/${appeal.body.appealId}/decision`)).send({ decision: 'overturned' }).expect(403); // same reviewer
      await ts2.as(t.http.post(`/v1/admin/moderation/appeals/${appeal.body.appealId}/decision`)).send({ decision: 'overturned', note: 'Context checks out' }).expect(200);
      const reversed = await t.db.selectFrom('moderation_actions').select(['reversed_at', 'reversal_action_id']).where('id', '=', act.body.actionId).executeTakeFirstOrThrow();
      expect(reversed.reversed_at).not.toBeNull();
      expect((await t.http.get('/v1/account/status').set(auth).expect(200)).body.status).toBe('active');
    });

    it('restricts messaging, removes content and lifts only that action’s restrictions on reversal', async () => {
      const { a, b, conversationId } = await pair();
      const ts = await adminSession(t, 'trust_safety');
      const created = await ts.as(t.http.post('/v1/admin/moderation/cases')).send({ subjectUserId: b.id, category: 'spam', severity: 'low' }).expect(201);
      const r1 = await ts.as(t.http.post(`/v1/admin/moderation/cases/${created.body.caseId}/actions`)).send({ action: 'restrict', reasonKey: 'spam', restrictionKinds: ['no_messaging'] }).expect(200);
      await ts.as(t.http.post(`/v1/admin/moderation/cases/${created.body.caseId}/actions`)).send({ action: 'restrict', reasonKey: 'spam_likes', restrictionKinds: ['no_likes'] }).expect(200);
      expect((await t.http.post(`/v1/conversations/${conversationId}/messages`).set(b.auth).send({ clientMessageId: 'r-12345678', kind: 'text', body: 'hi' }).expect(403)).body.error.message).toMatch(/restricted/);

      await ts.as(t.http.post(`/v1/admin/moderation/actions/${r1.body.actionId}/reverse`)).send({}).expect(200);
      await t.http.post(`/v1/conversations/${conversationId}/messages`).set(b.auth).send({ clientMessageId: 'r-87654321', kind: 'text', body: 'hi again' }).expect(201);
      const left = await t.db.selectFrom('account_restrictions').select('kind').where('user_id', '=', b.id).where('lifted_at', 'is', null).execute();
      expect(left.map((x) => x.kind)).toEqual(['no_likes']);

      const media = await t.db.selectFrom('profile_media').select('id').where('user_id', '=', b.id).limit(1).executeTakeFirstOrThrow();
      await ts.as(t.http.post(`/v1/admin/moderation/cases/${created.body.caseId}/actions`)).send({ action: 'remove_content', reasonKey: 'nudity', contentType: 'media', contentId: media.id }).expect(200);
      expect((await t.db.selectFrom('profile_media').select('moderation_status').where('id', '=', media.id).executeTakeFirstOrThrow()).moderation_status).toBe('rejected');

      const support = await adminSession(t, 'support');
      await support.as(t.http.post(`/v1/admin/moderation/cases/${created.body.caseId}/actions`)).send({ action: 'warn', reasonKey: 'abuse' }).expect(403);
    });
  });

  describe('verification', () => {
    it('requires consent, issues a pose challenge, takes evidence and is decided in the T&S queue', async () => {
      const u = await discoverableUser(t, { gender: 'woman', seeking: ['man'], ...HERE });
      expect((await t.http.post('/v1/verification').set(u.auth).send({ kind: 'selfie' }).expect(400)).body.error.details.consentType).toBe('biometric_verification');
      await t.http.post('/v1/users/me/consents').set(u.auth).send({ consentType: 'biometric_verification', granted: true }).expect(200);
      const start = await t.http.post('/v1/verification').set(u.auth).send({ kind: 'selfie' }).expect(201);
      expect(start.body.poseChallenge).toEqual(expect.any(String));
      await t.http.post(`/v1/verification/${start.body.requestId}/submit`).set(u.auth).expect(409); // nothing uploaded

      const up = await t.http.post(`/v1/verification/${start.body.requestId}/evidence`).set(u.auth).send({ mimeType: 'image/jpeg', byteSize: 1000 }).expect(201);
      const key = (await t.db.selectFrom('verification_requests').select('evidence_keys').where('id', '=', start.body.requestId).executeTakeFirstOrThrow()).evidence_keys[0]!;
      expect(key.startsWith(`v/${u.id}/`)).toBe(true);
      expect(up.body.uploadUrl).toContain('memory://');
      await t.app.get<InMemoryObjectStorage>(OBJECT_STORAGE).put(key, Buffer.alloc(1000), 'image/jpeg');
      await t.http.post(`/v1/verification/${start.body.requestId}/submit`).set(u.auth).expect(200);
      await drainOutbox(t);

      const support = await adminSession(t, 'support'); // can view the queue, not evidence
      const seen = (await support.as(t.http.get(`/v1/admin/verification/${start.body.requestId}`)).expect(200)).body;
      expect(seen).toMatchObject({ status: 'needs_review', evidence: null });
      await support.as(t.http.post(`/v1/admin/verification/${start.body.requestId}/decision`)).send({ decision: 'approved' }).expect(403);

      const ts = await adminSession(t, 'trust_safety');
      expect((await ts.as(t.http.get(`/v1/admin/verification/${start.body.requestId}`)).expect(200)).body.evidence).toHaveLength(1);
      await ts.as(t.http.post(`/v1/admin/verification/${start.body.requestId}/decision`)).send({ decision: 'approved' }).expect(204);
      const st = (await t.http.get('/v1/verification').set(u.auth).expect(200)).body;
      expect(st).toMatchObject({ level: 'selfie', history: [{ status: 'approved', expiresAt: expect.any(String) }] });
      const logs = await t.db.selectFrom('admin_data_access_logs').select('resource').where('admin_user_id', '=', ts.id).execute();
      expect(logs.map((l) => l.resource)).toContain('verification_evidence');
    });

    it('blocks identity verification where the country does not offer it', async () => {
      const u = await activeUser(t);
      await t.http.post('/v1/users/me/consents').set(u.auth).send({ consentType: 'identity_verification', granted: true }).expect(200);
      expect((await t.http.post('/v1/verification').set(u.auth).send({ kind: 'identity' }).expect(403)).body.error.code).toBe('NOT_AVAILABLE_IN_COUNTRY');
    });
  });

  describe('automation', () => {
    it('auto-approves clean prompts and holds flagged ones for review', async () => {
      const u = await activeUser(t);
      await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'Auto' }).expect(200);
      const [p1, p2] = await t.db.selectFrom('prompt_catalog').select('id').limit(2).execute();
      await t.http.put('/v1/profiles/me/prompts').set(u.auth).send({ prompts: [{ promptId: p1!.id, answer: 'Sunday markets and long lunches' }, { promptId: p2!.id, answer: 'Add me on telegram, I do crypto investment' }] }).expect(200);
      await drainOutbox(t);
      const rows = await t.db.selectFrom('profile_prompts').select(['answer', 'moderation_status']).where('user_id', '=', u.id).orderBy('position').execute();
      expect(rows.map((r) => r.moderation_status)).toEqual(['approved', 'pending']);
      const queue = (await (await adminSession(t, 'trust_safety')).as(t.http.get('/v1/admin/profile-review/queue')).expect(200)).body;
      expect(queue.prompts.map((p: { user_id: string }) => p.user_id)).toContain(u.id);
    });

    it('restricts accounts that share a device with a banned account (ban evasion)', async () => {
      const banned = await activeUser(t);
      const dev = await t.db.selectFrom('user_devices').select('installation_id').where('user_id', '=', banned.id).executeTakeFirstOrThrow();
      await drainOutbox(t);
      const ts = await adminSession(t, 'trust_safety');
      await ts.as(t.http.post(`/v1/admin/users/${banned.id}/actions`)).send({ action: 'ban', reasonKey: 'scam' }).expect(200);
      const evader = await activeUser(t);
      await t.http.post('/v1/auth/login').send({ identifier: evader.email, password: evader.password, device: { ...device(), installationId: dev.installation_id } }).expect(200);
      await drainOutbox(t);
      const r = await t.db.selectFrom('account_restrictions').select('kind').where('user_id', '=', evader.id).where('lifted_at', 'is', null).execute();
      expect(r.map((x) => x.kind).sort()).toEqual(['no_discovery', 'no_messaging', 'review_required']);
    });

    it('computes risk scores from signals and reports', async () => {
      const { a, b } = await pair();
      await t.http.post('/v1/reports').set(a.auth).send({ targetType: 'user', targetId: b.id, reasonKey: 'fake_profile' }).expect(201);
      await t.db.insertInto('safety_events').values({ user_id: b.id, signal: 'scam', source: 'test', score: 0.9 }).execute();
      await t.app.get(SafetyAutomationService).recomputeRiskScores();
      const s = await t.db.selectFrom('user_risk_scores').select('score').where('user_id', '=', b.id).executeTakeFirstOrThrow();
      expect(s.score).toBeGreaterThan(0.5);
    });
  });

  describe('admin user management', () => {
    it('masks PII without permission and audits exports', async () => {
      const u = await activeUser(t);
      const analystLike = await adminSession(t, 'product_admin'); // users.view, no PII
      const list = (await analystLike.as(t.http.get(`/v1/admin/users?q=${u.id}`)).expect(200)).body.items[0];
      expect(list.email).toMatch(/^.•••@/);
      const support = await adminSession(t, 'support');
      const full = (await support.as(t.http.get(`/v1/admin/users/${u.id}`)).expect(200)).body;
      expect(full.email).toBe(u.email);
      expect(full.safety).toBeNull(); // support lacks users.view_safety_history

      await support.as(t.http.post(`/v1/admin/users/${u.id}/actions`)).send({ action: 'ban', reasonKey: 'abuse' }).expect(403);
      await support.as(t.http.post(`/v1/admin/users/${u.id}/actions`)).send({ action: 'force_logout', reasonKey: 'user_request' }).expect(200);
      await t.http.get('/v1/users/me').set(u.auth).expect(401);

      const sa = await adminSession(t, 'super_admin');
      const csv = await sa.as(t.http.get('/v1/admin/users/export/csv?country=US')).expect(200);
      expect(csv.text.split('\n')[0]).toBe('id,status,country,created_at,verification,email');
      expect((await t.db.selectFrom('audit_logs').select('action').where('actor_id', '=', sa.id).execute()).map((x) => x.action)).toContain('users.exported');
      await sa.as(t.http.get(`/v1/admin/users/${u.id}/location`)).expect(400); // case id required
    });
  });
});
