import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { reportCreate } from '@amora/shared';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { AuditService } from '../../common/audit/audit.service';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import type { ClientContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { RealtimeBus } from '../../common/realtime/realtime-bus';
import { ModerationService, REASON_MAP } from './moderation.service';

@Injectable()
export class SafetyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly moderation: ModerationService,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
    private readonly outbox: OutboxService,
    private readonly bus: RealtimeBus,
  ) {}

  // ---------------------------------------------------------------------------------- reports

  /** Resolves the reported user for a target and checks the reporter could actually see it. */
  private async resolveTarget(reporterId: string, type: string, id: string): Promise<{ subjectId: string | null; snapshot: Record<string, unknown> }> {
    switch (type) {
      case 'user':
      case 'profile': {
        const p = await this.db.selectFrom('user_profiles').select(['user_id', 'display_name', 'bio', 'profession']).where('user_id', '=', id).executeTakeFirst();
        if (!p) throw new AppError('NOT_FOUND');
        const prompts = await this.db.selectFrom('profile_prompts').select(['prompt_id', 'answer']).where('user_id', '=', id).execute();
        return { subjectId: id, snapshot: { displayName: p.display_name, bio: p.bio, profession: p.profession, prompts } };
      }
      case 'media': {
        const m = await this.db.selectFrom('profile_media').select(['user_id', 'storage_key', 'kind']).where('id', '=', id).executeTakeFirst();
        if (!m) throw new AppError('NOT_FOUND');
        return { subjectId: m.user_id, snapshot: { kind: m.kind, storageKey: m.storage_key } };
      }
      case 'prompt': {
        const p = await this.db.selectFrom('profile_prompts').select(['user_id', 'answer', 'prompt_id']).where('id', '=', id).executeTakeFirst();
        if (!p) throw new AppError('NOT_FOUND');
        return { subjectId: p.user_id, snapshot: { promptId: p.prompt_id, answer: p.answer } };
      }
      case 'message': {
        const m = await this.db.selectFrom('messages as m').innerJoin('conversation_members as cm', (j) => j.onRef('cm.conversation_id', '=', 'm.conversation_id').on('cm.user_id', '=', reporterId))
          .select(['m.sender_id', 'm.body', 'm.kind', 'm.created_at', 'm.conversation_id']).where('m.id', '=', id).executeTakeFirst();
        if (!m || !m.sender_id || m.sender_id === reporterId) throw new AppError('NOT_FOUND');
        return { subjectId: m.sender_id, snapshot: { body: m.body, kind: m.kind, sentAt: m.created_at, conversationId: m.conversation_id } };
      }
      case 'event': {
        const e = await this.db.selectFrom('events').select(['organizer_user_id', 'title', 'description']).where('id', '=', id).executeTakeFirst();
        if (!e) throw new AppError('NOT_FOUND');
        return { subjectId: e.organizer_user_id, snapshot: { title: e.title, description: e.description } };
      }
      case 'date': {
        const d = await this.db.selectFrom('date_plans as d').innerJoin('matches as m', 'm.id', 'd.match_id').select(['m.user_low_id', 'm.user_high_id', 'd.title', 'd.starts_at', 'd.venue_name'])
          .where('d.id', '=', id).executeTakeFirst();
        if (!d || ![d.user_low_id, d.user_high_id].includes(reporterId)) throw new AppError('NOT_FOUND');
        return { subjectId: d.user_low_id === reporterId ? d.user_high_id : d.user_low_id, snapshot: { title: d.title, startsAt: d.starts_at, venue: d.venue_name } };
      }
    }
    throw new AppError('VALIDATION_FAILED', 'Unknown target type');
  }

  async report(reporterId: string, input: z.infer<typeof reportCreate>, client: ClientContext) {
    const reason = await this.db.selectFrom('taxonomy_terms').select(['id', 'key']).where('kind', '=', 'report_reason').where('key', '=', input.reasonKey).where('is_active', '=', true).executeTakeFirst();
    if (!reason) throw new AppError('VALIDATION_FAILED', 'Unknown reason', [{ path: 'reasonKey', message: 'unknown' }]);
    const { subjectId, snapshot } = await this.resolveTarget(reporterId, input.targetType, input.targetId);
    if (subjectId === reporterId) throw new AppError('VALIDATION_FAILED', 'You cannot report yourself');
    const [category, severity] = REASON_MAP[reason.key] ?? ['other', 'medium'];

    // Attached messages must come from a conversation the reporter is part of, and be authored by the subject.
    const evidenceMessages = input.messageIds.length
      ? await this.db.selectFrom('messages as m').innerJoin('conversation_members as cm', (j) => j.onRef('cm.conversation_id', '=', 'm.conversation_id').on('cm.user_id', '=', reporterId))
          .select(['m.id', 'm.body', 'm.kind', 'm.created_at', 'm.sender_id']).where('m.id', 'in', input.messageIds).execute()
      : [];

    const result = await this.db.transaction().execute(async (trx) => {
      const caseId = await this.moderation.openOrAttachCase(trx, subjectId, category, severity, 'user_report');
      const report = await trx.insertInto('reports').values({
        reporter_id: reporterId, reported_user_id: subjectId, target_type: input.targetType, target_id: input.targetId, reason_term_id: reason.id, details: input.details ?? null,
        evidence: JSON.stringify(evidenceMessages.map((m) => ({ type: 'message', id: m.id }))), case_id: caseId, status: 'triaged',
      }).returning('id').executeTakeFirstOrThrow().catch((err: { code?: string }) => {
        if (err.code === '23505') throw new AppError('ALREADY_REPORTED');
        throw err;
      });
      // Snapshots are immutable copies so the subject deleting content cannot erase evidence.
      await trx.insertInto('case_evidence').values([
        { case_id: caseId, kind: input.targetType === 'message' ? 'message' : input.targetType === 'media' ? 'media' : input.targetType === 'prompt' ? 'prompt' : input.targetType === 'event' ? 'event' : 'profile_snapshot', ref_id: input.targetId, snapshot: JSON.stringify(snapshot) },
        ...evidenceMessages.map((m) => ({ case_id: caseId, kind: 'message', ref_id: m.id, snapshot: JSON.stringify({ body: m.body, kind: m.kind, sentAt: m.created_at, senderId: m.sender_id }) })),
      ]).execute();
      if (input.alsoBlock && subjectId) await this.blockInTx(trx, reporterId, subjectId, input.reasonKey);
      await this.audit.record({ actorType: 'user', actorId: reporterId, action: 'safety.report_submitted', targetType: input.targetType, targetId: input.targetId, after: { caseId, reason: reason.key }, client }, trx);
      return { reportId: report.id, caseId };
    });
    await this.analytics.track('report_submitted', { userId: reporterId, properties: { targetType: input.targetType, reason: reason.key } });
    if (input.alsoBlock && subjectId) await this.afterBlock(reporterId, subjectId);
    // Reporter gets no case details; outcomes are communicated without revealing actions on another account.
    return { reportId: result.reportId, blocked: !!input.alsoBlock };
  }

  // ---------------------------------------------------------------------------------- blocks

  private async blockInTx(trx: Tx, blocker: string, blocked: string, reasonKey?: string) {
    await trx.insertInto('blocks').values({ blocker_id: blocker, blocked_id: blocked, reason_key: reasonKey ?? null }).onConflict((oc) => oc.doNothing()).execute();
    const [low, high] = blocker < blocked ? [blocker, blocked] : [blocked, blocker];
    const m = await trx.updateTable('matches').set({ status: 'blocked', ended_at: new Date(), ended_by: blocker }).where('user_low_id', '=', low).where('user_high_id', '=', high).where('status', '=', 'active').returning('id').executeTakeFirst();
    if (m) {
      await trx.updateTable('conversations').set({ status: 'closed' }).where('match_id', '=', m.id).execute();
      await trx.updateTable('relationship_journeys').set({ stage: 'ended', ended_at: new Date() }).where('match_id', '=', m.id).execute();
    }
    await trx.updateTable('match_candidates').set({ acted_at: new Date() }).where('acted_at', 'is', null)
      .where((eb) => eb.or([eb.and([eb('user_id', '=', blocker), eb('candidate_id', '=', blocked)]), eb.and([eb('user_id', '=', blocked), eb('candidate_id', '=', blocker)])])).execute();
    return m?.id ?? null;
  }

  private async afterBlock(blocker: string, blocked: string) {
    await this.analytics.track('block_created', { userId: blocker });
    // Same payload as an unmatch, so the blocked person's client drops the conversation without learning it was a block.
    // Both sides get it (the blocker's other devices must drop it too). Nothing to send if they were never matched.
    const [low, high] = blocker < blocked ? [blocker, blocked] : [blocked, blocker];
    const m = await this.db.selectFrom('matches as m').leftJoin('conversations as c', 'c.match_id', 'm.id').select(['m.id', 'c.id as conversation_id'])
      .where('m.user_low_id', '=', low).where('m.user_high_id', '=', high).where('m.status', '=', 'blocked').orderBy('m.ended_at', 'desc').executeTakeFirst();
    if (m) await this.bus.publish([blocker, blocked], 'match.ended', { matchId: m.id, conversationId: m.conversation_id ?? null });
  }

  async block(userId: string, targetId: string, reasonKey: string | undefined, client: ClientContext) {
    if (userId === targetId) throw new AppError('VALIDATION_FAILED', 'You cannot block yourself');
    const exists = await this.db.selectFrom('users').select('id').where('id', '=', targetId).executeTakeFirst();
    if (!exists) throw new AppError('NOT_FOUND');
    await this.db.transaction().execute(async (trx) => {
      await this.blockInTx(trx, userId, targetId, reasonKey);
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'safety.blocked', targetType: 'user', targetId, client }, trx);
    });
    await this.afterBlock(userId, targetId);
  }

  async unblock(userId: string, targetId: string, client: ClientContext) {
    const r = await this.db.deleteFrom('blocks').where('blocker_id', '=', userId).where('blocked_id', '=', targetId).executeTakeFirst();
    if (!r.numDeletedRows) throw new AppError('NOT_FOUND');
    await this.audit.record({ actorType: 'user', actorId: userId, action: 'safety.unblocked', targetType: 'user', targetId, client });
  }

  async listBlocks(userId: string) {
    return this.db.selectFrom('blocks as b').leftJoin('user_profiles as p', 'p.user_id', 'b.blocked_id').select(['b.blocked_id as userId', 'p.display_name as displayName', 'b.created_at as blockedAt'])
      .where('b.blocker_id', '=', userId).orderBy('b.created_at', 'desc').execute();
  }

  async setControl(userId: string, targetId: string, control: 'mute' | 'restrict', enabled: boolean) {
    if (enabled) await this.db.insertInto('user_relationship_controls').values({ owner_id: userId, subject_id: targetId, control }).onConflict((oc) => oc.doNothing()).execute();
    else await this.db.deleteFrom('user_relationship_controls').where('owner_id', '=', userId).where('subject_id', '=', targetId).where('control', '=', control).execute();
    if (control === 'mute') {
      // Muting a person mutes the conversation with them.
      const convs = await this.db.selectFrom('conversation_members as me').innerJoin('conversation_members as them', 'them.conversation_id', 'me.conversation_id').select('me.conversation_id')
        .where('me.user_id', '=', userId).where('them.user_id', '=', targetId).execute();
      if (convs.length) await this.db.updateTable('conversation_members').set({ muted_until: enabled ? new Date('9999-12-31') : null }).where('user_id', '=', userId).where('conversation_id', 'in', convs.map((c) => c.conversation_id)).execute();
    }
  }

  // ---------------------------------------------------------------------------------- account status & appeals

  async accountStatus(userId: string) {
    const [u, restrictions, actions] = await Promise.all([
      this.db.selectFrom('users').select(['status', 'status_reason', 'status_until']).where('id', '=', userId).executeTakeFirstOrThrow(),
      this.db.selectFrom('account_restrictions').select(['id', 'kind', 'starts_at', 'ends_at']).where('user_id', '=', userId).where('lifted_at', 'is', null).execute(),
      this.db.selectFrom('moderation_actions as a').leftJoin('appeals as ap', 'ap.action_id', 'a.id').select(['a.id', 'a.action', 'a.reason_key', 'a.created_at', 'a.reversed_at', 'ap.status as appeal_status'])
        .where('a.subject_user_id', '=', userId).where('a.action', 'in', ['warn', 'restrict', 'suspend', 'ban', 'remove_content']).orderBy('a.created_at', 'desc').limit(50).execute(),
    ]);
    return {
      status: u.status, reasonKey: u.status_reason, until: u.status_until ? new Date(u.status_until).toISOString() : null,
      restrictions: restrictions.map((r) => ({ id: r.id, kind: r.kind, endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null })),
      actions: actions.map((a) => ({ id: a.id, action: a.action, reasonKey: a.reason_key, at: new Date(a.created_at).toISOString(), reversed: !!a.reversed_at, appealStatus: a.appeal_status, canAppeal: !a.reversed_at && !a.appeal_status })),
    };
  }

  async appeal(userId: string, actionId: string, statement: string, client: ClientContext) {
    const a = await this.db.selectFrom('moderation_actions').select(['id', 'subject_user_id', 'action', 'reversed_at', 'case_id']).where('id', '=', actionId).executeTakeFirst();
    if (!a || a.subject_user_id !== userId || !['warn', 'restrict', 'suspend', 'ban', 'remove_content'].includes(a.action)) throw new AppError('NOT_FOUND');
    if (a.reversed_at) throw new AppError('CONFLICT', 'Action already reversed');
    return this.db.transaction().execute(async (trx) => {
      const ap = await trx.insertInto('appeals').values({ user_id: userId, action_id: actionId, statement }).returning(['id', 'status', 'created_at']).executeTakeFirstOrThrow()
        .catch((err: { code?: string }) => {
          if (err.code === '23505') throw new AppError('CONFLICT', 'This action was already appealed');
          throw err;
        });
      await this.moderation.openOrAttachCase(trx, userId, 'other', 'medium', 'appeal');
      await this.audit.record({ actorType: 'user', actorId: userId, action: 'safety.appeal_submitted', targetType: 'moderation_action', targetId: actionId, client }, trx);
      return { appealId: ap.id, status: ap.status };
    });
  }
}
