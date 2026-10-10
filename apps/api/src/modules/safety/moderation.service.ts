import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import type { ClientContext } from '../../common/http/request-context';
import { JobScheduler } from '../../common/jobs/scheduler';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TokenService } from '../auth/token.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../platform/settings.service';
import { ProfileStateService } from '../profiles/profile-state.service';

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Category = 'harassment' | 'scam' | 'fake_profile' | 'spam' | 'inappropriate_content' | 'underage' | 'violence' | 'hate' | 'self_harm' | 'offline_safety' | 'impersonation' | 'other';

const DEFAULT_SLA_HOURS: Record<Severity, number> = { critical: 1, high: 4, medium: 24, low: 72 };
const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Report reason → (case category, base severity). Unknown reasons fall back to other/medium. */
export const REASON_MAP: Record<string, [Category, Severity]> = {
  fake_profile: ['fake_profile', 'medium'], scam: ['scam', 'high'], harassment: ['harassment', 'high'], inappropriate_content: ['inappropriate_content', 'medium'],
  underage: ['underage', 'critical'], hate: ['hate', 'high'], violence: ['violence', 'critical'], offline_safety: ['offline_safety', 'critical'],
  spam: ['spam', 'low'], impersonation: ['impersonation', 'high'], other: ['other', 'medium'], self_harm: ['self_harm', 'critical'],
};

export interface ActionInput {
  action: 'warn' | 'restrict' | 'suspend' | 'ban' | 'remove_content' | 'restore_content' | 'escalate' | 'unban' | 'unsuspend' | 'lift_restriction' | 'verify' | 'unverify' | 'force_logout';
  reasonKey: string;
  note?: string;
  durationHours?: number;
  restrictionKinds?: string[];
  contentType?: 'media' | 'message' | 'prompt' | 'bio' | 'event';
  contentId?: string;
  restrictionId?: string;
  /** lift_restriction: only restrictions created by this action (used by reversals). */
  sourceActionId?: string;
  notifyUser?: boolean;
}

/**
 * Case management + enforcement (TECH §11). Every action is a row in moderation_actions with its effects applied in
 * the same transaction, is audited, can be reversed (restrictions, suspensions, bans, content removal) and may be
 * appealed by the user.
 */
