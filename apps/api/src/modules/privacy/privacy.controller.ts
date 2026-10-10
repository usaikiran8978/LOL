import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { pageQuery } from '@amora/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { clientContext } from '../../common/http/request-context';
import { decodeCursor, iso, keysetPage } from '../../common/http/cursor';
import { ZodPipe } from '../../common/http/zod.pipe';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../admin/auth/admin.guard';
import { assertUserInScope } from '../admin/auth/country-scope';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { DSAR_DUE_DAYS, PrivacyService } from './privacy.service';

@ApiTags('privacy')
@Controller('users/me/privacy')
@UseGuards(UserAuthGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('requests')
  requests(@CurrentUser() u: AuthContext) {
    return this.privacy.exportStatus(u.userId);
  }

  @Post('export')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  export(@CurrentUser() u: AuthContext, @Req() req: Request) {
    return this.privacy.requestExport(u.userId, clientContext(req));
  }

  @Post('delete-account')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  remove(@CurrentUser() u: AuthContext, @Body(new ZodPipe(z.object({ password: z.string().max(128).optional() }))) b: { password?: string }, @Req() req: Request) {
    return this.privacy.requestDeletion(u.userId, u.sessionId, b.password, clientContext(req));
  }

  @Delete('delete-account')
  @HttpCode(204)
  async cancel(@CurrentUser() u: AuthContext, @Req() req: Request) {
    await this.privacy.cancelDeletion(u.userId, clientContext(req));
  }
}

@ApiTags('admin-privacy')
@Controller('admin/privacy')
@UseGuards(AdminGuard)
export class AdminPrivacyController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly privacy: PrivacyService,
    private readonly audit: AuditService,
  ) {}

  /** DSAR queue ordered by legal due date. */
  @Get('requests')
  @RequirePermissions('privacy.requests')
  async list(@CurrentAdmin() a: AdminContext, @Query(new ZodPipe(pageQuery.extend({ status: z.enum(['received', 'verifying', 'in_progress', 'completed', 'rejected', 'cancelled']).optional() }))) q: { limit: number; cursor?: string; status?: string }) {
    const c = decodeCursor<[string, string]>(q.cursor, 2);
    let qb = this.db.selectFrom('data_privacy_requests').select(['id', 'user_id', 'subject_email', 'kind', 'status', 'regime', 'due_at', 'created_at', 'completed_at', 'handled_by', 'notes']).orderBy('due_at').orderBy('id').limit(q.limit + 1);
    if (c) qb = qb.where((eb) => eb.or([eb('due_at', '>', new Date(c[0])), eb.and([eb('due_at', '=', new Date(c[0])), eb('id', '>', c[1])])]));
    qb = q.status ? qb.where('status', '=', q.status) : qb.where('status', 'in', ['received', 'verifying', 'in_progress']);
    if (a.countryScope) qb = qb.where('user_id', 'in', this.db.selectFrom('users').select('id').where('country_code', 'in', a.countryScope));
    return keysetPage(await qb.execute(), q.limit, (r) => [iso(r.due_at), r.id]);
  }

  /** Requests received outside the app (email, letter) are logged here and processed with the same machinery. */
  @Post('requests')
  @RequirePermissions('privacy.requests')
  async create(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Body(new ZodPipe(z.object({ userId: z.uuid(), kind: z.enum(['export', 'delete', 'rectify', 'restrict_processing', 'object']), notes: z.string().max(2000).optional() }))) b: { userId: string; kind: string; notes?: string }) {
    await assertUserInScope(this.db, a, b.userId);
    const u = await this.db.selectFrom('users as u').leftJoin('country_configs as cc', 'cc.country_code', 'u.country_code').select(['u.email', 'cc.privacy_regime']).where('u.id', '=', b.userId).executeTakeFirst();
    if (!u) throw new AppError('NOT_FOUND');
    const r = await this.db.insertInto('data_privacy_requests').values({ user_id: b.userId, subject_email: u.email, kind: b.kind, status: 'verifying', regime: u.privacy_regime, notes: b.notes ?? null, handled_by: a.adminId, due_at: new Date(Date.now() + DSAR_DUE_DAYS * 86_400_000) }).returning('id').executeTakeFirstOrThrow();
    await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'privacy.request_logged', targetType: 'data_privacy_request', targetId: r.id, client: clientContext(req) });
    return r;
  }

  /** After identity verification the admin executes the request. Deletion runs the same purge immediately. */
  @Post('requests/:id/execute')
  @HttpCode(204)
  @RequirePermissions('privacy.requests')
  async execute(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string) {
    const r = await this.db.selectFrom('data_privacy_requests').selectAll().where('id', '=', id).executeTakeFirst();
    if (!r?.user_id) throw new AppError('NOT_FOUND');
    await assertUserInScope(this.db, a, r.user_id);
    if (!['received', 'verifying'].includes(r.status)) throw new AppError('CONFLICT', `Request is ${r.status}`);
    await this.db.updateTable('data_privacy_requests').set({ status: 'in_progress', handled_by: a.adminId }).where('id', '=', id).execute();
    if (r.kind === 'export') await this.privacy.buildExport(id);
    else if (r.kind === 'delete') {
      await this.privacy.purge(r.user_id);
      await this.db.updateTable('data_privacy_requests').set({ status: 'completed', completed_at: new Date() }).where('id', '=', id).execute();
    } else {
      // Rectification / restriction / objection are handled by an operator with the user tools; this records completion.
      await this.db.updateTable('data_privacy_requests').set({ status: 'completed', completed_at: new Date() }).where('id', '=', id).execute();
    }
    await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: `privacy.${r.kind}_executed`, targetType: 'data_privacy_request', targetId: id, client: clientContext(req) });
  }

  @Get('retention')
  @RequirePermissions('privacy.retention.manage')
  retention() {
    return this.db.selectFrom('retention_policies').selectAll().orderBy('entity').execute();
  }

  @Put('retention/:entity')
  @RequirePermissions('privacy.retention.manage')
  async setRetention(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('entity') entity: string, @Body(new ZodPipe(z.object({ retentionDays: z.number().int().min(1).max(3650), action: z.enum(['delete', 'anonymize']) }))) b: { retentionDays: number; action: 'delete' | 'anonymize' }) {
    const before = await this.db.selectFrom('retention_policies').selectAll().where('entity', '=', entity).executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND', 'Unknown retention entity');
    await this.db.updateTable('retention_policies').set({ retention_days: b.retentionDays, action: b.action, updated_by: a.adminId, updated_at: new Date() }).where('entity', '=', entity).execute();
    await this.audit.record({ actorType: 'admin', actorId: a.adminId, action: 'privacy.retention_updated', targetType: 'retention_policy', targetId: entity, before, after: b, client: clientContext(req) });
  }
}
