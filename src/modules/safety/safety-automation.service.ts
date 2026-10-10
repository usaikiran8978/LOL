import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'kysely';
import { sha256 } from '../../common/crypto/tokens';
import { DATABASE, type Database } from '../../common/db/database';
import { JobScheduler } from '../../common/jobs/scheduler';
import { MessagingService } from '../../common/messaging/messaging';
import { OutboxService } from '../../common/outbox/outbox.service';
import { SettingsService } from '../platform/settings.service';
import { ProfileStateService } from '../profiles/profile-state.service';
import { decideImage, IMAGE_MODERATION, type ImageModerationProvider, type ImagePolicy } from './image-moderation';
import { ModerationService } from './moderation.service';
import { TextModerationService } from './text-moderation';

const DEFAULT_IMAGE_POLICY: ImagePolicy = {
  rejectLabels: ['Explicit Nudity', 'Explicit', 'Violence', 'Visually Disturbing', 'Hate Symbols', 'Drugs & Tobacco Paraphernalia & Use'],
  reviewLabels: ['Suggestive', 'Non-Explicit Nudity of Intimate parts and Kissing', 'Swimwear or Underwear', 'Alcohol', 'Gambling', 'Rude Gestures'],
  rejectConfidence: 0.9,
  reviewConfidence: 0.6,
};

/** Normalized email for duplicate detection: case-insensitive, Gmail dots/+tags removed. */
export function normalizeEmailForFingerprint(email: string): string {
  const [local = '', domain = ''] = email.toLowerCase().split('@');
  const base = local.split('+')[0]!;
  return `${['gmail.com', 'googlemail.com'].includes(domain) ? base.replace(/\./g, '') : base}@${domain === 'googlemail.com' ? 'gmail.com' : domain}`;
}

/**
 * Automated trust & safety (BRD §15, TECH §11): profile text scanning, image moderation, ban-evasion/duplicate
 * detection via hashed fingerprints, rolling risk scores feeding ranking (TECH §6) and admin-defined auto-actions.
 * Automation only restricts and routes to humans; bans are always a human decision.
 */
@Injectable()
export class SafetyAutomationService implements OnModuleInit {
  private readonly logger = new Logger(SafetyAutomationService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Optional() @Inject(IMAGE_MODERATION) private readonly images: ImageModerationProvider | null,
    private readonly text: TextModerationService,
    private readonly moderation: ModerationService,
    private readonly settings: SettingsService,
    private readonly profileState: ProfileStateService,
    private readonly outbox: OutboxService,
    private readonly jobs: JobScheduler,
    private readonly messaging: MessagingService,
  ) {}

  onModuleInit(): void {
    this.outbox.on('profile.text_changed', (p) => this.scanProfileText(String(p.userId)));
    this.outbox.on('media.ready', (p) => this.moderateProfileMedia(String(p.mediaId)));
    this.outbox.on('message.media_uploaded', (p) => this.moderateMessageMedia(String(p.messageId)));
    this.outbox.on('auth.session_created', (p) => this.fingerprint(String(p.userId), String(p.installationId)));
    this.outbox.on('safety.user_banned', (p) => this.linkedAccounts(String(p.userId)));
    this.outbox.on('moderation.critical_case', async (p) => {
      const to = await this.settings.get<string | null>('moderation.oncall_email', null);
      if (to) await this.messaging.sendEmail({ to, subject: `[T&S] Critical case ${p.caseId}`, text: `A critical ${p.category} case was opened: ${p.caseId}. SLA: 1 hour.` });
    });
    this.jobs.register('safety.risk_scores', 3600, () => this.recomputeRiskScores());
    this.jobs.register('verification.purge_evidence', 6 * 3600, () => this.purgeVerificationEvidence());
  }

  // ---------------------------------------------------------------------------------- text

