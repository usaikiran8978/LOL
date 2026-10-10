import { Inject, Injectable } from '@nestjs/common';
import type { Permission } from '@amora/shared';
import { AuditService } from '../../../common/audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../../common/config/config';
import { FIELD_ENCRYPTION, FieldEncryption } from '../../../common/crypto/field-encryption';
import { randomToken, sha256 } from '../../../common/crypto/tokens';
import { DATABASE, type Database } from '../../../common/db/database';
import { AppError } from '../../../common/errors/app-error';
import type { ClientContext } from '../../../common/http/request-context';
import { PasswordService } from '../../auth/password.service';
import { base32Decode, verifyTotp } from './totp';

export interface AdminContext {
  adminId: string;
  sessionId: string;
  email: string;
  permissions: Set<Permission>;
  /** Union of country scopes across roles; null = unrestricted. */
  countryScope: string[] | null;
  displayName: string;
  mfaEnabled: boolean;
  sessionExpiresAt: string;
}

const MAX_FAILURES = 5;
const LOCKOUT_MS = 30 * 60_000;

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    @Inject(FIELD_ENCRYPTION) private readonly fieldEncryption: FieldEncryption,
  ) {}

  async login(email: string, password: string, totpCode: string | undefined, client: ClientContext) {
    const admin = await this.db
      .selectFrom('admin_users')
      .select(['id', 'email', 'display_name', 'password_hash', 'status', 'failed_login_count', 'locked_until', 'mfa_secret_enc', 'mfa_enabled_at'])
      .where('email', '=', email)
      .executeTakeFirst();

    if (admin?.locked_until && new Date(admin.locked_until) > new Date()) throw new AppError('ACCOUNT_LOCKED');
    const ok = await this.passwords.verify(admin?.password_hash, password);
    if (!admin || !ok || admin.status !== 'active') {
      if (admin) {
        const failures = admin.failed_login_count + 1;
        await this.db
          .updateTable('admin_users')
          .set({ failed_login_count: failures, locked_until: failures >= MAX_FAILURES ? new Date(Date.now() + LOCKOUT_MS) : null })
          .where('id', '=', admin.id)
          .execute();
        await this.audit.record({ actorType: 'admin', actorId: admin.id, action: 'admin.login_failed', client });
      }
      throw new AppError('INVALID_CREDENTIALS');
    }

    if (admin.mfa_enabled_at) {
      if (!totpCode) throw new AppError('MFA_REQUIRED');
      const secret = base32Decode(this.fieldEncryption.decrypt(admin.mfa_secret_enc as Buffer));
      if (!verifyTotp(secret, totpCode)) {
        await this.audit.record({ actorType: 'admin', actorId: admin.id, action: 'admin.mfa_failed', client });
        throw new AppError('INVALID_CREDENTIALS');
      }
    }

    const sessionToken = randomToken(32);
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + this.cfg.ADMIN_SESSION_TTL_HOURS * 3_600_000);
    const session = await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('admin_users').set({ failed_login_count: 0, locked_until: null, last_login_at: new Date() }).where('id', '=', admin.id).execute();
      const s = await trx
        .insertInto('admin_sessions')
        .values({ admin_user_id: admin.id, token_hash: sha256(sessionToken), csrf_hash: sha256(csrfToken), ip: client.ip, user_agent: client.userAgent, expires_at: expiresAt })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record({ actorType: 'admin', actorId: admin.id, action: 'admin.login', targetType: 'admin_session', targetId: s.id, client }, trx);
      return s;
    });

    const context = await this.contextFor(admin.id, session.id, admin.email);
    return {
      sessionToken,
      csrfToken,
      expiresAt,
      admin: { id: admin.id, email: admin.email, displayName: admin.display_name, mfaEnabled: !!admin.mfa_enabled_at, mfaSetupRequired: this.cfg.ADMIN_REQUIRE_MFA && !admin.mfa_enabled_at, permissions: [...context.permissions].sort() },
    };
  }

  /** Resolves a session cookie into an admin context; enforces CSRF on state-changing requests. */
  async authenticate(sessionToken: string, csrfToken: string | undefined, mutating: boolean): Promise<AdminContext> {
    const row = await this.db
      .selectFrom('admin_sessions as s')
      .innerJoin('admin_users as a', 'a.id', 's.admin_user_id')
      .select(['s.id', 's.csrf_hash', 's.expires_at', 's.revoked_at', 'a.id as admin_id', 'a.email', 'a.status', 'a.display_name', 'a.mfa_enabled_at'])
      .where('s.token_hash', '=', sha256(sessionToken))
      .executeTakeFirst();
    if (!row || row.revoked_at || new Date(row.expires_at) <= new Date() || row.status !== 'active') throw new AppError('UNAUTHENTICATED');
    if (mutating && (!csrfToken || !sha256(csrfToken).equals(row.csrf_hash as Buffer))) throw new AppError('CSRF_INVALID');
    await this.db.updateTable('admin_sessions').set({ last_used_at: new Date() }).where('id', '=', row.id).execute();
    return { ...(await this.contextFor(row.admin_id, row.id, row.email)), displayName: row.display_name, mfaEnabled: !!row.mfa_enabled_at, sessionExpiresAt: new Date(row.expires_at).toISOString() };
  }

  /** Issues a fresh CSRF token for the current session (e.g. after a page reload lost the in-memory token). */
  async rotateCsrf(ctx: AdminContext): Promise<string> {
    const csrfToken = randomToken(24);
    await this.db.updateTable('admin_sessions').set({ csrf_hash: sha256(csrfToken) }).where('id', '=', ctx.sessionId).execute();
    return csrfToken;
  }

  async logout(ctx: AdminContext, client: ClientContext): Promise<void> {
    await this.db.updateTable('admin_sessions').set({ revoked_at: new Date() }).where('id', '=', ctx.sessionId).execute();
    await this.audit.record({ actorType: 'admin', actorId: ctx.adminId, action: 'admin.logout', targetType: 'admin_session', targetId: ctx.sessionId, client });
  }

  private async contextFor(adminId: string, sessionId: string, email: string): Promise<Omit<AdminContext, 'displayName' | 'mfaEnabled' | 'sessionExpiresAt'>> {
    const rows = await this.db
      .selectFrom('admin_user_roles as ur')
      .innerJoin('admin_role_permissions as rp', 'rp.role_id', 'ur.role_id')
      .select(['rp.permission_key', 'ur.country_scope'])
      .where('ur.admin_user_id', '=', adminId)
      .execute();
    const permissions = new Set(rows.map((r) => r.permission_key as Permission));
    // Any role without a country scope grants global reach.
    const unrestricted = rows.some((r) => !r.country_scope || r.country_scope.length === 0);
    const countryScope = unrestricted ? null : [...new Set(rows.flatMap((r) => r.country_scope ?? []))];
    return { adminId, sessionId, email, permissions, countryScope };
  }
}
