import { randomBytes } from 'node:crypto';
import { rotate } from '../scripts/rotate-field-encryption';
import { FieldEncryption, parseRetiredKeys } from '../src/common/crypto/field-encryption';
import { createTestApp, type TestApp } from './helpers';
import { testEnv } from './env';

describe('Field-encryption key rotation (e2e)', () => {
  const oldKey = randomBytes(32).toString('base64');
  const newKey = randomBytes(32).toString('base64');
  let t: TestApp;
  const saved = { ...process.env };

  beforeAll(async () => {
    t = await createTestApp({ FIELD_ENCRYPTION_KEY: oldKey });
  });
  afterAll(async () => {
    process.env = saved;
    await t.close();
  });

  it('re-encrypts every encrypted column with the new key, idempotently', async () => {
    const v1 = new FieldEncryption(oldKey, 1);
    const admin = await t.db.insertInto('admin_users').values({ email: `rot-${Date.now()}@amora.test`, display_name: 'rot', status: 'active', mfa_secret_enc: v1.encrypt('JBSWY3DPEHPK3PXP') }).returning('id').executeTakeFirstOrThrow();
    const user = await t.db.insertInto('users').values({ email: `rot-${Date.now()}@x.test`, status: 'active', date_of_birth: '1990-01-01', country_code: 'US' }).returning('id').executeTakeFirstOrThrow();
    const contact = await t.db.insertInto('trusted_contacts').values({ user_id: user.id, name: 'Sam', phone_e164_enc: v1.encrypt('+14155550123'), email_enc: v1.encrypt('sam@x.test') }).returning('id').executeTakeFirstOrThrow();

    // Suites share the database and each test app uses its own random key, so ciphertext left by earlier suites can't
    // be decrypted here (in production every row shares one key lineage). Clear it; suites run sequentially.
    await t.db.updateTable('admin_users').set({ mfa_secret_enc: null }).where('id', '<>', admin.id).where('mfa_secret_enc', 'is not', null).execute();
    await t.db.deleteFrom('trusted_contacts').where('id', '<>', contact.id).execute();

    Object.assign(process.env, testEnv({ FIELD_ENCRYPTION_KEY: newKey, FIELD_ENCRYPTION_KEY_VERSION: '2', FIELD_ENCRYPTION_RETIRED_KEYS: `1:${oldKey}` }));
    expect(await rotate(() => undefined)).toBeGreaterThanOrEqual(3);
    expect(await rotate(() => undefined)).toBe(0);

    const v2 = new FieldEncryption(newKey, 2, parseRetiredKeys([]));
    const a = await t.db.selectFrom('admin_users').select('mfa_secret_enc').where('id', '=', admin.id).executeTakeFirstOrThrow();
    const c = await t.db.selectFrom('trusted_contacts').select(['phone_e164_enc', 'email_enc']).where('id', '=', contact.id).executeTakeFirstOrThrow();
    expect(v2.decrypt(a.mfa_secret_enc as Buffer)).toBe('JBSWY3DPEHPK3PXP');
    expect(v2.decrypt(c.phone_e164_enc as Buffer)).toBe('+14155550123');
    expect(v2.decrypt(c.email_enc as Buffer)).toBe('sam@x.test');
  });
});
