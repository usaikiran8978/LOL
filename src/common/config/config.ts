import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const list = z.string().transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

/**
 * Environment configuration, validated at boot. Production refuses to start with dev-only adapters
 * or missing secrets (see refine below).
 */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(20),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().default('amora-api'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    SESSION_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(365).default(180),
    OTP_PEPPER: z.string().min(32),
    FIELD_ENCRYPTION_KEY: z.string().min(40), // base64 of 32 random bytes
    // Key rotation: bump the version with a new key and list old keys as "<version>:<base64>" until re-encrypted.
    FIELD_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).max(255).default(1),
    FIELD_ENCRYPTION_RETIRED_KEYS: list.default([]),
    OTP_TTL_SECONDS: z.coerce.number().int().default(600),
    OTP_MAX_PER_HOUR: z.coerce.number().int().default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().default(60),
    // Development only: every OTP (sign-up, login, email/phone verification, recovery) is this fixed 6-digit code.
    OTP_DEV_STATIC_CODE: z.string().regex(/^\d{6}$/).optional(),
    LOGIN_MAX_FAILURES: z.coerce.number().int().default(5),
    LOGIN_LOCKOUT_BASE_SECONDS: z.coerce.number().int().default(900),
    CORS_ORIGINS: list.default([]),
    ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
    ADMIN_COOKIE_SECURE: bool.default(true),
    ADMIN_REQUIRE_MFA: bool.default(true),
    ADMIN_CONSOLE_URL: z.string().default('http://localhost:3001'),
    // Public web origin for links sent to people without the app (trusted contacts, safety views).
    PUBLIC_WEB_URL: z.string().default('http://localhost:3002'),
    // Voice/video calls (LiveKit-compatible SFU). Empty = calls unavailable.
    LIVEKIT_URL: z.string().optional(),
    LIVEKIT_API_KEY: z.string().optional(),
    LIVEKIT_API_SECRET: z.string().optional(),
    // Messaging channels. 'dev' adapters keep messages in memory and log them — not allowed in production.
    EMAIL_PROVIDER: z.enum(['smtp', 'dev']).default('dev'),
    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('LOL <no-reply@amora.local>'),
    SMS_PROVIDER: z.enum(['twilio', 'dev']).default('dev'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM: z.string().optional(),
    // Push (optional; a missing provider means that channel is skipped and recorded as suppressed).
    FCM_SERVICE_ACCOUNT_JSON_B64: z.string().optional(),
    APNS_KEY_P8_B64: z.string().optional(),
    APNS_KEY_ID: z.string().optional(),
    APNS_TEAM_ID: z.string().optional(),
    APNS_BUNDLE_ID: z.string().optional(),
    APNS_PRODUCTION: bool.default(false),
    APP_DEEP_LINK_SCHEME: z.string().default('amora'),
    // Social login audiences (comma-separated client IDs). Empty = provider disabled.
    GOOGLE_CLIENT_IDS: list.default([]),
    APPLE_CLIENT_IDS: list.default([]),
    // Facebook Login: app id + secret (Graph debug_token validation). Empty = provider disabled.
    FACEBOOK_APP_ID: z.string().optional(),
    FACEBOOK_APP_SECRET: z.string().optional(),
    FACEBOOK_GRAPH_BASE: z.string().default('https://graph.facebook.com/v21.0'),
    TRUST_PROXY: bool.default(false),
    RATE_LIMIT_ENABLED: bool.default(true),
    WORKERS_ENABLED: bool.default(true),
    // Redis: realtime fan-out + presence across instances (and rate-limit storage). Empty = single-instance mode.
    REDIS_URL: z.string().optional(),
    // Observability: 'json' emits one structured access-log line per request; METRICS_TOKEN guards GET /metrics.
    LOG_FORMAT: z.enum(['json', 'text']).default('text'),
    METRICS_TOKEN: z.string().min(16).optional(),
    // HMAC key for chat upload tokens and other short-lived signed values.
    SIGNING_SECRET: z.string().min(32),
    OUTBOX_POLL_MS: z.coerce.number().int().min(50).default(1000),
    // Object storage (S3-compatible). Empty bucket = media endpoints return STORAGE_NOT_CONFIGURED.
    S3_BUCKET: z.string().optional(),
    // S3_BUCKET=local: development-only disk storage served by the API itself (no S3/MinIO needed).
    LOCAL_STORAGE_DIR: z.string().default('./.local-storage'),
    // Base URL clients use to reach this API (signed dev-storage URLs). Use the machine's LAN IP for a physical phone.
    PUBLIC_API_URL: z.string().default('http://localhost:3000'),
    S3_REGION: z.string().default('us-east-1'),
    S3_ENDPOINT: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool.default(false),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    // Payments (each provider is optional; unconfigured providers return PAYMENT_PROVIDER_NOT_CONFIGURED).
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_API_BASE: z.string().default('https://api.stripe.com'),
    CHECKOUT_RETURN_ORIGINS: list.default(['http://localhost:3002', 'amora://']),
    APPLE_BUNDLE_ID: z.string().optional(),
    APPLE_ENVIRONMENT: z.enum(['Production', 'Sandbox']).default('Sandbox'),
    APPLE_ROOT_FINGERPRINTS: list.default([]),
    GOOGLE_PLAY_PACKAGE: z.string().optional(),
    GOOGLE_PLAY_SA_JSON_B64: z.string().optional(),
    GOOGLE_RTDN_AUDIENCE: z.string().optional(),
    GOOGLE_RTDN_SA_EMAIL: z.string().optional(),
    // Image moderation provider; 'none' = human review queue (or auto-approve per admin setting).
    IMAGE_MODERATION_PROVIDER: z.enum(['none', 'rekognition']).default('none'),
    // Search (DEC-019): empty = Postgres adapter.
    OPENSEARCH_URL: z.string().optional(),
    OPENSEARCH_INDEX: z.string().default('profiles'),
    OPENSEARCH_AUTH: z.string().optional(),
    MEDIA_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(600),
    MEDIA_DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().default(3600),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.EMAIL_PROVIDER === 'dev') ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'dev email adapter is not allowed in production' });
    if (env.SMS_PROVIDER === 'dev') ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'dev SMS adapter is not allowed in production' });
    if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL) ctx.addIssue({ code: 'custom', path: ['SMTP_URL'], message: 'required' });
    if (env.SMS_PROVIDER === 'twilio' && !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM))
      ctx.addIssue({ code: 'custom', path: ['TWILIO_ACCOUNT_SID'], message: 'Twilio credentials required' });
    if (!env.ADMIN_REQUIRE_MFA) ctx.addIssue({ code: 'custom', path: ['ADMIN_REQUIRE_MFA'], message: 'must be true in production' });
    if (!env.ADMIN_COOKIE_SECURE) ctx.addIssue({ code: 'custom', path: ['ADMIN_COOKIE_SECURE'], message: 'must be true in production' });
    if (!env.RATE_LIMIT_ENABLED) ctx.addIssue({ code: 'custom', path: ['RATE_LIMIT_ENABLED'], message: 'must be true in production' });
    if (env.S3_BUCKET === 'memory') ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'memory storage is test-only' });
    if (env.OTP_DEV_STATIC_CODE) ctx.addIssue({ code: 'custom', path: ['OTP_DEV_STATIC_CODE'], message: 'static OTP is development-only' });
    if (env.S3_BUCKET === 'local') ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'local disk storage is development-only' });
    if (!env.S3_BUCKET) ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'required in production' });
  });

export type AppConfig = z.infer<typeof schema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
