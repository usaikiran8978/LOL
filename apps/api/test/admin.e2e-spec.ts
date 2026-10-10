import { randomBytes } from 'node:crypto';
import { Algorithm, hash } from '@node-rs/argon2';
import { FieldEncryption } from '../src/common/crypto/field-encryption';
import { totp, base32Decode } from '../src/modules/admin/auth/totp';
import { createTestApp, type TestApp } from './helpers';

const ENC_KEY = randomBytes(32).toString('base64');
const PASSWORD = 'admin test passphrase 123';

async function createAdmin(t: TestApp, roleKey: string, opts: { mfaSecret?: string } = {}) {
  const email = `admin-${randomBytes(4).toString('hex')}@amora.test`;
  const password_hash = await hash(PASSWORD, { algorithm: Algorithm.Argon2id });
  const admin = await t.db
    .insertInto('admin_users')
    .values({
      email, display_name: roleKey, password_hash, status: 'active',
      ...(opts.mfaSecret ? { mfa_secret_enc: new FieldEncryption(ENC_KEY).encrypt(opts.mfaSecret), mfa_enabled_at: new Date() } : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const role = await t.db.selectFrom('admin_roles').select('id').where('key', '=', roleKey).executeTakeFirstOrThrow();
  await t.db.insertInto('admin_user_roles').values({ admin_user_id: admin.id, role_id: role.id }).execute();
  return { id: admin.id, email };
}

async function login(t: TestApp, email: string, totpCode?: string) {
  const res = await t.http.post('/v1/admin/auth/login').send({ email, password: PASSWORD, totp: totpCode });
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('amora_admin='));
  return { res, cookie: cookie?.split(';')[0], csrf: res.body.csrfToken as string };
}

describe('Admin auth & RBAC (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    process.env.TEST_FIELD_ENCRYPTION_KEY = ENC_KEY;
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('issues an httpOnly SameSite=Strict session cookie and a CSRF token', async () => {
    const { email } = await createAdmin(t, 'super_admin');
    const { res } = await login(t, email);
    expect(res.status).toBe(200);
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []).join(';');
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(res.body.csrfToken).toEqual(expect.any(String));
    expect(res.body.admin.permissions).toContain('admins.manage');
  });

  it('requires the CSRF token on state-changing requests and can re-issue it', async () => {
    const { email } = await createAdmin(t, 'super_admin');
    const { cookie, csrf } = await login(t, email);
    const body = { value: 3, valueType: 'number' };
    const missing = await t.http.put('/v1/admin/config/settings/onboarding.min_interests').set('Cookie', cookie!).send(body).expect(403);
    expect(missing.body.error.code).toBe('CSRF_INVALID');
    await t.http.put('/v1/admin/config/settings/onboarding.min_interests').set('Cookie', cookie!).set('X-CSRF-Token', csrf).send(body).expect(200);
    // After a reload the console asks for a new token; the old one stops working.
    const fresh = await t.http.post('/v1/admin/auth/csrf').set('Cookie', cookie!).expect(200);
    await t.http.put('/v1/admin/config/settings/onboarding.min_interests').set('Cookie', cookie!).set('X-CSRF-Token', csrf).send(body).expect(403);
    await t.http.put('/v1/admin/config/settings/onboarding.min_interests').set('Cookie', cookie!).set('X-CSRF-Token', fresh.body.csrfToken).send(body).expect(200);
    // Logout needs no CSRF (SameSite=Strict cookie) so a reloaded tab can always sign out.
    await t.http.post('/v1/admin/auth/logout').set('Cookie', cookie!).expect(204);
    await t.http.get('/v1/admin/auth/me').set('Cookie', cookie!).expect(401);
  });

  it('archives CMS entries (regression: BigInt in audit payload)', async () => {
    const { email } = await createAdmin(t, 'content_admin');
    const { cookie, csrf } = await login(t, email);
    await t.http.put('/v1/admin/content/cms/faq.archive_me').set('Cookie', cookie!).set('X-CSRF-Token', csrf)
      .send({ key: 'faq.archive_me', kind: 'faq', status: 'published', translations: { en: { title: 'T', bodyMarkdown: 'B' } } }).expect(200);
    await t.http.delete('/v1/admin/content/cms/faq.archive_me').set('Cookie', cookie!).set('X-CSRF-Token', csrf).expect(204);
  });

  it('enforces permissions per endpoint (support cannot read audit logs, super admin can)', async () => {
    const support = await createAdmin(t, 'support');
    const s = await login(t, support.email);
    const denied = await t.http.get('/v1/admin/audit-logs').set('Cookie', s.cookie!).expect(403);
    expect(denied.body.error).toMatchObject({ code: 'FORBIDDEN', details: { missing: ['audit.view'] } });

    const sa = await createAdmin(t, 'super_admin');
    const a = await login(t, sa.email);
    const page = await t.http.get('/v1/admin/audit-logs?limit=2&action=admin.login').set('Cookie', a.cookie!).expect(200);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.nextCursor).toEqual(expect.any(String));
    const next = await t.http.get(`/v1/admin/audit-logs?limit=2&action=admin.login&cursor=${page.body.nextCursor}`).set('Cookie', a.cookie!).expect(200);
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
  });

  it('requires a valid TOTP when MFA is enabled', async () => {
    const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const { email } = await createAdmin(t, 'finance_admin', { mfaSecret: seed });
    expect((await login(t, email)).res.body.error.code).toBe('MFA_REQUIRED');
    expect((await login(t, email, '000000')).res.status).toBe(401);
    const ok = await login(t, email, totp(base32Decode(seed)));
    expect(ok.res.status).toBe(200);
  });

  it('rejects a user access token on admin endpoints', async () => {
    await t.http.get('/v1/admin/auth/me').set('Authorization', 'Bearer something').expect(401);
  });

  it('keeps audit_logs append-only at the database level', async () => {
    await expect(t.db.deleteFrom('audit_logs').execute()).rejects.toThrow(/append-only/);
  });
});