@Injectable()
export class ModerationService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly tokens: TokenService,
    private readonly notifications: NotificationsService,
    private readonly profileState: ProfileStateService,
    private readonly settings: SettingsService,
    private readonly jobs: JobScheduler,
  ) {}

  onModuleInit(): void {
    // Lift expired suspensions/restrictions (auth already ignores expired suspensions; this normalizes state).
    this.jobs.register('moderation.expire', 300, async () => {
      const expired = await this.db.updateTable('users').set({ status: 'active', status_reason: null, status_until: null })
        .where('status', '=', 'suspended').where('status_until', 'is not', null).where('status_until', '<=', new Date()).returning('id').execute();
      await this.db.updateTable('account_restrictions').set({ lifted_at: new Date() }).where('lifted_at', 'is', null).where('ends_at', '<=', new Date()).execute();
      for (const u of expired) await this.profileState.recompute(u.id);
    });
  }

  async slaFor(severity: Severity): Promise<Date> {
    const hours = await this.settings.get<Record<Severity, number>>('moderation.sla_hours', DEFAULT_SLA_HOURS);
    return new Date(Date.now() + (hours[severity] ?? DEFAULT_SLA_HOURS[severity]) * 3_600_000);
  }

  /** Attaches to the subject's open case of the same category, or opens one. Escalates severity/priority on repeats. */
  async openOrAttachCase(trx: Tx, subjectUserId: string | null, category: Category, severity: Severity, source: 'user_report' | 'automated' | 'admin' | 'appeal'): Promise<string> {
    const existing = subjectUserId
      ? await trx.selectFrom('moderation_cases').select(['id', 'severity', 'priority_score']).where('subject_user_id', '=', subjectUserId).where('category', '=', category)
          .where('status', 'in', ['open', 'in_review', 'escalated']).forUpdate().executeTakeFirst()
      : undefined;
    if (existing) {
      const sev = SEVERITY_RANK[severity] > SEVERITY_RANK[existing.severity as Severity] ? severity : (existing.severity as Severity);
      await trx.updateTable('moderation_cases').set({ severity: sev, priority_score: sql`priority_score + 1`, ...(sev !== existing.severity ? { sla_due_at: await this.slaFor(sev) } : {}) }).where('id', '=', existing.id).execute();
      return existing.id;
    }
    const c = await trx.insertInto('moderation_cases').values({
      subject_user_id: subjectUserId, category, severity, source, priority_score: SEVERITY_RANK[severity] * 10, sla_due_at: await this.slaFor(severity),
    }).returning('id').executeTakeFirstOrThrow();
    // Critical cases page the on-call T&S rota via the outbox (alerting integration consumes it).
    if (severity === 'critical') await this.outbox.enqueue(trx, 'moderation.critical_case', { caseId: c.id, category });
    return c.id;
  }

  async applyAction(actor: { type: 'admin' | 'system'; id: string | null }, subjectUserId: string, input: ActionInput, caseId: string | null, client?: ClientContext): Promise<{ actionId: string }> {
    const subject = await this.db.selectFrom('users').select(['id', 'status']).where('id', '=', subjectUserId).executeTakeFirst();
    if (!subject) throw new AppError('NOT_FOUND');
    const result = await this.db.transaction().execute(async (trx) => {
      const action = await trx.insertInto('moderation_actions').values({
        case_id: caseId, subject_user_id: subjectUserId, action: input.action, content_type: input.contentType ?? null, content_id: input.contentId ?? null,
        params: JSON.stringify({ durationHours: input.durationHours ?? null, restrictionKinds: input.restrictionKinds ?? null, note: input.note ?? null }),
        reason_key: input.reasonKey, actor_type: actor.type, actor_id: actor.id,
      }).returning('id').executeTakeFirstOrThrow();
      await this.effects(trx, subjectUserId, input, action.id);
      if (caseId) {
        const status = input.action === 'escalate' ? 'escalated' : ['unban', 'unsuspend', 'lift_restriction', 'restore_content'].includes(input.action) ? undefined : 'actioned';
        if (status) await trx.updateTable('moderation_cases').set({ status, ...(status === 'actioned' ? { resolved_at: new Date(), resolution_key: input.reasonKey } : {}) }).where('id', '=', caseId).execute();
        if (input.note && actor.type === 'admin' && actor.id) await trx.insertInto('case_notes').values({ case_id: caseId, author_id: actor.id, body: input.note }).execute();
      }
      await this.audit.record({ actorType: actor.type, actorId: actor.id, action: `moderation.${input.action}`, targetType: 'user', targetId: subjectUserId, after: { actionId: action.id, caseId, reason: input.reasonKey, contentType: input.contentType, contentId: input.contentId }, reason: input.note, client }, trx);
      return action;
    });
    if (input.notifyUser !== false && !['escalate', 'force_logout'].includes(input.action)) {
      await this.notifications.notify(subjectUserId, 'moderation.action', { action: input.action }, { dedupeKey: `moderation:${result.id}` });
    }
    await this.profileState.recompute(subjectUserId);
    return { actionId: result.id };
  }

  private async effects(trx: Tx, userId: string, input: ActionInput, actionId: string): Promise<void> {
    const until = input.durationHours ? new Date(Date.now() + input.durationHours * 3_600_000) : null;
    switch (input.action) {
      case 'warn':
      case 'escalate':
        return;
      case 'restrict':
        await trx.insertInto('account_restrictions').values((input.restrictionKinds ?? []).map((kind) => ({ user_id: userId, kind, action_id: actionId, ends_at: until }))).execute();
        await trx.updateTable('users').set({ status: 'restricted' }).where('id', '=', userId).where('status', '=', 'active').execute();
        return;
      case 'lift_restriction': {
        let q = trx.updateTable('account_restrictions').set({ lifted_at: new Date() }).where('user_id', '=', userId).where('lifted_at', 'is', null);
        if (input.restrictionId) q = q.where('id', '=', input.restrictionId);
        if (input.sourceActionId) q = q.where('action_id', '=', input.sourceActionId);
        await q.execute();
        const left = await trx.selectFrom('account_restrictions').select('id').where('user_id', '=', userId).where('lifted_at', 'is', null).executeTakeFirst();
        if (!left) await trx.updateTable('users').set({ status: 'active' }).where('id', '=', userId).where('status', '=', 'restricted').execute();
        return;
      }
      case 'suspend':
        await trx.updateTable('users').set({ status: 'suspended', status_reason: input.reasonKey, status_until: until }).where('id', '=', userId).execute();
        await this.tokens.revokeAllForUser(trx, userId, 'suspended');
        return;
      case 'unsuspend':
      case 'unban':
        await trx.updateTable('users').set({ status: 'active', status_reason: null, status_until: null }).where('id', '=', userId).where('status', 'in', input.action === 'unban' ? ['banned'] : ['suspended']).execute();
        return;
      case 'ban':
        await trx.updateTable('users').set({ status: 'banned', status_reason: input.reasonKey, status_until: null }).where('id', '=', userId).execute();
        await this.tokens.revokeAllForUser(trx, userId, 'banned');
        await trx.updateTable('matches').set({ status: 'closed_by_moderation', ended_at: new Date() }).where('status', '=', 'active').where((eb) => eb.or([eb('user_low_id', '=', userId), eb('user_high_id', '=', userId)])).execute();
        await trx.updateTable('conversations').set({ status: 'locked_by_moderation' })
          .where('match_id', 'in', trx.selectFrom('matches').select('id').where((eb) => eb.or([eb('user_low_id', '=', userId), eb('user_high_id', '=', userId)]))).execute();
        // Fingerprints of banned accounts feed duplicate/ban-evasion detection.
        await this.outbox.enqueue(trx, 'safety.user_banned', { userId });
        return;
      case 'force_logout':
        await this.tokens.revokeAllForUser(trx, userId, 'admin_force_logout');
        return;
      case 'verify':
        await trx.updateTable('user_profiles').set({ verification_level: 'selfie' }).where('user_id', '=', userId).execute();
        return;
      case 'unverify':
        await trx.updateTable('user_profiles').set({ verification_level: 'none' }).where('user_id', '=', userId).execute();
        return;
      case 'remove_content':
      case 'restore_content':
        return this.contentEffect(trx, userId, input, input.action === 'remove_content');
    }
  }

  private async contentEffect(trx: Tx, userId: string, input: ActionInput, remove: boolean): Promise<void> {
    const id = input.contentId;
    switch (input.contentType) {
      case 'media':
        await trx.updateTable('profile_media').set({ moderation_status: remove ? 'rejected' : 'approved' }).where('id', '=', id!).where('user_id', '=', userId).execute();
        await trx.updateTable('message_media').set({ moderation_status: remove ? 'rejected' : 'approved' }).where('id', '=', id!).execute();
        return;
      case 'message':
        await trx.updateTable('messages').set({ moderation_status: remove ? 'removed' : 'clean' }).where('id', '=', id!).where('sender_id', '=', userId).execute();
        return;
      case 'prompt':
        await trx.updateTable('profile_prompts').set({ moderation_status: remove ? 'rejected' : 'approved' }).where('id', '=', id!).where('user_id', '=', userId).execute();
        return;
      case 'bio':
        if (remove) await trx.updateTable('user_profiles').set({ bio: null }).where('user_id', '=', userId).execute();
        return; // a cleared bio cannot be restored by moderation; the user rewrites it
      case 'event':
        await trx.updateTable('events').set({ status: remove ? 'rejected' : 'published' }).where('id', '=', id!).execute();
        return;
    }
  }

  /** Reverses an action (appeal overturned or admin correction) by applying its inverse and linking both rows. */
  async reverse(actor: { type: 'admin' | 'system'; id: string | null }, actionId: string, note: string | undefined, client?: ClientContext): Promise<string | null> {
    const a = await this.db.selectFrom('moderation_actions').selectAll().where('id', '=', actionId).executeTakeFirst();
    if (!a || !a.subject_user_id) throw new AppError('NOT_FOUND');
    if (a.reversed_at) throw new AppError('CONFLICT', 'Already reversed');
    const inverse: Partial<Record<string, ActionInput['action']>> = { ban: 'unban', suspend: 'unsuspend', restrict: 'lift_restriction', remove_content: 'restore_content', verify: 'unverify', unverify: 'verify' };
    const inv = inverse[a.action];
    let reversalId: string | null = null;
    if (inv) {
      reversalId = (await this.applyAction(actor, a.subject_user_id, { action: inv, reasonKey: 'reversal', note, contentType: (a.content_type ?? undefined) as ActionInput['contentType'], contentId: a.content_id ?? undefined, sourceActionId: inv === 'lift_restriction' ? actionId : undefined, notifyUser: true }, a.case_id, client)).actionId;
    }
    await this.db.updateTable('moderation_actions').set({ reversed_at: new Date(), reversed_by: actor.id, reversal_action_id: reversalId }).where('id', '=', actionId).execute();
    return reversalId;
  }
}
