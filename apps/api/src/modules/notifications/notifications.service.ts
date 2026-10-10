import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../common/http/cursor';
import { localeChain } from '../../common/i18n/translations';
import { JobScheduler } from '../../common/jobs/scheduler';
import { MessagingService } from '../../common/messaging/messaging';
import { OutboxService } from '../../common/outbox/outbox.service';
import { RealtimeBus } from '../../common/realtime/realtime-bus';
import { FlagsService } from '../platform/flags.service';
import { UserFactsService } from '../platform/user-facts.service';
import { ApnsProvider, FcmProvider, type PushProvider } from './push';
import { inQuietHours, render } from './render';

type Channel = 'push' | 'email' | 'sms' | 'in_app';
const MAX_ATTEMPTS = 5;
const DISPATCH_BATCH = 200;
// Safety-critical categories ignore quiet hours and opt-outs (trusted-contact alerts, SOS follow-ups, account security).
const ALWAYS_DELIVER = new Set(['safety']);

export interface RenderedContent {
  title: string | null;
  subject: string | null;
  body: string;
  htmlBody: string | null;
  locale: string;
  versionId: string;
}

/**
 * Event-driven notifications (TECH §18): versioned localized templates, per-category/channel preferences, quiet hours,
 * push/email/SMS/in-app channels, retry with backoff and dead-lettering, deep links, dedupe/collapse.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly push = new Map<string, PushProvider>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly messaging: MessagingService,
    private readonly outbox: OutboxService,
    private readonly jobs: JobScheduler,
    private readonly bus: RealtimeBus,
    private readonly analytics: AnalyticsService,
    private readonly facts: UserFactsService,
    private readonly flags: FlagsService,
  ) {
    if (cfg.FCM_SERVICE_ACCOUNT_JSON_B64) this.push.set('fcm', new FcmProvider(JSON.parse(Buffer.from(cfg.FCM_SERVICE_ACCOUNT_JSON_B64, 'base64').toString('utf8'))));
    if (cfg.APNS_KEY_P8_B64 && cfg.APNS_KEY_ID && cfg.APNS_TEAM_ID && cfg.APNS_BUNDLE_ID) {
      this.push.set('apns', new ApnsProvider({ keyP8: Buffer.from(cfg.APNS_KEY_P8_B64, 'base64').toString('utf8'), keyId: cfg.APNS_KEY_ID, teamId: cfg.APNS_TEAM_ID, bundleId: cfg.APNS_BUNDLE_ID, production: cfg.APNS_PRODUCTION }));
    }
  }

  onModuleInit(): void {
    this.jobs.register('notifications.dispatch', 5, async () => {
      while ((await this.dispatchDue()) === DISPATCH_BATCH) { /* drain */ }
    });

    // Admin console invites (queued by AdminsController in the same transaction as the invite row).
    this.outbox.on('admin.invite_email', async (p) => {
      await this.sendImmediate('admin.invite', 'en', 'email', String(p.email), { link: String(p.link), hours: Number(p.hours) });
    });
    this.outbox.on('notifications.broadcast', async (p) => {
      const seg = p.segmentKey ? await this.db.selectFrom('user_segments').select('definition').where('key', '=', String(p.segmentKey)).executeTakeFirst() : null;
      for (const uid of p.userIds as string[]) {
        if (seg && !this.flags.segmentMatches(seg.definition, await this.facts.load(uid))) continue;
        await this.notify(uid, String(p.templateKey), (p.variables ?? {}) as Record<string, string | number>, { dedupeKey: `broadcast:${p.broadcastId}` });
      }
    });
    this.outbox.on('match.created', async (p) => {
      const ids = p.userIds as string[];
      for (const uid of ids) {
        const other = ids.find((x) => x !== uid)!;
        await this.notify(uid, 'match.new', { name: await this.displayName(other) }, { dedupeKey: `match:${p.matchId}`, deepLinkVars: { matchId: String(p.matchId) } });
      }
    });
    this.outbox.on('like.received', async (p) => {
      await this.notify(String(p.toUserId), p.superLike ? 'like.super' : 'like.new', {}, { dedupeKey: `like:${p.fromUserId}` });
    });
    this.outbox.on('message.created', async (p) => {
      const sender = await this.displayName(String(p.senderId));
      for (const rid of p.recipientIds as string[]) {
        const member = await this.db.selectFrom('conversation_members').select('muted_until').where('conversation_id', '=', String(p.conversationId)).where('user_id', '=', rid).executeTakeFirst();
        if (member?.muted_until && new Date(member.muted_until) > new Date()) continue;
        // Online users already got the realtime event; push only to people who are away.
        const online = await this.bus.isOnline(rid);
        const minute = Math.floor(Date.now() / 60_000);
        await this.notify(rid, 'message.new', { name: sender }, {
          dedupeKey: `msg:${p.conversationId}:${minute}`, collapseKey: `conv:${p.conversationId}`, deepLinkVars: { conversationId: String(p.conversationId) },
          skipChannels: online ? ['push', 'email', 'sms'] : ['email', 'sms'],
        });
      }
    });
  }

  private async displayName(userId: string): Promise<string> {
    return (await this.db.selectFrom('user_profiles').select('display_name').where('user_id', '=', userId).executeTakeFirst())?.display_name ?? '';
  }

  // ---------------------------------------------------------------------------------- templates

  /** Published template content for a locale (with fallback) and channel. */
  async content(templateKey: string, locale: string, channel: Channel, trx: Tx | Database = this.db, versionId?: string): Promise<RenderedContent & { template: { id: string; category: string; channels: string[]; isTransactional: boolean; respectsQuietHours: boolean; deepLinkPattern: string | null; isActive: boolean } }> {
    const t = await trx.selectFrom('notification_templates').selectAll().where('key', '=', templateKey).executeTakeFirst();
    if (!t) throw new AppError('TEMPLATE_NOT_FOUND', `Template ${templateKey} not found`);
    const v = await trx.selectFrom('notification_template_versions').select('id').where('template_id', '=', t.id)
      .$if(!versionId, (q) => q.where('status', '=', 'published')).$if(!!versionId, (q) => q.where('id', '=', versionId!)).executeTakeFirst();
    if (!v) throw new AppError('TEMPLATE_NOT_FOUND', versionId ? `Version ${versionId} does not belong to ${templateKey}` : `Template ${templateKey} has no published version`);
    const rows = await trx.selectFrom('notification_template_contents').selectAll().where('version_id', '=', v.id).where('channel', '=', channel).where('locale', 'in', localeChain(locale)).execute();
    const row = localeChain(locale).map((l) => rows.find((r) => r.locale === l)).find(Boolean);
    if (!row) throw new AppError('TEMPLATE_NOT_FOUND', `Template ${templateKey} has no ${channel} content`);
    return {
      title: row.title, subject: row.subject, body: row.body, htmlBody: row.html_body, locale: row.locale, versionId: v.id,
      template: { id: t.id, category: t.category, channels: t.channels, isTransactional: t.is_transactional, respectsQuietHours: t.respects_quiet_hours, deepLinkPattern: t.deep_link_pattern, isActive: t.is_active },
    };
  }

  renderContent(c: RenderedContent, vars: Record<string, string | number>) {
    return { title: c.title ? render(c.title, vars) : null, subject: c.subject ? render(c.subject, vars) : null, body: render(c.body, vars), htmlBody: c.htmlBody ? render(c.htmlBody, vars, { html: true }) : null };
  }

  /** Synchronous send outside the queue — only for auth codes, where queueing latency is unacceptable. */
  async sendImmediate(templateKey: string, locale: string, channel: 'email' | 'sms', destination: string, vars: Record<string, string | number>): Promise<void> {
    const r = this.renderContent(await this.content(templateKey, locale, channel), vars);
    if (channel === 'email') await this.messaging.sendEmail({ to: destination, subject: r.subject ?? r.title ?? '', text: r.body, html: r.htmlBody ?? undefined });
    else await this.messaging.sendSms({ to: destination, body: r.body });
  }

  // ---------------------------------------------------------------------------------- enqueue

  async notify(
    userId: string,
    templateKey: string,
    vars: Record<string, string | number>,
    opts: { dedupeKey?: string; collapseKey?: string; deepLinkVars?: Record<string, string>; skipChannels?: Channel[]; trx?: Tx } = {},
  ): Promise<number> {
    const db = opts.trx ?? this.db;
    const t = await db.selectFrom('notification_templates').selectAll().where('key', '=', templateKey).executeTakeFirst();
    if (!t || !t.is_active) return 0;
    const v = await db.selectFrom('notification_template_versions').select('id').where('template_id', '=', t.id).where('status', '=', 'published').executeTakeFirst();
    if (!v) return 0;
    const user = await db.selectFrom('users').select(['locale', 'status', 'timezone']).where('id', '=', userId).executeTakeFirst();
    if (!user || ['deleted', 'banned'].includes(user.status)) return 0;

    const prefs = await db.selectFrom('notification_preferences').select(['channel', 'enabled']).where('user_id', '=', userId).where('category', '=', t.category).execute();
    const settings = await db.selectFrom('notification_settings').selectAll().where('user_id', '=', userId).executeTakeFirst();
    const marketingConsent = t.category === 'marketing' ? await this.marketingConsents(userId) : null;
    const critical = ALWAYS_DELIVER.has(t.category);

    let scheduled = new Date();
    if (!critical && t.respects_quiet_hours && settings?.quiet_hours_start && settings.quiet_hours_end) {
      const q = inQuietHours(new Date(), String(settings.quiet_hours_start).slice(0, 5), String(settings.quiet_hours_end).slice(0, 5), settings.timezone ?? user.timezone ?? 'UTC');
      if (q.quiet && q.endsAt) scheduled = q.endsAt;
    }
    const deepLink = t.deep_link_pattern ? render(t.deep_link_pattern, { ...(opts.deepLinkVars ?? {}), scheme: this.cfg.APP_DEEP_LINK_SCHEME }) : null;

    let created = 0;
    for (const channel of t.channels as Channel[]) {
      if (opts.skipChannels?.includes(channel) && channel !== 'in_app') continue;
      const pref = prefs.find((p) => p.channel === channel);
      if (!critical && pref && !pref.enabled) continue;
      if (marketingConsent && channel !== 'in_app' && !marketingConsent.has(channel)) continue;
      const contentRow = await this.content(templateKey, user.locale, channel, db).catch(() => null);
      if (!contentRow) continue;
      const r = this.renderContent(contentRow, vars);
      const res = await db
        .insertInto('notifications')
        .values({
          user_id: userId, template_version_id: v.id, category: t.category, channel,
          payload: JSON.stringify({ vars, collapseKey: opts.collapseKey ?? null, subject: r.subject, htmlBody: r.htmlBody }),
          rendered_title: r.title, rendered_body: r.body, deep_link: deepLink, dedupe_key: opts.dedupeKey ?? null,
          status: channel === 'in_app' ? 'delivered' : scheduled > new Date() ? 'deferred' : 'queued', scheduled_for: channel === 'in_app' ? new Date() : scheduled,
          sent_at: channel === 'in_app' ? new Date() : null,
        })
        .onConflict((oc) => oc.columns(['user_id', 'channel', 'dedupe_key']).where('dedupe_key', 'is not', null).doNothing())
        .returning(['id', 'rendered_title', 'rendered_body', 'deep_link', 'category', 'created_at'])
        .executeTakeFirst();
      if (!res) continue;
      created++;
      if (channel === 'in_app') await this.bus.publish([userId], 'notification', { id: res.id, title: res.rendered_title, body: res.rendered_body, deepLink: res.deep_link, category: res.category, createdAt: new Date(res.created_at).toISOString() });
    }
    return created;
  }

  private async marketingConsents(userId: string): Promise<Set<Channel>> {
    const rows = await this.db.selectFrom('consent_records').distinctOn('consent_type').select(['consent_type', 'granted']).where('user_id', '=', userId)
      .where('consent_type', 'in', ['marketing_email', 'marketing_push', 'marketing_sms']).orderBy('consent_type').orderBy('created_at', 'desc').execute();
    const map: Record<string, Channel> = { marketing_email: 'email', marketing_push: 'push', marketing_sms: 'sms' };
    return new Set(rows.filter((r) => r.granted).map((r) => map[r.consent_type]!));
  }

  // ---------------------------------------------------------------------------------- dispatch

  /** Sends due notifications. Claimed with SKIP LOCKED so many workers can run concurrently. */
  async dispatchDue(): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const due = await trx.selectFrom('notifications').selectAll().where('status', 'in', ['queued', 'deferred']).where('scheduled_for', '<=', new Date())
        .orderBy('scheduled_for').limit(DISPATCH_BATCH).forUpdate().skipLocked().execute();
      for (const n of due) {
        const outcome = await this.deliver(trx, n).catch((err: Error) => ({ ok: false as const, retryable: true, error: err.message }));
        if (outcome.ok) {
          await trx.updateTable('notifications').set({ status: 'sent', sent_at: new Date(), attempts: n.attempts + 1, provider_message_id: outcome.providerMessageId ?? null, last_error: null }).where('id', '=', n.id).execute();
        } else if ('suppressed' in outcome) {
          await trx.updateTable('notifications').set({ status: 'suppressed', last_error: outcome.error }).where('id', '=', n.id).execute();
        } else {
          const attempts = n.attempts + 1;
          const dead = !outcome.retryable || attempts >= MAX_ATTEMPTS;
          await trx.updateTable('notifications').set({
            status: dead ? 'dead_letter' : 'queued', attempts, last_error: outcome.error.slice(0, 1000),
            scheduled_for: dead ? n.scheduled_for : new Date(Date.now() + 2 ** attempts * 30_000),
          }).where('id', '=', n.id).execute();
        }
      }
      return due.length;
    });
  }

  private async deliver(trx: Tx, n: { id: string; user_id: string; channel: string; rendered_title: string | null; rendered_body: string | null; deep_link: string | null; category: string; payload: unknown }): Promise<{ ok: true; providerMessageId?: string | null } | { ok: false; retryable: boolean; error: string } | { ok: false; suppressed: true; error: string }> {
    const payload = n.payload as { subject?: string | null; htmlBody?: string | null; collapseKey?: string | null };
    const channelEnabled = async (channel: string) => {
      const rows = await trx.selectFrom('notification_channel_configs').select('is_enabled').where('channel', '=', channel).execute();
      return rows.length === 0 || rows.some((r) => r.is_enabled); // no row = governed by deployment configuration
    };
    if (!(await channelEnabled(n.channel))) return { ok: false, suppressed: true, error: 'channel_disabled_by_admin' };
    const user = await trx.selectFrom('users').select(['email', 'phone_e164', 'email_verified_at', 'phone_verified_at', 'status']).where('id', '=', n.user_id).executeTakeFirstOrThrow();
    if (['deleted', 'banned'].includes(user.status)) return { ok: false, suppressed: true, error: 'user_inactive' };

    if (n.channel === 'email') {
      if (!user.email || !user.email_verified_at) return { ok: false, suppressed: true, error: 'no_verified_email' };
      await this.messaging.sendEmail({ to: user.email, subject: payload.subject ?? n.rendered_title ?? '', text: n.rendered_body ?? '', html: payload.htmlBody ?? undefined });
      return { ok: true };
    }
    if (n.channel === 'sms') {
      if (!user.phone_e164 || !user.phone_verified_at) return { ok: false, suppressed: true, error: 'no_verified_phone' };
      await this.messaging.sendSms({ to: user.phone_e164, body: n.rendered_body ?? '' });
      return { ok: true };
    }
    if (n.channel === 'push') {
      const devices = await trx.selectFrom('user_devices').select(['id', 'push_token', 'push_provider']).where('user_id', '=', n.user_id).where('revoked_at', 'is', null).where('push_token', 'is not', null).execute();
      if (!devices.length) return { ok: false, suppressed: true, error: 'no_push_devices' };
      let delivered = 0;
      let lastError = 'no_push_provider_configured';
      let retryable = false;
      for (const d of devices) {
        const provider = this.push.get(d.push_provider ?? '');
        if (!provider) continue;
        const r = await provider.send({ token: d.push_token!, title: n.rendered_title, body: n.rendered_body ?? '', deepLink: n.deep_link, category: n.category, collapseKey: payload.collapseKey, data: { notificationId: n.id } });
        if (r.ok) delivered++;
        else {
          lastError = r.error;
          retryable ||= r.retryable;
          if (r.invalidToken) await trx.updateTable('user_devices').set({ push_token: null }).where('id', '=', d.id).execute();
        }
      }
      if (delivered) return { ok: true };
      return lastError === 'no_push_provider_configured' ? { ok: false, suppressed: true, error: lastError } : { ok: false, retryable, error: lastError };
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------- user APIs

  async inbox(userId: string, limit: number, cursor?: string) {
    const c = decodeCursor<[string, string]>(cursor, 2);
    let qb = this.db.selectFrom('notifications').select(['id', 'category', 'rendered_title', 'rendered_body', 'deep_link', 'read_at', 'created_at'])
      .where('user_id', '=', userId).where('channel', '=', 'in_app').orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit + 1);
    if (c) qb = qb.where((eb) => eb.or([eb('created_at', '<', new Date(c[0])), eb.and([eb('created_at', '=', new Date(c[0])), eb('id', '<', c[1])])]));
    const rows = await qb.execute();
    const page = rows.slice(0, limit);
    const { unread } = await this.db.selectFrom('notifications').select(sql<number>`count(*)::int`.as('unread')).where('user_id', '=', userId).where('channel', '=', 'in_app').where('read_at', 'is', null).executeTakeFirstOrThrow();
    return {
      unread,
      items: page.map((r) => ({ id: r.id, category: r.category, title: r.rendered_title, body: r.rendered_body, deepLink: r.deep_link, read: !!r.read_at, createdAt: new Date(r.created_at).toISOString() })),
      nextCursor: rows.length > limit ? encodeCursor([new Date(page.at(-1)!.created_at).toISOString(), page.at(-1)!.id]) : null,
    };
  }

  async markRead(userId: string, id?: string) {
    let qb = this.db.updateTable('notifications').set({ read_at: new Date() }).where('user_id', '=', userId).where('read_at', 'is', null).where('channel', '=', 'in_app');
    if (id) qb = qb.where('id', '=', id);
    const r = await qb.executeTakeFirst();
    if (id && !r.numUpdatedRows) throw new AppError('NOT_FOUND');
    if (id) await this.analytics.track('notification_opened', { userId });
  }

  async preferences(userId: string) {
    const [rows, settings, templates] = await Promise.all([
      this.db.selectFrom('notification_preferences').select(['category', 'channel', 'enabled']).where('user_id', '=', userId).execute(),
      this.db.selectFrom('notification_settings').selectAll().where('user_id', '=', userId).executeTakeFirst(),
      this.db.selectFrom('notification_templates').select(['category', 'channels']).where('is_active', '=', true).execute(),
    ]);
    const pairs = new Map<string, Set<string>>();
    for (const t of templates) for (const ch of t.channels) (pairs.get(t.category) ?? pairs.set(t.category, new Set()).get(t.category)!).add(ch);
    return {
      preferences: [...pairs].flatMap(([category, chans]) => [...chans].map((channel) => ({
        category, channel, enabled: rows.find((r) => r.category === category && r.channel === channel)?.enabled ?? category !== 'marketing', locked: ALWAYS_DELIVER.has(category),
      }))),
      quietHours: settings?.quiet_hours_start ? { start: String(settings.quiet_hours_start).slice(0, 5), end: String(settings.quiet_hours_end).slice(0, 5), timezone: settings.timezone } : null,
    };
  }

  async updatePreferences(userId: string, prefs: Array<{ category: string; channel: string; enabled: boolean }>, quiet?: { start: string; end: string; timezone: string } | null) {
    if (quiet) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: quiet.timezone });
      } catch {
        throw new AppError('VALIDATION_FAILED', 'Unknown timezone', [{ path: 'quietHours.timezone', message: 'invalid' }]);
      }
    }
    await this.db.transaction().execute(async (trx) => {
      for (const p of prefs) {
        await trx.insertInto('notification_preferences').values({ user_id: userId, category: p.category, channel: p.channel, enabled: p.enabled })
          .onConflict((oc) => oc.columns(['user_id', 'category', 'channel']).doUpdateSet({ enabled: p.enabled, updated_at: new Date() })).execute();
      }
      if (quiet !== undefined) {
        const v = { quiet_hours_start: quiet?.start ?? null, quiet_hours_end: quiet?.end ?? null, timezone: quiet?.timezone ?? null, updated_at: new Date() };
        await trx.insertInto('notification_settings').values({ user_id: userId, ...v }).onConflict((oc) => oc.column('user_id').doUpdateSet(v)).execute();
      }
    });
    return this.preferences(userId);
  }

  async registerPushToken(userId: string, installationId: string, provider: 'fcm' | 'apns', token: string) {
    // Validate first and move the token atomically: a rejected call must not strip it from the other device.
    await this.db.transaction().execute(async (trx) => {
      const r = await trx.updateTable('user_devices').set({ push_token: token, push_provider: provider, push_token_updated_at: new Date() })
        .where('user_id', '=', userId).where('installation_id', '=', installationId).where('revoked_at', 'is', null).executeTakeFirst();
      if (!r.numUpdatedRows) throw new AppError('NOT_FOUND', 'Unknown device; log in on this device first');
      // A token belongs to one install; clear it anywhere else (device handed to someone else / reinstall).
      await trx.updateTable('user_devices').set({ push_token: null }).where('push_token', '=', token).where('installation_id', '<>', installationId).execute();
    });
  }
}
