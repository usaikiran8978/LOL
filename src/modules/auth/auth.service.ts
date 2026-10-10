import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AuthResult, DeviceInfo, MeResponse } from '@amora/shared';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { AuditService } from '../../common/audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import type { ClientContext } from '../../common/http/request-context';
import { ageOn, isValidBirthDate } from './age';
import { OtpService, type OtpChannel } from './otp.service';
import { PasswordService } from './password.service';
import { SocialIdentityService } from './social.service';
import { assertUserCanAuthenticate, TokenService } from './token.service';

const DEFAULT_MIN_AGE = 18;
const MAX_LOCKOUT_SECONDS = 86_400;
const PG_UNIQUE_VIOLATION = '23505';

interface SignupFields {
  dateOfBirth: string;
  countryCode: string;
  locale: string;
  timezone?: string;
  acceptedTermsVersionId: string;
  acceptedPrivacyVersionId: string;
  marketingOptIn: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly otp: OtpService,
    private readonly social: SocialIdentityService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  // ---------------------------------------------------------------- registration

  async register(
    input: SignupFields & { email?: string; phone?: string; password?: string; device: DeviceInfo },
    client: ClientContext,
  ): Promise<AuthResult> {
    await this.assertSignupEligible(input, client);
    const passwordHash = input.password ? await this.passwords.hash(input.password) : null;

    let result: AuthResult;
    try {
      result = await this.db.transaction().execute(async (trx) => {
        const user = await this.createUser(trx, {
          ...input,
          email: input.email ?? null,
          phone: input.phone ?? null,
          passwordHash,
          emailVerified: false,
        }, client);
        const tokens = await this.tokens.createSession(trx, user.id, input.device, client, 0);
        await this.audit.record({ actorType: 'user', actorId: user.id, action: 'auth.register', targetType: 'user', targetId: user.id, client }, trx);
        await this.analytics.track('signup_completed', { userId: user.id, platform: input.device.platform, countryCode: input.countryCode, properties: { method: input.email ? 'email' : 'phone' } }, trx);
        return { user: await this.me(user.id, trx), tokens, isNewUser: true };
      });
    } catch (err) {
      throw mapUniqueViolation(err);
    }

    // Verification code is sent after commit; a delivery failure must not undo the signup (client can resend).
    const channel: OtpChannel = input.email ? 'email' : 'sms';
    await this.sendContactVerification(result.user.id, channel, client).catch((err: Error) =>
      this.logger.warn(`verification send failed for ${result.user.id}: ${err.message}`),
    );
    return result;
  }

  private async assertSignupEligible(input: SignupFields & { email?: string | null; phone?: string | null }, client: ClientContext): Promise<void> {
    if (!isValidBirthDate(input.dateOfBirth)) throw new AppError('VALIDATION_FAILED', 'Invalid date of birth', [{ path: 'dateOfBirth', message: 'invalid' }]);

    const country = await this.db
      .selectFrom('countries as c')
      .leftJoin('country_configs as cc', 'cc.country_code', 'c.code')
      .select(['c.code', 'c.is_active', 'cc.min_age'])
      .where('c.code', '=', input.countryCode)
      .executeTakeFirst();
    if (!country?.is_active) throw new AppError('COUNTRY_NOT_SUPPORTED');

    const minAge = country.min_age ?? DEFAULT_MIN_AGE;
    if (ageOn(input.dateOfBirth) < minAge) {
      // No account is created and no PII is stored for ineligible sign-ups.
      await this.audit.record({ actorType: 'system', action: 'auth.signup_age_ineligible', targetType: 'country', targetId: input.countryCode, client });
      throw new AppError('AGE_INELIGIBLE', undefined, { minAge });
    }

    const docs = await this.db
      .selectFrom('legal_documents')
      .select(['id', 'doc_type'])
      .where('id', 'in', [input.acceptedTermsVersionId, input.acceptedPrivacyVersionId])
      .where('status', '=', 'published')
      .execute();
    const types = new Set(docs.filter((d) => d.id === input.acceptedTermsVersionId || d.id === input.acceptedPrivacyVersionId).map((d) => `${d.id}:${d.doc_type}`));
    if (!types.has(`${input.acceptedTermsVersionId}:terms`) || !types.has(`${input.acceptedPrivacyVersionId}:privacy`)) {
      throw new AppError('CONSENT_REQUIRED', 'Current terms and privacy policy must be accepted');
    }

    if (input.email && (await this.db.selectFrom('users').select('id').where('email', '=', input.email).executeTakeFirst())) {
      throw new AppError('EMAIL_TAKEN');
    }
    if (input.phone && (await this.db.selectFrom('users').select('id').where('phone_e164', '=', input.phone).executeTakeFirst())) {
      throw new AppError('PHONE_TAKEN');
    }
  }

