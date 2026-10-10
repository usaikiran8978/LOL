import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { AuditService } from '../../common/audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import type { ClientContext } from '../../common/http/request-context';
import { JobScheduler } from '../../common/jobs/scheduler';
import { OutboxService } from '../../common/outbox/outbox.service';
import { OBJECT_STORAGE, type ObjectStorage } from '../../common/storage/object-storage';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfileStateService } from '../profiles/profile-state.service';

const EXPORT_LINK_TTL_S = 7 * 86_400;
const DELETION_GRACE_DAYS = 14;
export const DSAR_DUE_DAYS = 30;

/**
 * Privacy workflows (BRD §22, TECH §16): data export (DSAR), account deletion with a grace period followed by a real
 * purge, media deletion, retention enforcement and the admin privacy-request queue. Safety evidence and financial
 * records are retained only where law/safety requires, de-linked from the person (documented in docs/privacy.md).
 */
@Injectable()
export class PrivacyService implements OnModuleInit {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly outbox: OutboxService,
    private readonly jobs: JobScheduler,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationsService,
    private readonly profileState: ProfileStateService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('privacy.export', (p) => this.buildExport(String(p.requestId)));
    this.jobs.register('privacy.purge_deleted', 3600, async () => { await this.purgeDue(); });
    this.jobs.register('privacy.retention', 6 * 3600, () => this.applyRetention());
  }

  // ------------------------------------------------------------------------------------ export

  async requestExport(userId: string, client: ClientContext) {
    const open = await this.db.selectFrom('data_privacy_requests').select('id').where('user_id', '=', userId).where('kind', '=', 'export').where('status', 'in', ['received', 'in_progress']).executeTakeFirst();
    if (open) throw new AppError('CONFLICT', 'An export is already being prepared', { requestId: open.id });
    const u = await this.db.selectFrom('users as u').leftJoin('country_configs as cc', 'cc.country_code', 'u.country_code').select(['u.email', 'cc.privacy_regime']).where('u.id', '=', userId).executeTakeFirstOrThrow();
    const r = await this.db.transaction().execute(async (trx) => {
      const row = await trx.insertInto('data_privacy_requests').values({ user_id: userId, subject_email: u.email, kind: 'export', regime: u.privacy_regime, due_at: new Date(Date.now() + DSAR_DUE_DAYS * 86_400_000) }).returning('id').executeTakeFirstOrThrow();
      await this.outbox.enqueue(trx, 'privacy.export', { requestId: row.id }, { aggregateId: userId });
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'privacy.export_requested', targetType: 'data_privacy_request', targetId: row.id, client }, trx);
      return row;
    });
    await this.analytics.track('data_export_requested', { userId });
    return { requestId: r.id, status: 'received' };
  }

  /** Assembles everything we hold about the person (their own data; other people's personal data is excluded). */
  async buildExport(requestId: string): Promise<void> {
    const req = await this.db.selectFrom('data_privacy_requests').selectAll().where('id', '=', requestId).executeTakeFirst();
    if (!req?.user_id || req.status === 'completed') return;
    await this.db.updateTable('data_privacy_requests').set({ status: 'in_progress' }).where('id', '=', requestId).execute();
    const uid = req.user_id;
    const q = <T>(p: Promise<T>) => p;
    const [account, profile, attributes, interests, languages, prompts, media, preferences, privacy, consents, answers, swipes, matches, messages, dates, feedbackGiven, events, subscriptions, payments, reports, verification, sessions, notificationsPrefs, blocks, favorites] = await Promise.all([
      q(this.db.selectFrom('users').select(['id', 'email', 'phone_e164', 'status', 'date_of_birth', 'country_code', 'locale', 'timezone', 'created_at', 'last_login_at']).where('id', '=', uid).executeTakeFirst()),
      q(this.db.selectFrom('user_profiles').selectAll().where('user_id', '=', uid).executeTakeFirst()),
      q(this.db.selectFrom('user_profile_attributes as a').innerJoin('taxonomy_terms as t', 't.id', 'a.term_id').select(['a.kind', 't.key']).where('a.user_id', '=', uid).execute()),
      q(this.db.selectFrom('user_interests as i').innerJoin('interests as x', 'x.id', 'i.interest_id').select('x.key').where('i.user_id', '=', uid).execute()),
      q(this.db.selectFrom('user_languages').select(['language_code', 'proficiency']).where('user_id', '=', uid).execute()),
      q(this.db.selectFrom('profile_prompts as p').innerJoin('prompt_catalog as c', 'c.id', 'p.prompt_id').select(['c.key', 'p.answer', 'p.created_at']).where('p.user_id', '=', uid).execute()),
      q(this.db.selectFrom('profile_media').select(['id', 'kind', 'storage_key', 'created_at', 'deleted_at', 'moderation_status']).where('user_id', '=', uid).execute()),
      q(this.db.selectFrom('user_preferences').selectAll().where('user_id', '=', uid).executeTakeFirst()),
      q(this.db.selectFrom('user_privacy_settings').selectAll().where('user_id', '=', uid).executeTakeFirst()),
      q(this.db.selectFrom('consent_records').select(['consent_type', 'granted', 'created_at']).where('user_id', '=', uid).orderBy('created_at').execute()),
      q(this.db.selectFrom('question_answers as a').innerJoin('questions as q', 'q.id', 'a.question_id').select(['q.key', 'a.value', 'a.importance', 'a.is_dealbreaker', 'a.answered_at', 'a.superseded_at']).where('a.user_id', '=', uid).execute()),
      q(this.db.selectFrom('swipe_actions').select(['action', 'created_at', 'rewound_at']).where('actor_id', '=', uid).execute()), // targets omitted (other people's data)
      q(this.db.selectFrom('matches').select(['id', 'status', 'created_at', 'ended_at']).where((eb) => eb.or([eb('user_low_id', '=', uid), eb('user_high_id', '=', uid)])).execute()),
      q(this.db.selectFrom('messages').select(['conversation_id', 'kind', 'body', 'created_at', 'deleted_at']).where('sender_id', '=', uid).execute()), // only messages they wrote
      q(this.db.selectFrom('date_plans').select(['id', 'title', 'activity_type', 'starts_at', 'status']).where('proposed_by', '=', uid).execute()),
      q(this.db.selectFrom('date_feedback').select(['date_plan_id', 'date_happened', 'overall', 'felt_safe', 'want_second_date', 'tags', 'private_note', 'created_at']).where('author_id', '=', uid).execute()),
      q(this.db.selectFrom('event_attendees as a').innerJoin('events as e', 'e.id', 'a.event_id').select(['e.title', 'e.starts_at', 'a.status']).where('a.user_id', '=', uid).execute()),
      q(this.db.selectFrom('subscriptions').select(['provider', 'status', 'created_at', 'current_period_end', 'canceled_at']).where('user_id', '=', uid).execute()),
      q(this.db.selectFrom('payments').select(['provider', 'kind', 'amount_minor', 'currency', 'status', 'created_at']).where('user_id', '=', uid).execute()),
      q(this.db.selectFrom('reports').select(['target_type', 'details', 'created_at']).where('reporter_id', '=', uid).execute()),
      q(this.db.selectFrom('verification_requests').select(['kind', 'status', 'submitted_at', 'decided_at']).where('user_id', '=', uid).execute()),
      q(this.db.selectFrom('user_sessions as s').leftJoin('user_devices as d', 'd.id', 's.device_id').select(['s.created_at', 's.last_used_at', 'd.platform', 'd.model']).where('s.user_id', '=', uid).execute()),
      q(this.db.selectFrom('notification_preferences').selectAll().where('user_id', '=', uid).execute()),
      q(this.db.selectFrom('blocks').select(['created_at']).where('blocker_id', '=', uid).execute()),
      q(this.db.selectFrom('user_favorites').select(['created_at']).where('user_id', '=', uid).execute()), // targets omitted (other people's data)
    ]);
    const ttl = EXPORT_LINK_TTL_S;
    const bundle = {
      generatedAt: new Date().toISOString(), requestId, account, profile, attributes, interests, languages, prompts,
      media: await Promise.all(media.filter((m) => !m.deleted_at).map(async (m) => ({ id: m.id, kind: m.kind, createdAt: m.created_at, downloadUrl: await this.storage.signedDownloadUrl(m.storage_key, ttl) }))),
      preferences, privacy, consents, questionnaireAnswers: answers, swipes, matches, messagesYouSent: messages, datesYouPlanned: dates, yourDateFeedback: feedbackGiven,
      events, subscriptions, payments, reportsYouMade: reports, verification, sessions, notificationPreferences: notificationsPrefs, blocksCount: blocks.length, favoritesCount: favorites.length,
    };
    const key = `exports/${uid}/${requestId}.json`;
    await this.storage.put(key, Buffer.from(JSON.stringify(bundle, (_k, v) => (typeof v === 'bigint' ? v.toString() : Buffer.isBuffer(v) ? undefined : v), 2)), 'application/json');
    await this.db.updateTable('data_privacy_requests').set({ status: 'completed', export_storage_key: key, export_expires_at: new Date(Date.now() + ttl * 1000), completed_at: new Date() }).where('id', '=', requestId).execute();
    await this.notifications.notify(uid, 'privacy.export_ready', { link: await this.storage.signedDownloadUrl(key, ttl) }, { dedupeKey: `export:${requestId}` });
  }

  async exportStatus(userId: string) {
    const rows = await this.db.selectFrom('data_privacy_requests').select(['id', 'kind', 'status', 'created_at', 'completed_at', 'export_storage_key', 'export_expires_at', 'due_at']).where('user_id', '=', userId).orderBy('created_at', 'desc').limit(10).execute();
    return Promise.all(rows.map(async (r) => ({
      id: r.id, kind: r.kind, status: r.status, requestedAt: new Date(r.created_at).toISOString(), completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
      downloadUrl: r.export_storage_key && r.export_expires_at && new Date(r.export_expires_at) > new Date() ? await this.storage.signedDownloadUrl(r.export_storage_key, 3600) : null,
      scheduledFor: r.kind === 'delete' && r.status === 'in_progress' ? new Date(r.due_at).toISOString() : null,
    })));
  }

  // ------------------------------------------------------------------------------------ deletion

  /**
   * Deletion is a two-step process: immediate deactivation (hidden everywhere, signed out) and a purge after the grace
   * period, during which the person can cancel by signing back in and calling `cancelDeletion`.
   */
  async requestDeletion(userId: string, sessionId: string, password: string | undefined, client: ClientContext) {
    const u = await this.db.selectFrom('users').select(['password_hash', 'email', 'status']).where('id', '=', userId).executeTakeFirstOrThrow();
    // Re-authentication: a password if the account has one; otherwise the session must be fresh (< 15 minutes).
    if (u.password_hash) {
      if (!password || !(await this.passwords.verify(u.password_hash, password))) throw new AppError('INVALID_CREDENTIALS');
    } else {
      const s = await this.db.selectFrom('user_sessions').select('created_at').where('id', '=', sessionId).executeTakeFirstOrThrow();
      if (Date.now() - new Date(s.created_at).getTime() > 15 * 60_000) throw new AppError('UNAUTHENTICATED', 'Please sign in again to delete your account');
    }
    const due = new Date(Date.now() + DELETION_GRACE_DAYS * 86_400_000);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('users').set({ status: 'deactivated', status_reason: 'deletion_requested' }).where('id', '=', userId).execute();
      await trx.updateTable('user_profiles').set({ is_discoverable: false }).where('user_id', '=', userId).execute();
      await trx.insertInto('data_privacy_requests').values({ user_id: userId, subject_email: u.email, kind: 'delete', status: 'in_progress', due_at: due }).execute();
      await this.tokens.revokeAllForUser(trx, userId, 'account_deletion');
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'privacy.deletion_requested', targetType: 'user', targetId: userId, after: { purgeAt: due.toISOString() }, client }, trx);
    });
    return { status: 'scheduled', purgeAt: due.toISOString() };
  }

  /** Called after a successful login during the grace period (the app offers "restore my account"). */
  async cancelDeletion(userId: string, client: ClientContext) {
    const r = await this.db.updateTable('data_privacy_requests').set({ status: 'cancelled' }).where('user_id', '=', userId).where('kind', '=', 'delete').where('status', '=', 'in_progress').executeTakeFirst();
    if (!r.numUpdatedRows) throw new AppError('NOT_FOUND');
    await this.db.updateTable('users').set({ status: 'active', status_reason: null }).where('id', '=', userId).where('status', '=', 'deactivated').execute();
    await this.audit.record({ actorType: 'user', actorId: userId, action: 'privacy.deletion_cancelled', targetType: 'user', targetId: userId, client });
    await this.profileState.recompute(userId);
  }

  async purgeDue(): Promise<number> {
    const due = await this.db.selectFrom('data_privacy_requests').select(['id', 'user_id']).where('kind', '=', 'delete').where('status', '=', 'in_progress').where('due_at', '<=', new Date()).execute();
    for (const r of due) {
      if (!r.user_id) continue;
      try {
        await this.purge(r.user_id);
        await this.db.updateTable('data_privacy_requests').set({ status: 'completed', completed_at: new Date() }).where('id', '=', r.id).execute();
      } catch (err) {
        this.logger.error(`purge of ${r.user_id} failed: ${(err as Error).message}`);
      }
    }
    return due.length;
  }

  /**
   * Irreversible purge. Removes the person's content and identifiers; keeps an anonymized husk row (status 'deleted',
   * no PII) so foreign keys from retained records (payments for tax law, moderation case evidence) stay intact.
   */
  /**
   * Retained after purge, tied only to the anonymized husk: payments/subscriptions/ledgers (tax and accounting law),
   * reports, moderation cases/actions/appeals and restrictions (safety; defence of legal claims), consent records and
   * privacy requests (proof of compliance), conversation membership and call metadata (the other person's history),
   * feedback others wrote. Each has its own retention policy (Admin → Privacy → Retention).
   */
  async purge(userId: string): Promise<void> {
    const media = await this.db.selectFrom('profile_media').select('storage_key').where('user_id', '=', userId).execute();
    const msgMedia = await this.db.selectFrom('message_media as mm').innerJoin('messages as m', 'm.id', 'mm.message_id').select('mm.storage_key').where('m.sender_id', '=', userId).execute();
    const evidence = await this.db.selectFrom('verification_requests').select('evidence_keys').where('user_id', '=', userId).execute();
    const exports = await this.db.selectFrom('data_privacy_requests').select('export_storage_key').where('user_id', '=', userId).where('export_storage_key', 'is not', null).execute();
    const keys = [...media.map((m) => m.storage_key), ...msgMedia.map((m) => m.storage_key), ...evidence.flatMap((e) => e.evidence_keys), ...exports.map((e) => e.export_storage_key!)];
    await this.db.transaction().execute(async (trx) => {
      for (const t of ['user_profile_attributes', 'user_interests', 'user_languages', 'profile_prompts', 'profile_media', 'user_preference_terms', 'user_preferences', 'user_privacy_settings',
        'user_locations', 'crossed_path_sightings', 'travel_plans', 'onboarding_progress', 'question_answers', 'user_deal_breakers', 'user_embeddings', 'user_behavior_stats', 'user_preference_signals',
        'notification_preferences', 'notification_settings', 'notifications', 'trusted_contacts', 'auth_identities', 'user_devices', 'consumable_balances', 'usage_counters',
        'billing_customers', 'recommendation_feedback', 'user_sessions', 'verification_codes', 'message_reactions', 'boosts', 'entitlements', 'experiment_assignments',
        'date_safety_sessions', 'date_plan_participants', 'event_attendees', 'event_feedback'] as const) {
        await trx.deleteFrom(t).where('user_id', '=', userId).execute();
      }
      // Fingerprints, risk scores and safety signals are kept only for banned accounts (ban-evasion protection, a
      // legitimate safety interest).
      const banned = await trx.selectFrom('moderation_actions').select('id').where('subject_user_id', '=', userId).where('action', '=', 'ban').where('reversed_at', 'is', null).executeTakeFirst();
      if (!banned) {
        await trx.deleteFrom('account_fingerprints').where('user_id', '=', userId).execute();
        await trx.deleteFrom('user_risk_scores').where('user_id', '=', userId).execute();
        await trx.deleteFrom('safety_events').where('user_id', '=', userId).execute();
      }
      // Two-sided relations: both directions go.
      await trx.deleteFrom('swipe_actions').where((eb) => eb.or([eb('actor_id', '=', userId), eb('target_id', '=', userId)])).execute();
      await trx.deleteFrom('blocks').where((eb) => eb.or([eb('blocker_id', '=', userId), eb('blocked_id', '=', userId)])).execute();
      await trx.deleteFrom('user_favorites').where((eb) => eb.or([eb('user_id', '=', userId), eb('target_id', '=', userId)])).execute();
      await trx.deleteFrom('user_relationship_controls').where((eb) => eb.or([eb('owner_id', '=', userId), eb('subject_id', '=', userId)])).execute();
      await trx.deleteFrom('recommendation_feedback').where('candidate_id', '=', userId).execute();
      await trx.deleteFrom('match_candidates').where((eb) => eb.or([eb('user_id', '=', userId), eb('candidate_id', '=', userId)])).execute();
      await trx.deleteFrom('profile_views').where((eb) => eb.or([eb('viewer_id', '=', userId), eb('viewed_id', '=', userId)])).execute();
      await trx.deleteFrom('user_profiles').where('user_id', '=', userId).execute();
      // Messages they wrote: content removed, rows kept so the other person's thread stays coherent ("deleted message").
      await trx.updateTable('messages').set({ body: null, deleted_at: sql`coalesce(deleted_at, now())` }).where('sender_id', '=', userId).execute();
      await trx.deleteFrom('message_media').where('message_id', 'in', trx.selectFrom('messages').select('id').where('sender_id', '=', userId)).execute();
      await trx.updateTable('matches').set({ status: 'unmatched', ended_at: sql`coalesce(ended_at, now())` }).where('status', '=', 'active').where((eb) => eb.or([eb('user_low_id', '=', userId), eb('user_high_id', '=', userId)])).execute();
      await trx.updateTable('date_feedback').set({ private_note: null, tags: [] }).where('author_id', '=', userId).execute();
      await trx.updateTable('verification_requests').set({ evidence_keys: [], evidence_purged_at: new Date() }).where('user_id', '=', userId).execute();
      await trx.updateTable('users').set({
        email: null, phone_e164: null, password_hash: null, date_of_birth: null, timezone: null, status: 'deleted', status_reason: 'purged', deleted_at: new Date(),
        token_version: sql`token_version + 1`,
      }).where('id', '=', userId).execute();
      await this.audit.record({ actorType: 'system', action: 'privacy.account_purged', targetType: 'user', targetId: userId, after: { objectsDeleted: keys.length } }, trx);
    });
    for (const k of keys) await this.storage.delete(k).catch((err: Error) => this.logger.warn(`delete ${k}: ${err.message}`));
    await this.analytics.track('account_deleted', {});
  }

  // ------------------------------------------------------------------------------------ retention

  async applyRetention(): Promise<void> {
    const policies = new Map((await this.db.selectFrom('retention_policies').select(['entity', 'retention_days']).execute()).map((p) => [p.entity, p.retention_days]));
    const cutoff = (entity: string, fallback: number) => new Date(Date.now() - (policies.get(entity) ?? fallback) * 86_400_000);
    await this.db.deleteFrom('crossed_path_sightings').where('hour_bucket', '<', cutoff('crossed_path_sightings', 14)).execute();
    await this.db.deleteFrom('date_safety_locations').where('captured_at', '<', cutoff('date_safety_locations', 30)).execute();
    await this.db.deleteFrom('notifications').where('created_at', '<', cutoff('notifications', 180)).where('status', 'in', ['sent', 'delivered', 'read', 'suppressed', 'dead_letter']).execute();
    await this.db.deleteFrom('ai_requests').where('created_at', '<', cutoff('ai_requests', 365)).execute();
    await this.db.deleteFrom('verification_codes').where('created_at', '<', new Date(Date.now() - 7 * 86_400_000)).execute();
    await this.db.deleteFrom('refresh_tokens').where('expires_at', '<', new Date(Date.now() - 7 * 86_400_000)).execute();
    await this.db.deleteFrom('outbox_events').where('dispatched_at', '<', new Date(Date.now() - 14 * 86_400_000)).execute();
    // Analytics: keep aggregates, drop the person link from old raw events.
    await this.db.updateTable('analytics_events').set({ user_id: null, session_id: null }).where('occurred_at', '<', cutoff('analytics_events', 760)).where('user_id', 'is not', null).execute();
    // Expired DSAR exports are deleted from storage.
    const stale = await this.db.selectFrom('data_privacy_requests').select(['id', 'export_storage_key']).where('export_expires_at', '<', new Date()).where('export_storage_key', 'is not', null).execute();
    for (const s of stale) {
      await this.storage.delete(s.export_storage_key!).catch(() => undefined);
      await this.db.updateTable('data_privacy_requests').set({ export_storage_key: null }).where('id', '=', s.id).execute();
    }
  }
}
