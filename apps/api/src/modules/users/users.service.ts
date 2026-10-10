import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import type { ClientContext } from '../../common/http/request-context';
import { TokenService } from '../auth/token.service';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /** Active sessions with their device, for the "devices & sessions" screen (TECH §15). */
  async listSessions(userId: string, currentSessionId: string) {
    const rows = await this.db
      .selectFrom('user_sessions as s')
      .leftJoin('user_devices as d', 'd.id', 's.device_id')
      .select(['s.id', 's.created_at', 's.last_used_at', 's.ip', 'd.platform', 'd.model', 'd.os_version', 'd.app_version'])
      .where('s.user_id', '=', userId)
      .where('s.revoked_at', 'is', null)
      .where('s.expires_at', '>', new Date())
      .orderBy('s.last_used_at', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      current: r.id === currentSessionId,
      platform: r.platform,
      model: r.model,
      osVersion: r.os_version,
      appVersion: r.app_version,
      createdAt: new Date(r.created_at).toISOString(),
      lastUsedAt: new Date(r.last_used_at).toISOString(),
    }));
  }

  async revokeSession(userId: string, sessionId: string, client: ClientContext): Promise<void> {
    const owned = await this.db.selectFrom('user_sessions').select('id').where('id', '=', sessionId).where('user_id', '=', userId).executeTakeFirst();
    if (!owned) throw new AppError('NOT_FOUND');
    await this.tokens.revokeSession(sessionId, 'user_revoked');
    await this.audit.record({ actorType: 'user', actorId: userId, action: 'auth.session_revoked', targetType: 'session', targetId: sessionId, client });
  }

  async revokeOtherSessions(userId: string, currentSessionId: string, client: ClientContext): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.tokens.revokeAllForUser(trx, userId, 'user_revoked_others', currentSessionId);
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'auth.sessions_revoked_others', targetType: 'user', targetId: userId, client }, trx);
    });
  }

  /** Current state per consent type (latest record wins). */
  async currentConsents(userId: string) {
    const rows = await this.db
      .selectFrom('consent_records')
      .distinctOn('consent_type')
      .select(['consent_type', 'granted', 'created_at', 'legal_document_id'])
      .where('user_id', '=', userId)
      .orderBy('consent_type')
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => ({ consentType: r.consent_type, granted: r.granted, legalDocumentId: r.legal_document_id, updatedAt: new Date(r.created_at).toISOString() }));
  }

  async recordConsent(userId: string, consentType: string, granted: boolean, client: ClientContext) {
    await this.db
      .insertInto('consent_records')
      .values({ user_id: userId, consent_type: consentType, granted, source: 'app', ip: client.ip, user_agent: client.userAgent })
      .execute();
    return this.currentConsents(userId);
  }
}