  private async createUser(
    trx: Tx,
    input: SignupFields & { email: string | null; phone: string | null; passwordHash: string | null; emailVerified: boolean; socialIdentity?: boolean },
    client: ClientContext,
  ): Promise<{ id: string }> {
    const now = new Date();
    const user = await trx
      .insertInto('users')
      .values({
        email: input.email,
        phone_e164: input.phone,
        password_hash: input.passwordHash,
        // A social identity is itself provider-verified, so such accounts don't wait on an email/phone code.
        status: input.emailVerified || input.socialIdentity ? 'active' : 'pending',
        has_social_identity: input.socialIdentity ?? false,
        email_verified_at: input.emailVerified ? now : null,
        date_of_birth: input.dateOfBirth,
        age_verified_at: now, // self-declared age gate passed; stronger assurance comes from ID verification
        country_code: input.countryCode,
        locale: input.locale,
        timezone: input.timezone ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const consent = (consent_type: string, granted: boolean, legal_document_id: string | null = null) => ({
      user_id: user.id,
      consent_type,
      granted,
      legal_document_id,
      source: 'app',
      ip: client.ip,
      user_agent: client.userAgent,
    });
    const consents = [
      consent('terms', true, input.acceptedTermsVersionId),
      consent('privacy', true, input.acceptedPrivacyVersionId),
      consent('age_confirmation', true),
    ];
    if (input.email) consents.push(consent('marketing_email', input.marketingOptIn));
    if (input.phone) consents.push(consent('marketing_sms', input.marketingOptIn));
    await trx.insertInto('consent_records').values(consents).execute();
    return user;
  }

  // ---------------------------------------------------------------- password login

  async login(identifier: string, password: string, device: DeviceInfo, client: ClientContext): Promise<AuthResult> {
    const normalized = identifier.trim();
    const byPhone = normalized.startsWith('+');
    const user = await this.db
      .selectFrom('users')
      .select(['id', 'password_hash', 'status', 'status_until', 'failed_login_count', 'locked_until', 'token_version', 'country_code'])
      .where(byPhone ? 'phone_e164' : 'email', '=', byPhone ? normalized : normalized.toLowerCase())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', undefined, { retryAfterSeconds: Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 1000) });
    }

    const ok = await this.passwords.verify(user?.password_hash, password);
    if (!user || !ok) {
      if (user) await this.registerFailedLogin(user.id, user.failed_login_count + 1, client);
      await this.analytics.track('login_failed', { userId: user?.id ?? null, platform: device.platform });
      throw new AppError('INVALID_CREDENTIALS');
    }
    assertUserCanAuthenticate(user.status, user.status_until);

    return this.completeLogin(user.id, user.token_version, device, client, 'password');
  }

  private async registerFailedLogin(userId: string, failures: number, client: ClientContext): Promise<void> {
    const over = failures - this.cfg.LOGIN_MAX_FAILURES;
    const lockSeconds = over >= 0 ? Math.min(this.cfg.LOGIN_LOCKOUT_BASE_SECONDS * 2 ** over, MAX_LOCKOUT_SECONDS) : 0;
    await this.db
      .updateTable('users')
      .set({ failed_login_count: failures, locked_until: lockSeconds ? new Date(Date.now() + lockSeconds * 1000) : null })
      .where('id', '=', userId)
      .execute();
    await this.audit.record({ actorType: 'user', actorId: userId, action: lockSeconds ? 'auth.account_locked' : 'auth.login_failed', targetType: 'user', targetId: userId, client });
  }

  private async completeLogin(userId: string, tokenVersion: number, device: DeviceInfo, client: ClientContext, method: string): Promise<AuthResult> {
    return this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({ failed_login_count: 0, locked_until: null, last_login_at: new Date(), last_active_at: new Date() })
        .where('id', '=', userId)
        .execute();
      const tokens = await this.tokens.createSession(trx, userId, device, client, tokenVersion);
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'auth.login', targetType: 'session', targetId: tokens.sessionId, after: { method }, client }, trx);
      await this.analytics.track('login_succeeded', { userId, platform: device.platform, properties: { method } }, trx);
      return { user: await this.me(userId, trx), tokens, isNewUser: false };
    });
  }

  // ---------------------------------------------------------------- OTP flows

  /**
   * Public OTP request for login, password reset and account recovery. Always succeeds from the caller's point of
   * view so the endpoint cannot be used to discover which emails/phones have accounts.
   */
  async requestPublicOtp(channel: OtpChannel, destination: string, purpose: 'login_otp' | 'password_reset' | 'account_recovery', client: ClientContext): Promise<void> {
    const dest = normalizeDestination(channel, destination);
    if (purpose === 'login_otp' && channel !== 'sms') throw new AppError('VALIDATION_FAILED', 'login codes are sent by SMS');
    const user = await this.findByDestination(channel, dest);
    if (!user || ['banned', 'deleted'].includes(user.status)) return;
    // Recovery codes only go to contacts the user has already proven they control.
    if (purpose === 'account_recovery' && !(channel === 'email' ? user.email_verified_at : user.phone_verified_at)) return;
    await this.otp.issue({ channel, destination: dest, purpose, userId: user.id, locale: user.locale, client });
  }

  async loginWithOtp(phone: string, code: string, device: DeviceInfo, client: ClientContext): Promise<AuthResult> {
    const { userId } = await this.otp.consume(phone, 'login_otp', code);
    const user = userId
      ? await this.db.selectFrom('users').select(['id', 'status', 'status_until', 'token_version', 'phone_verified_at']).where('id', '=', userId).executeTakeFirst()
      : undefined;
    if (!user) throw new AppError('INVALID_CREDENTIALS');
    assertUserCanAuthenticate(user.status, user.status_until);
    if (!user.phone_verified_at) await this.markVerified(user.id, 'sms');
    return this.completeLogin(user.id, user.token_version, device, client, 'otp');
  }

  async sendContactVerification(userId: string, channel: OtpChannel, client: ClientContext): Promise<void> {
    const user = await this.db.selectFrom('users').select(['email', 'phone_e164', 'locale', 'email_verified_at', 'phone_verified_at']).where('id', '=', userId).executeTakeFirstOrThrow();
    const destination = channel === 'email' ? user.email : user.phone_e164;
    if (!destination) throw new AppError('VALIDATION_FAILED', `No ${channel === 'email' ? 'email' : 'phone'} on account`);
    if (channel === 'email' ? user.email_verified_at : user.phone_verified_at) throw new AppError('CONFLICT', 'Already verified');
    await this.otp.issue({ channel, destination, purpose: channel === 'email' ? 'verify_email' : 'verify_phone', userId, locale: user.locale, client });
  }

  async verifyContact(userId: string, channel: OtpChannel, code: string, client: ClientContext): Promise<MeResponse> {
    const user = await this.db.selectFrom('users').select(['email', 'phone_e164']).where('id', '=', userId).executeTakeFirstOrThrow();
    const destination = channel === 'email' ? user.email : user.phone_e164;
    if (!destination) throw new AppError('VALIDATION_FAILED', 'No destination on account');
    const consumed = await this.otp.consume(destination, channel === 'email' ? 'verify_email' : 'verify_phone', code);
    if (consumed.userId !== userId) throw new AppError('OTP_INVALID');
    await this.markVerified(userId, channel);
    await this.audit.record({ actorType: 'user', actorId: userId, action: channel === 'email' ? 'auth.email_verified' : 'auth.phone_verified', targetType: 'user', targetId: userId, client });
    await this.analytics.track(channel === 'email' ? 'email_verified' : 'phone_verified', { userId });
    return this.me(userId);
  }

  private async markVerified(userId: string, channel: OtpChannel): Promise<void> {
    await this.db
      .updateTable('users')
      .set((eb) => ({
        ...(channel === 'email' ? { email_verified_at: new Date() } : { phone_verified_at: new Date() }),
        status: eb.case().when('status', '=', 'pending').then('active').else(eb.ref('status')).end(),
      }))
      .where('id', '=', userId)
      .execute();
  }

  async resetPassword(channel: OtpChannel, destination: string, code: string, newPassword: string, client: ClientContext): Promise<void> {
    const dest = normalizeDestination(channel, destination);
    const { userId } = await this.otp.consume(dest, 'password_reset', code);
    if (!userId) throw new AppError('OTP_INVALID');
    const hash = await this.passwords.hash(newPassword);
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({
          password_hash: hash,
          failed_login_count: 0,
          locked_until: null,
          // Receiving the code proves control of the channel.
          ...(channel === 'email' ? { email_verified_at: sql<Date>`coalesce(email_verified_at, now())` } : { phone_verified_at: sql<Date>`coalesce(phone_verified_at, now())` }),
        })
        .where('id', '=', userId)
        .execute();
      await this.tokens.revokeAllForUser(trx, userId, 'password_reset');
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'auth.password_reset', targetType: 'user', targetId: userId, client }, trx);
      await this.analytics.track('password_reset_completed', { userId }, trx);
    });
  }

  /**
   * Account recovery: the user proves control of a verified contact, every existing session is revoked (the account
   * may be compromised), an optional new password is set, and a fresh session is issued on this device.
   */
  async recoverAccount(
    input: { channel: OtpChannel; destination: string; code: string; newPassword?: string; device: DeviceInfo },
    client: ClientContext,
  ): Promise<AuthResult> {
    const dest = normalizeDestination(input.channel, input.destination);
    const { userId } = await this.otp.consume(dest, 'account_recovery', input.code);
    if (!userId) throw new AppError('OTP_INVALID');
    const hash = input.newPassword ? await this.passwords.hash(input.newPassword) : undefined;
    const user = await this.db.transaction().execute(async (trx) => {
      await this.tokens.revokeAllForUser(trx, userId, 'account_recovery');
      const updated = await trx
        .updateTable('users')
        .set({ failed_login_count: 0, locked_until: null, ...(hash ? { password_hash: hash } : {}) })
        .where('id', '=', userId)
        .returning(['status', 'status_until', 'token_version'])
        .executeTakeFirstOrThrow();
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'auth.account_recovered', targetType: 'user', targetId: userId, after: { passwordChanged: !!hash }, client }, trx);
      return updated;
    });
    assertUserCanAuthenticate(user.status, user.status_until);
    return this.completeLogin(userId, user.token_version, input.device, client, 'recovery');
  }

  async changePassword(userId: string, sessionId: string, current: string | undefined, next: string, client: ClientContext): Promise<void> {
    const user = await this.db.selectFrom('users').select('password_hash').where('id', '=', userId).executeTakeFirstOrThrow();
    // Accounts created via phone/social have no password yet; setting one does not require a current password.
    if (user.password_hash && (!current || !(await this.passwords.verify(user.password_hash, current)))) throw new AppError('INVALID_CREDENTIALS');
    const hash = await this.passwords.hash(next);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ password_hash: hash }).where('id', '=', userId).execute();
      await this.tokens.revokeAllForUser(trx, userId, 'password_changed', sessionId);
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'auth.password_changed', targetType: 'user', targetId: userId, client }, trx);
    });
  }

  // ---------------------------------------------------------------- social login

  async socialLogin(
    input: { provider: 'google' | 'apple' | 'facebook'; idToken: string; nonce?: string; device: DeviceInfo; signup?: SignupFields },
    client: ClientContext,
  ): Promise<AuthResult> {
    const identity = await this.social.verify(input.provider, input.idToken, input.nonce);

    const linked = await this.db
      .selectFrom('auth_identities as ai')
      .innerJoin('users as u', 'u.id', 'ai.user_id')
      .select(['u.id', 'u.status', 'u.status_until', 'u.token_version', 'ai.id as identity_id'])
      .where('ai.provider', '=', identity.provider)
      .where('ai.provider_subject', '=', identity.subject)
      .executeTakeFirst();
    if (linked) {
      assertUserCanAuthenticate(linked.status, linked.status_until);
      await this.db.updateTable('auth_identities').set({ last_used_at: new Date() }).where('id', '=', linked.identity_id).execute();
      return this.completeLogin(linked.id, linked.token_version, input.device, client, input.provider);
    }

    if (identity.email) {
      const existing = await this.db
        .selectFrom('users')
        .select(['id', 'status', 'status_until', 'token_version', 'email_verified_at'])
        .where('email', '=', identity.email)
        .executeTakeFirst();
      if (existing) {
        // Auto-link only when both sides have verified the email; otherwise an attacker could pre-register a
        // victim's address and take over the account when the victim later signs in with Google/Apple.
        if (!identity.emailVerified || !existing.email_verified_at) throw new AppError('EMAIL_TAKEN', 'Sign in with your password to link this account');
        assertUserCanAuthenticate(existing.status, existing.status_until);
        await this.db.updateTable('users').set({ has_social_identity: true }).where('id', '=', existing.id).execute();
        await this.db.insertInto('auth_identities').values({ user_id: existing.id, provider: identity.provider, provider_subject: identity.subject, email: identity.email, last_used_at: new Date() }).execute();
        await this.audit.record({ actorType: 'user', actorId: existing.id, action: 'auth.social_linked', targetType: 'user', targetId: existing.id, after: { provider: identity.provider }, client });
        return this.completeLogin(existing.id, existing.token_version, input.device, client, identity.provider);
      }
    }

    if (!input.signup) throw new AppError('CONSENT_REQUIRED', 'Sign-up details required for new account', { needsSignup: true });
    const email = identity.email && identity.emailVerified ? identity.email : null;
    await this.assertSignupEligible({ ...input.signup, email }, client);

    try {
      return await this.db.transaction().execute(async (trx) => {
        const user = await this.createUser(trx, { ...input.signup!, email, phone: null, passwordHash: null, emailVerified: !!email, socialIdentity: true }, client);
        await trx.insertInto('auth_identities').values({ user_id: user.id, provider: identity.provider, provider_subject: identity.subject, email: identity.email, last_used_at: new Date() }).execute();
        const tokens = await this.tokens.createSession(trx, user.id, input.device, client, 0);
        await this.audit.record({ actorType: 'user', actorId: user.id, action: 'auth.register', targetType: 'user', targetId: user.id, after: { method: identity.provider }, client }, trx);
        await this.analytics.track('signup_completed', { userId: user.id, platform: input.device.platform, countryCode: input.signup!.countryCode, properties: { method: identity.provider } }, trx);
        return { user: await this.me(user.id, trx), tokens, isNewUser: true };
      });
    } catch (err) {
      throw mapUniqueViolation(err);
    }
  }

  // ---------------------------------------------------------------- session lifecycle

  refresh(refreshToken: string, client: ClientContext) {
    return this.tokens.rotate(refreshToken, client);
  }

  async logout(userId: string, sessionId: string, client: ClientContext): Promise<void> {
    await this.tokens.revokeSession(sessionId, 'logout');
    await this.audit.record({ actorType: 'user', actorId: userId, action: 'auth.logout', targetType: 'session', targetId: sessionId, client });
    await this.analytics.track('logout', { userId });
  }

  // ---------------------------------------------------------------- helpers

  async me(userId: string, trx: Tx | Database = this.db): Promise<MeResponse> {
    const u = await trx
      .selectFrom('users as u')
      .leftJoin('onboarding_progress as op', 'op.user_id', 'u.id')
      .select(['u.id', 'u.email', 'u.phone_e164', 'u.email_verified_at', 'u.phone_verified_at', 'u.status', 'u.country_code', 'u.locale', 'u.created_at', 'op.completed_at'])
      .where('u.id', '=', userId)
      .executeTakeFirstOrThrow();
    return {
      id: u.id,
      email: u.email,
      phone: u.phone_e164,
      emailVerified: !!u.email_verified_at,
      phoneVerified: !!u.phone_verified_at,
      status: u.status,
      countryCode: u.country_code,
      locale: u.locale,
      onboardingCompleted: !!u.completed_at,
      createdAt: new Date(u.created_at).toISOString(),
    };
  }

  private findByDestination(channel: OtpChannel, destination: string) {
    return this.db
      .selectFrom('users')
      .select(['id', 'status', 'locale', 'email_verified_at', 'phone_verified_at'])
      .where(channel === 'email' ? 'email' : 'phone_e164', '=', destination)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }
}

export function normalizeDestination(channel: OtpChannel, destination: string): string {
  const d = destination.trim();
  if (channel === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d)) throw new AppError('VALIDATION_FAILED', 'Invalid email');
    return d.toLowerCase();
  }
  if (!/^\+[1-9][0-9]{6,14}$/.test(d)) throw new AppError('VALIDATION_FAILED', 'Invalid phone number');
  return d;
}

function mapUniqueViolation(err: unknown): unknown {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== PG_UNIQUE_VIOLATION) return err;
  if (e.constraint === 'users_email_key') return new AppError('EMAIL_TAKEN');
  if (e.constraint === 'users_phone_e164_key') return new AppError('PHONE_TAKEN');
  return new AppError('CONFLICT');
}
