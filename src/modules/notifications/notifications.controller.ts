import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  adminBroadcast, adminChannelConfig, adminTemplateCreate, adminTemplatePreview, adminTemplateTestSend, adminTemplateVersionInput, notificationPreferencesUpdate,
  pageQuery, pushTokenRegister,
} from '@amora/shared';
import type { Request } from 'express';
import { sql } from 'kysely';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { OutboxService } from '../../common/outbox/outbox.service';
import { ZodPipe } from '../../common/http/zod.pipe';
import type { AdminContext } from '../admin/auth/admin-auth.service';
import { AdminGuard, CurrentAdmin, RequirePermissions } from '../admin/auth/admin.guard';
import { AuditedController } from '../admin/common/audited';
import { CurrentUser, UserAuthGuard, type AuthContext } from '../auth/auth.guard';
import { NotificationsService } from './notifications.service';
import { undeclared } from './render';

type B<T extends z.ZodType> = z.infer<T>;
const id = new ParseUUIDPipe();

@ApiTags('notifications')
@Controller()
@UseGuards(UserAuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get('notifications')
  inbox(@CurrentUser() u: AuthContext, @Query(new ZodPipe(pageQuery)) q: B<typeof pageQuery>) {
    return this.svc.inbox(u.userId, q.limit, q.cursor);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async read(@CurrentUser() u: AuthContext, @Param('id', id) nid: string) {
    await this.svc.markRead(u.userId, nid);
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() u: AuthContext) {
    await this.svc.markRead(u.userId);
  }

  @Get('notifications/preferences')
  prefs(@CurrentUser() u: AuthContext) {
    return this.svc.preferences(u.userId);
  }

  @Put('notifications/preferences')
  updatePrefs(@CurrentUser() u: AuthContext, @Body(new ZodPipe(notificationPreferencesUpdate)) b: B<typeof notificationPreferencesUpdate>) {
    return this.svc.updatePreferences(u.userId, b.preferences, b.quietHours);
  }

  @Post('devices/push-token')
  @HttpCode(204)
  async pushToken(@CurrentUser() u: AuthContext, @Body(new ZodPipe(pushTokenRegister)) b: B<typeof pushTokenRegister>) {
    await this.svc.registerPushToken(u.userId, b.installationId, b.provider, b.token);
  }
}

@ApiTags('admin-notifications')
@Controller('admin/notifications')
@UseGuards(AdminGuard)
export class AdminNotificationsController extends AuditedController {
  constructor(
    @Inject(DATABASE) db: Database,
    audit: AuditService,
    private readonly svc: NotificationsService,
    private readonly outbox: OutboxService,
  ) {
    super(db, audit);
  }

  @Get('templates')
  @RequirePermissions('notifications.manage')
  async templates() {
    const t = await this.db.selectFrom('notification_templates').selectAll().orderBy('key').execute();
    const v = await this.db.selectFrom('notification_template_versions').select(['id', 'template_id', 'version', 'status', 'published_at']).orderBy('version', 'desc').execute();
    return t.map((x) => ({ ...x, versions: v.filter((y) => y.template_id === x.id) }));
  }

  @Get('templates/:key/versions/:version')
  @RequirePermissions('notifications.manage')
  async version(@Param('key') key: string, @Param('version') version: string) {
    const v = await this.db.selectFrom('notification_template_versions as v').innerJoin('notification_templates as t', 't.id', 'v.template_id').selectAll('v').where('t.key', '=', key).where('v.version', '=', Number(version)).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    return { ...v, contents: await this.db.selectFrom('notification_template_contents').selectAll().where('version_id', '=', v.id).execute() };
  }

  @Put('templates/:key')
  @RequirePermissions('notifications.manage')
  async upsert(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminTemplateCreate)) b: B<typeof adminTemplateCreate>) {
    if (key !== b.key) throw new AppError('VALIDATION_FAILED', 'key mismatch');
    const before = await this.db.selectFrom('notification_templates').selectAll().where('key', '=', key).executeTakeFirst();
    return this.write(a, req, 'notifications.template_upserted', { type: 'notification_template', id: key }, before ?? null, (trx) => {
      const v = { category: b.category, channels: b.channels, is_transactional: b.isTransactional, respects_quiet_hours: b.respectsQuietHours, deep_link_pattern: b.deepLinkPattern, is_active: b.isActive };
      return trx.insertInto('notification_templates').values({ key, ...v }).onConflict((oc) => oc.column('key').doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
    });
  }

  @Post('templates/:key/versions')
  @RequirePermissions('notifications.manage')
  async createVersion(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminTemplateVersionInput)) b: B<typeof adminTemplateVersionInput>) {
    const t = await this.db.selectFrom('notification_templates').select(['id', 'channels']).where('key', '=', key).executeTakeFirst();
    if (!t) throw new AppError('NOT_FOUND');
    const bad = b.contents.filter((c) => !t.channels.includes(c.channel));
    if (bad.length) throw new AppError('VALIDATION_FAILED', `Template does not use channel(s): ${[...new Set(bad.map((c) => c.channel))].join(', ')}`);
    const missing = undeclared(b.contents, b.variables);
    if (missing.length) throw new AppError('VALIDATION_FAILED', `Undeclared variables: ${missing.join(', ')}`);
    return this.write(a, req, 'notifications.version_created', { type: 'notification_template', id: key }, null, async (trx) => {
      const { v } = await trx.selectFrom('notification_template_versions').select(sql<number>`coalesce(max(version), 0) + 1`.as('v')).where('template_id', '=', t.id).executeTakeFirstOrThrow();
      const row = await trx.insertInto('notification_template_versions').values({ template_id: t.id, version: v, status: 'draft', variables: b.variables, created_by: a.adminId }).returning(['id', 'version']).executeTakeFirstOrThrow();
      await trx.insertInto('notification_template_contents').values(b.contents.map((c) => ({ version_id: row.id, locale: c.locale, channel: c.channel, title: c.title ?? null, subject: c.subject ?? null, body: c.body, html_body: c.htmlBody ?? null }))).execute();
      return row;
    });
  }

  @Post('templates/:key/versions/:version/publish')
  @HttpCode(200)
  @RequirePermissions('notifications.manage')
  async publish(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Param('version') version: string) {
    const v = await this.db.selectFrom('notification_template_versions as v').innerJoin('notification_templates as t', 't.id', 'v.template_id').select(['v.id', 'v.status', 'v.template_id', 't.channels'])
      .where('t.key', '=', key).where('v.version', '=', Number(version)).executeTakeFirst();
    if (!v) throw new AppError('NOT_FOUND');
    if (v.status !== 'draft') throw new AppError('VERSION_IMMUTABLE');
    const en = await this.db.selectFrom('notification_template_contents').select('channel').where('version_id', '=', v.id).where('locale', '=', 'en').execute();
    const missing = v.channels.filter((c) => !en.some((x) => x.channel === c));
    if (missing.length) throw new AppError('PUBLISH_VALIDATION_FAILED', `English content missing for: ${missing.join(', ')}`);
    return this.write(a, req, 'notifications.version_published', { type: 'notification_template', id: key }, null, async (trx) => {
      await trx.updateTable('notification_template_versions').set({ status: 'archived' }).where('template_id', '=', v.template_id).where('status', '=', 'published').execute();
      return trx.updateTable('notification_template_versions').set({ status: 'published', published_at: new Date(), published_by: a.adminId }).where('id', '=', v.id).returning(['id', 'version', 'status']).executeTakeFirstOrThrow();
    });
  }

  @Post('templates/:key/preview')
  @HttpCode(200)
  @RequirePermissions('notifications.manage')
  async preview(@Param('key') key: string, @Body(new ZodPipe(adminTemplatePreview)) b: B<typeof adminTemplatePreview>) {
    const c = await this.svc.content(key, b.locale, b.channel, undefined, b.versionId);
    return { locale: c.locale, versionId: c.versionId, ...this.svc.renderContent(c, b.variables) };
  }

  @Post('templates/:key/test-send')
  @HttpCode(200)
  @RequirePermissions('notifications.send_test')
  async testSend(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('key') key: string, @Body(new ZodPipe(adminTemplateTestSend)) b: B<typeof adminTemplateTestSend>) {
    const created = await this.svc.notify(b.userId, key, b.variables, { dedupeKey: `test:${Date.now()}` });
    await this.write(a, req, 'notifications.test_sent', { type: 'notification_template', id: key }, null, async () => ({ userId: b.userId, created }));
    return { created };
  }

  @Get('channels')
  @RequirePermissions('notifications.channels')
  channels() {
    return this.db.selectFrom('notification_channel_configs').selectAll().orderBy('channel').execute();
  }

  @Put('channels/:channel/:provider')
  @RequirePermissions('notifications.channels')
  async channel(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Param('channel') channel: string, @Param('provider') provider: string, @Body(new ZodPipe(adminChannelConfig)) b: B<typeof adminChannelConfig>) {
    if (!['push', 'email', 'sms'].includes(channel) || !/^[a-z0-9_]{2,30}$/.test(provider)) throw new AppError('VALIDATION_FAILED', 'invalid channel/provider');
    const before = await this.db.selectFrom('notification_channel_configs').selectAll().where('channel', '=', channel).where('provider', '=', provider).executeTakeFirst();
    return this.write(a, req, 'notifications.channel_updated', { type: 'notification_channel', id: `${channel}:${provider}` }, before ?? null, (trx) => {
      const v = { is_enabled: b.isEnabled, priority: b.priority, settings: JSON.stringify(b.settings), secret_ref: b.secretRef, country_codes: b.countryCodes, updated_by: a.adminId, updated_at: new Date() };
      return trx.insertInto('notification_channel_configs').values({ channel, provider, ...v }).onConflict((oc) => oc.columns(['channel', 'provider']).doUpdateSet(v)).returningAll().executeTakeFirstOrThrow();
    });
  }

  /** System announcements to a segment/countries. dryRun returns the audience size without sending. */
  @Post('broadcast')
  @HttpCode(200)
  @RequirePermissions('notifications.broadcast')
  async broadcast(@CurrentAdmin() a: AdminContext, @Req() req: Request, @Body(new ZodPipe(adminBroadcast)) b: B<typeof adminBroadcast>) {
    const t = await this.db.selectFrom('notification_templates').select(['category']).where('key', '=', b.templateKey).executeTakeFirst();
    if (!t) throw new AppError('TEMPLATE_NOT_FOUND');
    let qb = this.db.selectFrom('users').select('id').where('status', '=', 'active');
    if (b.countryCodes?.length) qb = qb.where('country_code', 'in', b.countryCodes);
    const candidates = (await qb.execute()).map((r) => r.id);
    if (b.segmentKey && !(await this.db.selectFrom('user_segments').select('key').where('key', '=', b.segmentKey).executeTakeFirst())) throw new AppError('NOT_FOUND', 'Unknown segment');
    // The segment predicate is evaluated per user by the broadcast worker; the count here is an upper bound.
    if (b.dryRun) return { dryRun: true, audienceUpperBound: candidates.length };
    await this.write(a, req, 'notifications.broadcast', { type: 'notification_template', id: b.templateKey }, null, async (trx) => {
      for (let i = 0; i < candidates.length; i += 500) {
        await this.outbox.enqueue(trx, 'notifications.broadcast', { templateKey: b.templateKey, segmentKey: b.segmentKey, userIds: candidates.slice(i, i + 500), variables: b.variables, broadcastId: req.requestId });
      }
      return { candidates: candidates.length };
    });
    return { dryRun: false, queued: candidates.length };
  }
}