  async scanProfileText(userId: string): Promise<void> {
    const [p, prompts] = await Promise.all([
      this.db.selectFrom('user_profiles').select(['bio', 'display_name', 'moderation_status']).where('user_id', '=', userId).executeTakeFirst(),
      this.db.selectFrom('profile_prompts').select(['id', 'answer']).where('user_id', '=', userId).where('moderation_status', '=', 'pending').execute(),
    ]);
    if (!p) return;
    const profileScan = await this.text.scan('profile_text', `${p.display_name}\n${p.bio ?? ''}`);
    if (profileScan.action !== 'allow') await this.signal(userId, profileScan.signals, profileScan.score, 'user_profile', null, profileScan.matchedRules);
    // A profile is approved when its free text is clean; flagged text waits for a human, hidden text is rejected.
    const profileStatus = profileScan.action === 'hide' ? 'rejected' : profileScan.action === 'warn' ? 'needs_changes' : 'approved';
    await this.db.updateTable('user_profiles').set({ moderation_status: profileStatus }).where('user_id', '=', userId).execute();
    for (const pr of prompts) {
      const s = await this.text.scan('profile_text', pr.answer);
      const status = s.action === 'hide' ? 'rejected' : s.action === 'warn' ? 'pending' : 'approved';
      if (s.action !== 'allow') await this.signal(userId, s.signals, s.score, 'profile_prompt', pr.id, s.matchedRules);
      await this.db.updateTable('profile_prompts').set({ moderation_status: status }).where('id', '=', pr.id).execute();
    }
    await this.profileState.recompute(userId);
  }

  // ---------------------------------------------------------------------------------- images

  private async imageDecision(storageKey: string): Promise<'approved' | 'rejected' | 'needs_review'> {
    if (!this.images) {
      // No provider configured: admins choose between human review of every image and auto-approval.
      return (await this.settings.get<boolean>('moderation.media_auto_approve', false)) ? 'approved' : 'needs_review';
    }
    const policy = await this.settings.get<ImagePolicy>('moderation.image_policy', DEFAULT_IMAGE_POLICY);
    try {
      return decideImage(await this.images.analyze(storageKey), policy);
    } catch (err) {
      this.logger.warn(`image moderation failed for ${storageKey}: ${(err as Error).message}`);
      return 'needs_review'; // fail closed to humans, never auto-approve on provider errors
    }
  }

  async moderateProfileMedia(mediaId: string): Promise<void> {
    const m = await this.db.selectFrom('profile_media').select(['user_id', 'storage_key', 'kind', 'moderation_status']).where('id', '=', mediaId).executeTakeFirst();
    if (!m || m.moderation_status !== 'pending') return;
    const decision = m.kind === 'photo' ? await this.imageDecision(m.storage_key) : 'needs_review';
    await this.db.updateTable('profile_media').set({ moderation_status: decision }).where('id', '=', mediaId).execute();
    if (decision === 'rejected') await this.signal(m.user_id, ['inappropriate_content'], 0.8, 'profile_media', mediaId, ['image_policy']);
    await this.profileState.recompute(m.user_id);
  }

  async moderateMessageMedia(messageId: string): Promise<void> {
    const media = await this.db.selectFrom('message_media as mm').innerJoin('messages as m', 'm.id', 'mm.message_id').select(['mm.id', 'mm.storage_key', 'mm.kind', 'm.sender_id', 'm.moderation_status'])
      .where('mm.message_id', '=', messageId).execute();
    let worst: 'approved' | 'rejected' | 'needs_review' = 'approved';
    for (const x of media) {
      const d = x.kind === 'image' ? await this.imageDecision(x.storage_key) : (await this.settings.get<boolean>('moderation.media_auto_approve', false)) ? 'approved' : 'needs_review';
      await this.db.updateTable('message_media').set({ moderation_status: d }).where('id', '=', x.id).execute();
      if (d === 'rejected' || (d === 'needs_review' && worst === 'approved')) worst = d;
    }
    const sender = media[0]?.sender_id;
    // Chat media is post-moderated: visible immediately, removed if rejected.
    await this.db.updateTable('messages').set({ moderation_status: worst === 'rejected' ? 'removed' : worst === 'needs_review' ? 'pending' : 'clean' })
      .where('id', '=', messageId).where('moderation_status', 'in', ['pending', 'clean']).execute();
    if (worst === 'rejected' && sender) await this.signal(sender, ['inappropriate_content'], 0.8, 'message', messageId, ['image_policy']);
    // Chat pushes the new state to the conversation (media now visible, or the message removed).
    await this.outbox.enqueue(this.db, 'message.moderated', { messageId }, { aggregateId: messageId });
  }

