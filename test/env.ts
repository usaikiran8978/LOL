import { randomBytes } from 'node:crypto';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost/amora_test';

/** Fixed test configuration. Secrets are random per run. */
export function testEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_POOL_MAX: '5',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    OTP_PEPPER: randomBytes(32).toString('hex'),
    SIGNING_SECRET: randomBytes(32).toString('hex'),
    FIELD_ENCRYPTION_KEY: process.env.TEST_FIELD_ENCRYPTION_KEY ?? randomBytes(32).toString('base64'),
    OTP_RESEND_COOLDOWN_SECONDS: '0',
    OTP_MAX_PER_HOUR: '50',
    ADMIN_COOKIE_SECURE: 'false',
    ADMIN_REQUIRE_MFA: 'false',
    EMAIL_PROVIDER: 'dev',
    SMS_PROVIDER: 'dev',
    RATE_LIMIT_ENABLED: 'false',
    WORKERS_ENABLED: 'false', // tests drain the outbox explicitly
    S3_BUCKET: 'memory',
    ...overrides,
  };
}
