import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { hmac, numericCode, safeEqual } from '../../common/crypto/tokens';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import type { ClientContext } from '../../common/http/request-context';
import { NotificationsService } from '../notifications/notifications.service';

export type OtpChannel = 'email' | 'sms';
export type OtpPurpose = 'verify_email' | 'verify_phone' | 'login_otp' | 'password_reset' | 'account_recovery' | 'change_email' | 'change_phone';

/**
 * One-time codes. Only an HMAC (server pepper + destination + purpose + code) is stored, so a database leak does not
 * expose usable codes. Limits: per-destination hourly cap, resend cooldown, per-code attempt cap, short TTL.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  private digest(destination: string, purpose: OtpPurpose, code: string): Buffer {
    return hmac(this.cfg.OTP_PEPPER, `${purpose}:${destination}:${code}`);
  }

  async issue(params: { channel: OtpChannel; destination: string; purpose: OtpPurpose; userId: string | null; locale: string; client: ClientContext }): Promise<void> {
    const { channel, destination, purpose } = params;
    const recent = await this.db
      .selectFrom('verification_codes')
      .select([sql<number>`count(*)::int`.as('count'), sql<Date | null>`max(created_at)`.as('last')])
      .where('destination', '=', destination)
      .where('purpose', '=', purpose)
      .where('created_at', '>', sql<Date>`now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();

    if (recent.count >= this.cfg.OTP_MAX_PER_HOUR) throw new AppError('RATE_LIMITED', 'Too many codes requested');
    if (recent.last && Date.now() - new Date(recent.last).getTime() < this.cfg.OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      throw new AppError('RATE_LIMITED', 'Please wait before requesting another code', { retryAfterSeconds: this.cfg.OTP_RESEND_COOLDOWN_SECONDS });
    }

    const code = this.cfg.OTP_DEV_STATIC_CODE ?? numericCode(6);
    await this.db.transaction().execute(async (trx) => {
      // A new code invalidates earlier unconsumed codes for the same destination+purpose.
      await trx
        .updateTable('verification_codes')
        .set({ consumed_at: new Date() })
        .where('destination', '=', destination)
        .where('purpose', '=', purpose)
        .where('consumed_at', 'is', null)
        .execute();
      await trx
        .insertInto('verification_codes')
        .values({
          user_id: params.userId,
          channel,
          destination,
          purpose,
          code_hash: this.digest(destination, purpose, code),
          expires_at: new Date(Date.now() + this.cfg.OTP_TTL_SECONDS * 1000),
          ip: params.client.ip,
        })
        .execute();
    });

    // Copy comes from the admin-managed, localized 'auth.otp' template (sent immediately, not queued).
    await this.notifications.sendImmediate('auth.otp', params.locale, channel, destination, { code, minutes: Math.round(this.cfg.OTP_TTL_SECONDS / 60) });
  }

  /** Verifies and consumes a code. Returns the user id the code was issued for (may be null). */
  async consume(destination: string, purpose: OtpPurpose, code: string): Promise<{ userId: string | null }> {
    type Outcome = { ok: true; userId: string | null } | { ok: false; error: 'OTP_INVALID' | 'OTP_EXPIRED' | 'OTP_TOO_MANY_ATTEMPTS' };
    const outcome: Outcome = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('verification_codes')
        .select(['id', 'user_id', 'code_hash', 'attempts', 'max_attempts', 'expires_at'])
        .where('destination', '=', destination)
        .where('purpose', '=', purpose)
        .where('consumed_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(1)
        .forUpdate()
        .executeTakeFirst();

      if (!row) return { ok: false, error: 'OTP_INVALID' };
      if (new Date(row.expires_at) <= new Date()) return { ok: false, error: 'OTP_EXPIRED' };
      if (row.attempts >= row.max_attempts) return { ok: false, error: 'OTP_TOO_MANY_ATTEMPTS' };

      if (!safeEqual(this.digest(destination, purpose, code), row.code_hash as Buffer)) {
        const attempts = row.attempts + 1;
        await trx
          .updateTable('verification_codes')
          .set({ attempts, consumed_at: attempts >= row.max_attempts ? new Date() : null })
          .where('id', '=', row.id)
          .execute();
        return { ok: false, error: attempts >= row.max_attempts ? 'OTP_TOO_MANY_ATTEMPTS' : 'OTP_INVALID' };
      }
      await trx.updateTable('verification_codes').set({ consumed_at: new Date() }).where('id', '=', row.id).execute();
      return { ok: true, userId: row.user_id };
    });
    // Attempt counters must persist, so errors are thrown after commit.
    if (!outcome.ok) throw new AppError(outcome.error);
    return { userId: outcome.userId };
  }
}