  // ---------------------------------------------------------------------------------- fingerprints

  async fingerprint(userId: string, installationId: string): Promise<void> {
    const u = await this.db.selectFrom('users').select(['email', 'phone_e164']).where('id', '=', userId).executeTakeFirst();
    if (!u) return;
    const prints: Array<{ kind: 'device' | 'phone' | 'email_normalized'; value_hash: Buffer }> = [{ kind: 'device', value_hash: sha256(`device:${installationId}`) }];
    if (u.email) prints.push({ kind: 'email_normalized', value_hash: sha256(`email:${normalizeEmailForFingerprint(u.email)}`) });
    if (u.phone_e164) prints.push({ kind: 'phone', value_hash: sha256(`phone:${u.phone_e164}`) });
    await this.db.insertInto('account_fingerprints').values(prints.map((p) => ({ user_id: userId, ...p }))).onConflict((oc) => oc.doNothing()).execute();
    await this.linkedAccounts(userId);
  }

  /** Flags accounts sharing fingerprints; sharing with a banned account restricts pending human review. */
  async linkedAccounts(userId: string): Promise<void> {
    const linked = await this.db
      .selectFrom('account_fingerprints as mine')
      .innerJoin('account_fingerprints as other', (j) => j.onRef('other.kind', '=', 'mine.kind').onRef('other.value_hash', '=', 'mine.value_hash'))
      .innerJoin('users as u', 'u.id', 'other.user_id')
      .select(['other.user_id', 'other.kind', 'u.status'])
      .where('mine.user_id', '=', userId)
      .where('other.user_id', '<>', userId)
      .execute();
    if (!linked.length) return;
    const banned = linked.filter((l) => l.status === 'banned');
    const me = await this.db.selectFrom('users').select('status').where('id', '=', userId).executeTakeFirstOrThrow();
    const subject = me.status === 'banned' ? null : userId;
    const already = await this.db.selectFrom('safety_events').select('id').where('user_id', '=', userId).where('signal', '=', 'duplicate_account').where('source', '=', 'fingerprint').where('created_at', '>', new Date(Date.now() - 86_400_000)).executeTakeFirst();
    if (already) return;
    await this.signal(subject ?? userId, ['duplicate_account'], banned.length ? 0.9 : 0.4, 'user', null, [...new Set(linked.map((l) => l.kind))], 'fingerprint');
    if (banned.length && subject) {
      const active = await this.db.selectFrom('account_restrictions').select('id').where('user_id', '=', subject).where('kind', '=', 'review_required').where('lifted_at', 'is', null).executeTakeFirst();
      if (!active) {
        const caseId = await this.db.transaction().execute((trx) => this.moderation.openOrAttachCase(trx, subject, 'fake_profile', 'high', 'automated'));
        await this.moderation.applyAction({ type: 'system', id: null }, subject, { action: 'restrict', reasonKey: 'ban_evasion_suspected', restrictionKinds: ['review_required', 'no_messaging', 'no_discovery'], notifyUser: false }, caseId);
      }
    }
  }

  private async signal(userId: string, signals: string[], score: number, refType: string, refId: string | null, rules: string[], source = 'text_moderation'): Promise<void> {
    await this.db.insertInto('safety_events').values([...new Set(signals)].map((signal) => ({ user_id: userId, signal, source, score, ref_type: refType, ref_id: refId, details: JSON.stringify({ rules }) }))).execute();
  }

