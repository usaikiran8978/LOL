import { randomUUID } from 'node:crypto';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { SendMessage } from '@amora/shared';
import { sql } from 'kysely';
import { AnalyticsService } from '../../common/analytics/analytics.service';
import { APP_CONFIG, type AppConfig } from '../../common/config/config';
import { hmac, safeEqual } from '../../common/crypto/tokens';
import { DATABASE, type Database, type Tx } from '../../common/db/database';
import { blockedEitherWay } from '../../common/db/relations';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../common/http/cursor';
import { JobScheduler } from '../../common/jobs/scheduler';
import { OutboxService } from '../../common/outbox/outbox.service';
import { RealtimeBus } from '../../common/realtime/realtime-bus';
import { OBJECT_STORAGE, type ObjectStorage } from '../../common/storage/object-storage';
import { localeChain, pickTranslation } from '../../common/i18n/translations';
import { FlagsService } from '../platform/flags.service';
import { SettingsService } from '../platform/settings.service';
import { UserFactsService } from '../platform/user-facts.service';
import { TextModerationService } from '../safety/text-moderation';

const CHAT_MIME: Record<'image' | 'voice', string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif'],
  voice: ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg'],
};
const CHAT_MAX_BYTES = { image: 15 * 1024 * 1024, voice: 5 * 1024 * 1024 };
const UPLOAD_TOKEN_TTL_MS = 30 * 60_000;
const DELETE_FOR_EVERYONE_MS = 60 * 60_000;

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string | null;
  clientMessageId: string | null;
  kind: string;
  body: string | null;
  gifProviderId: string | null;
  media: Array<{ id: string; kind: string; url: string | null; durationMs: number | null; width: number | null; height: number | null }>;
  replyToId: string | null;
  reactions: Array<{ emoji: string; userId: string }>;
  safetyWarning: boolean;
  aiAssisted: boolean;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

/**
 * Mutual-match messaging (BRD §11, TECH §10). Every operation re-checks membership, conversation state, match state,
 * blocks and account restrictions. Text passes the admin-managed moderation rules: "warn" messages are delivered with
 * a safety warning, "hide" messages are withheld from the recipient and raise a safety signal.
 */
