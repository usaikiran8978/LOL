import { base32Decode, totp } from '../src/modules/admin/auth/totp';
import { activeUser, adminSession, codeFrom, createTestApp, type TestApp, drainOutbox } from './helpers';

describe('Admin accounts, MFA & contract-gap fixes (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('invites an admin who sets a password, cannot escalate privileges, and cannot strand the platform without a Super Admin', async () => {
    const sa = await adminSession(t, 'super_admin');
    const email = `invitee-${Date.now()}@amora.test`;
    const inv = await sa.as(t.http.post('/v1/admin/admins')).send({ email, displayName: 'Mod', roleKeys: ['trust_safety'], countryScope: ['IN'] }).expect(201);
    await drainOutbox(t); // the invite email is queued in the same transaction as the invite
    const token = decodeURIComponent(t.sink.lastTo(email)!.match(/token=([^\s]+)/)![1]!);
    await t.http.post('/v1/admin/auth/accept-invite').send({ token, password: 'a very long admin password' }).expect(204);
    await t.http.post('/v1/admin/auth/accept-invite').send({ token, password: 'a very long admin password' }).expect(401); // one-time
    const login = await t.http.post('/v1/admin/auth/login').send({ email, password: 'a very long admin password' }).expect(200);
    expect(login.body.admin.permissions).toContain('moderation.action');
    const list = (await sa.as(t.http.get('/v1/admin/admins')).expect(200)).body.find((x: { id: string }) => x.id === inv.body.id);
    expect(list.roles).toEqual([{ key: 'trust_safety', countryScope: ['IN'] }]);

    // Trust & safety holds no admins.manage → cannot touch roles at all; a product admin with admins.manage via custom role cannot grant super_admin.
    const ts = await adminSession(t, 'trust_safety');
    await ts.as(t.http.get('/v1/admin/roles')).expect(403);
    await sa.as(t.http.put('/v1/admin/roles/people_ops')).send({ name: 'People ops', permissions: ['admins.manage', 'users.view'] }).expect(200);
    const po = await adminSession(t, 'people_ops');
    const esc = await po.as(t.http.put(`/v1/admin/admins/${inv.body.id}/roles`)).send({ roleKeys: ['super_admin'] }).expect(403);
    expect(esc.body.error.details.missing.length).toBeGreaterThan(5);
    await sa.as(t.http.put('/v1/admin/roles/super_admin')).send({ name: 'x', permissions: [] }).expect(409);

    const lone = await t.db.selectFrom('admin_user_roles as ur').innerJoin('admin_roles as r', 'r.id', 'ur.role_id').select('ur.admin_user_id').where('r.key', '=', 'super_admin').execute();
    expect(lone.length).toBeGreaterThan(0);
    await sa.as(t.http.post(`/v1/admin/admins/${sa.id}/disable`)).send({}).expect(409);
  });

  it('enrols MFA with a confirmed code, then requires it at login', async () => {
    const a = await adminSession(t, 'analyst');
    const setup = await a.as(t.http.post('/v1/admin/auth/mfa/setup')).send({}).expect(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    await a.as(t.http.post('/v1/admin/auth/mfa/confirm')).send({ code: '000000' }).expect(400);
    await a.as(t.http.post('/v1/admin/auth/mfa/confirm')).send({ code: totp(base32Decode(setup.body.secret)) }).expect(204);
    const me = (await a.as(t.http.get('/v1/admin/auth/me')).expect(200)).body;
    expect(me).toMatchObject({ mfaEnabled: true, displayName: 'analyst', sessionExpiresAt: expect.any(String) });
    const row = await t.db.selectFrom('admin_users').select('email').where('id', '=', a.id).executeTakeFirstOrThrow();
    expect((await t.http.post('/v1/admin/auth/login').send({ email: row.email, password: 'admin test passphrase 123' }).expect(401)).body.error.code).toBe('MFA_REQUIRED');
  });

  it('exposes metadata, secret settings without leaking values, legal draft edits, audit date filters', async () => {
    const sa = await adminSession(t, 'super_admin');
    const cat = (await sa.as(t.http.get('/v1/admin/config/catalog')).expect(200)).body;
    expect(cat.onboardingSteps).toContain('questionnaire');
    expect(cat.predicateFields.map((f: { field: string }) => f.field)).toContain('countryCode');

    await sa.as(t.http.put('/v1/admin/config/settings/integrations.partner_key')).send({ value: 's3cr3t', valueType: 'string', isSecret: true }).expect(200);
    await sa.as(t.http.put('/v1/admin/config/settings/integrations.partner_key')).send({ valueType: 'string', description: 'Partner API key' }).expect(200); // keeps value
    const listed = (await sa.as(t.http.get('/v1/admin/config/settings')).expect(200)).body.find((s: { key: string }) => s.key === 'integrations.partner_key');
    expect(listed).toMatchObject({ value: null, is_secret: true, description: 'Partner API key' });
    const stored = await t.db.selectFrom('system_settings').select('value').where('key', '=', 'integrations.partner_key').executeTakeFirstOrThrow();
    expect(stored.value).toBe('s3cr3t');
    const audit = await t.db.selectFrom('audit_logs').select('after_state').where('target_id', '=', 'integrations.partner_key').execute();
    expect(JSON.stringify(audit)).not.toContain('s3cr3t');

    const draft = await sa.as(t.http.post('/v1/admin/content/legal')).send({ docType: 'privacy', locale: 'en', title: 'Privacy v2', bodyMarkdown: '# v2' }).expect(201);
    await sa.as(t.http.put(`/v1/admin/content/legal/${draft.body.id}`)).send({ title: 'Privacy v2 (edited)', bodyMarkdown: '# v2 edited' }).expect(200);
    await sa.as(t.http.delete(`/v1/admin/content/legal/${draft.body.id}`)).expect(204);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await sa.as(t.http.get(`/v1/admin/audit-logs?from=${encodeURIComponent(future)}`)).expect(200)).body.items).toHaveLength(0);
  });

  it('closes mobile contract gaps: optional skip, analytics consent, first password, country min age, city', async () => {
    const u = await activeUser(t);
    await t.http.put('/v1/profiles/me').set(u.auth).send({ displayName: 'Gap' }).expect(200);
    const skipped = await t.http.put('/v1/onboarding/step').set(u.auth).send({ step: 'orientation', skip: true }).expect(200);
    expect(skipped.body.steps.find((s: { key: string }) => s.key === 'orientation').completed).toBe(true);
    expect((await t.http.put('/v1/onboarding/step').set(u.auth).send({ step: 'gender', skip: true }).expect(400)).body.error.details.reason).toBe('onboarding.required');

    await t.http.post('/v1/users/me/consents').set(u.auth).send({ consentType: 'analytics', granted: false }).expect(200);
    expect((await t.http.post('/v1/analytics/events').set(u.auth).send({ platform: 'ios', events: [{ name: 'paywall_viewed', occurredAt: new Date().toISOString(), properties: {} }] }).expect(202)).body).toMatchObject({ accepted: 0, reason: 'consent_withdrawn' });

    const countries = (await t.http.get('/v1/catalog/countries').expect(200)).body;
    expect(countries.find((c: { code: string }) => c.code === 'IN').minAge).toBe(18);
    const hyd = await t.db.selectFrom('cities').select('id').where('name', '=', 'Hyderabad').executeTakeFirstOrThrow();
    expect((await t.http.put('/v1/profiles/me').set(u.auth).send({ cityId: hyd.id }).expect(200)).body.city).toMatchObject({ name: 'Hyderabad', countryCode: 'IN' });

    // Phone-only account sets its first password without a current one.
    const phone = `+1415${String(Date.now()).slice(-7)}`;
    const terms = (await t.http.get('/v1/legal/terms')).body.id;
    const privacy = (await t.http.get('/v1/legal/privacy')).body.id;
    const reg = await t.http.post('/v1/auth/register').send({
      phone, dateOfBirth: '1994-01-01', countryCode: 'US', locale: 'en', confirmsMinimumAge: true,
      acceptedTermsVersionId: terms, acceptedPrivacyVersionId: privacy,
      device: { installationId: `inst-${Date.now()}`, platform: 'ios' },
    }).expect(201);
    expect(codeFrom(t.sink, phone)).toMatch(/^\d{6}$/);
    await t.http.post('/v1/auth/password/change').set({ Authorization: `Bearer ${reg.body.tokens.accessToken}` }).send({ newPassword: 'first password ever' }).expect(204);
    await t.http.post('/v1/auth/password/change').set({ Authorization: `Bearer ${reg.body.tokens.accessToken}` }).send({ newPassword: 'second password' }).expect(401);

    const cfg = (await t.http.get('/v1/config').expect(200)).body;
    expect(cfg.settings['onboarding.min_photos']).toBe(2);
  });
});

describe('Admin MFA enforcement (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ ADMIN_REQUIRE_MFA: 'true' });
  });
  afterAll(() => t.close());

  it('limits an un-enrolled admin to MFA setup until enrolled', async () => {
    const a = await adminSession(t, 'super_admin');
    expect((await a.as(t.http.get('/v1/admin/audit-logs')).expect(403)).body.error.code).toBe('MFA_SETUP_REQUIRED');
    expect((await a.as(t.http.get('/v1/admin/auth/me')).expect(200)).body.mfaSetupRequired).toBe(true);
    const setup = await a.as(t.http.post('/v1/admin/auth/mfa/setup')).send({}).expect(200);
    await a.as(t.http.post('/v1/admin/auth/mfa/confirm')).send({ code: totp(base32Decode(setup.body.secret)) }).expect(204);
    await a.as(t.http.get('/v1/admin/audit-logs')).expect(200);
  });
});
