import { Inject, Injectable } from '@nestjs/common';
import type { AuthTokens, DeviceInfo } from '@amora/shared';
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import type { ClientContext } from '../../common/http/request-context';
import { randomToken, sha256 } from '../../common/crypto/tokens';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';

export interface AccessClaims {
  userId: string;
  sessionId: string;
  tokenVersion: number;
}

/**
 * Sessions = one per device login. Access tokens: short-lived JWT (HS256). Refresh tokens: opaque, single use,
 * rotated on every refresh; presenting an already-used refresh token revokes the whole session (reuse detection).
 */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {
    this.key = new TextEncoder().encode(cfg.JWT_ACCESS_SECRET);
  }

  async createSession(trx: Tx, userId: string, device: DeviceInfo, client: ClientContext, tokenVersion: number): Promise<AuthTokens> {
    const deviceRow = await trx
      .insertInto('user_devices')
      .values({
        user_id: userId,
        installation_id: device.installationId,
        platform: device.platform,
        model: device.model ?? null,
        os_version: device.osVersion ?? null,
        app_version: device.appVersion ?? null,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'installation_id']).doUpdateSet({
          platform: device.platform,
          model: device.model ?? null,
          os_version: device.osVersion ?? null,
          app_version: device.appVersion ?? null,
          last_seen_at: new Date(),
          revoked_at: null,
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();

    // One active session per device: logging in again on the same install replaces the old session.
    await trx
      .updateTable('user_sessions')
      .set({ revoked_at: new Date(), revoke_reason: 'replaced' })
      .where('device_id', '=', deviceRow.id)
      .where('revoked_at', 'is', null)
      .execute();

    const session = await trx
      .insertInto('user_sessions')
      .values({
        user_id: userId,
        device_id: deviceRow.id,
        ip: client.ip,
        user_agent: client.userAgent,
        expires_at: new Date(Date.now() + this.cfg.SESSION_MAX_AGE_DAYS * 86_400_000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Device/contact fingerprinting for duplicate & ban-evasion detection (safety module).
    await this.outbox.enqueue(trx, 'auth.session_created', { userId, installationId: device.installationId }, { aggregateId: userId });
    return this.issue(trx, userId, session.id, tokenVersion, null);
  }

  private async issue(trx: Tx, userId: string, sessionId: string, tokenVersion: number, parentId: string | null): Promise<AuthTokens> {
    const refreshToken = randomToken(32);
    const refreshExpires = new Date(Date.now() + this.cfg.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    await trx
      .insertInto('refresh_tokens')
      .values({ session_id: sessionId, token_hash: sha256(refreshToken), parent_id: parentId, expires_at: refreshExpires })
      .execute();

    const accessExpires = new Date(Date.now() + this.cfg.ACCESS_TOKEN_TTL_SECONDS * 1000);
    const accessToken = await new SignJWT({ sid: sessionId, tv: tokenVersion, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(this.cfg.JWT_ISSUER)
      .setIssuedAt()
      .setExpirationTime(Math.floor(accessExpires.getTime() / 1000))
      .sign(this.key);

    return {
      accessToken,
      accessTokenExpiresAt: accessExpires.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpires.toISOString(),
      sessionId,
    };
  }

  async rotate(refreshToken: string, client: ClientContext): Promise<{ userId: string; tokens: AuthTokens }> {
    const result = await this.db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('refresh_tokens as rt')
        .innerJoin('user_sessions as s', 's.id', 'rt.session_id')
        .innerJoin('users as u', 'u.id', 's.user_id')
        .select([
          'rt.id', 'rt.used_at', 'rt.revoked_at', 'rt.expires_at', 's.id as session_id', 's.revoked_at as session_revoked_at',
          's.expires_at as session_expires_at', 'u.id as user_id', 'u.status', 'u.status_until', 'u.token_version',
        ])
        .where('rt.token_hash', '=', sha256(refreshToken))
        .forUpdate()
        .executeTakeFirst();

      if (!row) throw new AppError('TOKEN_INVALID');

      if (row.used_at || row.revoked_at) {
        // Reuse of a rotated token: assume theft, revoke the whole session.
        await this.revokeSessionInTx(trx, row.session_id, 'refresh_reuse');
        await this.audit.record({ actorType: 'system', action: 'auth.refresh_reuse_detected', targetType: 'session', targetId: row.session_id, client }, trx);
        return { reused: true as const };
      }
      const now = new Date();
      if (row.session_revoked_at || new Date(row.expires_at) <= now || new Date(row.session_expires_at) <= now) {
        throw new AppError('TOKEN_EXPIRED');
      }
      assertUserCanAuthenticate(row.status, row.status_until);

      await trx.updateTable('refresh_tokens').set({ used_at: now }).where('id', '=', row.id).execute();
      await trx.updateTable('user_sessions').set({ last_used_at: now, ip: client.ip }).where('id', '=', row.session_id).execute();
      const tokens = await this.issue(trx, row.user_id, row.session_id, row.token_version, row.id);
      return { reused: false as const, userId: row.user_id, tokens };
    });
    // Thrown after commit so the revocation above is persisted.
    if (result.reused) throw new AppError('REFRESH_TOKEN_REUSED');
    return { userId: result.userId, tokens: result.tokens };
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: this.cfg.JWT_ISSUER, algorithms: ['HS256'] });
      if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.tv !== 'number') {
        throw new AppError('TOKEN_INVALID');
      }
      return { userId: payload.sub, sessionId: payload.sid, tokenVersion: payload.tv };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err instanceof joseErrors.JWTExpired) throw new AppError('TOKEN_EXPIRED');
      throw new AppError('TOKEN_INVALID');
    }
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.db.transaction().execute((trx) => this.revokeSessionInTx(trx, sessionId, reason));
  }

  async revokeSessionInTx(trx: Tx, sessionId: string, reason: string): Promise<void> {
    const now = new Date();
    await trx.updateTable('user_sessions').set({ revoked_at: now, revoke_reason: reason }).where('id', '=', sessionId).where('revoked_at', 'is', null).execute();
    await trx.updateTable('refresh_tokens').set({ revoked_at: now }).where('session_id', '=', sessionId).where('revoked_at', 'is', null).execute();
  }

  /** Revoke every session of a user (password reset, force logout, ban) and invalidate outstanding access tokens. */
  async revokeAllForUser(trx: Tx, userId: string, reason: string, exceptSessionId?: string): Promise<void> {
    let sessions = trx.selectFrom('user_sessions').select('id').where('user_id', '=', userId).where('revoked_at', 'is', null);
    if (exceptSessionId) sessions = sessions.where('id', '<>', exceptSessionId);
    for (const s of await sessions.execute()) await this.revokeSessionInTx(trx, s.id, reason);
    if (!exceptSessionId) {
      await trx.updateTable('users').set((eb) => ({ token_version: eb('token_version', '+', 1) })).where('id', '=', userId).execute();
    }
  }
}

export function assertUserCanAuthenticate(status: string, statusUntil?: Date | string | null): void {
  if (status === 'banned') throw new AppError('ACCOUNT_BANNED');
  // Time-boxed suspensions stop applying once status_until passes (the maintenance job then flips status back).
  if (status === 'suspended' && !(statusUntil && new Date(statusUntil) <= new Date())) {
    throw new AppError('ACCOUNT_SUSPENDED', undefined, statusUntil ? { until: new Date(statusUntil).toISOString() } : undefined);
  }
  if (status === 'deleted') throw new AppError('INVALID_CREDENTIALS');
}
