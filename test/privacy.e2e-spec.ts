import { OBJECT_STORAGE, type InMemoryObjectStorage } from '../src/common/storage/object-storage';
import { PrivacyService } from '../src/modules/privacy/privacy.service';
import { activeUser, adminSession, createTestApp, drainOutbox, type TestApp } from './helpers';

describe('Privacy: export, deletion, purge & retention (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('builds a JSON export bundle via the outbox and exposes a download link', async () => {
    const u = await activeUser(t);
    const r = (await t.http.post('/v1/users/me/privacy/export').set(u.auth).expect(201)).body;
    expect(r.status).toBe('received');
    await t.http.post('/v1/users/me/privacy/export').set(u.auth).expect(409);
    await drainOutbox(t);
    const list = (await t.http.get('/v1/users/me/privacy/requests').set(u.auth).expect(200)).body;
    const exp = list.find((x: { id: string }) => x.id === r.requestId);
    expect(exp.status).toBe('completed');
    expect(exp.downloadUrl).toContain(`exports/${u.id}/`);
    const storage = t.app.get<InMemoryObjectStorage>(OBJECT_STORAGE);
    const key = [...storage.objects.keys()].find((k) => k.startsWith(`exports/${u.id}/`))!;
    const bundle = JSON.parse(storage.objects.get(key)!.body.toString('utf8'));
    expect(bundle.account.email).toBe(u.email);
    expect(JSON.stringify(bundle)).not.toContain('password_hash');
  });

  it('requires a fresh session or password, deactivates, can be cancelled, and purges to an anonymized husk', async () => {
    const u = await activeUser(t);
    // A stale session must re-authenticate with the password.
    await t.db.updateTable('user_sessions').set({ created_at: new Date(Date.now() - 3_600_000) }).where('user_id', '=', u.id).execute();
    await t.http.post('/v1/users/me/privacy/delete-account').set(u.auth).send({}).expect(401);
    await t.http.post('/v1/users/me/privacy/delete-account').set(u.auth).send({ password: 'wrong password!!' }).expect(401);
    const del = (await t.http.post('/v1/users/me/privacy/delete-account').set(u.auth).send({ password: u.password }).expect(200)).body;
    expect(del.status).toBe('scheduled');
    expect((await t.db.selectFrom('users').select('status').where('id', '=', u.id).executeTakeFirstOrThrow()).status).toBe('deactivated');
    // Sessions were revoked, so the old token no longer works.
    await t.http.get('/v1/users/me/privacy/requests').set(u.auth).expect(401);

    await t.app.get(PrivacyService).cancelDeletion(u.id, { ip: null, userAgent: null } as never);
    expect((await t.db.selectFrom('users').select('status').where('id', '=', u.id).executeTakeFirstOrThrow()).status).toBe('active');

    await t.app.get(PrivacyService).purge(u.id);
    const husk = await t.db.selectFrom('users').select(['status', 'email', 'password_hash', 'date_of_birth']).where('id', '=', u.id).executeTakeFirstOrThrow();
    expect(husk).toEqual({ status: 'deleted', email: null, password_hash: null, date_of_birth: null });
    expect(await t.db.selectFrom('user_profiles').select('user_id').where('user_id', '=', u.id).executeTakeFirst()).toBeUndefined();
    for (const table of ['user_profiles', 'user_sessions', 'user_devices', 'auth_identities', 'verification_codes', 'user_locations', 'question_answers', 'notifications', 'entitlements'] as const) {
      const n = await t.db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', u.id).executeTakeFirstOrThrow();
      expect([table, Number(n.n)]).toEqual([table, 0]);
    }
  });

  it('purges accounts whose grace period has elapsed', async () => {
    const u = await activeUser(t);
    await t.http.post('/v1/users/me/privacy/delete-account').set(u.auth).send({ password: u.password }).expect(200);
    await t.db.updateTable('data_privacy_requests').set({ due_at: new Date(Date.now() - 1000) }).where('user_id', '=', u.id).where('kind', '=', 'delete').execute();
    expect(await t.app.get(PrivacyService).purgeDue()).toBeGreaterThanOrEqual(1);
    expect((await t.db.selectFrom('users').select('status').where('id', '=', u.id).executeTakeFirstOrThrow()).status).toBe('deleted');
    const req = await t.db.selectFrom('data_privacy_requests').select('status').where('user_id', '=', u.id).where('kind', '=', 'delete').executeTakeFirstOrThrow();
    expect(req.status).toBe('completed');
  });

  it('lets support log and execute requests, and super admins manage retention (with RBAC)', async () => {
    const u = await activeUser(t);
    const support = await adminSession(t, 'support');
    const r = (await support.as(t.http.post('/v1/admin/privacy/requests')).send({ userId: u.id, kind: 'export', notes: 'Emailed request' }).expect(201)).body;
    const queue = (await support.as(t.http.get('/v1/admin/privacy/requests')).expect(200)).body;
    expect(queue.items.some((x: { id: string }) => x.id === r.id)).toBe(true);
    await support.as(t.http.post(`/v1/admin/privacy/requests/${r.id}/execute`)).send({}).expect(204);
    await support.as(t.http.post(`/v1/admin/privacy/requests/${r.id}/execute`)).send({}).expect(409);
    expect((await t.db.selectFrom('data_privacy_requests').select('status').where('id', '=', r.id).executeTakeFirstOrThrow()).status).toBe('completed');
    await support.as(t.http.get('/v1/admin/privacy/retention')).expect(403);

    const sa = await adminSession(t, 'super_admin');
    const policies = (await sa.as(t.http.get('/v1/admin/privacy/retention')).expect(200)).body;
    expect(policies.length).toBeGreaterThan(0);
    const p = policies[0];
    await sa.as(t.http.put(`/v1/admin/privacy/retention/${p.entity}`)).send({ retentionDays: p.retention_days, action: p.action }).expect(200);
    await sa.as(t.http.put('/v1/admin/privacy/retention/nope')).send({ retentionDays: 10, action: 'delete' }).expect(404);
    await t.app.get(PrivacyService).applyRetention();
  });
});