  // ---------------------------------------------------------------------------------- risk scores & auto actions

  async recomputeRiskScores(): Promise<void> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const users = await this.db.selectFrom('safety_events').select('user_id').distinct().where('created_at', '>', since).where('user_id', 'is not', null).execute();
    const reported = await this.db.selectFrom('reports').select(['reported_user_id', sql<number>`count(DISTINCT reporter_id)::int`.as('n')]).where('created_at', '>', since).where('reported_user_id', 'is not', null).groupBy('reported_user_id').execute();
    const ids = new Set([...users.map((u) => u.user_id!), ...reported.map((r) => r.reported_user_id!)]);
    const autoRules = await this.db.selectFrom('moderation_rules').select(['key', 'config']).where('rule_type', '=', 'auto_action').where('is_active', '=', true).execute();
    for (const uid of ids) {
      const events = await this.db.selectFrom('safety_events').select(['signal', 'score', 'created_at']).where('user_id', '=', uid).where('created_at', '>', since).execute();
      // Recent signals weigh more (half-life 7 days); independent signals combine as 1 - Π(1 - s).
      let keep = 1;
      const bySignal: Record<string, number> = {};
      for (const e of events) {
        const ageDays = (Date.now() - new Date(e.created_at).getTime()) / 86_400_000;
        const s = Math.min(1, Number(e.score)) * 0.5 ** (ageDays / 7);
        keep *= 1 - s * 0.6;
        bySignal[e.signal] = (bySignal[e.signal] ?? 0) + 1;
      }
      const reporters = reported.find((r) => r.reported_user_id === uid)?.n ?? 0;
      keep *= (1 - 0.15) ** reporters;
      const score = Math.round((1 - keep) * 1000) / 1000;
      await this.db.insertInto('user_risk_scores').values({ user_id: uid, score, components: JSON.stringify({ signals: bySignal, reporters }) })
        .onConflict((oc) => oc.column('user_id').doUpdateSet({ score, components: JSON.stringify({ signals: bySignal, reporters }), computed_at: new Date() })).execute();
      for (const r of autoRules) {
        const c = r.config as { riskAbove?: number; restrictionKinds?: string[]; durationHours?: number };
        if (c.riskAbove === undefined || score < c.riskAbove || !c.restrictionKinds?.length) continue;
        const existing = await this.db.selectFrom('moderation_actions').select('id').where('subject_user_id', '=', uid).where('reason_key', '=', `auto:${r.key}`).where('reversed_at', 'is', null)
          .where('created_at', '>', since).executeTakeFirst();
        if (existing) continue;
        const caseId = await this.db.transaction().execute((trx) => this.moderation.openOrAttachCase(trx, uid, 'other', 'high', 'automated'));
        await this.moderation.applyAction({ type: 'system', id: null }, uid, { action: 'restrict', reasonKey: `auto:${r.key}`, restrictionKinds: c.restrictionKinds, durationHours: c.durationHours, notifyUser: false }, caseId);
      }
    }
  }

  async purgeVerificationEvidence(): Promise<void> {
    const days = (await this.db.selectFrom('retention_policies').select('retention_days').where('entity', '=', 'verification_evidence').executeTakeFirst())?.retention_days ?? 30;
    const rows = await this.db.selectFrom('verification_requests').select(['id', 'evidence_keys']).where('decided_at', '<', new Date(Date.now() - days * 86_400_000)).where('evidence_purged_at', 'is', null).limit(500).execute();
    for (const r of rows) {
      for (const k of r.evidence_keys) await this.outbox.enqueue(this.db, 'media.deleted', { keys: [k] });
      await this.db.updateTable('verification_requests').set({ evidence_keys: [], evidence_purged_at: new Date() }).where('id', '=', r.id).execute();
    }
  }
}