@Injectable()
export class ChatService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly bus: RealtimeBus,
    private readonly outbox: OutboxService,
    private readonly moderation: TextModerationService,
    private readonly analytics: AnalyticsService,
    private readonly flags: FlagsService,
    private readonly facts: UserFactsService,
    private readonly settings: SettingsService,
    private readonly jobs: JobScheduler,
  ) {}

  onModuleInit(): void {
    this.outbox.on('match.created', async (p) => {
      for (const uid of p.userIds as string[]) await this.bus.publish([uid], 'match.new', { matchId: p.matchId });
    });
    this.outbox.on('message.moderated', async (p) => {
      const m = await this.db.selectFrom('messages').selectAll().where('id', '=', String(p.messageId)).executeTakeFirst();
      if (!m?.sender_id) return;
      const members = (await this.db.selectFrom('conversation_members').select('user_id').where('conversation_id', '=', m.conversation_id).where('left_at', 'is', null).execute()).map((x) => x.user_id);
      const [dto] = await this.toDtos([m]);
      // Removed/hidden messages stay visible only to their sender (same rule as the history endpoint).
      if (['removed', 'hidden'].includes(m.moderation_status)) {
        await this.bus.publish([m.sender_id], 'message.updated', dto);
        await this.bus.publish(members.filter((u) => u !== m.sender_id), 'message.deleted', { messageId: m.id, conversationId: m.conversation_id });
      } else await this.bus.publish(members, 'message.updated', dto);
    });
    this.outbox.on('match.ended', async (p) => {
      const conv = await this.db.selectFrom('conversations as c').innerJoin('conversation_members as m', 'm.conversation_id', 'c.id').select(['c.id', 'm.user_id']).where('c.match_id', '=', String(p.matchId)).execute();
      await this.bus.publish(conv.map((c) => c.user_id), 'match.ended', { matchId: p.matchId, conversationId: conv[0]?.id ?? null });
    });
    // Retention (TECH §10): purge message bodies/media of closed conversations after the configured period.
    this.jobs.register('chat.retention', 6 * 3600, () => this.applyRetention());
  }

  // ------------------------------------------------------------------------------------ access

  private async membership(userId: string, conversationId: string, opts: { forWrite: boolean }) {
    const row = await this.db
      .selectFrom('conversations as c')
      .innerJoin('conversation_members as m', (j) => j.onRef('m.conversation_id', '=', 'c.id').on('m.user_id', '=', userId))
      .leftJoin('matches as mt', 'mt.id', 'c.match_id')
      .select(['c.id', 'c.kind', 'c.status', 'c.match_id', 'c.event_id', 'm.left_at', 'mt.status as match_status'])
      .where('c.id', '=', conversationId)
      .executeTakeFirst();
    if (!row || row.left_at) throw new AppError('NOT_FOUND');
    const members = (await this.db.selectFrom('conversation_members').select('user_id').where('conversation_id', '=', conversationId).where('left_at', 'is', null).execute()).map((m) => m.user_id);
    const others = members.filter((m) => m !== userId);
    if (opts.forWrite) {
      if (row.status !== 'active' || (row.kind === 'match' && row.match_status !== 'active')) throw new AppError('CONVERSATION_CLOSED');
      if (row.kind === 'match' && others[0] && (await blockedEitherWay(this.db, userId, others[0]))) throw new AppError('CONVERSATION_CLOSED');
      const restricted = await this.db.selectFrom('account_restrictions').select('kind').where('user_id', '=', userId).where('kind', '=', 'no_messaging').where('lifted_at', 'is', null)
        .where((eb) => eb.or([eb('ends_at', 'is', null), eb('ends_at', '>', new Date())])).executeTakeFirst();
      if (restricted) throw new AppError('FORBIDDEN', 'Messaging is restricted on this account');
    }
    return { ...row, members, others };
  }

  // ------------------------------------------------------------------------------------ reads

  private memberConversations(userId: string) {
    const sortExpr = sql<Date>`coalesce(cv.last_message_at, cv.created_at)`;
    const qb = this.db
      .selectFrom('conversations as cv')
      .innerJoin('conversation_members as me', (j) => j.onRef('me.conversation_id', '=', 'cv.id').on('me.user_id', '=', userId))
      .select(['cv.id', 'cv.kind', 'cv.match_id', 'cv.event_id', 'cv.status', 'cv.last_message_at', 'cv.created_at', 'me.last_read_message_id', 'me.muted_until', 'me.archived_at', sortExpr.as('sort_at')])
      .where('me.left_at', 'is', null)
      .where('cv.status', '<>', 'locked_by_moderation');
    return { qb, sortExpr };
  }

  /** One conversation in the same shape as the list items (deep links, push taps, app restarts). */
  async conversation(userId: string, conversationId: string) {
    const row = await this.memberConversations(userId).qb.where('cv.id', '=', conversationId).executeTakeFirst();
    if (!row) throw new AppError('NOT_FOUND');
    return (await this.conversationItems(userId, [row]))[0]!;
  }

  async listConversations(userId: string, limit: number, cursor?: string) {
    const c = decodeCursor<[string, string]>(cursor, 2);
    const base = this.memberConversations(userId);
    const sortExpr = base.sortExpr;
    let qb = base.qb
      .orderBy(sortExpr, 'desc')
      .orderBy('cv.id', 'desc')
      .limit(limit + 1);
    if (c) qb = qb.where((eb) => eb.or([eb(sortExpr, '<', new Date(c[0])), eb.and([eb(sortExpr, '=', new Date(c[0])), eb('cv.id', '<', c[1])])]));
    const rows = await qb.execute();
    const page = rows.slice(0, limit);
    return {
      items: await this.conversationItems(userId, page),
      nextCursor: rows.length > limit ? encodeCursor([new Date(page.at(-1)!.sort_at).toISOString(), page.at(-1)!.id]) : null,
    };
  }

  private async conversationItems(userId: string, page: Array<{ id: string; kind: string; match_id: string | null; event_id: string | null; status: string; last_message_at: string | Date | null; muted_until: string | Date | null; archived_at: string | Date | null }>) {
    const ids = page.map((p) => p.id);
    const [partners, unread] = ids.length
      ? await Promise.all([
          this.db.selectFrom('conversation_members as m').innerJoin('user_profiles as p', 'p.user_id', 'm.user_id').select(['m.conversation_id', 'm.user_id', 'p.display_name']).where('m.conversation_id', 'in', ids).where('m.user_id', '<>', userId).execute(),
          this.db.selectFrom('messages as msg').innerJoin('conversation_members as me', (j) => j.onRef('me.conversation_id', '=', 'msg.conversation_id').on('me.user_id', '=', userId))
            .select(['msg.conversation_id', sql<number>`count(*)::int`.as('n')])
            .where('msg.conversation_id', 'in', ids).where('msg.sender_id', '<>', userId).where('msg.deleted_at', 'is', null).where('msg.moderation_status', 'in', ['clean', 'flagged'])
            .where((eb) => eb.or([eb('me.last_read_at', 'is', null), eb('msg.created_at', '>', eb.ref('me.last_read_at'))]))
            .groupBy('msg.conversation_id').execute(),
        ])
      : [[], []];
    return page.map((r) => ({
        id: r.id, kind: r.kind, matchId: r.match_id, eventId: r.event_id, status: r.status, lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
        muted: !!r.muted_until && new Date(r.muted_until) > new Date(), archived: !!r.archived_at,
        unreadCount: unread.find((u) => u.conversation_id === r.id)?.n ?? 0,
        participants: partners.filter((p) => p.conversation_id === r.id).map((p) => ({ userId: p.user_id, displayName: p.display_name })),
      }));
  }

  async messages(userId: string, conversationId: string, limit: number, before?: string): Promise<{ items: MessageDto[]; nextCursor: string | null }> {
    await this.membership(userId, conversationId, { forWrite: false });
    const c = decodeCursor<[string, string]>(before, 2);
    let qb = this.db
      .selectFrom('messages')
      .selectAll()
      .where('conversation_id', '=', conversationId)
      // Hidden/removed messages are visible only to their sender.
      .where((eb) => eb.or([eb('moderation_status', 'in', ['clean', 'flagged', 'pending']), eb('sender_id', '=', userId)]))
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1);
    if (c) qb = qb.where((eb) => eb.or([eb('created_at', '<', new Date(c[0])), eb.and([eb('created_at', '=', new Date(c[0])), eb('id', '<', c[1])])]));
    const rows = await qb.execute();
    const page = rows.slice(0, limit);
    return { items: await this.toDtos(page), nextCursor: rows.length > limit ? encodeCursor([new Date(page.at(-1)!.created_at).toISOString(), page.at(-1)!.id]) : null };
  }

  // ------------------------------------------------------------------------------------ uploads

  /** Presigned upload for chat media; returns a signed token the client passes back when sending the message. */
  async requestUpload(userId: string, conversationId: string, kind: 'image' | 'voice', mimeType: string, byteSize: number, durationMs?: number) {
    await this.membership(userId, conversationId, { forWrite: true });
    if (kind === 'voice') await this.flags.assertEnabled('voice_messages', await this.facts.load(userId));
    if (!CHAT_MIME[kind].includes(mimeType)) throw new AppError('MEDIA_TYPE_NOT_ALLOWED', undefined, { allowed: CHAT_MIME[kind] });
    if (byteSize > CHAT_MAX_BYTES[kind]) throw new AppError('MEDIA_TOO_LARGE', undefined, { maxBytes: CHAT_MAX_BYTES[kind] });
    const key = `c/${conversationId}/${userId}/${randomUUID()}`;
    const uploadUrl = await this.storage.signedUploadUrl(key, mimeType, byteSize, this.cfg.MEDIA_UPLOAD_URL_TTL_SECONDS);
    const payload = Buffer.from(JSON.stringify({ u: userId, c: conversationId, k: key, t: kind, m: mimeType, s: byteSize, d: durationMs ?? null, e: Date.now() + UPLOAD_TOKEN_TTL_MS })).toString('base64url');
    const sig = hmac(this.cfg.SIGNING_SECRET, payload).toString('base64url');
    return { uploadUrl, method: 'PUT', headers: { 'Content-Type': mimeType }, uploadToken: `${payload}.${sig}` };
  }

  private verifyUploadToken(token: string, userId: string, conversationId: string) {
    const [payload, sig] = token.split('.');
    if (!payload || !sig || !safeEqual(hmac(this.cfg.SIGNING_SECRET, payload), Buffer.from(sig, 'base64url'))) throw new AppError('UPLOAD_TOKEN_INVALID');
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u: string; c: string; k: string; t: 'image' | 'voice'; m: string; s: number; d: number | null; e: number };
    if (p.u !== userId || p.c !== conversationId || p.e < Date.now()) throw new AppError('UPLOAD_TOKEN_INVALID');
    return p;
  }

  // ------------------------------------------------------------------------------------ send

  async send(userId: string, conversationId: string, input: SendMessage): Promise<MessageDto> {
    // Idempotent retries: same client id returns the original message.
    const dup = await this.existingByClientId(userId, conversationId, input.clientMessageId);
    if (dup) return dup;
    const conv = await this.membership(userId, conversationId, { forWrite: true });
    await this.rateLimit(userId);
    if (input.replyToId) {
      const parent = await this.db.selectFrom('messages').select('conversation_id').where('id', '=', input.replyToId).executeTakeFirst();
      if (!parent || parent.conversation_id !== conversationId) throw new AppError('VALIDATION_FAILED', 'replyToId must be in this conversation');
    }

    let upload: ReturnType<ChatService['verifyUploadToken']> | null = null;
    if (input.uploadToken) {
      upload = this.verifyUploadToken(input.uploadToken, userId, conversationId);
      if (upload.t !== input.kind) throw new AppError('UPLOAD_TOKEN_INVALID');
      const head = await this.storage.head(upload.k);
      if (!head) throw new AppError('MEDIA_NOT_UPLOADED');
      if (head.byteSize > upload.s) throw new AppError('MEDIA_TOO_LARGE');
    }

    const scan = input.body ? await this.moderation.scan('message', input.body) : { action: 'allow' as const, score: 0, signals: [] as string[], matchedRules: [] as string[] };
    const status = scan.action === 'hide' ? 'hidden' : scan.action === 'warn' ? 'flagged' : upload ? 'pending' : 'clean';

    let msg;
    try {
      msg = await this.db.transaction().execute(async (trx) => {
        const m = await trx.insertInto('messages').values({
          conversation_id: conversationId, sender_id: userId, client_message_id: input.clientMessageId, kind: input.kind, body: input.body ?? null,
          gif_provider_id: input.gifProviderId ?? null, reply_to_id: input.replyToId ?? null, ai_assisted: input.aiAssisted, moderation_status: status, spam_score: scan.score || null,
        }).returningAll().executeTakeFirstOrThrow();
        if (upload) {
          await trx.insertInto('message_media').values({ message_id: m.id, kind: upload.t, storage_key: upload.k, mime_type: upload.m, byte_size: upload.s, duration_ms: upload.d, processing_status: 'ready', moderation_status: 'pending' }).execute();
          await this.outbox.enqueue(trx, 'message.media_uploaded', { messageId: m.id }, { aggregateId: m.id });
        }
        if (status !== 'hidden') await trx.updateTable('conversations').set({ last_message_at: m.created_at }).where('id', '=', conversationId).execute();
        if (scan.signals.length) {
          await trx.insertInto('safety_events').values(scan.signals.map((signal) => ({
            user_id: userId, signal, source: 'text_moderation', score: scan.score,
            ref_type: 'message', ref_id: m.id, details: JSON.stringify({ rules: scan.matchedRules, action: scan.action }),
          }))).execute();
        }
        if (status !== 'hidden') await this.outbox.enqueue(trx, 'message.created', { messageId: m.id, conversationId, senderId: userId, recipientIds: conv.others }, { aggregateId: conversationId });
        await this.advanceJourney(trx, conv.match_id, conversationId);
        return m;
      });
    } catch (err) {
      // A concurrent request with the same client id won the insert (UNIQUE (sender_id, client_message_id)):
      // this request is a retry of it, so answer with that message.
      if ((err as { code?: string; constraint?: string }).code === '23505') {
        const winner = await this.existingByClientId(userId, conversationId, input.clientMessageId);
        if (winner) return winner;
      }
      throw err;
    }

    const [dto] = await this.toDtos([msg]);
    await this.bus.publish(status === 'hidden' ? [userId] : conv.members, 'message.new', dto);
    await this.analytics.track('message_sent', { userId, properties: { kind: input.kind, aiAssisted: input.aiAssisted, moderation: status } });
    return dto!;
  }

  private async existingByClientId(userId: string, conversationId: string, clientMessageId: string): Promise<MessageDto | null> {
    const dup = await this.db.selectFrom('messages').selectAll().where('sender_id', '=', userId).where('client_message_id', '=', clientMessageId).executeTakeFirst();
    if (!dup) return null;
    if (dup.conversation_id !== conversationId) throw new AppError('CONFLICT', 'clientMessageId reused');
    return (await this.toDtos([dup]))[0]!;
  }

  /** conversation stage starts when both people have sent at least one visible message. */
  private async advanceJourney(trx: Tx, matchId: string | null, conversationId: string): Promise<void> {
    if (!matchId) return;
    const j = await trx.selectFrom('relationship_journeys').select(['stage', 'conversation_at']).where('match_id', '=', matchId).executeTakeFirst();
    if (!j || j.conversation_at) return;
    const senders = await trx.selectFrom('messages').select('sender_id').distinct().where('conversation_id', '=', conversationId).where('moderation_status', '<>', 'hidden').where('sender_id', 'is not', null).execute();
    if (senders.length < 2) return;
    await trx.updateTable('relationship_journeys').set({ conversation_at: new Date(), stage: j.stage === 'matched' ? 'conversation' : j.stage }).where('match_id', '=', matchId).execute();
    await trx.insertInto('analytics_events').values({ name: 'conversation_started', user_id: null, platform: 'server', properties: JSON.stringify({ matchId }) }).execute();
  }

  private async rateLimit(userId: string): Promise<void> {
    const perMinute = await this.settings.get<number>('chat.max_messages_per_minute', 30);
    const { n } = await this.db.selectFrom('messages').select(sql<number>`count(*)::int`.as('n')).where('sender_id', '=', userId).where('created_at', '>', new Date(Date.now() - 60_000)).executeTakeFirstOrThrow();
    if (n >= perMinute) {
      await this.db.insertInto('safety_events').values({ user_id: userId, signal: 'velocity', source: 'chat.rate_limit', score: 0.5, details: JSON.stringify({ perMinute }) }).execute();
      throw new AppError('RATE_LIMITED', 'Slow down', { retryAfterSeconds: 60 });
    }
  }

  // ------------------------------------------------------------------------------------ interactions

  async react(userId: string, messageId: string, emoji: string, add: boolean) {
    const m = await this.db.selectFrom('messages').select(['conversation_id', 'deleted_at']).where('id', '=', messageId).executeTakeFirst();
    if (!m || m.deleted_at) throw new AppError('NOT_FOUND');
    const conv = await this.membership(userId, m.conversation_id, { forWrite: true });
    if (add) await this.db.insertInto('message_reactions').values({ message_id: messageId, user_id: userId, emoji }).onConflict((oc) => oc.doNothing()).execute();
    else await this.db.deleteFrom('message_reactions').where('message_id', '=', messageId).where('user_id', '=', userId).where('emoji', '=', emoji).execute();
    await this.bus.publish(conv.members, 'reaction', { messageId, conversationId: m.conversation_id, userId, emoji, added: add });
  }

  async markRead(userId: string, conversationId: string, messageId: string) {
    const conv = await this.membership(userId, conversationId, { forWrite: false });
    const m = await this.db.selectFrom('messages').select(['created_at', 'conversation_id']).where('id', '=', messageId).executeTakeFirst();
    if (!m || m.conversation_id !== conversationId) throw new AppError('NOT_FOUND');
    await this.db.updateTable('conversation_members').set({ last_read_message_id: messageId, last_read_at: m.created_at, last_delivered_message_id: messageId })
      .where('conversation_id', '=', conversationId).where('user_id', '=', userId)
      .where((eb) => eb.or([eb('last_read_at', 'is', null), eb('last_read_at', '<', m.created_at)])).execute();
    // Read receipts respect the reader's privacy setting.
    const ps = await this.db.selectFrom('user_privacy_settings').select('show_read_receipts').where('user_id', '=', userId).executeTakeFirst();
    if (ps?.show_read_receipts !== false) await this.bus.publish(conv.others, 'read', { conversationId, userId, messageId });
  }

  async markDelivered(userId: string, conversationId: string, messageId: string) {
    const conv = await this.membership(userId, conversationId, { forWrite: false });
    await this.db.updateTable('conversation_members').set({ last_delivered_message_id: messageId }).where('conversation_id', '=', conversationId).where('user_id', '=', userId).execute();
    await this.bus.publish(conv.others, 'delivered', { conversationId, userId, messageId });
  }

  async typing(userId: string, conversationId: string, isTyping: boolean) {
    const conv = await this.membership(userId, conversationId, { forWrite: true });
    await this.bus.publish(conv.others, 'typing', { conversationId, userId, isTyping });
  }

  async deleteMessage(userId: string, messageId: string) {
    const m = await this.db.selectFrom('messages').select(['sender_id', 'conversation_id', 'created_at', 'deleted_at']).where('id', '=', messageId).executeTakeFirst();
    if (!m || m.sender_id !== userId || m.deleted_at) throw new AppError('NOT_FOUND');
    if (Date.now() - new Date(m.created_at).getTime() > DELETE_FOR_EVERYONE_MS) throw new AppError('CONFLICT', 'Messages can only be deleted for everyone within an hour');
    const conv = await this.membership(userId, m.conversation_id, { forWrite: false });
    // Body is cleared but the row (and any report evidence snapshot) remains for safety review.
    await this.db.updateTable('messages').set({ deleted_at: new Date(), body: null }).where('id', '=', messageId).execute();
    await this.bus.publish(conv.members, 'message.deleted', { messageId, conversationId: m.conversation_id });
  }

  async setMuted(userId: string, conversationId: string, until: Date | null) {
    await this.membership(userId, conversationId, { forWrite: false });
    await this.db.updateTable('conversation_members').set({ muted_until: until }).where('conversation_id', '=', conversationId).where('user_id', '=', userId).execute();
  }

  /** Admin-managed icebreakers resolved against what the two people actually share (BRD §11). */
  async icebreakers(userId: string, conversationId: string, locale: string) {
    const conv = await this.membership(userId, conversationId, { forWrite: false });
    const other = conv.others[0];
    if (!other) return [];
    const [shared, theirPrompts, other_profile, templates] = await Promise.all([
      this.db.selectFrom('user_interests as a').innerJoin('user_interests as b', 'b.interest_id', 'a.interest_id').innerJoin('interests as i', 'i.id', 'a.interest_id')
        .select(['i.key']).where('a.user_id', '=', userId).where('b.user_id', '=', other).execute(),
      this.db.selectFrom('profile_prompts as pp').innerJoin('prompt_catalog as pc', 'pc.id', 'pp.prompt_id').select(['pc.key']).where('pp.user_id', '=', other).where('pp.moderation_status', '=', 'approved').execute(),
      this.db.selectFrom('user_profiles').select('display_name').where('user_id', '=', other).executeTakeFirst(),
      this.db.selectFrom('icebreaker_templates as t').innerJoin('icebreaker_template_translations as tr', 'tr.template_id', 't.id')
        .select(['t.id', 't.key', 't.trigger_type', 't.trigger_ref', 'tr.locale', 'tr.text']).where('t.is_active', '=', true).where('tr.locale', 'in', localeChain(locale)).execute(),
    ]);
    const interestLabels = new Map((await this.db.selectFrom('interests as i').innerJoin('interest_translations as t', 't.interest_id', 'i.id').select(['i.key', 't.locale', 't.label']).where('i.key', 'in', shared.map((s) => s.key).concat(['__none__'])).where('t.locale', 'in', localeChain(locale)).execute())
      .reduce((m, r) => (m.has(r.key) ? m : m.set(r.key, r.label)), new Map<string, string>()));
    const byTemplate = new Map<string, typeof templates>();
    for (const t of templates) byTemplate.set(t.id, [...(byTemplate.get(t.id) ?? []), t]);
    const out: Array<{ key: string; text: string }> = [];
    for (const rows of byTemplate.values()) {
      const t = pickTranslation(rows, locale)!;
      const fill = (text: string, vars: Record<string, string>) => text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
      if (t.trigger_type === 'shared_interest') {
        const hit = shared.find((s) => !t.trigger_ref || s.key === t.trigger_ref);
        if (hit) out.push({ key: t.key, text: fill(t.text, { interest: interestLabels.get(hit.key) ?? hit.key, name: other_profile?.display_name ?? '' }) });
      } else if (t.trigger_type === 'prompt') {
        if (theirPrompts.some((p) => p.key === t.trigger_ref)) out.push({ key: t.key, text: fill(t.text, { name: other_profile?.display_name ?? '' }) });
      } else if (t.trigger_type === 'generic') {
        out.push({ key: t.key, text: fill(t.text, { name: other_profile?.display_name ?? '' }) });
      }
    }
    return out.slice(0, 5);
  }

  // ------------------------------------------------------------------------------------ helpers

  private async toDtos(rows: Array<{ id: string; conversation_id: string; sender_id: string | null; client_message_id: string | null; kind: string; body: string | null; gif_provider_id: string | null; reply_to_id: string | null; moderation_status: string; ai_assisted: boolean; created_at: string | Date; edited_at: string | Date | null; deleted_at: string | Date | null }>): Promise<MessageDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [media, reactions] = await Promise.all([
      this.db.selectFrom('message_media').selectAll().where('message_id', 'in', ids).execute(),
      this.db.selectFrom('message_reactions').select(['message_id', 'emoji', 'user_id']).where('message_id', 'in', ids).execute(),
    ]);
    return Promise.all(rows.map(async (r) => ({
      id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, clientMessageId: r.client_message_id, kind: r.kind,
      body: r.deleted_at ? null : r.body, gifProviderId: r.gif_provider_id,
      media: r.deleted_at ? [] : await Promise.all(media.filter((m) => m.message_id === r.id && m.moderation_status !== 'rejected').map(async (m) => ({
        id: m.id, kind: m.kind, url: await this.storage.signedDownloadUrl(m.storage_key, this.cfg.MEDIA_DOWNLOAD_URL_TTL_SECONDS), durationMs: m.duration_ms, width: m.width, height: m.height,
      }))),
      replyToId: r.reply_to_id,
      reactions: reactions.filter((x) => x.message_id === r.id).map((x) => ({ emoji: x.emoji, userId: x.user_id })),
      safetyWarning: r.moderation_status === 'flagged',
      aiAssisted: r.ai_assisted,
      createdAt: new Date(r.created_at).toISOString(),
      editedAt: r.edited_at ? new Date(r.edited_at).toISOString() : null,
      deleted: !!r.deleted_at,
    })));
  }

  private async applyRetention(): Promise<void> {
    const policy = await this.db.selectFrom('retention_policies').select(['retention_days', 'action']).where('entity', '=', 'messages').executeTakeFirst();
    if (!policy) return;
    const cutoff = new Date(Date.now() - policy.retention_days * 86_400_000);
    // Only closed conversations; never touch messages referenced by open moderation cases.
    const stale = this.db.selectFrom('messages as m').innerJoin('conversations as c', 'c.id', 'm.conversation_id').select('m.id')
      .where('c.status', '=', 'closed').where('m.created_at', '<', cutoff).where('m.body', 'is not', null)
      .where((eb) => eb.not(eb.exists(eb.selectFrom('case_evidence as e').innerJoin('moderation_cases as mc', 'mc.id', 'e.case_id').select(sql`1`.as('x')).whereRef('e.ref_id', '=', 'm.id').where('mc.status', 'in', ['open', 'in_review', 'escalated']))));
    const keys = await this.db.selectFrom('message_media').select('storage_key').where('message_id', 'in', stale).execute();
    for (const k of keys) await this.storage.delete(k.storage_key);
    await this.db.deleteFrom('message_media').where('message_id', 'in', stale).execute();
    await this.db.updateTable('messages').set({ body: null, deleted_at: sql`coalesce(deleted_at, now())` }).where('id', 'in', stale).execute();
  }
}
